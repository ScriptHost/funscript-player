# Funscript Player 1.19.0 – deine Rückmeldungen aus dem Test

## Fehler behoben
- **Mitschnitt im Positions-Modus** nahm nichts auf – jetzt wird die Finger-Position aufgezeichnet (wird ein Positions-Script).
- **Altes Standbild beim Videowechsel:** Die Bildverbesserung wird beim Wechsel geleert; Stash-Szenen zeigen ihr Vorschaubild.
- **Mini-Player wanderte beim Scrollen** (Browserleiste ein/aus) – jetzt fest verankert.
- **Script-Infos trotz „Zeile Scriptname“ aus** – der Script-Bereich hält sich jetzt an die Einstellung.
- **Minimieren aus dem Vollbild schwarz:** Android öffnet das kleine Fenster automatisch nur, wenn das *Video selbst* im
  Vollbild ist. Neue Option (⚙️ → Anzeige, erweitert) **„Vollbild nur mit dem Video“** – dann klappt es automatisch, im
  Vollbild gibt es dafür die Browser-Bedienung statt der Player-Leiste. Ohne Option weiter über ⧉.

## Steuerung
- **Finger „Position“ flüssiger:** geglättet, und jede Bewegung dauert länger als der Abstand der Befehle – die Handy
  bleibt nicht mehr zwischen zwei Befehlen stehen (vorher „fahren – stehen – fahren“).
- **Hublänge im Tempo-Modus** (Selbst steuern): kürzerer Weg um die Mitte des Hubs.
- **„↩ Zurück zum Script“** deutlich im Script-Bereich.
- **Vollbild: gedrückt halten links/rechts = spulen.** Sprungweite 5/10 s wie eingestellt beim Doppeltippen.
- **Vib-Knopf zeigt den Zustand** (rot „Vib ▶“, wenn die Geräte pausiert sind).
- **Hub live:** Beim Ziehen von Hub min/max fährt die Handy auf die Grenze (wenn gerade kein Video läuft).
- **Bluetooth als Rückfall:** Ist die Handy-Cloud weg, aber die Handy per Intiface verbunden, übernimmt Bluetooth.

## Oberfläche
- **Ein Status oben:** nur noch „verbunden“ oder „getrennt“.
- **Bild-Popup** am Player (Automatisch/Aus, Stufen) statt Sprung in die Einstellungen.
- **Bibliothek:** Knöpfe (Zufall, FapTap, Pornhub, Datei) ein-/ausblenden, **eigene Links** anlegen.
- **Intensitäts-Filter** schaltet „nur mit Funscript“ mit ein.
- Unter der Szene: Ist nur ein Teil an (z. B. Darsteller), steht er direkt da. Szenentitel kleiner.
- **Selbsttest** als Knopf (⚙️ → System), mit Bericht zum Herunterladen.
- **Demo-Modus** (⚙️ → Anzeige): Vorschaubilder, Video und Titel unkenntlich – zum Vorzeigen und für Screenshots.

## Scripts
- **Gemeinsam einstellen:** eine Auswahl für Handy und Satisfyer (abschaltbar → getrennt).
- **🔥 Intensivste Stelle:** springt der Reihe nach zu den 3 intensivsten Abschnitten.
- **✂ Abschnitt anpassen:** Bereich „ab hier … bis hier“ sanfter, intensiver, halbes Tempo, stumm oder ±100 ms –
  gespeichert als eigenes Script, das Original bleibt.

## Satisfyer & Standards
- **Kräftiger und deutlicher pulsierend** (Rhythmus-Übersetzung angehoben, „Automatisch“ glättet nicht mehr).
- Standards: Minimum 0 %, Maximum 100 %, „Volle Stärke ab“ 200 %/s; Hub max 100 %. Bereits gespeicherte Werte bleiben –
  bei dir z. B. Hub max 90: einfach auf 100 ziehen.
- **Probe:** Nach einer Änderung an der Übersetzung vibriert der Satisfyer 2 s im Beispiel-Rhythmus.

## Docker & Vorstellung
- `docker-compose.yml` deutlich kürzer und gruppiert (Werte weiter in der `.env`).
- Vorstellung: „Echte Geräte verbinden“ im Mini-Player entfernt – sie zeigt, sie testet nicht.

## Zum Unterschied „Automatisch“ und „Original + Takt-Schutz“ (Handy)
- **Original + Takt-Schutz:** das Script genau wie die Datei – nur Stöße, die der Motor nicht schafft, werden angepasst.
- **Automatisch:** zusätzlich wird ein flacher Hub (< 70 %) auf den vollen Bereich gestreckt; damit werden schwache
  Scripts kräftiger. Feine Vibrationen bleiben bei beiden erhalten.

## Test-Checkliste
1. Selbst steuern → Position → ⏺ Mitschnitt → speichern → läuft das Positions-Script mit?
2. Finger „Position“: flüssiger als vorher?
3. Option „Vollbild nur mit dem Video“ an → Vollbild → App verlassen → kleines Fenster mit Bild?
4. Videowechsel: kein altes Standbild mehr?
5. ⚙️ → System → 🧪 Selbsttest → alle ✅.

## Noch nicht drin (ab 1.20)
- Einstellungen komplett neu geordnet und neues Design (Mischung A Kino + C Neon) – vorher Mockup.
