# Changelog

The GitHub release notes are taken from this file (one `## x.y.z` section per release). It lists what users notice;
changes to the build pipeline, code checks and repository files are left out.

**Versioning (from 2.0.0 on):** `MAJOR.MINOR.PATCH` – a new major for big breaks (new interface, renamed container…),
a new minor for a batch of features, a patch only for bug fixes. Every push to `main` additionally builds the test image
`ghcr.io/scripthost/funscript-player:edge`; `latest` and the version tags only come with a real release.

The 34 versions up to 1.19.9 (31.10.–04.11.2026) are summarised below. Only 1.19.9 and newer are still available on
GitHub (release, git tag, Docker image) – older ones were removed when the versioning was cleaned up.

## 2.0.0-beta1 – 06.11.2026

The big redesign. A beta: please report anything odd.

**Before you update**

- **A login is now required.** If your player ran without `AUTH_USER`/`AUTH_PASS`, it now opens a setup page where you
  choose user name and password. Or set `AUTH_USER` + `AUTH_PASS` in `.env`, or `LOGIN=off` if a reverse proxy with
  its own login protects it. The example password `change-me` does not count.
- **HereSphere is off by default on new installs** (existing installs keep their setting) – switch it on in ⚙️ → VR & HereSphere.
- **Stash 0.32+ answers “HTTP 403”** when Stash has no login and the player's Docker network counts as public. The player
  shows the exact `public_whitelist` line for Stash's `config.yml` in ⚙️ → Library and in `docker logs`.

**New look**

- New dark “graphite” design with a thumb bar at the bottom (Library, Player, Devices, Settings); on a PC the navigation
  sits at the top, settings use two columns
- Settings in clear pages (Devices, Security & privacy, Script, Library, Picture, VR & HereSphere, System) with a back button
- The script shows as a “mountain” in the player bar: height and colour by tempo (blue calm … red/purple intense),
  Stash markers on top
- New app icon; quieter play/pause and finale buttons

**Player and devices**

- Several scripts per video (`clip.soft.funscript` …) for folders and Stash, switchable while playing
- Intensity presets Auto · Original · Gentle · Intense – Intense keeps the rhythm and only uses a longer stroke
- 🌱 Warm-up: slow, gentle movement/vibration – also while the video is paused
- ⏺ Record your own script along the video, name your recordings; patterns and recordings as cards
- “✕ Close video”; the player area becomes “Control” without a video
- Picture-in-picture only via ⧉ (no more black mini window when leaving fullscreen)
- Device checks every time you come back to the app; no Handy warning while another device (e.g. Satisfyer) plays
- Demo mode: blurred videos, previews and names, no sound, virtual Handy and Satisfyer

**Login, Stash and HereSphere**

- Set up, change or remove the login in ⚙️ → Security & privacy (also with `LOGIN=off`). Order: `.env` > ⚙️ > `LOGIN=off`.
  Forgotten? `LOGIN_RESET=1` in `.env`, restart, remove the line again
- Stash address and API key can be changed in ⚙️ → Library (overrides `STASH_URL`/`STASH_API_KEY`); connection status
  with “Test connection”; the player reconnects on its own every 30 s
- “Show 2D videos only” now works without a “2D” tag: it hides Stash scenes with a VR tag and folder videos with a VR
  marker in the file name
- HereSphere: just enter the normal address – the player redirects HereSphere to `/heresphere` (switchable); its own
  password (log in once); the library opens faster (lists load in parallel and are kept for up to 10 minutes)

**Security and Docker**

- Brake against password guessing (10 attempts per minute), login password stored as scrypt hash
- `PLAYER_BIND` to publish the port only locally (e.g. behind a proxy); `UPDATE_CHECK=off`
- Intel graphics check in `docker logs` and ⚙️ → System; the container stops immediately on `docker stop`

## 1.19.11 – 04.11.2026

- **Own fullscreen is back** – with STOP, finale, sound and fit/fill (“stretched”); swiping shows its value in the middle of
  the picture. The browser’s video fullscreen (since 1.19.3) only had the browser controls. Picture-in-picture via ⧉
- **Quieter start:** connecting the Handy automatically runs silently (status at the top only) and keeps retrying; one calm
  hint only after the last attempt. Satisfyer reconnects silently too. Coming back to the app retries the Handy
- **Video start:** the thumbnail (or black with a spinner) shows until the first real frame is on screen
- **Fix:** recording along the video with only a Satisfyer recorded nothing (touch mode “position” is Handy-only now)
- **Devices window:** one “Connect” button instead of two; shows whether Handy API v2 or v3 is in use
- Clearer texts for “keep the Handy in time” and for calibrating the offset (tap when the video reaches the lowest point)
- Swipe defaults from 1.19.8 (left volume, right both) are switched once to left Handy stroke, right Satisfyer strength

