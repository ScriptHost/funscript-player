# Handy Player 1.5.0 – Handy per Bluetooth als Offline-Weg

## Was
Fällt das Internet aus, lässt sich die Handy jetzt **per Bluetooth über Intiface Central** steuern –
komplett ohne Handy-Cloud. Die normale WLAN-Verbindung bleibt der Standard.

So geht's:
1. Handy in den **Bluetooth-Modus** schalten.
2. **Intiface Central** (Smartphone oder PC) starten, Server starten, Handy dort verbinden.
3. Im Player: Reiter **Vibrator → „Intiface Central (auch: Handy per Bluetooth)“** → IP eintragen, verbinden.
4. Die Handy erscheint als **„The Handy – Intiface ↕ Bewegung“**, oben steht „Handy: Bluetooth (Intiface)“.

Was funktioniert: Video-Sync, Patterns, Script-Baukasten, Direktsteuerung, Finale (beide Varianten),
Hub-Begrenzung, Script umkehren, Video-Offset, Script-Werkzeuge, Not-Aus.
Einstellbar in der Handy-Karte → „Ohne Internet: Handy per Bluetooth“: **Bluetooth-Vorlauf**
(Standard 80 ms), um die Funkverzögerung auszugleichen.

## Warum über Intiface und nicht direkt
- Intiface unterstützt die Handy per Bluetooth offiziell (Gerätedatenbank von Buttplug.io:
  „The Handy“, Positionssteuerung). Das Handy-eigene Bluetooth-Protokoll ist nicht öffentlich
  dokumentiert – es selbst nachzubauen wäre fehleranfällig.
- Intiface läuft komplett lokal, Verbindung über dein LAN (bzw. bei HTTPS über die
  Weiterleitung des Servers, nur private Adressen).

## Wie es technisch arbeitet – und warum WLAN trotzdem Standard bleibt
- **WLAN (Cloud, HSSP):** Die Handy bekommt das ganze Script vorab und spielt es nach einer
  abgeglichenen Uhr ab → sehr genau.
- **Bluetooth (Intiface):** Der Player schickt bei jedem Script-Punkt „fahre in x ms auf Position y“
  (bei Spulen sofort neu, bei Pause Stopp). Das ist robust, hängt aber stärker von der Funkverzögerung
  ab – dafür gibt es den Bluetooth-Vorlauf. Direktsteuerung und Finale „Komplett lösen“ werden als
  gleichmäßiges Hin und Her gesendet (0,3–3 Stöße/s je nach Geschwindigkeit).

Deshalb: WLAN für den Alltag, Bluetooth als Rückfallebene ohne Internet.

## Getestet
Mit nachgebautem Intiface (meldet „The Handy“ mit Positionssteuerung) im Browser:
Erkennung als Bewegungsgerät, Status-Anzeige, Script-Folgen im 500-ms-Takt mit Hub 20–80 % → Positionen
0,2/0,8, sofortiger Neustart nach Spulen, Stopp bei Pause, Direktsteuerung (50 % → ~300 ms je
Halbbewegung), Not-Aus.
**Nicht getestet:** echte Handy per Bluetooth mit echtem Intiface – die tatsächliche Verzögerung
musst du ggf. mit dem Bluetooth-Vorlauf feinjustieren.
