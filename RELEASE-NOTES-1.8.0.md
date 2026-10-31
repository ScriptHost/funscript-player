# Handy Player 1.8.0 – Fernbedienung

## Was
Das Video läuft am **Bildschirm** (TV, PC, Tablet), bedient wird am **Smartphone** – dort hängt auch
der Satisfyer per Bluetooth.

So geht's:
1. Player auf beiden Geräten öffnen.
2. Am Smartphone in der Bibliothek oben **„📺 Abspielen auf“** den Bildschirm wählen
   (Name einstellbar unter ⚙️ → Fernbedienung).
3. Szene antippen – sie öffnet sich am Bildschirm. Das Smartphone zeigt die gewohnte Player-Leiste:
   Play/Pause, ±10 s, Zeitleiste mit Heatmap und Vorschaubildern, ★/💦/📍, ⛶ (Vollbild am Bildschirm), STOPP.
4. „Trennen“ oder „Abspielen auf: Diesem Gerät“ beendet die Fernbedienung.

## Wie der Abgleich funktioniert – und warum so
- Jede Player-Seite hält eine **Server-Sent-Events**-Verbindung zum Server. Das läuft ohne Zusatzpakete
  und problemlos durch Traefik (kein WebSocket-Upgrade nötig).
- Der Bildschirm meldet bei jeder Änderung und alle 3 s: Szene, Position, läuft/pausiert.
  Die Position ist mit der **Serveruhr** gestempelt; beide Geräte gleichen ihre Uhr jede Minute mit dem
  Server ab. Die Fernbedienung rechnet von dort aus weiter – im Test lagen beide Seiten auf die
  Millisekunde gleich.
- Der Satisfyer am Smartphone folgt so dem Script im Takt des Bildschirms (inkl. Vorlauf, Finale,
  Script-Werkzeugen).
- **The Handy:** Ist sie am Bildschirm verbunden, steuert der Bildschirm sie (er kennt die Videoposition
  exakt). Nur wenn sie dort nicht verbunden ist, übernimmt das Smartphone.
- Bewertung, Favorit, O und Marker schreibt das Smartphone direkt nach Stash; der Bildschirm lädt sie neu.

## Sicherheit
- Meldet sich der Bildschirm 8 s nicht (WLAN weg, Seite zu), stoppen die Geräte am Smartphone.
- STOPP am Smartphone hält auch das Video und die Geräte am Bildschirm an.
- Ist „Alles stoppen bei Bildschirmsperre“ an, hält das Sperren des Smartphones auch den Bildschirm an.

## Hinweise
- Browser spielen Video mit Ton erst nach einer Berührung ab. Startet der Bildschirm nicht, zeigt die
  Fernbedienung „bitte am Bildschirm einmal tippen/klicken“.
- Der Server merkt sich nur den aktuellen Zustand im Speicher, nichts wird gespeichert.

## Getestet
Mit zwei Browser-Tabs (Bildschirm + Fernbedienung) und Ordner-Video mit Funscript: Bildschirm erscheint
in der Auswahl, Szene öffnen, Play, Spulen, Positionsabgleich (Abweichung < 1 ms), Script-Quelle für den
Satisfyer. **Nicht getestet:** echte zwei Geräte über Traefik, Stash-Szenen über die Fernbedienung,
STOPP und Verbindungsabbruch in der Praxis.
