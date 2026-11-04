<!-- Grafiken: docs/img/gh/ (erzeugt mit `node docs/img/gh/build.js`) -->
<p align="center">
  <a href="../../releases/latest"><img src="docs/img/gh/hero.svg" alt="Self-hosted · in the browser – Your video. Your devices. Perfectly in sync. A Funscript player that drives The Handy and the Satisfyer at the same time – from any script, right from your Stash library." width="100%"></a>
</p>

<p align="center">
  <a href="#-quick-start"><img src="docs/img/gh/btn-install.svg" alt="Install" height="48"></a>&nbsp;
  <a href="../../releases/latest"><img src="docs/img/gh/btn-download.svg" alt="Download ZIP" height="48"></a>
</p>

<p align="center">
  <a href="../../releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/ScriptHost/funscript-player?style=flat-square&label=version&color=e0457b"></a>
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/node.js-no%20dependencies-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="The Handy" src="https://img.shields.io/badge/The%20Handy-API%20v3-1a1d23?style=flat-square">
  <img alt="Satisfyer" src="https://img.shields.io/badge/Satisfyer-Bluetooth-1a1d23?style=flat-square">
  <img alt="Stash" src="https://img.shields.io/badge/Stash-integrated-1a1d23?style=flat-square">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-1a1d23?style=flat-square"></a>
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/README-Deutsch-1a1d23?style=flat-square"></a>
</p>

<p align="center">
  <img src="docs/img/gh/live.svg" alt="Animation: the video plays, The Handy strokes and the Satisfyer pulses – all from one Funscript" width="100%">
</p>

<p align="center">
  <img src="docs/img/gh/highlights.svg" alt="One choice for every device · Satisfyer with any script · Natural picture through upscaling" width="100%">
</p>

<p align="center">
  <img src="docs/img/gh/h-look.svg" alt="See it – the player as it looks today" width="100%">
  <img src="docs/img/player-1.19.7.svg" alt="Funscript Player 1.19.7 on a phone: player with script box and library" width="100%">
</p>

<p align="center">
  <img src="docs/img/gh/h-for-whom.svg" alt="Who is it for? Whatever you own" width="100%">
  <img src="docs/img/gh/for-whom.svg" alt="Just a Handy · Just a Satisfyer · A Stash library" width="100%">
</p>

<p align="center">
  <img src="docs/img/gh/h-steps.svg" alt="In three steps – connect, pick, play" width="100%">
  <img src="docs/img/gh/steps.svg" alt="1 Connect · 2 Pick a scene · 3 Play" width="100%">
</p>

## ✨ All features

