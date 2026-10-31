# Funscript Player 1.15.0 – Handy-API v3, Einstellungen für alle Geräte, Intensität auf einen Blick

## Handy-API v3 (mit Application ID)
**Was:** Unter ⚙️ → Geräte gibt es das Feld **Application ID**. Mit ID nutzt der Player die neue Handy-API v3,
ohne ID wie bisher v2.
**Warum:** v3 kann die Wiedergabegeschwindigkeit mitgeben – die Handy bleibt jetzt auch bei 0,5× … 2× im Takt
(v2 musste dann anhalten). v2 gilt laut Handy als veraltet.
**Wie:** Anmeldung mit `X-Api-Key` (Application ID) + `X-Connection-Key`; `/hssp/play` mit `playback_rate`;
Hub als 0–1, HAMP-Tempo als 0–1; Scripts über den Hosting-Dienst v2. Die Application ID ist kein Geheimnis –
den geheimen *Application Key* braucht der Player nicht.

## Einstellungen für alle Geräte gleich
**Was:** Connection Key, Application ID, Offsets (auch pro Szene), Hub, Umkehren, Satisfyer-Übersetzung,
Sicherheitsgrenzen, Script-Presets, Finale, Anzeige im Player, Stash-Filter, „Selbst steuern“ und die
Touch-Optionen liegen auf dem Server (`data/prefs.json`) und gelten auf jedem Gerät.
**Pro Gerät bleiben:** Bild & HQ, Kopfzeile, Bildschirmsperre, Ton, Fernbedienungs-Name, Bluetooth-Geräte.
**Umstieg:** Das erste Gerät, das 1.15 öffnet, schickt seine bisherigen Einstellungen auf den Server; danach
übernehmen alle anderen diese.

## Intensität auf einen Blick
Jede Kachel mit Funscript zeigt unten eine schmale Heatmap-Leiste (blau = ruhig … rot = schnell); darüber
steht „ruhig / mittel / intensiv“ mit dem mittleren Tempo. Der Server fasst jedes Script in 48 Abschnitte
zusammen und merkt sich das; die Bibliothek lädt nur, was ins Bild scrollt.

## Pixel automatisch kompakt
Auf Pixel-Smartphones (Kamera oben mittig) ist „Kompakt neben der Kamera“ standardmäßig an.

## 🧪 Beta: Touch-Steuerung
**Was:** Schalter unter ⚙️ → Geräte (Standard aus). Dann gibt es eine Finger-Fläche unter 🎮 Steuern und bei
„Selbst steuern“ am Video – wie in der Satisfyer-App: Finger oben = stark/schnell, unten = schwach/langsam,
Loslassen = aus (wahlweise „beim Loslassen halten“). Pro Fläche wählbar: ↕ Handy und/oder 〰 Satisfyer.
Grenzen aus ⚙️ → Sicherheit gelten, STOPP setzt die Fläche zurück.
**Warum Beta:** Gefühl und Reaktionszeit lassen sich nur am echten Gerät beurteilen.

## Getestet
Im Browser: gemeinsame Einstellungen (Server bekommt geteilte Werte, Bild bleibt lokal); Handy v3/v2 mit
mitgeschriebenen Anfragen (richtige Pfade, Header, `playback_rate`, Hub/Tempo 0–1, Upload); Heatmap-Leiste auf
Kacheln; Touch-Fläche unter Steuern und bei Selbst steuern (Start, Tempo folgt dem Finger, Loslassen, Halten,
Sicherheitsgrenze, STOPP), Smartphone-Breite.
**Nicht getestet:** echte Handy mit v3 und deiner Application ID, Touch am echten Smartphone, Pixel-Erkennung
am Gerät, Heatmap mit echtem Stash.
