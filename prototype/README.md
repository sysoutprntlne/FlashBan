# FlashBan · Local Shield prototype

An independent, fork-only build: a working demo studio plus an unpacked Chrome MV3 extension sharing a real general-flash detector. Upstream main and the team draft PR are not changed by this prototype branch.

## Start the demo

```sh
cd prototype
npm ci
npx playwright install chromium
npm run build
npm start
```

Open **http://127.0.0.1:8787**. The adjacent port, 8788, deliberately serves a different origin for the unreadable-media test. Both servers bind to loopback only. No accounts or remote service are required; the runtime has no npm dependencies.

Choose calm, rapid-change, or unreadable content and run the shield. The studio reads actual canvas pixels. Rapid-change content stays covered during analysis and stops when flagged. Explicit reveal shows only the paused source. Reduced motion disables visual tests and offers an off-screen measurements-only replay. Session events stay in memory and disappear when the tab closes.

## Install the extension

Run `npm run build`, then load **prototype/extension** via **chrome://extensions → Developer mode → Load unpacked**. The ZIP in artifacts contains the extension too. Visit `/fixtures/source.html` through the local server to validate the actual installed extension on a standalone source. The studio is independently instrumented; use the standalone fixture to avoid confusing the studio shield with the extension shield.

The extension inspects HTTP/HTTPS pages in an isolated world. Its only API permission is storage. Hostnames and bounded numeric event summaries are stored locally, not URLs, paths, queries, screenshots or page content. The popup can clear the log.

## Test

```sh
npm test
npm run test:browser       # with npm start running in another terminal
node test/extension.mjs    # actual installed-extension checks
```

Browser tests exercise real sample reads, threshold decisions, actual cross-origin pixel restrictions, reduced motion, mobile layout and axe accessibility checks. Extension tests run a persistent Chromium profile with the unpacked extension, inspect actual guard/log behavior, and write evidence to artifacts. No manual screen-reader validation or arbitrary-site protection is claimed.

## Walkthrough and downloads

- `artifacts/flashban-walkthrough.mp4` — narrated, captioned walkthrough; flashing sources remain covered.
- `artifacts/flashban-walkthrough.vtt` — text captions.
- `artifacts/transcript.md` — narration transcript.
- `artifacts/flashban-prototype.zip` — unpacked extension and standalone studio source.
- `artifacts/browser-results.json` and `extension-results.json` — test evidence.
- `artifacts/studio-desktop.png` and `studio-mobile.png` — rendered screenshots.

Regenerate the video on macOS with `npm run video` while the demo server runs; requires `say`, `ffmpeg`, and `ffprobe`. Development browser tooling is pinned in package-lock.json. No generated narration or private credentials are required at runtime.

## Architecture

`engine/detector.js` is DOM-free and unit-tested. `studio/` imports it directly. `build.mjs` produces the extension's local detector bundle. `extension/` supplies discovery, sampling, source guards, local event storage and popup UI. `server.mjs` serves the studio and cross-origin fixture. `test/` holds unit/browser evidence; `tools/` produces the walkthrough.

## Boundaries

**Experimental. Not a medical device, guarantee of protection, or WCAG certification.** General-luminance flashes only; no saturated-red detector or animated-image decoder. CSS sampling is approximate. Browser scheduling and initial rendering can expose content before intervention. Area is a CSS-pixel heuristic, not calibrated visual angle. Cross-origin/DRM restrictions, small or adversarial elements, compositing, screenshots and viewport aggregation need more work. No universal browser/site support claim.

Research and the reasons for these choices are in [RESEARCH.md](RESEARCH.md).
