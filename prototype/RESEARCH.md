# Engineering decisions

Reviewed November 6, 2026. Primary specifications and browser documentation are the source of truth; community workarounds do not establish accessibility conformance.

| Decision                                                          | Evidence                                                                                                                     | Consequence                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Count paired opposing luminance transitions in a real-time window | [W3C general-flash definition](https://www.w3.org/TR/WCAG22/#dfn-general-flash-and-red-flash-thresholds)                     | A transition is not a complete flash. Tests distinguish three from four completed flashes per second.      |
| Use isolated MV3 content scripts, with bundled local code         | [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)                      | No remote code, page-global bridge, or unsafe evaluation.                                                  |
| Use frame callbacks for readable video                            | [MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) | Sampling follows browser frames rather than a low-frequency timer. Scheduling can still miss transitions.  |
| Guard unreadable content                                          | [MDN cross-origin canvas](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)                       | Cross-origin pixel restrictions are real. The studio demonstrates a separate local origin without CORS.    |
| Keep events local and bounded                                     | Browser storage and attack-surface minimization                                                                              | No reputation server, accounts, telemetry uploads or personal browsing paths.                              |
| Default to covered examples and offer a measurements-only replay  | [W3C SC 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)                            | Demonstration does not require exposing viewers to flashing stimuli; reduced motion has a useful fallback. |

## Deliberate scope cuts

General flashes only. No red-flash detector, GIF/APNG/WebP decoder, WebGL guarantees, full viewport aggregation, malicious-page overlay hardening, universal pre-render interception, or medical claims. The CSS-background path is an approximation, not a rasterization of arbitrary styled DOM. The source-area threshold is a configurable engineering heuristic, not the standard's calibrated visual field. Rates are capped by bounded per-pixel history; the cap does not make a high-rate violation pass.

The studio and extension share code but have different trust and coverage boundaries. Studio fixtures prove controlled behavior; they do not prove safety on arbitrary websites. Automated accessibility tests supplement, rather than replace, manual assistive-technology testing.
