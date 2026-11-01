# Funscript Player

> 🇩🇪 Deutsch: [README.de.md](README.de.md)

Self-hosted web player that plays your videos and drives **The Handy** and the **Satisfyer** in sync – both from the
same Funscript, no separate vibration script needed. Library from **Stash** and/or your own folders, watch on PC,
phone, TV or in a VR headset (HereSphere). No external dependencies, one small container.

## Highlights

- **One script for every device.** The Handy plays the Funscript **original + beat guard**: every fine movement and
  vibration stays, only strokes faster than its motor are adapted (shorter, or full stroke at half tempo). The Satisfyer
  turns the same stroke script into vibration live (rhythm, speed or position).
- **Sync that stays in time:** Handy cloud with clock sync; with an *Application ID* (API v3) even at 0.5×–2× speed.
- **Own scripts (✋):** control the devices yourself while watching (slider, quick picks or touch pad), record it as a
  script for the video, later replace just a section or delete it. Originals are never overwritten.
- **Library:** Stash scenes and folder videos with heatmap and intensity filter, saved Stash filters, continue
  watching, mini player while browsing, picture-in-picture.
- **Picture:** upscaling on the server (Intel Quick Sync / VAAPI) plus sharpening in the browser.
- **Remote:** video on the TV, controls and Satisfyer on the phone.
- **VR:** HereSphere API (VR videos, optional password, ratings back to Stash).
- **English and German** interface (follows the device language, switch under ⚙️ → Display).

## Installation (Docker)

```bash
unzip handy-player-linux-vX.Y.Z.zip && cd handy-player
cp .env.example .env      # once: set DOMAIN, STASH_URL, media folders if any
nano .env
docker compose up -d --build
docker logs Handy-Player  # startup summary ends with “✓ bereit” (ready)
```

- All settings live in **`.env`**; `docker-compose.yml` only reads them. Updates never overwrite your `.env`.
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
`docs/dev.html` (English/German switch). Release history: `CHANGELOG.md` and `RELEASE-NOTES-*.md` (German).

## Notes

- **Privacy:** for Wi-Fi control only the Funscript is uploaded to the Handy’s script hosting (as CSV with the neutral
  name `script.csv`). Videos and titles stay on your server.
- **Formats:** whatever your browser plays – MP4 (H.264/H.265) and WebM everywhere, MKV depending on the browser;
  Stash scenes in other formats are converted live.
