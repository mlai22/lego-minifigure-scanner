# LEGO Shrek Minifigure Scanner

A mobile-first static scanner for LEGO Collectible Minifigures Shrek Series 71053. HTML5, CSS3, vanilla JavaScript, and ZXing Browser. No framework, backend, database server, npm install, or build step.

## Run locally

From this directory:

```sh
python3 -m http.server 8080
```

Open http://localhost:8080. Do not open `index.html` using `file://`: fetching the JSON requires HTTP. Camera access works on localhost or HTTPS. A phone visiting a computer’s plain-HTTP LAN address is not a secure context; use an HTTPS deployment for phone testing.

## Deploy to GitHub Pages

1. Create a GitHub repository, e.g. `lego-shrek-scanner`.
2. Upload **the contents of this directory** to the repository root (`index.html` must be at the root).
3. In repository Settings → Pages, choose Deploy from a branch, `main`, `/ (root)`, and Save.
4. Open `https://YOUR-USERNAME.github.io/lego-shrek-scanner/` after deployment completes. Enable Enforce HTTPS when available.
5. Test the live HTTPS URL on an iPhone in Safari and an Android phone in Chrome, granting camera permission.

All local URLs are relative, including the JSON, so project subpaths work. No API keys, environment variables, Actions workflow, or server are needed. Production URL: https://mlai22.github.io/lego-shrek-scanner/

GitHub repository: https://github.com/mlai22/lego-shrek-scanner

GitHub Pages publishes the `main` branch repository root. Push updates to `main` to redeploy.

## Use

Tap **Start camera**, allow access, and point at the square Data Matrix on the bottom of an individual box. Start 10–20 cm away, use good lighting, and adjust distance for focus. The full video frame is decoded; the frame overlay is guidance. The ordinary retail barcode and printed batch code cannot identify the minifigure.

A successful decode stops the camera and shows either the matched character or an explicit unknown-code result. Tap **Scan another box** to resume. A camera selector appears if multiple cameras are available. Flashlight appears only when the browser reports torch capability. If a phone selects a lens that cannot focus close up, switch cameras or move farther away. The app requests the environment-facing camera, but exact lens choice is controlled by the browser.

Manual lookup accepts a seven-digit package ID or decoded text beginning with that ID. It supports whitespace, ASCII group/record separators, and optional `]d1` / `]d2` symbology identifiers. It intentionally does not extract numbers from arbitrary positions, URLs, or longer numbers. Unknown formats fail safely rather than guessing.

## Data and accuracy

`data/minifigures.json` ships with 12 **North American** mappings from [BrickFan’s published table](https://brick.fan/minifigures/scan), checked September 28, 2026. BrickFan cites [brick’em](https://brickem.io/cmf-scanner). These are published community mappings, not independently validated by opening physical boxes. No coverage is claimed for European or other regional IDs. Future production batches may change. No demo or fabricated codes are included.

Example: `6634901` → Shrek. `6634902` → Fiona and Donkey.

To update, add a sourced code to the relevant character’s `codes` array:

```json
{"value": "6634901", "region": "North America"}
```

Preserve strings, use exactly seven digits, and never assign a code to multiple characters. Update `updated`, `source`, and `verification` in JSON; update the visible coverage caption/date and README when adding other regions or sources. The loader rejects invalid schemas, empty data, malformed records, and duplicate codes. Code data is fetched once per page session with revalidation; reload after updating it. Unknown codes do not become matches through a fallback or heuristic.

## Dependency and privacy

[ZXing Browser](https://github.com/zxing-js/browser), version **0.1.5**, Apache-2.0, is loaded only after the user requests the camera:

`https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js`

Uses its dedicated `BrowserDatamatrixCodeReader`, not the QR-only reader. The CDN script is pinned with SHA-384 Subresource Integrity and anonymous CORS. When upgrading, download the exact file, verify its API, recompute the hash, and test physical scans. Manual lookup does not depend on the CDN.

Frames are processed locally. There are no analytics, uploads, accounts, cookies, local storage, or scan history. Hosting/CDN providers receive ordinary resource requests, not camera frames or entered codes. Initial page/data and scanner loading need connectivity; offline reload is not supported. Camera tracks stop on a match, Stop, manual lookup, tab hiding, page exit, errors, and camera changes. Cancelled pending permission requests release any stream that arrives later.

## Validation and release checklist

The application should be checked using the actual deployment URL before public release:

- iPhone Safari and Android Chrome: rear-camera selection, permission grant/denial/retry, physical Data Matrix decoding in bright/dim light, focus on small box codes.
- Known North American box: confirm the decoded package ID and character against an opened box; check unknown-region/batch behavior.
- Start → Stop during permission prompt; grant afterward: no live tracks remain. Repeat while switching cameras and backgrounding the page.
- Scan result stops video; another scan restarts; torch toggles only where supported.
- Lookup `6634901`, `6634902 123R6 12345678`, an unknown ID, an 8/13-digit retail code, and text containing a known ID in a later field.
- Block the CDN: manual lookup works, camera shows a recoverable error. Block JSON: app shows data failure, never a guessed character; retry after restoring connectivity.
- Narrow screens (320 px), portrait/landscape, keyboard navigation, text zoom, screen reader announcements, and reduced motion.

Desktop automated/mock testing cannot certify physical camera focus, torch support, real-world recognition reliability, or Safari/Chrome mobile hardware compatibility. Workspace checks completed September 28, 2026:

- JavaScript syntax check passed.
- All 12 mappings, three decoded payload formats, malformed/embedded IDs, and unknown IDs passed automated checks.
- Mock camera lifecycle checks passed for decode cleanup, normal no-code frames, background cleanup, cancellation while permission is pending, denied access, and malformed JSON.
- The actual pinned ZXing Browser bundle decoded a generated Data Matrix carrying `6634901 123R6 12345678`.
- Browser UI checks passed for Shrek, Fiona and Donkey, unknown IDs, and malformed IDs.
- Visual review completed at 320 px and 1100 px widths; 320 px document width was confirmed without horizontal overflow.

Physical phone camera and torch testing, real box verification, remain release checks.

## Attribution

Independent fan tool, not affiliated with the LEGO Group or DreamWorks. LEGO and Shrek are trademarks of their respective owners. No official artwork is bundled.
