# Nachtrag zur Übergabe – seit dem letzten Einlesen von HANDOFF.md

Nur was sich geändert hat. HANDOFF.md selbst ist unverändert und gilt weiter
(Stand 1.16.0, Sammelliste 1.17, Ideen, Arbeitsweise).

## Geändert: Vorstellung (`docs/index.html` + Einzeldatei)

Keine neue Player-Version – nur die Vorstellungs-Seite. Der Player-Code (`public/`, `server.js`) ist unberührt.

1. **Mini-Player „Ausprobieren“** (neu, `docs/try-demo.js`): Video + Funscript wählen oder Beispiel-Script
   (60 s, absichtlich mit flachem Hub, zu schneller Stelle und Zittern). Heatmap + Hub-Verlauf, Handy-Schlitten,
   Satisfyer-Kugel. Umschalter **Original / ⚡ Automatik** (vereinfachte Kopie von `processScript`: Zittern weg,
   Hub strecken < 70, für die Handy auf 400 %/s kürzen) mit Hinweiszeile, was geändert wurde, und
   **Rhythmus / Tempo / Position** für den Satisfyer. Optional echte Geräte (Satisfyer Web Bluetooth, Handy API v2).
2. **Drei Highlights** direkt unter dem Kopf (+ hervorgehobene Chips):
   ⚡ Scripts automatisch besser · 〰 **Satisfyer mit jedem Script** (Hub-Script wird live zu Vibration) ·
   ✨ Upscaling (Vorher/Nachher-Grafik).
   Hinweis des Nutzers: „Auto Convert / nativ auf nicht unterstützten Geräten“ meint die **Live-Umrechnung fürs
   Satisfyer**, nicht Videoformate. Format-Umwandlung steht nur noch im Block „Bild & Wiedergabe“ (dort korrekt:
   Auto-Umwandeln nur Stash-Szenen, Ordner-Videos nur über den HQ-Stream).
3. **„Für wen?“** (Handy / Satisfyer / Stash) mit Vergleichstabelle „Üblicher Weg ↔ Funscript Player“.
4. **„Was brauche ich?“** vor der Installation: Nötig / Optional.

## Neu: Einzeldatei zum Verschicken

- `node docs/build-single.js ../Funscript-Player-Vorstellung.html` → `C:\Projekte\handy-player\Funscript-Player-Vorstellung.html`
  (~80 KB, alles eingebettet, für WhatsApp). Nach jeder Änderung an `docs/` neu bauen.
- CSS-Falle: Klassen in `docs/style.css` sind global – vorher grep, ob der Name schon belegt ist
  (`.m`, `.sd-slider` hatten schon Ärger gemacht).

## Offen / Ideen zur Vorstellung (nicht gebaut)

- Echter Screenshot oder kurzes GIF des Players im Kopf (Material vom Nutzer nötig).
- Upscaling-Vergleich mit Schieberegler und echtem Standbild (Material vom Nutzer nötig).
- Seite für WhatsApp evtl. kürzen (kompakte Fassung).
- Promo-Bild `promo.html` / `funscript-player-praesentation.png` zeigt die drei Highlights noch nicht.
