# Funscript Player 1.18.0

Kurzfassung (ausführlich: CHANGELOG.md). English version follows in a later release.

## Wichtig beim Update
- `cp .env.example .env` und Domain/Stash eintragen – die `docker-compose.yml` liest alle Werte aus der `.env`.
- Medienordner sind in der `docker-compose.yml` auskommentiert: bei Bedarf Zeile + `MEDIA_FILME` in der `.env` einschalten.
- „Als Bildschirm anbieten“ ist jetzt standardmäßig aus – am TV/PC einmal einschalten.
- Handy-Scripts laufen standardmäßig original (Takt-Schutz); Finale-Standard „sanfter, halbes Tempo, 15–85 %, 210 s“.

## Test-Checkliste mit echten Geräten
1. Touch „Position“ (mit Application ID): Finger halb hoch → Handy halb hoch. Fährt sie kaum noch, Rückmeldung geben.
2. Aus dem Vollbild die App verlassen → kleines Fenster zeigt das Video; zurück → läuft weiter.
3. Video mit Script: Script-Bereich am Video, Handy „Original + Takt-Schutz“, Vibrationen bleiben spürbar.
4. Selbst steuern → ⏺ Mitschnitt → „Nur diesen Abschnitt ersetzen“ bei einem eigenen Script.
5. Offset einmessen → nach Neuöffnen „🎯 eingemessen“ sichtbar.
6. `docker compose up -d` → `docker logs Handy-Player` zeigt Start-Übersicht und „✓ bereit“, Seite nach wenigen Sekunden da.
7. Im Browser `…/?selbsttest` – alle Punkte ✅.

## Nicht getestet
Echte Handy (Position, Modell), Bild-in-Bild auf dem Pixel, HereSphere-Passwort in der Brille, Docker-Build (kein Docker auf dem Entwicklungsrechner).
