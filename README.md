# LEGO Minifigure Scanner

A mobile-first static application for identifying LEGO Collectible Minifigure blind boxes using their Data Matrix codes. Choose a series, start the rear camera, and scan a square code. Manual entry uses the same parser. Unique matches from other registered series offer a switch; ambiguous or unknown codes never guess a character.

**Live site:** https://mlai22.github.io/lego-minifigure-scanner/

**Repository:** https://github.com/mlai22/lego-minifigure-scanner

The repository and application now use the general-purpose `lego-minifigure-scanner` name. Use the live URL above instead of the former Shrek-specific URL.

## Stack and files

HTML5, CSS3, vanilla JavaScript ES modules, and ZXing Browser 0.1.5. No build, backend, API keys, package install, database server, or analytics.

```text
lego-minifigure-scanner/
├── index.html
├── app.js
├── style.css
├── data/
│   ├── series.json
│   ├── shrek-71053.json
│   └── series-29-71052.json
├── tests/
│   └── parser-tests.html
├── assets/
│   └── README.md
├── .nojekyll
└── README.md
```

## Supported data

| Series | Set | Characters | Package codes | Region |
| --- | --- | --- | --- | --- |
| Shrek Series | 71053 | 12 | 12 | North America |
| Series 29 | 71052 | 12 | 24 | UK / Europe, groups EU-A and EU-B |

