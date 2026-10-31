# Änderungen

## 1.8.0 – 31.10.2026

Ausführlich mit Begründungen: [RELEASE-NOTES-1.8.0.md](RELEASE-NOTES-1.8.0.md)

- Neu: **Fernbedienung** – Video am TV/PC, Bedienung und Satisfyer am Smartphone.
  In der Bibliothek „📺 Abspielen auf“ den Bildschirm wählen; Abgleich über den Server
- Satisfyer (und Handy, falls dort verbunden) folgen am Smartphone dem Script im Takt des Bildschirms
- ⚙️ → Fernbedienung: Gerät als Bildschirm anbieten, Gerätename

## 1.7.0 – 31.10.2026

- Neu: **★ / 💦 / 📍 direkt in der Player-Leiste**, auch im Vollbild (nur bei Stash-Szenen).
  ★ öffnet ein kleines Feld mit Sternen, Favorit ♥ und „O −1“; 💦 zählt +1, 📍 setzt einen Marker.
  Abschaltbar unter ⚙️ → Anzeige im Player
  (Warum: im Vollbild kam man bisher nicht an Bewertung, O-Zähler und Marker heran)
- Player-Leiste bricht bei wenig Platz in eine zweite Zeile um, statt Knöpfe zusammenzuquetschen
- Roter STOPP-Knopf über dem Video abschaltbar (Geräte → Sicherheit); Esc, „Alles stoppen“ und
  Stopp bei Bildschirmsperre bleiben (Warum: Wunsch – der Knopf kann im Bild stören)
- „Vibrator“ heißt in der Oberfläche jetzt „Satisfyer“ (Statusanzeige oben und Reiter)

## 1.6.0 – 01.11.2026

- Bluetooth-Suche findet den Satisfyer ohne „Alle Geräte anzeigen“: Namen „Power Masturbator“,
  „SF…“, „Satisfyer…“; einmal über „Alle Geräte“ gewählte Namen merkt sich der Player
  (Warum: der Power Masturbator meldet sich nicht als „SF …“, wie es die Buttplug-Liste vermuten ließ)
- Neu in ⚙️ Einstellungen → **Anzeige im Player**: Datum/Länge, Bewertung/Favorit/O, Studio/Darsteller,
  Tags, Marker-Liste, Beschreibung und Bild-Zeile einzeln ein-/ausblenden.
  Standard: Tags, Studio/Darsteller und Beschreibung aus (Warum: beim normalen Schauen nicht nötig)

## 1.5.1 – 01.11.2026

- Streamen: „⚡ nur mit Funscript“ ausgeblendet, es werden immer alle Videos gezeigt
  (Warum: beim reinen Schauen spielt das Script keine Rolle; im Sync-Modus bleibt der Filter)
- Separate Heatmap unter dem Video entfernt – die Player-Leiste zeigt Heatmap, Marker und Vorschau
  bereits (Warum: war doppelt)

## 1.5.0 – 01.11.2026

Ausführlich mit Begründungen: [RELEASE-NOTES-1.5.0.md](RELEASE-NOTES-1.5.0.md)

- Handy per Bluetooth über Intiface als Offline-Weg (Bewegungsgeräte mit Positionssteuerung)
- Funktioniert mit Video-Sync, Patterns, Direktsteuerung, Finale, Hub, Offset, Not-Aus
- Bluetooth-Vorlauf einstellbar

## 1.4.0 – 01.11.2026

Ausführlich mit Begründungen: [RELEASE-NOTES-1.4.0.md](RELEASE-NOTES-1.4.0.md)

- Zurückschreiben in Stash: Sterne, Favorit (Tag), O-Zähler, Marker setzen (Taste P)
- HereSphere: Bewertung und Favorit werden nach Stash geschrieben
- Script-Werkzeuge (standardmäßig aus): Hub strecken, Spitzen glätten
- Offset per Takt einmessen (Taste T)

## 1.3.2 – 01.11.2026

- „Weiterschauen“-Reihe ist jetzt ein Schalter in ⚙️ Einstellungen → Bibliothek, **standardmäßig aus**
  (Warum: nicht jeder möchte sie oben in der Bibliothek sehen)

## 1.3.1 – 01.11.2026

- Link rechts in der Bibliothek je nach Modus: **Streamen** → „Pornhub ↗“, **Sync** → „FapTap ↗“
  (Warum: beim reinen Schauen braucht man keine Script-Seite, beim Sync schon)

