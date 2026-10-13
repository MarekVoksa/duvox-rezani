# Duvox Řezání

Cutting planner for 6 m window and door profiles at DUVOX s.r.o. It plans which lengths to cut from each bar (new bars or remnants from stock), keeps a stock of remnants and a history of plans, imports cutting lists from REF2MEN PDFs, and exports a printable PDF. The UI is in Czech.

## How it is built

Plain HTML, CSS and JavaScript, no framework. `./build.sh` builds the website into `dist/` (served by the Cloudflare Worker) and the same app as one fragment into `build/artifact.html` (for the claude.ai artifact). How to deploy: [DEPLOY.md](DEPLOY.md).

| File | What it does |
| --- | --- |
| `src/ui.html` | Page shell and all CSS (Duvox website look: navy, cream, red and indigo slanted bars, Rokkitt font) |
| `src/optimizer.js` | Cutting-stock optimizer: tries bar patterns and scores plans on waste plus number of length changes (the "jednoduchost" slider) |
| `src/ref2men.js` | Reads REF2MEN "Seznam řezů" PDFs with pdf.js (loaded from cdnjs on demand), including the profile cross-section pictures |
| `src/pdf.js` | Printable A4 PDF export: pages drawn on a canvas, colors plus fill patterns so it also works in black and white |
| `src/app.js` | App: jobs, catalog (systems, profiles, colors), stock, history, import, plan screen, backup |
| `server/api.js` | Server part on Cloudflare: document store on D1, checks the Cloudflare Access sign-in on every request |
| `server/worker.js`, `wrangler.jsonc` | Cloudflare Worker: serves `dist/` and `/api/*` (`functions/` does the same for a Pages project) |
| `public/` | Icons and manifest, so phones can add the app to the home screen |

## Data

The app picks its storage when it starts:
- on claude.ai (the artifact): the artifact's shared database;
- on Cloudflare: the server in `functions/` (`/api/...`), polled every few seconds for changes from others;
- anywhere else (a plain file, a local preview without the server): the browser's localStorage, with example data.

All three hold the same collections (`systems`, `profiles`, `colors`, `stock`, `jobs`, `history`, and the doc `config/settings`). **Katalog → Data → Stáhnout zálohu / Nahrát zálohu** moves everything between them as one JSON file.

## Build and test

```sh
./build.sh          # writes dist/ and build/artifact.html
npm install         # Playwright, for the tests
npm test            # builds, then drives the app in Chromium
```

The import test needs the sample REF2MEN PDF (not in the repo, it holds customer data) and pdf.js from a local folder: `PDFJS_DIR=path/to/pdfjs-dist/build node tests/imptest.js file.pdf`.

`tests/fakedb.js` imitates the artifact database (read-only snapshot data, slow taps), because those two behaviours caused real bugs that plain local runs did not show.
