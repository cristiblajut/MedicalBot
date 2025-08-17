const SELECTORS = {
  tabs: ".tab",
  views: ".view",
  profileForm: "#profile-form",
  resetProfile: "#reset-profile",
  planContent: "#plan-content",
  preopWeek: "#preop-week",
  dayOf: "#day-of",
  eduContent: "#education-content",
  printPlan: "#print-plan",
  exportPlan: "#export-plan",
  exportIcs: "#export-ics",
  clearData: "#clear-data",
  installBtn: "#install-btn",
  swStatus: "#sw-status",
};

const STORAGE_KEYS = {
  profile: "prehab.profile.v1",
  plan: "prehab.plan.v1",
};

const state = {
  deferredPrompt: null,
};

function select(el, all = false) {
  return all ? Array.from(document.querySelectorAll(el)) : document.querySelector(el);
}

function daysUntil(dateStr) {
  const today = new Date();
  const date = new Date(dateStr);
  const ms = date.setHours(0,0,0,0) - today.setHours(0,0,0,0);
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function computeBMI(heightCm, weightKg) {
  const h = Number(heightCm) / 100;
  if (!h) return null;
  return Number(weightKg) / (h * h);
}

function formatNumber(n, digits = 1) {
  return Number(n).toFixed(digits);
}

function readProfileFromForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const heightCm = Number(data.heightCm);
  const weightKg = Number(data.weightKg);
  const bmi = computeBMI(heightCm, weightKg);
  const untilDays = daysUntil(data.surgeryDate);
  return {
    ...data,
    heightCm,
    weightKg,
    bmi,
    untilDays,
  };
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function load(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function idealBodyWeightKg(heightCm, sex) {
  // Devine formula
  const heightInches = heightCm / 2.54;
  const base = sex === "Male" ? 50 : 45.5;
  return base + 2.3 * Math.max(0, heightInches - 60);
}

function adjustedBodyWeightKg(actualKg, idealKg) {
  // Common approach when BMI > 30
  return idealKg + 0.25 * (actualKg - idealKg);
}

function proteinTargetGPerDay(profile) {
  const { weightKg, sex, bmi, malnutritionRisk, magnitude } = profile;
  const ibw = idealBodyWeightKg(profile.heightCm, sex);
  const obese = bmi >= 30;
  const major = magnitude === "Major";
  const highRisk = malnutritionRisk === "Yes" || major;
  const perKg = highRisk ? 1.5 : 1.2; // ESPEN: general 1.2–1.5 g/kg/day depending on risk
  const refWeight = obese ? adjustedBodyWeightKg(weightKg, ibw) : weightKg;
  return Math.round(perKg * refWeight);
}

function energyTargetKcalPerDay(profile) {
  // ESPEN: 25–30 kcal/kg/day typical range; use 28 as mid-point; use adjusted weight if BMI >= 30
  const { weightKg, sex, bmi } = profile;
  const ibw = idealBodyWeightKg(profile.heightCm, sex);
  const refWeight = bmi >= 30 ? adjustedBodyWeightKg(weightKg, ibw) : weightKg;
  return Math.round(28 * refWeight);
}

function buildPlan(profile) {
  const plan = { profile, modules: [], summary: {}, checklists: {}, education: [] };

  const proteinG = proteinTargetGPerDay(profile);
  const energyKcal = energyTargetKcalPerDay(profile);
  const baseFluidsMl = 30 * profile.weightKg; // 25–35 ml/kg/day; choose 30 ml/kg as a simple average
  const fluidsMl = profile.fluidRestricted === "Yes" ? null : baseFluidsMl;

  const risks = [];
  if (profile.bmi < 18.5) risks.push("underweight");
  if (profile.bmi >= 35) risks.push("severe obesity");
  if (profile.lowCapacity === "Yes") risks.push("low functional capacity");
  if (profile.anemia === "Yes") risks.push("anemia");
  if (profile.malnutritionRisk === "Yes") risks.push("malnutrition risk");
  if (Number(profile.weightLossPct) >= 5) risks.push("recent weight loss");
  if (profile.reducedIntake === "Yes") risks.push("reduced recent intake");
  if (profile.smoker === "Yes") risks.push("tobacco");
  if (profile.alcoholHigh === "Yes") risks.push("alcohol");
  if (profile.diabetes === "Yes") risks.push("diabetes");

  plan.summary = {
    bmi: profile.bmi ? Number(profile.bmi.toFixed(1)) : null,
    untilDays: profile.untilDays,
    energyKcal,
    proteinG,
    fluidsMl,
    risks,
  };

  // Exercise module
  const weeks = Math.max(0, Math.ceil(profile.untilDays / 7));
  const baselineMinutes = profile.lowCapacity === "Yes" ? 60 : 90;
  const targetMinutes = weeks >= 4 ? baselineMinutes + 60 : baselineMinutes;
  const imtRecommended = ["Thoracic", "Upper GI / HPB"].includes(profile.surgeryType);
  plan.modules.push({
    id: "exercise",
    title: "Exercise and conditioning",
    items: [
      `Aerobic training: aim for ${targetMinutes} minutes/week moderate intensity (e.g., brisk walking or cycling), split 4–5 days/week.`,
      "Strength training: 2–3 sessions/week full-body (bodyweight or bands).",
      profile.lowCapacity === "Yes" ? "Start with 10–15 minutes/day and progress by 10% each week." : "Include intervals to raise heart rate comfortably.",
      imtRecommended ? "Inspiratory muscle training (IMT): 2 sessions/day, 15–20 minutes, using threshold device if available." : null,
      "Daily activity: 6–8k steps/day if able; break up sitting every 30–60 minutes.",
    ].filter(Boolean),
  });

  // Nutrition module (ESPEN-aligned)
  const nutritionItems = [
    `Energy target: about ${energyKcal} kcal/day (estimate).`,
    `Protein target: about ${proteinG} g/day (generally 1.2–1.5 g/kg/day).`,
    profile.malnutritionRisk !== "No" || Number(profile.weightLossPct) >= 5 || profile.reducedIntake === "Yes"
      ? "Use high-protein oral nutrition supplements between meals if intake is inadequate. Consider dietitian referral."
      : "Prioritize whole foods; distribute protein across meals.",
  ];
  nutritionItems.push(
    profile.fluidRestricted === "Yes"
      ? "Fluid intake as per your clinician's restriction."
      : "Include 25–35 ml/kg/day of fluids unless restricted."
  );
  if (profile.magnitude !== "Minor") {
    nutritionItems.push("Consider carbohydrate loading per protocol: evening before ~800 mL 12–14% CHO drink; 2–3 hours pre-op ~400 mL.");
  }
  plan.modules.push({ id: "nutrition", title: "Nutrition", items: nutritionItems });

  // Lifestyle module
  if (profile.smoker === "Yes" || profile.alcoholHigh === "Yes") {
    const items = [];
    if (profile.smoker === "Yes") items.push("Stop all nicotine now; even 2–4 weeks improves outcomes. Consider NRT or varenicline/bupropion per clinician.");
    if (profile.alcoholHigh === "Yes") items.push("Stop or reduce alcohol ideally ≥4 weeks pre-op; seek support to prevent withdrawal and ensure safety.");
    plan.modules.push({ id: "lifestyle", title: "Lifestyle risk reduction", items });
  }

  // Medical optimization module
  const medItems = [];
  if (profile.anemia !== "No") medItems.push("Check hemoglobin and iron studies; treat iron deficiency (oral or IV) per protocol.");
  if (profile.diabetes === "Yes") medItems.push("Optimize glucose; typical periop target 80–180 mg/dL (4.4–10 mmol/L). Consult your team for medication plan.");
  if (profile.sglt2 === "Yes") medItems.push("SGLT2 inhibitor: discuss perioperative hold timing to reduce risk of ketoacidosis.");
  if (profile.glp1 === "Yes") medItems.push("GLP-1 RA: discuss perioperative plan to reduce risk of delayed gastric emptying.");
  if (profile.anticoag === "Yes") medItems.push("Anticoagulant/antiplatelet: confirm hold/bridging plan as per surgeon/anesthesia.");
  medItems.push("Medication review with clinician: anticoagulants, antiplatelets, SGLT2i, GLP-1 RA, ACE/ARB — follow local guidance.");
  plan.modules.push({ id: "medical", title: "Medical optimization", items: medItems });

  // Education modules remain the same
  plan.education = [
    { title: "What is ERAS?", body: "Enhanced Recovery After Surgery pathways reduce complications by optimizing nutrition, pain control, mobilization, and minimizing fasting and tubes." },
    { title: "ESPEN nutrition basics", body: "Screen for malnutrition risk. Typical targets: 25–30 kcal/kg/day and 1.2–1.5 g/kg/day protein (adjust per clinical context). Use supplements if needed." },
    { title: "Fasting and carbohydrate loading", body: "Unless told otherwise: clear fluids up to 2 hours before anesthesia, solids up to 6 hours. Many pathways use carbohydrate drinks the evening before and 2–3 hours pre-op." },
    { title: "Pain, nausea, and bowel care", body: "Multimodal analgesia reduces opioids; antiemetics prevent nausea; early oral intake and mobilization support bowel recovery." },
    { title: "Early mobilization", body: "Plan your first walk early after surgery as advised. Sitting up and walking multiple times daily reduces complications." },
  ];

  // Checklists
  plan.checklists.preopWeek = [
    "Confirm surgery date/time and arrival instructions.",
    "Complete pre-op labs/EKG/clearances as instructed.",
    profile.smoker === "Yes" ? "Stop nicotine; use supports as arranged." : null,
    profile.alcoholHigh === "Yes" ? "Reduce/stop alcohol; monitor for withdrawal risk under medical guidance." : null,
    Number(profile.weightLossPct) >= 5 || profile.reducedIntake === "Yes" ? "Track daily intake; add high-protein snacks/supplements to meet targets." : null,
    "Practice breathing/IMT and your exercise plan.",
    "Meal-prep high-protein options and stock oral supplements if needed.",
    "Arrange help at home and plan transport.",
  ].filter(Boolean);

  plan.checklists.dayOf = [
    "Follow fasting instructions (clear fluids up to 2 h; solids up to 6 h unless told otherwise).",
    profile.magnitude !== "Minor" ? "Take carbohydrate drink per protocol if instructed (2–3 h before)." : null,
    profile.sglt2 === "Yes" ? "Confirm SGLT2i hold as instructed." : null,
    profile.glp1 === "Yes" ? "Confirm GLP-1 RA plan as instructed." : null,
    profile.anticoag === "Yes" ? "Confirm anticoagulant/antiplatelet plan as instructed." : null,
    "Take morning medications only as instructed.",
    "Bring ID, medication list, inhalers/devices, and plan for postoperative support.",
  ].filter(Boolean);

  return plan;
}

function renderPlan(plan) {
  const container = select(SELECTORS.planContent);
  if (!plan) {
    container.innerHTML = `<div class="card"><p>No plan yet. Create a profile to generate your plan.</p></div>`;
    return;
  }
  const p = plan.profile;
  const s = plan.summary;
  const modulesHtml = plan.modules.map(m => `
    <section class="card">
      <h3>${m.title}</h3>
      <ul>${m.items.map(i => `<li>${i}</li>`).join("")}</ul>
    </section>
  `).join("");

  container.innerHTML = `
    <section class="card">
      <h3>At-a-glance</h3>
      <div class="grid two">
        <div>
          <p><strong>${p.firstName} ${p.lastName}</strong></p>
          <p>${p.surgeryType} — ${p.magnitude}</p>
          <p>Surgery in <strong>${s.untilDays}</strong> days</p>
        </div>
        <div>
          <p>BMI: <strong>${s.bmi ?? "—"}</strong></p>
          <p>Energy: <strong>${s.energyKcal}</strong> kcal/day</p>
          <p>Protein: <strong>${s.proteinG}</strong> g/day</p>
          <p>Fluids: <strong>${s.fluidsMl}</strong> mL/day</p>
        </div>
      </div>
      ${s.risks.length ? `<p>Risks flagged: ${s.risks.join(", ")}</p>` : ""}
    </section>
    ${modulesHtml}
  `;

  // Checklists
  const preopWeek = select(SELECTORS.preopWeek);
  const dayOf = select(SELECTORS.dayOf);
  preopWeek.innerHTML = plan.checklists.preopWeek.map(i => `<li>${i}</li>`).join("");
  dayOf.innerHTML = plan.checklists.dayOf.map(i => `<li>${i}</li>`).join("");

  // Education
  const edu = select(SELECTORS.eduContent);
  edu.innerHTML = plan.education.map(e => `
    <article class="card">
      <h3>${e.title}</h3>
      <p>${e.body}</p>
    </article>
  `).join("");
}

function restoreProfileToForm(profile) {
  const form = select(SELECTORS.profileForm);
  if (!profile) return;
  for (const [key, value] of Object.entries(profile)) {
    const el = form.elements[key];
    if (!el || typeof value === "object") continue;
    el.value = value;
  }
}

function switchView(targetSelector) {
  select(SELECTORS.views, true).forEach(v => v.classList.remove("visible"));
  select(SELECTORS.tabs, true).forEach(t => t.classList.remove("active"));
  const view = document.querySelector(targetSelector);
  const tab = Array.from(select(SELECTORS.tabs, true)).find(t => t.dataset.target === targetSelector);
  if (view) view.classList.add("visible");
  if (tab) tab.classList.add("active");
}

function bindNavigation() {
  select(SELECTORS.tabs, true).forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.target));
  });
}

