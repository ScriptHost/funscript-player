# Developer docs

How the Funscript Player is built: a Node.js server without dependencies and a static interface made of plain
scripts – no build step, no framework. Everything that drives the devices runs in the browser.

Contents: [Architecture](#architecture) · [Files](#files) · [Core concepts](#core-concepts) · [HTTP API](#http-api) ·
[Configuration](#configuration) · [Working on the code](#working-on-the-code) · [Tests](#tests)

## Architecture

The server delivers the interface, streams videos, proxies Stash and checks itself at startup. The browser talks to
the Handy (cloud) and the Satisfyer (Bluetooth) directly.

```text
Browser (public/*.js)                        server.js + lib/
  player, sync, library, devices,   <──>       HTTP(S), range streaming, Stash proxy,
  intensity; localStorage per device           HereSphere, HQ (ffmpeg), self-check, data/*.json
     │            │           │                    │            │              │
 Handy cloud   Satisfyer   Intiface Central      Stash        /media        ffmpeg / VAAPI
 (API v2:      (Web        (ws:// in the LAN,   (GraphQL     (videos +      (HQ stream,
  HSSP, clock,  Bluetooth)  forwarded via        + files)     .funscript)    Intel graphics)
  upload)                   /intiface)
```

## Files

The scripts in `public/` are classic `<script>` files without modules. They share global functions and load in a fixed
order – later ones may use earlier ones, the other way round only at runtime (guard with `typeof x === 'function'`).
`boot.js` starts the interface (no inline scripts because of the Content Security Policy).

| File | Purpose |
|---|---|
| `server.js` | Routes table (`ROUTES`), login, security headers incl. CSP, origin check, Intiface WebSocket forwarding, startup summary and slow requests in `docker logs` (English; the release workflow greps for `✓ ready` and `Self-test: n/n`) |
| `lib/config.js` · `lib/util.js` | Environment variables and constants · safe paths (`safeJoin`), `readBody`, `sendFile` with range, `cleanTitle` |
| `lib/library.js` | Folder library, cached; rescanned when the folders change (`librarySignature`) or in the background after 30 s |
| `lib/settings.js` | Server settings (HereSphere, scrypt password hash and signed token, Intiface home-network only) |
| `lib/data.js` | Shared settings, intensity, own scripts (`data/userscripts.json`), Handy upload cache, patterns |
| `lib/stash.js` · `lib/heresphere.js` | Stash GraphQL, filters, write-back, proxy · HereSphere API (VR only, password, cached list) |
| `lib/hq.js` | HQ stream via ffmpeg (ffprobe results cached); presets `natural` (auto), `clean`, `strong` |
| `lib/selfcheck.js` · `lib/update.js` | Startup self-check (data folder, stored files, every UI script compiles, every `$('id')` exists in `index.html`, script intensity) – result in `docker logs`, also used by the tests · “update available” (latest GitHub release, cached 6 h) |
| `i18n.js` · `i18n-en.js` | Language: English via table (German text → English) and patterns; translates on load and via `MutationObserver` |
| `handy.js` | Class `Handy` (API v2/v3: HAMP, HSSP with `playback_rate`, clock sync, upload cache), shared settings (`SHARED_PREFS`, synced with `/api/prefs`), `claimHandy()`, helpers `$`, `store`, `log`, `pillText`, `positionAt` |
| `app.js` | Modes and pages, menu, device window, “devices follow the video”, loading video + script, sync video → Handy (`doSync`), heatmap (`paintHeat`), markers |
| `library.js` | Library (folders + Stash), filters, opening a scene, Stash actions (`sceneAct`: ★, favourite, O, marker), resume position, sprites |
| `control.js` | Control mode: direct control, pattern editor, `emergencyStop()` |
| `vibe.js` | Satisfyer via Web Bluetooth and Intiface: several devices, each with its own loop, lead (`devLeadMs`), strength (`devGain`), motor mode (`same`/`split`), soft start and latency display |
| `fullscreen.js` · `gestures.js` | Player bar, fullscreen (native video), taps/double taps/hold, keyboard, STOP button, auto-stop, wake lock · swipe up/down per half in fullscreen (`swipeLeft`/`swipeRight`: volume, `vibeScene`, `slideMax`, both) on the video element (native fullscreen) and `#ovHit` |
| `enhance.js` · `hq.js` | Picture enhancement via WebGL · HQ stream from the server (seeking restarts the conversion) |
| `finale.js` · `tools.js` | Finale · script intensity for both devices: original/auto/soft/intense (`processScript`, `multiplyCalm`, `presetVibeShape`), per scene, previews, offset calibration |
| `stroker.js` | Stroker devices via Intiface (e.g. the Handy over Bluetooth) |
| `audiovibe.js` (removed in 1.19.9) | 🧪 “Follow sound” (beta): video → Web Audio `AnalyserNode`; `audioVibeLevel()` gives `targetLevel()` a 0–1 level from loudness above the running average plus onsets; `audioHandySpeed()` smooths it (~0.8 s) into Handy tempo steps of 10 for `selfHampLevel()`. The `AudioContext` is only created on a click (otherwise the video would play muted); all media is same-origin, so the analyser gets real samples |
| `selfctl.js` · `touchpad.js` | “Control yourself” (`selfCtl.mode`: `off` / `self`) for videos without a Funscript · touch area (tempo or 🧪 position via HDSP, at most 2 commands in flight, slower on HTTP 429), ⏺ recording |
| `settings.js` | Settings page: collapsible sections, ⓘ explanations, picture/HQ, player display, update notice, “new in” dialog, welcome dialog (only on a fresh install: `freshInstall` from `handy.js` = nothing stored in the browser nor on the server), install as app (`beforeinstallprompt`, otherwise a hint) and “whole app in fullscreen” (`appFs`, next tap), reset |
| `selftest.js` | Developer self-test in the browser: append `?selbsttest` to the address – runs typical flows with a simulated Handy |
| `test/` | Automated tests with Node built-ins: server, script logic, `i18n.test.js` (every German UI text has an English entry), `browser.test.js` (runs `?selbsttest` in headless Chrome via the DevTools protocol, fixtures in `test/fixtures/`; skipped locally without Chrome, required on GitHub) |
| `eslint.config.js` | ESLint, only on GitHub (`npm i --no-save eslint@9 globals@15 && npx eslint .`). All top-level names of the UI scripts are registered as shared globals, so typos are caught without flagging cross-file names |
| Health check | `checkDevices()` in `app.js` (on return after > 20 s and every minute): Handy `/connected`, Satisfyer `checkVibes()` → `dev.lost()` (one reconnect at a time); `deviceLost()` pauses the video if enabled (`pauseOnLoss`) |

## Core concepts

**Timeline.** `mediaTime()`, `seekTo()`, `duration()` and `videoPlaying()` are the single truth about the video. They
account for the HQ stream (which starts at 0 after every seek → `hq.offset`). Never use `video.currentTime` or
`video.paused` directly for device logic.

**Who controls the Handy?** `handy.owner` is `'video'`, `'manual'`, `'self'`, `'pattern'` or `'finale'`.
`claimHandy(owner)` switches and fires the `handy-owner` event – the other parts reset themselves (e.g. the video
pauses).

**Script chain.** `script.actions` → `toolActions()` (intensity: analysis + adjustment in `tools.js`, per scene in
`scenePresets`) → `sendActions()` (finale “half tempo”) → Handy (CSV via HSSP) or Satisfyer. The heatmap shows
`toolActions()`.

**Mirrored controls.** Fields that appear twice (connection key / Application ID in the device window, Satisfyer
strength min/max and translation at the video) are mirrors of the settings fields: `mirrorField(mirror, src)` in
`app.js` copies the value and re-dispatches `input`/`change` on the original, so only one place stores and reacts.

**Vibration.** `scriptSource()` returns `{ actions, ms }` from control or video. Each Satisfyer has its own loop:
`targetLevel()` computes a strength 0–1, it is smoothed and only sent on change, ahead by the device's own Bluetooth
latency. Emergency stop and pause set 0 immediately; after quiet phases the level ramps up within 0.5 s.

**Handy sync.** `doSync()` preloads the script (`handy.prepare`; uploads remembered in the browser and on the server via
`/api/handycache`, expired URL → upload once more) and starts with `handy.play(mediaTime()·1000 + offset)`. Video
events trigger `resync()`; every 30 s it silently corrects, every 5 min the clock is re-synced. Seeking or buffering
stops the devices until the video plays again.

**Script intensity.** `currentPreset()` takes the scene's choice (`scenePresets[offsetKey()]`) or the default
(`scriptIntensity`). `analyzeScript()` measures stroke (without the outer 2 %), jitter and tempo spread;
`processScript()` applies: remove jitter < 3 % → stretch the stroke → `fitHandy()` (`halveFast()` / `limitSpeed()`,
limit `handyMaxSpeed()` by model). Results are cached per script.

**Only connected devices.** `updateDevClasses()` sets `has-handy`, `has-vibe`, `has-dev`, `dev-idle` on `body` every
0.5 s; CSS shows or hides sliders, bar buttons and touch options accordingly.

**Script per device.** `processScript(actions, 'handy' | 'vibe')`: shared steps (jitter, stroke), then speed limit
for the Handy only, smoothing for the Satisfyer. The offset applies to both.

**Own scripts & recording.** `saveScriptToLibrary()` → `POST /api/userscript`: next to the folder video or in
`data/scripts/`, listed in `data/userscripts.json` – only those may be replaced or deleted, originals never.

**Storing settings.** `localStorage` via `store.get/set` (prefix `hp.`); keys in `SHARED_PREFS` also on the server
(`/api/prefs`, for all devices – the server is authoritative: what's missing there is deleted in the browser).
Advanced settings: class `.adv`, shown with `body.adv-on`.

## HTTP API

All responses are JSON except file streams. With `AUTH_USER`/`AUTH_PASS`, basic auth applies to everything except
`/healthz` and `/api/version`. Changes (everything except GET/HEAD, except `/heresphere`) only from the player's own page
(`Sec-Fetch-Site` / `Origin`, otherwise 403). Headers: Content Security Policy, `X-Frame-Options`, `nosniff`,
`Referrer-Policy: same-origin`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` · `/api/version` | Docker health check · version |
| GET | `/api/library` | Videos under `/media` with their Funscript |
| GET | `/media/<path>` | File from `/media` with range support |
| GET PUT | `/api/store` | Patterns |
| GET | `/api/stash/status` · `saved-filters` · `filters` | Stash reachable? · saved filters · tags/performers/studios |
| GET | `/api/stash/scenes?…` | Scene list (search, sort, filter, pages) |
| GET | `/api/stash/scene/<id>` | Scene details incl. markers, rating, O, position |
| POST | `/api/stash/scene/<id>/rating` · `favorite` · `o` · `o-undo` · `marker` · `activity` · `play` | Write back to Stash |
| GET | `/stash/scene/<id>/stream` · `funscript` · `screenshot` · `preview` · `webp` · `vtt/…` | Proxied Stash files (only these) |
| GET | `/hq/stream?src=…&t=…&preset=…&h=…` | HQ stream from time t (ffmpeg, VAAPI or CPU) |
| GET | `/api/hq/status` · `probe` · `bench` | HQ available? · resolution/format · benchmark |
| GET POST | `/heresphere` · `/heresphere/stash/<id>` · `/heresphere/media/…` | HereSphere API (rating/favourite in POST), VR only if `hsVrOnly` |
| POST | `/heresphere/auth` | With a HereSphere password: `{ username, password }` → `{ "auth-token", access }`; the token has no expiry and is bound to the password hash (new password = all tokens invalid) |
| WS | `/intiface?target=IP:PORT` | WebSocket forwarding to Intiface: private IPv4 only (home network only by default), allowed ports only (`INTIFACE_PORTS`), own page only |
| GET PUT | `/api/handycache?k=…` | Cache of already uploaded Handy scripts |
| GET PUT | `/api/prefs` | Shared settings of all devices; PUT merges, `null` deletes |
| GET POST DELETE | `/api/userscript?src=…` | Own script: save, read, delete (own ones only) |
| GET | `/api/userscripts` | List of own scripts |
| GET | `/api/update` | `{ current, latest, url, available }` |
| POST | `/api/clientcheck` | Silent self-check of the interface and browser errors → `docker logs` (max. 20/min) |
| GET | `/api/heat?src=…` | Script intensity in 48 sections (for the tiles) |
| GET PUT | `/api/settings` | Server settings `{ heresphere, hsVrOnly, hsPassword, intifaceLan }` in `data/settings.json` |

## Configuration

With Docker all values live in `.env` (template `.env.example`); `docker-compose.yml` only reads them.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` · `HOST` | 8080 · 0.0.0.0 | Where the server listens |
| `MEDIA_DIR` · `DATA_DIR` | /media · ./data | Video folder (each subfolder = a source) · player data |
| `LOG_LEVEL` | – | `debug` = every request in `docker logs` (otherwise only slow ones > 1 s) |
| `STASH_URL` · `STASH_API_KEY` · `STASH_INSECURE` | – | Stash address, API key, `1` = accept a self-signed certificate |
| `STASH_FAVORITE_TAG` · `STASH_MARKER_TAG` | Favorit · Lieblingsstelle | Tags for favourites and markers |
| `HQ_ACCEL` · `HQ_DEVICE` · `HQ_MAX` | auto · /dev/dri/renderD128 · 2 | `vaapi` or `cpu`; graphics device; parallel HQ conversions |
| `PLAYER_MEM` | 2g | Memory limit of the container |
| `HERESPHERE` | on | `off` = HereSphere off for good |
| `INTIFACE_LAN_ONLY` · `INTIFACE_PORTS` | – · 12345 | `1` = home network only, fixed · allowed Intiface ports (comma-separated) |
| `AUTH_USER` · `AUTH_PASS` | – | Optional basic auth |
| `TLS_PFX` (+`_PASS`) / `TLS_CERT` + `TLS_KEY` | – | HTTPS directly, without a reverse proxy |
| `FFMPEG` · `FFPROBE` | ffmpeg · ffprobe | Paths to the programs |

The container runs read-only with `/tmp` as tmpfs, `cap_drop: ALL` and `no-new-privileges`; it only writes to the data
volume.

## Working on the code

```bash
MEDIA_DIR=./testmedia DATA_DIR=./data STASH_URL=http://stash:9999 node server.js   # → http://localhost:8080
```

Without Stash everything works with the folders. Web Bluetooth works on `localhost` without HTTPS.

- **No dependencies:** only the Node standard library and browser APIs. No build, no bundler.
- **Language:** code comments in German (they explain the why). The interface is bilingual: German texts in the code,
  English translations in `public/i18n-en.js`.
- **Safety first:** everything that moves devices must be stoppable via `emergencyStop()` and stop when the connection
  is lost.
- **Release:** `VERSION`, `CHANGELOG.md` (English), README; tag `vX.Y.Z` → the workflow runs the tests, starts
  the container read-only, then publishes the release (ZIP + notes from `CHANGELOG.md`) and the Docker image.

## Tests

No extra packages, Node built-ins only – they also run on every push:

```bash
node --test "test/*.test.js"
```

- `test/scripts.test.js` – reading Funscripts, script automation, touch recording, intensity, beat guard, half tempo,
  the four intensities, model detection. Functions are read straight from the browser files (`loadFunctions` in
  `test/helpers.js`).
- `test/server.test.js` – starts `server.js` with test folders: library, shared settings, own scripts, startup
  self-check, update comparison, HereSphere switch/VR only/password, origin check and security headers, script cache.
