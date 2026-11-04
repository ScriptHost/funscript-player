# Changelog

The GitHub release notes are taken from this file (one `## x.y.z` section per release).

**Versioning (from 2.0.0 on):** `MAJOR.MINOR.PATCH` – a new major for big breaks (new interface, renamed container…),
a new minor for a batch of features, a patch only for bug fixes. Every push to `main` additionally builds the test image
`ghcr.io/scripthost/funscript-player:edge`; `latest` and the version tags only come with a real release.

The 34 versions up to 1.19.9 (31.10.–04.11.2026) are summarised below; their git tags and Docker images stay available.

## 1.19.10 – 04.11.2026

Security fixes from GitHub code scanning (CodeQL) – all low risk:

- `/api/version` now requires the login like everything else (only `/healthz` stays open for the Docker healthcheck)
- Logs: line breaks and control characters are stripped from everything written to `docker logs`, so log lines can't be faked
- Stash filters and own-script keys: names like `__proto__` are rejected
- HereSphere: passwords from before 1.19.5 (SHA-256) are no longer accepted – if HereSphere asks again, set the password
  once more under ⚙️ → VR
- Code scanning ignores tests and the README graphics script; Stash IDs in requests are always encoded

## 1.19 – 01.–04.11.2026: polish, safety, Docker

Latest: **1.19.10** (security fixes, see above). Upgrading from 1.19.6 or older: container and volume were renamed in 1.19.7 – see README
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
