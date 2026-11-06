# Contributing

Thanks for wanting to help! Bug reports, ideas and pull requests are welcome.

## Before you start

- **Bugs:** open an issue with the template – version (⚙️ → System), browser, device (Handy / Satisfyer / Intiface) and,
  if possible, the relevant lines from `docker logs Funscript-Player`.
- **Security problems:** please **not** as an issue – see [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue first so we can agree on the direction before you spend time on code.

## Run it locally

No build step and no dependencies – only Node.js 22 (and ffmpeg for the HQ stream, optional):

```bash
PORT=8080 MEDIA_DIR=/path/to/videos DATA_DIR=./data node server.js
```

Open `http://localhost:8080`. Bluetooth (Satisfyer) works on `localhost` or over HTTPS. A folder with `video.mp4` and
`video.funscript` side by side is enough to try the sync; for Stash set `STASH_URL`.

## Checks before a pull request

```bash
node --test "test/*.test.js"                          # server, script logic, translations, browser self-test
npm ci && npx eslint .                               # code check (versions pinned in package-lock.json)
```

The browser self-test needs Chrome or Edge; without one it is skipped locally (on GitHub it always runs). Open
`http://localhost:8080/?selbsttest` to watch it in the browser.

## Code style

- Plain JavaScript, no framework, no build step; match the surrounding code (naming, comment density).
- New interface texts get a key in `public/lang/en.js` and `public/lang/de.js` (use `t('key')` or `data-i18n="key"`).
  The tests check that both languages have the same keys.
- Anything that moves a device must stop with `emergencyStop()` and when the connection is lost.
- Architecture and core concepts: [DEVELOPMENT.md](DEVELOPMENT.md).

## License

By contributing you agree that your contribution is licensed under the [GNU AGPL-3.0](LICENSE), like the rest of the
project.

---

**Deutsch:** Beiträge sind willkommen – Fehler bitte mit der Vorlage als Issue melden, Sicherheitsprobleme vertraulich
(siehe SECURITY.md). Vor einem Pull Request `node --test "test/*.test.js"` ausführen. Beiträge stehen wie das ganze
Projekt unter der AGPL-3.0.