| | |
|---|---|
| 🎚 **One script, every device** | Pick the intensity once for Handy and Satisfyer: **Original** (untouched), **Automatic** (small strokes stretched, what the motor can't manage adapted – still exactly in time), **Gentle** or **Intense** – per scene right at the video, with a mini heatmap preview. |
| 〰 **Satisfyer with any script** | The stroke script becomes vibration live – by rhythm, speed or position. No vibration script needed. Several Satisfyers at once, each with its own strength and lead; two motors can split into rhythm and tempo. |
| ⏱️ **Sync that stays in time** | Handy cloud with clock sync; with an *Application ID* (API v3) even at 0.5×–2× playback. |
| 👆 **Swipe in fullscreen** | Left/right half up/down – Handy stroke, Satisfyer strength, both devices or volume, configurable per half. |
| 🔌 **Honest status** | “Connected” is checked for real (on return and every minute) and reconnects; if a device drops mid-video, the video pauses. Satisfyer battery in the device list. |
| 📲 **Like an app** | Install it as an app with one tap, or put the whole app in fullscreen in the browser; leaving the app while the video plays opens picture-in-picture. |
| ✋ **Your own scripts** | Control the devices yourself while watching (slider, quick picks, touch pad), record it as a script, replace just a section later. Originals are never overwritten. |
| 📚 **Library** | Stash scenes and folder videos with heatmap, intensity filter, 🔥 highlights, saved Stash filters, 2D-only mode, mini player, picture-in-picture. |
| ✨ **Natural picture** | Small videos are upscaled on the server (Intel Quick Sync / VAAPI) and lightly denoised; colours stay as in the original. More sharpness on request. |
| 🥽 **VR** | HereSphere API for VR headsets – ratings and favourites go back to Stash. |
| 🛑 **Emergency stop** | Esc and “Stop everything” in the devices window always; optional STOP buttons at the video, stop on screen lock and auto-stop after X minutes without input. |

<p align="center"><img src="docs/img/gh/h-install.svg" alt="Installation – Docker in five minutes" width="100%"></p>

## 🚀 Quick start

Grab `handy-player-linux-vX.Y.Z.zip` from the [latest release](../../releases/latest) (or clone this repo), then:

```bash
unzip handy-player-linux-vX.Y.Z.zip && cd handy-player
cp .env.example .env      # once: set STASH_URL, port and media folders if any
nano .env
docker compose pull && docker compose up -d
docker logs Funscript-Player  # startup summary with self-check, ends with “✓ ready”
```

- The player listens on `http://<server>:8080` (`PLAYER_PORT`). For **HTTPS** – needed for Bluetooth and “install as
  app” – put any reverse proxy in front (Traefik, Caddy, nginx, Nginx Proxy Manager …), e.g.
  `https://funscript-player.example.com` → port 8080 of the container.
- **Update:** `docker compose pull && docker compose up -d` – the ready-made image comes from GitHub
  (`ghcr.io/scripthost/funscript-player`). Build it yourself with `docker compose up -d --build`. Want to try what is
  coming next? `PLAYER_VERSION=edge` in `.env` follows the latest tested state of `main` (no release, may change daily).
- All server settings live in **`.env`**; `docker-compose.yml` only reads them. Updates never overwrite your `.env`.
- **Stash:** best reached directly over a shared Docker network, e.g. `STASH_URL=http://Stash:9999` (container name) –
  the player never hands Stash addresses to the browser, so no public DNS name is needed.
- **Media folders** are commented out by default (Stash only). Every folder under `/media/<name>` becomes a source; a video
  and its script share the same name (`Name.mp4` + `Name.funscript`).
- **HQ stream:** `/dev/dri` is passed through, `RENDER_GID` = GID of the host group `render` (`getent group render`).
- The container runs as user `node` (1000), never as root; `PUID`/`PGID` change it. `PLAYER_MEM` (default 2g) caps
  its memory – if the player runs out, only the player is hit, not Stash.

### Upgrading from 1.19.6 or older: container and volume were renamed

Since 1.19.7 the container is called `Funscript-Player` and the volume `funscript-data` (before: `Handy-Player` and
`<folder>_handy-data`). A new volume starts empty – copy your old data (key, settings, own scripts) over once:

```bash
docker volume ls | grep handy-data          # find the old name, e.g. handy-player_handy-data
docker stop Handy-Player && docker rm Handy-Player
docker volume create funscript-data
docker run --rm -v handy-player_handy-data:/from -v funscript-data:/to alpine cp -a /from/. /to/
docker compose pull && docker compose up -d
```

Once everything works, the old volume can go: `docker volume rm handy-player_handy-data`.

### What lives in the `funscript-data` volume?

Everything the player stores – back up this volume and you have backed up everything. Delete it and the player really
starts fresh (browsers forget the shared settings too).

| File | Contents |
|---|---|
| `prefs.json` | Settings shared by all devices: connection key, Application ID, offsets and stroke per scene, script intensity, Satisfyer translation, emergency stop … |
| `store.json` | Patterns (🎮 Control → Patterns) |
| `settings.json` | Server switches from the UI: HereSphere on/off, VR only, HereSphere password (scrypt hash), Intiface LAN only |
| `scripts/` + `userscripts.json` | Own scripts (touch recordings, recordings along the video) for Stash scenes and the index of all own scripts |
| `handy-cache.json` | Scripts already uploaded to the Handy (faster start) |

## Usage

1. Tap the status at the top → connect the Handy (connection key, optional Application ID) and/or the Satisfyer
   (Bluetooth right in Chrome/Edge, on iPhone the “Bluefy” app).
2. Pick a scene in the library and press play. Below the video you only see the controls of connected devices.
3. If a script is noticeably off: shift the **offset** or calibrate it by tapping the beat (🎯, saved per scene).

Every settings section is collapsible; fine-tuning (Satisfyer translation, picture, finale, display …) appears with
**⚙️ → Settings → Show advanced settings**. ⚙️ → System shows **“Update available”** when GitHub has a newer release.

## Security

- No login in the player by default – run it behind a protected proxy or in your home network only, or set
  `AUTH_USER`/`AUTH_PASS` (basic auth).
- The server only accepts changes from its own page (origin check) and can’t be embedded in other sites.
- Intiface forwarding: home-network addresses only by default (192.168.x / 10.x; fixed with `INTIFACE_LAN_ONLY=1`),
  port 12345 only – allow more with `INTIFACE_PORTS` (comma-separated).
- The container runs read-only, with `/tmp` as tmpfs, without Linux capabilities (`cap_drop: ALL`) and with
  `no-new-privileges`; it only writes to its data volume.
- A strict Content Security Policy only allows the player's own scripts.
- HereSphere password: stored as a scrypt hash; a new password logs out all devices.

## Development

```bash
MEDIA_DIR=./testmedia DATA_DIR=./data node server.js   # → http://localhost:8080
node --test "test/*.test.js"                           # automated tests, no packages needed
```

At startup the container checks itself (data folder, stored files, every UI script and control, script intensity) –
see `docker logs`. For development, `?selbsttest` runs typical flows with a simulated Handy. Technical details:
[DEVELOPMENT.md](DEVELOPMENT.md). Release history: [CHANGELOG.md](CHANGELOG.md). Want to help? [CONTRIBUTING.md](CONTRIBUTING.md).

## Notes

- **Privacy:** for Wi-Fi control only the Funscript is uploaded to the Handy’s script hosting (as CSV with the neutral
  name `script.csv`). Videos and titles stay on your server.
- **Formats:** whatever your browser plays – MP4 (H.264/H.265) and WebM everywhere, MKV depending on the browser;
  Stash scenes in other formats are converted live.

## License

Copyright © 2026 Funscript Player contributors. Licensed under the **[GNU AGPL-3.0](LICENSE)**: use, self-host and
change it freely; if you offer a modified version to others – also as a service over the network – you have to share its
source code under the same license.

---

<p align="center">
  <a href="../../releases"><b>Releases</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a> ·
  <a href="DEVELOPMENT.md"><b>Developer docs</b></a> ·
  <a href="../../issues/new/choose"><b>Report a bug / idea</b></a> ·
  <a href="README.de.md"><b>🇩🇪 Deutsch</b></a>
</p>
