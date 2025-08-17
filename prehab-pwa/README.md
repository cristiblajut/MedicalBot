# Prehab Coach — ERAS + ESPEN PWA

A lightweight offline-capable web app that generates a personalized surgical prehabilitation plan based on common principles from ERAS and ESPEN guidelines.

This app is educational and not a substitute for medical advice. Follow your care team's instructions.

## Run locally

Any static server works. Examples:

```bash
# Python
python3 -m http.server 8000 --directory /workspace/prehab-pwa

# Or Node (if available)
# npx serve /workspace/prehab-pwa -p 8000 --single
```

Then open: `http://localhost:8000/index.html`

The app registers a Service Worker and works offline after first load. You can install it as a PWA using the Settings tab or your browser's install prompt.

## Features

- Patient profile wizard (age, height, weight, surgery, risks)
- Personalized plan: exercise, nutrition (ESPEN-aligned targets), lifestyle, medical optimization
- ERAS-aligned checklists for pre-op week and day-of
- Education cards and references
- Offline support (service worker) and installable PWA
- Export plan to JSON and print to PDF

## Disclaimer

- This summarizes common principles and does not copy or quote proprietary guideline content.
- Always follow local protocols and clinician advice.