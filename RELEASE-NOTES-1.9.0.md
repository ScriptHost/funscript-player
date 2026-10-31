# Handy Player 1.9.0 – Aufgeräumt, und alles läuft weiter

## Einstellungen neu geordnet
**Was:** Die Einstellungen haben oben eine Leiste zum Springen: Geräte · Sicherheit · Bild · Script & Finale ·
Fernbedienung · Anzeige · Bibliothek · System. Aus der Geräte-Spalte im Sync-Modus sind dorthin gewandert:
Connection Key, automatisch verbinden/nachkorrigieren, Script umkehren, Handy per Bluetooth,
„Alle Bluetooth-Geräte anzeigen“, Übersetzung Script → Vibration, Intiface und der ganze Reiter Sicherheit.
In der Spalte bleibt, was man beim Schauen anfasst: Verbinden, Neu synchronisieren, Offset, Hub,
Satisfyer verbinden, Stärke, Pause, Finale, Alles stoppen.

**Warum:** Den Key trägt man einmal ein, die Sicherheits-Grenzen stellt man einmal ein – das musste
nicht dauerhaft neben dem Video stehen. Der Key verbindet jetzt direkt beim Eintragen; fehlt er, führt
„Verbinden“ in die Einstellungen.

## Video läuft weiter in Bibliothek und Einstellungen
**Was:** Zurück zur Bibliothek oder in die Einstellungen hält das Video nicht mehr an – Handy und
Satisfyer laufen mit. Unten erscheint „Läuft gerade“ mit ▶/❚❚ und „Zum Video ↑“.
**Warum:** Nächste Szene suchen oder eine Einstellung ändern, ohne die laufende Session zu unterbrechen.

## Satisfyer
- **Gleichmäßigkeit** (⚙️ → Geräte → Satisfyer): glättet die Stärke über die Zeit (bis 1,5 s).
  0 = jeder Stoß einzeln spürbar. Ganz gleichmäßig: Berechnung „Nach Geschwindigkeit“ + 40–60 %.
  Zusätzlich gibt es weiterhin die Script-Werkzeuge („Zu schnelle Stellen glätten“), die das Script
  selbst für Handy und Satisfyer beruhigen.
- **Neu verbinden statt neu koppeln:** Android trennt Bluetooth bei Bildschirmsperre oder App-Wechsel.
  Bisher hat der Player sofort im Hintergrund 3× neu verbunden – das scheitert dort, danach war das Gerät
  weg. Jetzt wartet er, bis der Player wieder sichtbar ist, und versucht es dann bis zu 5×.

## Kleinere Dinge
- Neues Video: Das alte Bild blitzt nicht mehr kurz auf (Video wird geleert und bis zum ersten neuen Bild
  ausgeblendet). Der Player öffnet oben beim Video statt an der Scroll-Stelle der Bibliothek.
- Jeder Modus merkt sich seinen Stash-Filter: Streamen startet mit „2D“, Sync mit „2D Script“
  (wenn die Filter in Stash so heißen). Wählst du in einem Modus einen anderen, gilt der ab dann dort.
- Kopfzeile kompakt (⚙️ → Anzeige): Handy-Status links, Satisfyer-Status rechts neben der Kamera,
  Titel ausgeblendet. Browser verraten nur die Höhe des Kamerabereichs, nicht wo die Kamera sitzt –
  deshalb ist es eine Option für Smartphones mit Kamera oben mittig.
- Feature-Übersicht als Webseite in `docs/index.html` (für GitHub Pages: Quelle „/docs“).

## Getestet
Im Browser mit Ordner-Video: Weiterlaufen in Bibliothek/Einstellungen inkl. „Läuft gerade“ und Rücksprung,
Bereichs-Leiste, Geräte-Spalte ohne Sicherheit, Lade-Ausblendung, Filter je Modus (mit nachgebauter
Filterliste), kompakte Kopfzeile in Smartphone-Breite, keine Fehler in der Konsole.
**Nicht getestet:** Satisfyer-Neuverbindung nach echter Bildschirmsperre, Gleichmäßigkeit am echten Gerät,
Filter mit echtem Stash.
