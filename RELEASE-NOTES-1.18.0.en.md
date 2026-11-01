# Funscript Player 1.18 – release notes (English)

German version: [RELEASE-NOTES-1.18.0.md](RELEASE-NOTES-1.18.0.md) · full list: `CHANGELOG.md`

## Updating
- `cp .env.example .env` and set domain/Stash – `docker-compose.yml` now reads every value from `.env`.
- Media folders are commented out in `docker-compose.yml`: enable the line and `MEDIA_FILME` in `.env` if you use them.
- “Offer as screen” (remote) is now off by default – switch it on once on the TV/PC.
- Handy scripts play original by default (beat guard); finale defaults “gentler, half tempo, 15–85 %, 210 s”.

## What’s new
- **Handy “Original + beat guard”:** fine vibrations stay, only strokes the motor can’t manage are adapted – around
  the stroke’s own centre, or full stroke at half tempo. Satisfyer keeps “Automatic”. Adapted spots show in the heatmap.
- **Own scripts (✋):** choose original or own, record again (just a section or completely), delete. Originals are
  never overwritten.
- **Script area** at the video (script choice, adjustment per device, control yourself); offset shows
  “🎯 calibrated” and can be reset; ✋/🎯 on library tiles.
- **Fixes:** touch “Position” with Application ID (0–1 scale), touch pad mirrors slider/quick picks, picture-in-picture
  from fullscreen, playback resumes after picture-in-picture, no duplicate mini player.
- **Settings:** advanced settings hidden by default, backup download/restore, “new in 1.18” hint, English interface.
- **Docker:** health check every 5 s (Traefik used to wait up to 30 s), startup summary ending in “✓ bereit” and
  slow requests in `docker logs`, settings in `.env`.
- **Internals:** server split into `lib/`, cached library, self-test (`?selbsttest`), new presentation page with
  animated header and phone layout.

## 1.18.1
- Fixed: start page “Nicht gefunden” and version “dev”, Stash “https is not defined” (after the server split).

## 1.18.2
- Developer page with English/German switch, English README (`README.md`, German `README.de.md`), these notes.
