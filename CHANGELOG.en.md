# Changelog

English version of [CHANGELOG.md](CHANGELOG.md) (German). The GitHub releases use this file.

## 1.19.4 – 04.11.2026

- **Several Satisfyers:** “＋ Connect another Satisfyer”; each has its own strength and its own lead (from its own
  Bluetooth latency) – several stay in time together
- **Two motors:** optionally motor 2 follows the tempo while motor 1 pulses with the rhythm (also via Intiface)
- **Soft start:** after start, pause and STOP the Satisfyer ramps up within 0.5 s instead of jumping to full strength
- **Sync display:** ⏱ Bluetooth latency per device; if it fluctuates a lot the status turns yellow with a hint
- **Settings:** Handy and Satisfyer together under “🔌 Devices”
- **More robust:** `HQ_MAX` 2 instead of 3 and a memory limit `PLAYER_MEM` (2g) in the compose file – if the player runs
  out of memory, only the player is hit, not Stash
- **Errors visible:** JavaScript errors from the browser and Stash/network errors (502–504) show up in `docker logs`
- **Tidied up:** server routes as a table, duplicate code (heatmap, Stash actions) merged, unused CSS removed, obsolete
  settings keys are deleted from `prefs.json`
- **Release workflow:** tests run before the release and the image
- **funscript-player.de** now redirects to the GitHub repository; the presentation page lives as source under `website/`

## 1.19.3 – 04.11.2026

- **Script intensity, one choice for both devices:** Original · Automatic · Gentle · Intense. *Original* leaves the file
  untouched, *Gentle* is clearly softer (stroke 20–80 %, max. 240 %/s, weaker and smoother Satisfyer), *Intense* is clearly
  stronger (full stroke, calm passages at double/triple tempo, stronger Satisfyer). Pick it per scene right at the video –
  four buttons with a mini heatmap preview – or via 🎚 in the player bar. “Original + beat guard”, “Custom” and the
  “set separately” option are gone (old choices are migrated once).
- **Seeking / buffering:** Handy and Satisfyer pause while the video jumps or loads instead of vibrating ahead of the picture
- **Control it yourself:** the touch area follows the strength slider above it
- **Picture “Automatic” more natural:** server upscaling only lightly denoised and barely sharpened, browser sharpening at
  most 25 %, no contrast/colour boost
- **Settings:** every section collapsible, explanations behind ⓘ; “Safety” is now **Emergency stop** with a new
  **auto-stop** after X minutes without input (and no video playing)
- **Status turns yellow** when the Handy cloud answers slowly
- **“Update available”** in ⚙️ → System (and a dot on the version) when GitHub has a newer release
- **Self-check at startup** in `docker logs` (server, UI scripts, every control present, script intensity); the UI checks
  itself silently and only reports errors – the self-test button is gone (`?selbsttest` still works for development)
- **The server is the source of truth for settings:** a deleted `handy-data` volume really starts fresh (the browser no
  longer re-uploads its old copies, e.g. the connection key)
- **Removed:** remote control (cast to another device), script builder, “adjust section”, demo mode, continue watching,
  library buttons (random, FapTap, Pornhub, file, own links), backup/restore (everything lives in the `handy-data` volume),
  Windows install scripts, the “fullscreen only the video” option (now always on)
- **Docker:** compose without Traefik (port 8080, put any reverse proxy in front), ready-made image on GitHub
  (`ghcr.io/scripthost/funscript-player`) – update with `docker compose pull && docker compose up -d`
- GitHub releases in English, rebuilt from this file

## 1.19.2 – 01.11.2026

- Defaults: scripts now play **Automatic** on the Handy too (changeable in ⚙️ → Script); new 🔥 finale defaults: stroke
  10–80 %, vibration 50 %, half tempo, back after 240 s – old defaults migrated once, “New in 1.19.2” notice
- Fixed: **max stroke jumped back to 90** (was only saved per scene) – now global, migrated 90 → 100 once
- Control it yourself: **stroke bottom / top** instead of “stroke length” around the middle
- Finger control more direct: position no longer waits for the Handy cloud (newest value every 100 ms, travel time from
  150 ms, only real jitter smoothed), tempo changes are sent immediately
- Press and hold on the video: right = **2× speed**, left = **rewind** at the same pace (HQ stream: jumps on release)
- Script box at the video tidied up; offset with −/+ (slider under “Advanced”), pause next to STOP
- “Handy fine-tuning” (resync, stroke min/max) only in the device window (tap the status at the top)
- ⚙️ → Library: **show only 2D videos** (Stash tag “2D”, per device)
- Settings on phones could be dragged sideways – fixed; help texts corrected
- Self-test: 11 checks

## 1.19.1 – 01.11.2026

- Website: new hero – short and big (“Your video. Your devices. Perfectly in sync.”), animation as its own section