## 1.3.0 – 01.11.2026

Ausführlich mit Begründungen: [RELEASE-NOTES-1.3.0.md](RELEASE-NOTES-1.3.0.md)

- 🔥 Finale mit zwei Varianten: „Komplett lösen“ oder „Script weiter, sanfter“
- „Sanfter“: kleinerer Hub, Vibration als einstellbarer Anteil, optional halbes Tempo (bleibt im Takt)
- Mit echter Handy getestet (Sync funktioniert)

## 1.2.0 – 01.11.2026

Ausführlich mit Begründungen: [RELEASE-NOTES-1.2.0.md](RELEASE-NOTES-1.2.0.md)

- Sync-Auto-Korrektur (30 s Position, 5 min Uhrabgleich, nach App-Wechsel) + ⟳-Knopf (Taste S)
- Vorschaubilder beim Spulen aus Stash-Sprites
- Bildqualität: ein Schalter „Automatisch – bestes Bild“, Einzelregler unter „Erweitert“
- Handy verbindet beim Start automatisch; gekoppelte Satisfyer werden wieder verbunden
- Lesbare Titel aus Dateinamen, wenn kein Stash-Titel gepflegt ist
- HQ schaltet bei Ruckeln automatisch eine Stufe zurück
- 🔥 Finale-Knopf (Taste O): Script entkoppelt, langsam/flach, einstellbar
- Offset pro Szene, „Weiterschauen“-Reihe

## 1.1.0 – 31.10.2026

- **Ordner direkt einbinden**: jeder Ordner unter `/media/<Name>` ist eine eigene Quelle (Bibliothek + HereSphere),
  neueste zuerst, „Neu“-Markierung für Dateien der letzten 7 Tage
- **HereSphere** (VR): API unter `/heresphere` mit Kategorien (Alle mit Script, gespeicherte Stash-Filter,
  Ordner), Vorschaubildern/-videos, Tags, Markern, Funscripts; VR-Format aus Dateinamen/Tags
- **Vibrator „Rhythmus“** (neuer Standard): pulsiert mit jedem Stoß, Tempo bestimmt die Stärke;
  schnellere Aktualisierung (60 ms), keine Glättung im Rhythmus-Modus
- **HQ „Auto“** (neuer Standard): verbessert nur, wenn das Video kleiner als der Bildschirm ist;
  4K und VR werden nie heruntergerechnet; Zielauflösung passend zum Gerät
- **⚙️ Einstellungen**: Bild & Qualität, VR/HereSphere-Adresse, Bibliothek (Startquelle, eingebundene
  Ordner, Vorschauvideos), System-Infos, Zurücksetzen

## 1.0.0 – 31.10.2026 (Zwischenstand)

Erste festgehaltene Version.

- **Modi**: Streamen, Sync (Video + Geräte), Steuern (Direkt, Patterns, Script-Baukasten)
- **The Handy** per WLAN (API v2, Connection Key): Video-Sync, Direktsteuerung (HAMP), Patterns/Scripts (HSSP),
  Offset, Hub-Begrenzung, Script umkehren
- **Vibrator** (Satisfyer u. a.) per Web Bluetooth oder Intiface Central; Script → Vibration nach
  Geschwindigkeit oder Position, Bluetooth-Diagnose, automatisches Neuverbinden
- **Bibliothek**: Stash (Kacheln, Vorschauvideos, Tags/Darsteller/Studios, Filter-Chips, gespeicherte
  Stash-Filter, Zufall) und lokaler Ordner; Weiterschauen, Marker, Play-Count an Stash
- **Player**: eigene Bedienleiste mit Heatmap und Markern, Vollbild fürs Smartphone (Füllen/Einpassen),
  Tastenkürzel, App-Installation (PWA), Bildschirm bleibt an
- **Bildverbesserung** im Browser (bikubisch + AMD CAS, Farbe, Anti-Banding, Vorher/Nachher)
- **HQ-Stream** vom Server über Intel Quick Sync (VAAPI) bzw. CPU, mit Leistungstest
- **Sicherheit**: Not-Aus (Knopf, Esc, Bildschirmsperre), Geschwindigkeits- und Vibrationsgrenzen
- **Betrieb**: Docker (Traefik-Labels, /dev/dri) und Windows (Skripte, Autostart, HTTPS)
