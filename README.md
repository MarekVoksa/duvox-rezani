# Duvox Řezání

Cutting planner for 6 m window and door profiles at DUVOX s.r.o. It plans which lengths to cut from each bar (new bars or remnants from stock), keeps a stock of remnants and a history of plans, imports cutting lists from REF2MEN PDFs, and exports a printable PDF. The UI is in Czech.

## How it is built

Plain HTML, CSS and JavaScript, no framework. Everything is built into one file, `dist/index.html`.

| File | What it does |
| --- | --- |
| `src/ui.html` | Page shell and all CSS (Duvox website look: navy, cream, red and indigo slanted bars, Rokkitt font) |
| `src/optimizer.js` | Cutting-stock optimizer: tries bar patterns and scores plans on waste plus number of length changes (the "jednoduchost" slider) |
| `src/ref2men.js` | Reads REF2MEN "Seznam řezů" PDFs with pdf.js (loaded from cdnjs on demand), including the profile cross-section pictures |
| `src/pdf.js` | Printable A4 PDF export: pages drawn on a canvas, colors plus fill patterns so it also works in black and white |
| `src/app.js` | App: jobs, catalog (systems, profiles, colors), stock, history, import, plan screen |

## Data

Right now the app runs as a claude.ai Artifact and stores its shared data in the artifact database (collections `systems`, `profiles`, `colors`, `stock`, `jobs`, `history` and the doc `config/settings`). Opened outside claude.ai it falls back to the browser's localStorage, which is only per device. The storage code is the `put`, `del`, `putSettings` and `boot` functions at the top of `src/app.js`; that is the part to replace for own hosting with a shared backend.

## Build and test

```sh
./build.sh          # writes dist/index.html
npm install         # Playwright, for the tests
npm test            # builds, then drives the app in Chromium
```

The import test needs the sample REF2MEN PDF (not in the repo, it holds customer data) and pdf.js from a local folder: `PDFJS_DIR=path/to/pdfjs-dist/build node tests/imptest.js file.pdf`.

`tests/fakedb.js` imitates the artifact database (read-only snapshot data, slow taps), because those two behaviours caused real bugs that plain local runs did not show.