## 1.19.0 – 01.11.2026

- Fixed: recording in position mode, old still frame when switching videos, mini player while scrolling, script info
  despite being hidden; option “fullscreen only the video” for automatic picture-in-picture
- Control: smoother finger position, stroke length in tempo mode, “back to script”, press and hold to seek, vibe state,
  live stroke, Bluetooth as fallback
- UI: one status (connected/disconnected), picture popup, library buttons and own links, intensity filter with
  “Funscript only”, scene info directly, smaller title, self-test button with report, demo mode
- Scripts: shared preset for Handy + Satisfyer, 🔥 hottest spot, ✂ adjust section
- Stronger Satisfyer, test vibration, defaults 0/100 %
- docker-compose.yml tidied up

## 1.18.2 – 01.11.2026

- Developer page with DE/EN switch
- README in English (README.md), German version as README.de.md; release notes 1.18 in English

## 1.18.1 – 01.11.2026

- Fix: start page “not found” and version “dev” (paths after splitting the server)
- Fix: Stash “https is not defined”
- Test for start page and version number

## 1.18.0 – 01.11.2026

- Handy defaults to “original + beat guard” (vibrations stay, only the impossible is adapted), Satisfyer “Automatic” –
  adapted spots shown in the heatmap
- Own scripts: marked (✋), choose original/own, record again (section or whole), delete; originals never overwritten
- Script area in the device box; offset with “🎯 calibrated” + ↺; 🎯/✋ on tiles
- Touch “position” with Application ID fixed (0–1); touch area shows the slider value; skip 5/10 s
- Picture-in-picture: no longer black from fullscreen, playback continues on return
- Advanced settings, backup download/restore, “New in 1.18” notice, English UI (language by device)
- Docker: health check every 5 s, startup summary ending in “✓ bereit” in docker logs, slow requests logged, settings in
  `.env` (`.env.example`)
- Server split into `lib/`, self-test (`?selbsttest`)

## 1.17.0 – 01.11.2026

- Close the mini player (✕); leaving the app = picture-in-picture (can be turned off); black picture after fullscreen fixed
- Player bar customisable (show/hide, order); useless buttons hide themselves
- Without Funscript + “no control” no device sliders; “control it yourself” only with connected devices
- Connect button shows its state, clear error messages, Satisfyer reconnects longer
- Faster start: the server remembers uploaded scripts
- Handy model detection, adjustable top speed; too-fast passages: “shorten stroke” or “full stroke, half tempo”
- 🧪 Touch area: tempo | position (Handy follows your finger)
- Library: tabs and saved Stash filters can be hidden; seek preview without black box
- HereSphere: optional password, “VR only” as a setting, faster on the headset
- Security: origin check, security headers, Intiface optionally LAN only, scripts only next to videos; optional own
  Docker user

## 1.16.0 – 31.10.2026

- One status for both devices; connecting only in the device window at the top
- Below the video one shared area – only for connected devices; offset also applies to the Satisfyer
- Sync (“devices follow the video”) is the default
- “Control it yourself” always available (with a device); **recording along the video** as an own script
- Touch control out of beta, with ⏺ recording (pattern / .funscript / to the video)
- Script automation per device (Handy shortened, Satisfyer unshortened); stroke and Satisfyer strength per scene
- Library: filter/sort by intensity; mini player while browsing; ⧉ picture-in-picture
- Satisfyer battery, measured delay (automatic lead), Bluetooth “all devices” directly
- Remote control: volume, “remote controlled by …” with disconnect
- Automated tests (`node --test "test/*.test.js"`)

## 1.15.0 – 31.10.2026

- **Handy API v3:** with an Application ID the Handy stays in sync at 0.5× … 2×; without ID API v2 as before
- **Settings shared by all devices** (key, offsets, Satisfyer translation, safety …) – stored on the server; picture,
  header and screen lock stay per device
- **Intensity at a glance:** thin heatmap strip on every tile with a Funscript
- Pixel phones: “compact next to the camera” on by default
- 🧪 Beta: touch control

## 1.14.0 – 31.10.2026

- New: **control it yourself** for videos without Funscript – Handy speed and Satisfyer strength while the video plays
- Line “⚡ script name (N points)” switchable, off by default
- “🔄 Devices follow the video” at the top of ⚙️ → Devices
- Website: “one Funscript for both devices”, sync animation

## 1.13.0 – 31.10.2026

- **Device controls back at the video** (connect, resync, offset, stroke, Satisfyer strength/pause, finale, stop all);
  can be turned off in ⚙️ → Display
- **HereSphere can be switched off** (`HERESPHERE=off` to lock it)
- Tap the title “Funscript Player”: to the library – or back to the running video
- Stash scenes show their screenshot until play

## 1.12.0 – 31.10.2026

