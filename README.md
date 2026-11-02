<!-- Grafiken: docs/img/gh/ (erzeugt mit `node docs/img/gh/build.js`, Stil und Texte wie funscript-player.de) -->
<p align="center">
  <a href="https://funscript-player.de"><img src="docs/img/gh/hero.svg" alt="Self-hosted · in the browser – Your video. Your devices. Perfectly in sync. A Funscript player that drives The Handy and the Satisfyer at the same time – from any script, right from your Stash library." width="100%"></a>
</p>

<p align="center">
  <a href="#-quick-start"><img src="docs/img/gh/btn-install.svg" alt="Install" height="48"></a>&nbsp;
  <a href="https://funscript-player.de"><img src="docs/img/gh/btn-website.svg" alt="Website" height="48"></a>&nbsp;
  <a href="../../releases/latest"><img src="docs/img/gh/btn-download.svg" alt="Download ZIP" height="48"></a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.19.2-e0457b?style=flat-square">
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/node.js-no%20dependencies-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="The Handy" src="https://img.shields.io/badge/The%20Handy-API%20v3-1a1d23?style=flat-square">
  <img alt="Satisfyer" src="https://img.shields.io/badge/Satisfyer-Bluetooth-1a1d23?style=flat-square">
  <img alt="Stash" src="https://img.shields.io/badge/Stash-integrated-1a1d23?style=flat-square">
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/README-Deutsch-1a1d23?style=flat-square"></a>
</p>

<p align="center">
  <img src="docs/img/gh/live.svg" alt="Animation: the video plays, The Handy strokes and the Satisfyer pulses – all from one Funscript" width="100%">
</p>

<p align="center">
  <img src="docs/img/gh/highlights.svg" alt="Automatic – and still in time · Satisfyer with any script · Sharper picture through upscaling" width="100%">
</p>

<p align="center">
  <img src="docs/img/gh/h-look.svg" alt="See it – the player as it looks today" width="100%">
  <img src="docs/img/player-1.19.2.svg" alt="Funscript Player 1.19.2 on a phone: player with script box and library" width="100%">
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
| ⚡ **One script, every device** | Scripts play **Automatic** by default: what the Handy's motor can't manage is adapted (shorter, or full stroke at half tempo), small strokes are stretched. Prefer it untouched? Pick **original + beat guard**. |
| 〰 **Satisfyer with any script** | The stroke script becomes vibration live – by rhythm, speed or position. No vibration script needed. |
| ⏱️ **Sync that stays in time** | Handy cloud with clock sync; with an *Application ID* (API v3) even at 0.5×–2× playback. |
| ✋ **Your own scripts** | Control the devices yourself while watching (slider, quick picks, touch pad), record it as a script, replace just a section later. Originals are never overwritten. |
| 📚 **Library** | Stash scenes and folder videos with heatmap, intensity filter, 🔥 hottest spots, saved Stash filters, continue watching, 2D-only mode, mini player, picture-in-picture. |
| ✨ **Sharper picture** | Server-side upscaling (Intel Quick Sync / VAAPI) plus sharpening in the browser. |
| 📱 **Remote & VR** | Video on the TV, controls on the phone; HereSphere API for VR headsets. |
| 🛡️ **Safety first** | STOP button everywhere, Esc as emergency stop, devices pause when the screen locks. |

<p align="center"><img src="docs/img/gh/h-install.svg" alt="Installation – Docker in five minutes" width="100%"></p>

## 🚀 Quick start

Grab `handy-player-linux-vX.Y.Z.zip` from the [latest release](../../releases/latest) (or clone this repo), then:

```bash
unzip handy-player-linux-vX.Y.Z.zip && cd handy-player
cp .env.example .env      # once: set DOMAIN, STASH_URL, media folders if any
nano .env
docker compose up -d --build
docker logs Handy-Player  # startup summary ends with “✓ bereit” (ready)
```

- All server settings live in **`.env`**; `docker-compose.yml` only reads them. Updates never overwrite your `.env`.
- Player settings shared by all your devices (Handy connection key, Application ID, offsets, own scripts …) are stored
  on the server in the Docker volume **`handy-data`** (`/app/data/prefs.json`, `store.json`) – that is why they are in sync
  everywhere and survive updates. Back them up via ⚙️ → System → Backup.
- The compose file is prepared for **Traefik** (add your own labels and networks); the player runs at `https://${PLAYER_HOST}.${DOMAIN}`.
- **Media folders** are commented out by default (Stash only). To use folders, enable the volume line in
  `docker-compose.yml` and set `MEDIA_FILME` in `.env`. Every folder under `/media/<name>` becomes a source; a video and
  its script share the same name (`Name.mp4` + `Name.funscript`).
- **HQ stream:** `/dev/dri` is passed through, `RENDER_GID` = GID of the host group `render` (`getent group render`).
- The container runs as user `node` (1000), never as root; `PUID`/`PGID` change it.
- Bluetooth and “install as app” need **HTTPS with a valid certificate** (e.g. Traefik + Let’s Encrypt).

## Usage

1. Tap the status at the top → connect the Handy (connection key, optional Application ID) and/or the Satisfyer
   (Bluetooth right in Chrome/Edge, on iPhone the “Bluefy” app).
2. Pick a scene in the library and press play. Below the video you only see the controls of connected devices.
3. If a script is noticeably off: shift the **offset** or calibrate it by tapping the beat (🎯, saved per scene).

Fine-tuning (Satisfyer translation, picture, finale, display …) is under **⚙️ → Settings → Show advanced settings**.
⚙️ → System offers a **backup** (own scripts, offsets, patterns, settings) to download and restore.

## Security

- No login in the player by default – run it behind a protected proxy or in your home network only, or set
  `AUTH_USER`/`AUTH_PASS` (basic auth).
- The server only accepts changes from its own page (origin check) and can’t be embedded in other sites.
- `INTIFACE_LAN_ONLY=1` restricts the Intiface forwarding to 192.168.x / 10.x.

## Development

```bash
MEDIA_DIR=./testmedia DATA_DIR=./data node server.js   # → http://localhost:8080
node --test "test/*.test.js"                           # automated tests, no packages needed
```

Open the player with `?selbsttest` for an in-browser self-test with a simulated Handy. Technical details:
`docs/dev.html` (English/German switch). Release history: [CHANGELOG.md](CHANGELOG.md) and [release-notes/](release-notes) (German).

## Notes

- **Privacy:** for Wi-Fi control only the Funscript is uploaded to the Handy’s script hosting (as CSV with the neutral
  name `script.csv`). Videos and titles stay on your server.
- **Formats:** whatever your browser plays – MP4 (H.264/H.265) and WebM everywhere, MKV depending on the browser;
  Stash scenes in other formats are converted live.

---

<p align="center">
  <a href="https://funscript-player.de"><b>Website</b></a> ·
  <a href="../../releases"><b>Releases</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a> ·
  <a href="https://funscript-player.de/dev.html"><b>Developer docs</b></a> ·
  <a href="../../issues/new/choose"><b>Report a bug / idea</b></a> ·
  <a href="README.de.md"><b>🇩🇪 Deutsch</b></a>
</p>