function bindProfileForm() {
  const form = select(SELECTORS.profileForm);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const profile = readProfileFromForm(form);
    save(STORAGE_KEYS.profile, profile);
    const plan = buildPlan(profile);
    save(STORAGE_KEYS.plan, plan);
    renderPlan(plan);
    switchView("#plan");
  });
  select(SELECTORS.resetProfile).addEventListener("click", () => {
    form.reset();
  });
}

function bindPlanActions() {
  select(SELECTORS.printPlan).addEventListener("click", () => window.print());
  select(SELECTORS.exportPlan).addEventListener("click", () => {
    const plan = load(STORAGE_KEYS.plan);
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prehab-plan-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  const icsBtn = select(SELECTORS.exportIcs);
  if (icsBtn) {
    icsBtn.addEventListener("click", () => {
      const plan = load(STORAGE_KEYS.plan);
      if (!plan) return;
      const ics = generateIcs(plan);
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prehab-schedule-${Date.now()}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }
}

function pad2(n) { return String(n).padStart(2, "0"); }
function toUtcBasic(date) {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const mm = pad2(date.getUTCMinutes());
  const ss = pad2(date.getUTCSeconds());
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function generateIcs(plan) {
  const { profile } = plan;
  const dtSurgery = new Date(profile.surgeryDate);
  const events = [];

  // Weekly prehab blocks leading up to surgery (once per week)
  const weeks = Math.max(0, Math.ceil((plan.summary.untilDays || 0) / 7));
  for (let i = weeks; i >= 1; i--) {
    const d = new Date(dtSurgery);
    d.setDate(d.getDate() - i * 7);
    const start = new Date(d);
    start.setHours(17, 0, 0, 0);
    const end = new Date(d);
    end.setHours(18, 0, 0, 0);
    events.push({
      summary: "Prehab focus: exercise + nutrition",
      description: "Review targets and plan for the coming week.",
      start,
      end,
    });
  }

  // Day before: carbohydrate loading reminder (if applicable)
  if (profile.magnitude !== "Minor") {
    const dayBefore = new Date(dtSurgery);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const start = new Date(dayBefore);
    start.setHours(18, 0, 0, 0);
    const end = new Date(dayBefore);
    end.setHours(19, 0, 0, 0);
    events.push({
      summary: "Pre-op: carbohydrate drink (if instructed)",
      description: "Evening before ~800 mL 12–14% CHO per protocol.",
      start,
      end,
    });
  }

  // Morning of surgery: fasting/meds reminder
  const morning = new Date(dtSurgery);
  morning.setHours(6, 0, 0, 0);
  const morningEnd = new Date(dtSurgery);
  morningEnd.setHours(7, 0, 0, 0);
  events.push({
    summary: "Day-of: fasting/medications per instructions",
    description: "Clear fluids up to 2h; solids up to 6h unless told otherwise. Confirm meds plan.",
    start: morning,
    end: morningEnd,
  });

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Prehab Coach//EN",
  ];

  const now = new Date();
  for (const ev of events) {
    const uid = `prehab-${ev.start.getTime()}-${Math.random().toString(36).slice(2)}@local`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${toUtcBasic(now)}`,
      `DTSTART:${toUtcBasic(ev.start)}`,
      `DTEND:${toUtcBasic(ev.end)}`,
      `SUMMARY:${ev.summary.replace(/\n/g, " ")}`,
      `DESCRIPTION:${ev.description.replace(/\n/g, " ")}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function bindSettings() {
  select(SELECTORS.clearData).addEventListener("click", () => {
    if (confirm("Clear all saved data?")) {
      localStorage.clear();
      location.reload();
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").then((reg) => {
      select(SELECTORS.swStatus).textContent = `Offline ready${reg.installing ? " (installing)" : ""}.`;
    }).catch((err) => {
      select(SELECTORS.swStatus).textContent = `SW error: ${err?.message || err}`;
    });
  } else {
    select(SELECTORS.swStatus).textContent = "Service Worker not supported in this browser.";
  }
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    const btn = select(SELECTORS.installBtn);
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      btn.hidden = true;
      state.deferredPrompt?.prompt();
      const choice = await state.deferredPrompt?.userChoice;
      state.deferredPrompt = null;
    }, { once: true });
  });
}

function hydrate() {
  bindNavigation();
  bindProfileForm();
  bindPlanActions();
  bindSettings();
  registerServiceWorker();
  setupInstallPrompt();

  const profile = load(STORAGE_KEYS.profile);
  if (profile) restoreProfileToForm(profile);
  const plan = load(STORAGE_KEYS.plan);
  if (plan) renderPlan(plan);
}

hydrate();