Mappings and verification dates are supplied in the project specification and retained exactly in JSON. They agree with the [published BrickFan table](https://brick.fan/minifigures/scan) inspected during the initial implementation. They have not been independently confirmed by opening physical boxes. No additional codes have been inferred. `sourceGroup` preserves the supplied production-group label; it is not interpreted as a geographic region.

A character can have multiple package codes. Each mapping includes `code`, `character`, `region`, and optional `sourceGroup`. Database metadata includes `id`, `name`, `setNumber`, `dataVersion`, and `lastVerified`. Shrek’s supplied date is `2026-09-16`; Series 29’s is month-only `2026-09`. Neither is represented as a new physical verification.

## Parser and identification

`extractPackageCode(rawText, mappings)` searches the entire text for known seven-digit codes, allowing letters, whitespace, punctuation, symbology prefixes, and suffixes. For example `ABC6603327XYZ123` works. A known code inside a longer run of digits does **not** match: `16634901` must not become `6634901`.

`resolveScan` checks all loaded databases. Exactly one mapping produces FOUND or DIFFERENT_SERIES. Multiple distinct mappings produce AMBIGUOUS_CODE, including collisions across series, even if the selected series has a match. Repeated occurrences of the same package code are one candidate. Identical duplicate database rows are collapsed; contradictory rows remain ambiguous. Unknown raw text is shown safely as text and can be copied; it is not stored in history or sent anywhere.

All registered databases load before identification is enabled, so failed cross-series loading cannot conceal ambiguity. Loading has a timeout and a retry control. Empty mapping arrays are valid and display “Package code data for this series has not been added yet.” Future unknown region/run codes remain unknown; numeric proximity and ordering are never used.

## Camera and browser compatibility

The exact pinned [ZXing Browser v0.1.5](https://github.com/zxing-js/browser/tree/v0.1.5) API was verified from its source and downloaded UMD bundle:

- `BrowserDatamatrixCodeReader` uses the Data Matrix reader exclusively.
- `decodeFromStream(stream, video, callback)` supports continuous camera decoding and returns stop controls.
- The app uses modern `navigator.mediaDevices.getUserMedia`, with `audio: false` and `facingMode: { ideal: 'environment' }`.
- The video is muted, autoplay, and `playsinline`, including the inline attribute needed for mobile playback.
- Modern iPhone Safari and Android Chrome implement the required [getUserMedia API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [facingMode constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode). This is API/source compatibility verification, not a claim that physical phones were tested.

The library is loaded on demand from `https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js` with a pinned SHA-384 integrity hash. Changing versions requires recalculating the hash and retesting. The bundle is Apache-2.0 licensed. No QR-only reader, legacy callback getUserMedia, or deprecated clipboard API is used.

Permission is requested only after Start Scanner (or an explicit Scan Another Box restart). No camera is requested on page load, series selection, or manual lookup. The camera stops after decoding, on Stop Camera, Change Series, restart, hidden page, page exit, or errors. Pending permission results from a cancelled session are stopped immediately. Each session owns a separate video node, preventing delayed cleanup from disrupting a newer preview. A token invalidates repeated callbacks after a result.

Rear lens choice and close focus depend on device/browser hardware. Start 10–20 cm away with good light. Try a different camera with the selector if available. Torch and continuous focus are offered only when the device exposes them. The square guide is visual guidance; the full frame is decoded. Manual lookup remains available if permission is denied or the scanner CDN fails.

## History, collection, and privacy

History stores the latest 20 successful camera/manual identifications (including unique cross-series detections), with character, series, set number, package code, region, and timestamp. Clear History removes history without clearing collections. Unknown or ambiguous raw strings are not persisted.

Collections are separate for each series and use unique character names, so alternate production codes do not duplicate checklist entries. Add to Collection is an explicit action; scanning does not silently collect a figure. Checkboxes allow manual changes. Renaming a character in JSON can require migrating existing collection names.

Both use this origin’s `localStorage`, under `minifigure-scanner.v1`. There is no account, sync, or server storage. Browser storage errors fall back to session memory and show a warning. Clearing browser site data removes history and collections. LocalStorage is origin-scoped: other applications on the same GitHub Pages hostname technically share access; the unique key prevents accidental collisions, not same-origin script access.

Camera frames are processed locally. Frames, raw text, history, and collections are not uploaded. The host and jsDelivr receive ordinary page/resource requests. No analytics, tracking, external fonts, or character images are included. Internet access is required for initial loading; offline reload is not supported.

## Update mappings

Edit the appropriate file in `data/`. Add a mapping row using a genuinely verified code and its correct region. Multiple rows can share a character name. Never extrapolate an apparent sequence or label an uncertain European code North American. Update `dataVersion` and `lastVerified` only to reflect actual data changes and verification. Keep existing valid codes and production groups.

## Add a future series

1. Create `data/series-30.json`, using the same schema as an existing database. Give it a unique ID, accurate name/set number (or `null` if unknown), data version, verification date, and a `mappings` array. An empty array is supported. Do not ship placeholder codes.
2. Add `{ "id": "series-30", "name": "Series 30", "setNumber": null, "dataFile": "data/series-30.json" }` to `data/series.json`.
3. Ensure ID, name, and set number match in both files. Keep filenames within `data/` using lowercase letters, numbers, and hyphens.
4. Run the tests. Cards, global detection, details, and checklists automatically use the new data. No scanner-code change is needed.

## Run locally

```bash
cd lego-minifigure-scanner
python3 -m http.server 8000
```

Open http://localhost:8000. Open http://localhost:8000/tests/parser-tests.html to run tests. Do not use `file://`: ES module imports and JSON fetching require HTTP. Camera access generally requires **HTTPS or localhost**. A phone opening a computer’s plain HTTP LAN address usually cannot use the camera; use the deployed HTTPS URL.

## Tests and release checks

`tests/parser-tests.html` imports production functions, automatically loads every registered database, tests every mapping, and tests the specified sample payloads, empty/malformed/unknown input, punctuation, whitespace, embedded text, longer numeric strings, duplicates, conflicting mappings, cross-series ambiguity, alternate codes, empty databases, new-series fixtures, and invalid schemas. It displays pass/fail counts without changing storage or requesting camera access.

Practical checks: select each series; enter `6634901`, `ABC6603327XYZ123`, `6605257`, `9999999`, and `6634901 6603327`; switch after cross-series detection; add/check/uncheck collection items; reload to check persistence; create 21 scans to verify the history cap; clear history and confirm collections remain. Inspect Scanner Details and browser console. Test database/CDN failure, storage unavailability, permission denial, cancelled permission, rapid restart, and page hiding. Check 320 px and desktop layouts for horizontal overflow.

Completed workspace validation: **76 parser/database tests passed**; all 36 mapping records match the supplied specification exactly. Browser checks covered cross-series switching, embedded manual input, alternate codes, unknown/ambiguous states, details, collection persistence and toggles, history persistence and the 20-item cap, and clearing history independently of collections. No browser console errors were reported. The 320 px layout had no horizontal overflow. A generated Data Matrix was decoded with the actual pinned library. Mock lifecycle checks covered opt-in, rear-camera preference, transient decoder errors, duplicate callbacks, stopping on result/series change/background/page exit, cancelled pending permission, denied access plus manual lookup, database failure, and unavailable storage.

Actual iPhone Safari and Android Chrome initialization, lens selection, tiny physical box-code focus, and hardware torch behavior still require physical-device testing. Automated and desktop checks cannot certify those hardware behaviors.

## Deploy to GitHub Pages

1. Push the **contents** of this directory to the repository root (`index.html` at root).
2. Open repository **Settings → Pages**.
3. Select **Deploy from a branch → main → /(root) → Save**.
4. Wait for Pages deployment and enable **Enforce HTTPS**.
5. Open the HTTPS URL and `tests/parser-tests.html`; verify the JSON and module paths.

This repository already publishes `main` at https://mlai22.github.io/lego-minifigure-scanner/. Commit and push changes to redeploy. All assets, imports, and JSON paths are relative, so project subpaths work without a build.

Independent fan project. LEGO and character names belong to their respective owners; the LEGO Group and DreamWorks do not sponsor or endorse this application.