## 1.19.10 – 04.11.2026

Security fixes – all low risk:

- `/api/version` now requires the login like everything else (only `/healthz` stays open for the Docker healthcheck)
- Logs: line breaks and control characters are stripped from everything written to `docker logs`, so log lines can't be faked
- Stash filters and own-script keys: names like `__proto__` are rejected
- HereSphere: passwords from before 1.19.5 (SHA-256) are no longer accepted – if HereSphere asks again, set the password
  once more under ⚙️ → VR
- Stash IDs in requests are always encoded

## 1.19 – 01.–04.11.2026: polish, safety, Docker

Latest: **1.19.11**. Upgrading from 1.19.6 or older: container and volume were renamed in 1.19.7 – see README
“Upgrading from 1.19.6 or older”.

- **Script intensity, one choice for both devices:** Automatic · Original · Gentle · Intense, per scene at the video with
  a mini heatmap preview; Handy and Satisfyer pause while the video seeks or buffers
- **Satisfyer:** several at once, each with its own strength and Bluetooth lead (latency measured per device); two motors
  can split rhythm and tempo; soft start and soft stop; battery per device with a low-battery warning
- **Handy:** connection key also in the device window, Application ID (API v3) in the settings; resync under the
  connection; automatic reconnect after a page reload
- **Honest status:** “connected” is checked for real on return and every minute; if a device drops mid-video, the video
  pauses (can be turned off)
- **At the video:** only what connected devices need – intensity, offset (collapsed, tap to change), Handy stroke,
  Satisfyer strength/translation; player bar without −/+, 🎚, ✨ and ⟳; press and hold = 2× / rewind, double tap = jump
- **Fullscreen:** swipe up/down per half (default: left Handy stroke, right Satisfyer strength), picture-in-picture when
  leaving the app from fullscreen
- **Like an app:** “📲 Install as app”, optional “whole app in fullscreen” in the browser, welcome on a fresh install,
  English/German UI, settings collapsible with explanations behind ⓘ, “update available” notice
- **Defaults:** STOP buttons at the video, stop on screen lock and auto-stop are off (Esc and “Stop everything” in the
  device window always work); picture “Auto”; Stash actions and date/length/views below the video off
- **Docker:** ready-made image `ghcr.io/scripthost/funscript-player`, hardened container (read-only, no capabilities,
  memory limit), container `Funscript-Player` with volume `funscript-data`, English compose/.env/logs, self-check in
  `docker logs` ending with “✓ ready”, healthcheck via Node
- **Security:** Content Security Policy, origin check, HereSphere password with scrypt (log in once), Intiface relay to the
  home network and port 12345 only by default
- **Quality:** tests on every push incl. a translation test, the browser self-test in headless Chrome and ESLint
- **Removed along the way:** remote control, script builder, adjust section, demo mode, continue watching, library
  buttons, backup/restore, Windows scripts, “🎵 follow sound” (1.19.7–1.19.8)

## 1.10 – 1.18 – 31.10.–01.11.2026: Funscript Player

- New name **Funscript Player** (1.10)
- **Script automation:** check every script and only change what the Handy can't do; per scene; own scripts (✋) recorded
  along the video, originals never overwritten
- **Control it yourself** for videos without a Funscript; touch area (tempo or position); ⏺ recording
- **Handy API v3** with an Application ID (in sync at 0.5×–2×); model detection and top speed
- **Settings shared by all devices**, stored on the server
- Calmer interface: one status at the top, device window, mini player while browsing, picture-in-picture, intensity strip
  on every tile, intensity filter
- **HereSphere:** VR videos only, optional password, can be switched off
- English interface, Docker health check, `.env` settings, server split into `lib/`, automated tests

## 1.0 – 1.9 – 31.10.–01.11.2026: the foundation

- **The Handy** (Wi-Fi, API v2) and **Satisfyer** (Web Bluetooth or Intiface) in sync with the video; Handy via Bluetooth
  through Intiface as an offline path
- **Library:** Stash and folders (`/media/<name>`), seek previews from Stash sprites, write back stars, favourite,
  O counter and markers
- **HereSphere** VR API; **picture:** browser enhancement and HQ stream via Intel Quick Sync
- 🔥 **Finale**, sync auto-correction, offset per scene with calibration by tapping the beat (key T)
- **Safety:** emergency stop (button, Esc, screen lock), speed and vibration limits
