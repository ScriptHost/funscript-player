# Änderungen

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