- **Calmer interface:** only Handy/Satisfyer status and menu ☰ at the top; tapping the status opens the device window
- Stream/sync is now the switch “🔄 Devices follow the video”; control and settings in the menu
- Performers, tags, markers and description under “More about the scene”; messages as short toasts
- **HereSphere shows only VR videos**

## 1.11.0 – 31.10.2026

- New: **script automation with presets** – Original · Automatic · Gentle · Intense · Custom; “Automatic” checks every
  script and only changes what is necessary
- Below the video you see what was adapted; the preset can be changed **per scene** and is remembered
- Too-fast passages are shrunk towards the middle instead of sliding down

## 1.10.0 – 31.10.2026

- New name: **Funscript Player** (instead of “Handy Player”)
- Technical names stay the same (container `Handy-Player`, folders, ZIP names) so an update changes nothing in an
  existing installation
- Website: illustrations, more detailed features, developer docs

## 1.9.0 – 31.10.2026

- **Settings reorganised** with a section bar at the top; the device column only shows what you need while watching
- **Video, Handy and Satisfyer keep running** in library and settings (“now playing” bar)
- New video: no flash of the old picture; the player opens at the top
- Satisfyer: reconnects automatically after screen lock / app switch; new **smoothness** slider
- Library: every mode remembers its Stash filter
- Optional compact header next to the camera

## 1.8.0 – 31.10.2026

- New: **remote control** – video on the TV/PC, controls and Satisfyer on the phone

## 1.7.0 – 31.10.2026

- New: **★ / 💦 / 📍 right in the player bar**, also in fullscreen (Stash scenes only)
- Player bar wraps into a second line instead of squeezing buttons
- Red STOP button over the video can be turned off; Esc, “stop all” and stop on screen lock stay
- “Vibrator” is now called “Satisfyer” in the interface

## 1.6.0 – 01.11.2026

- Bluetooth search finds the Satisfyer without “show all devices” (“Power Masturbator”, “SF…”, “Satisfyer…”); names
  picked once are remembered
- New ⚙️ → **Display in the player**: show/hide date, rating, studio/performers, tags, markers, description, picture line

## 1.5.1 – 01.11.2026

- Streaming: “⚡ Funscript only” hidden, all videos are shown
- Separate heatmap below the video removed (the player bar already shows it)

## 1.5.0 – 01.11.2026

- Handy via Bluetooth through Intiface as an offline path (works with sync, patterns, direct control, finale, stroke,
  offset, emergency stop); adjustable Bluetooth lead

## 1.4.0 – 01.11.2026

- Write back to Stash: stars, favourite (tag), O counter, set markers (key P)
- HereSphere: rating and favourite are written to Stash
- Script tools: stretch stroke, smooth peaks
- Calibrate the offset by tapping the beat (key T)

## 1.3.2 – 01.11.2026

- “Continue watching” row is now a switch, off by default

## 1.3.1 – 01.11.2026

- Link in the library depends on the mode: streaming → Pornhub, sync → FapTap

## 1.3.0 – 01.11.2026

- 🔥 Finale with two variants: “detach completely” or “keep the script, gentler”
- Tested with a real Handy

## 1.2.0 – 01.11.2026

- Sync auto-correction (position every 30 s, clock every 5 min, after app switch) + ⟳ button (key S)
- Seek previews from Stash sprites
- Picture quality: one switch “Automatic – best picture”, single sliders under “Advanced”
- Handy connects automatically at start; paired Satisfyers reconnect
- Readable titles from file names; HQ steps down automatically on stutter
- 🔥 Finale button (key O); offset per scene; “continue watching” row

## 1.1.0 – 31.10.2026

- **Folders as sources** (`/media/<name>`), newest first, “new” badge
- **HereSphere** (VR) API under `/heresphere` with categories, previews, tags, markers, Funscripts
- **Vibrator “rhythm”** (new default): pulses with every stroke
- **HQ “Auto”** (new default): only enhances when the video is smaller than the screen
- **⚙️ Settings**: picture & quality, VR address, library, system info

## 1.0.0 – 31.10.2026 (snapshot)

First recorded version.

- **Modes**: streaming, sync (video + devices), control (direct, patterns, script builder)
- **The Handy** via Wi-Fi (API v2): video sync, direct control, patterns/scripts, offset, stroke limits, invert
- **Vibrator** (Satisfyer and others) via Web Bluetooth or Intiface Central
- **Library**: Stash and a local folder; continue watching, markers, play count to Stash
- **Player**: own controls with heatmap and markers, phone fullscreen, shortcuts, installable app (PWA)
- **Picture enhancement** in the browser (bicubic + AMD CAS); **HQ stream** via Intel Quick Sync
- **Safety**: emergency stop (button, Esc, screen lock), speed and vibration limits
- **Operation**: Docker and Windows
