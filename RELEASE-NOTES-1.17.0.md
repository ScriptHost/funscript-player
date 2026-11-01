# Funscript Player 1.17.0 – Ruhiger beim Schauen, Handy folgt dem Finger, sicherer

## Beim Schauen
- **Mini-Player schließen (✕):** Video anhalten, Geräte stoppen, Mini-Player weg. **Warum:** Bisher ging das nur mit
  ❚❚ – das Video blieb geladen.
- **App verlassen = kleines Fenster:** Läuft das Video und du wechselst die App, geht es als Bild-in-Bild weiter
  (⚙️ → Anzeige, abschaltbar). „Alles stoppen bei App-Wechsel“ hält dann nicht an – du schaust ja noch.
  **Hinweis:** Ob der Browser das Fenster von selbst öffnet, entscheidet er; Chrome tut es über die Media Session.
- **Schwarzes Bild nach Vollbild behoben:** Die Bildverbesserung prüft alle 2 s, ob sie ein schwarzes Bild liefert,
  obwohl das Video hell ist – dann baut sie sich neu auf, notfalls läuft das Video ohne Verbesserung weiter.
  Dabei gefunden: Die automatische Schärfe passte sich nie an die Vergrößerung an (Namensgleichheit im Code) – behoben.
- **„Geräte pausieren“ hängt nicht mehr am nächsten Video:** Ein neues Video setzt die Pause zurück.
- **Spul-Vorschau:** Zeigt erst ein Bild, wenn es geladen ist – sonst nur die Zeit statt eines schwarzen Kästchens.
- **Player-Leiste anpassbar** (⚙️ → Anzeige): jeden Knopf ein-/ausblenden, Reihenfolge mit ↑ ↓. Knöpfe, die gerade
  nichts tun können, verschwinden selbst (⟳ ohne Handy, Vib ❚❚ und 🔥 ohne Gerät).
- Doppeltippen links/rechts im Video = −10/+10 s gab es schon – damit lassen sich die Knöpfe −10/+10 ausblenden.

## Geräte
- **Video ohne Funscript + „Keine Steuerung“:** Geräte-Regler und Geräte-Knöpfe sind dann ausgeblendet.
- **„Selbst steuern“ zeigt nur verbundene Geräte** (ohne Gerät ein Hinweis zum Verbinden).
- **Feineinstellung:** Offset einmessen, Neu synchronisieren und Hub stehen eingeklappt unter „Feineinstellung“
  (der Hub steht im Titel). Der Kasten ist etwa halb so hoch.
- **Offset-Standard 0:** Die Verzögerung der Geräte gleicht der Player selbst aus (Uhrabgleich der Handy, gemessene
  Bluetooth-Laufzeit beim Satisfyer). Ein allgemeiner Offset wurde einmal auf 0 gesetzt; pro Szene gemerkte bleiben.
  Bluetooth-Kopfhörer rechnet der Player nicht ein – Browser melden deren Verzögerung nicht verlässlich.
- **Verbinden-Knopf zeigt den Zustand:** „✓ Verbunden – neu verbinden“ (grau) statt immer „Verbinden“.
- **Klare Fehlermeldungen:** oben „Cloud nicht erreichbar“, „Handy offline“, „Key / App-ID falsch“ statt „Fehler“.
- **Satisfyer verbindet sich wieder:** Nach einem Abriss versucht der Player es 10 Minuten lang im Hintergrund weiter.
- **Schneller Start:** Einmal zur Handy hochgeladene Scripts merkt sich der Server – das Video startet beim nächsten
  Mal ohne „Script wird übertragen …“, auch auf anderen Geräten. Ist eine gemerkte Adresse abgelaufen, lädt er neu.
- **Handy-Modell und Höchsttempo** (⚙️ → Geräte): Das Modell wird beim Verbinden erkannt und angezeigt. Ab welchem
  Tempo eine Stelle „zu schnell“ ist, folgt dem Modell oder einem eigenen Wert. Für Handy 2 / 2 Pro gibt es noch
  keine gemessenen Werte – bis dahin gilt derselbe Wert wie bei Handy 1.
- **Zu schnelle Stellen** (⚙️ → Script): „Hub kürzen“ (wie bisher) oder **„voller Hub, halbes Tempo“** – dort fällt
  jeder zweite Stoß weg, die Handy fährt ganz 0→100 und bleibt im Takt. Die Zählung stimmt jetzt: Jeder Stoß zählt
  einmal und nur, wenn er spürbar (≥ 3 %) kürzer wird (vorher wurden Punkte doppelt und winzige Änderungen gezählt).
- **🧪 Touch-Fläche: Tempo | Position.** Bei „Position“ folgt die Handy direkt deinem Finger (WLAN: Direkt-Position,
  Bluetooth: Positionsbefehle), Hub min/max gilt. Auch ⏺ Aufnahmen folgen dem Umschalter – die Einstellung
  „Touch-Aufnahme als Position“ ist darin aufgegangen. Bleibt Beta, bis es am echten Gerät getestet ist.

## Bibliothek
- **Reiter Tags / Darsteller / Studios** einzeln ausblendbar (⚙️ → Bibliothek), **Studios standardmäßig aus**.
- **Gespeicherte Stash-Filter** einzeln ausblendbar, z. B. „VR“ (⚙️ → Bibliothek).
- „0 Studios“ geprüft: Die Liste zeigt alle Studios mit Szenen aus Stash, unabhängig vom gewählten Filter – 0 heißt,
  in Stash ist bei keiner Szene ein Studio eingetragen (oder das Suchfeld filtert).

## HereSphere
- **Optionales Passwort** (⚙️ → VR-Brille): HereSphere fragt einmal nach Benutzer und Passwort (Benutzer egal).
  Ohne Passwort wie bisher frei erreichbar. Gespeichert wird nur ein Hash.
- **„Nur VR-Videos“ als Einstellung** (Standard an). Gilt auch für einzelne Szenen über ihre Nummer – vorher ließ sich
  jede Stash-Szene abrufen und bewerten, wenn man die Nummer kannte.
- **Schneller auf der Brille:** Für die Listenansicht untersucht der Server Ordner-Videos nicht mehr mit ffprobe,
  merkt sich Ergebnisse und die Gesamtliste (60 s).

## Sicherheit & Docker
- **Herkunftsprüfung:** Änderungen nimmt der Server nur von der eigenen Seite an – eine fremde Webseite im selben
  Browser kann nichts mehr auslösen (wichtig ohne Anmeldung im Reverse Proxy). Gilt auch für die Intiface-Weiterleitung.
- **Schutz-Header:** nicht in fremde Seiten einbettbar, keine Typ-Raterei, Adresse nicht an fremde Seiten.
- **Intiface nur Heimnetz** (optional, ⚙️ → Geräte oder fest mit `INTIFACE_LAN_ONLY=1`): dann nur 192.168.x / 10.x,
  keine Docker-Netze und nichts im Container.
- **Eigene Scripts** landen nur noch neben echten Videos.
- **Eigener Benutzer optional:** `user: "1234:1234"` in der docker-compose.yml. Standard bleibt `node` (1000), nie root.
  Ein schon vorhandener Datenordner muss einmal auf die neue ID umgestellt werden (Befehl steht in der docker-compose.yml).

## Getestet
21 automatische Tests grün (neu: Herkunft, Schutz-Header, HereSphere-Passwort und „nur VR“, Script-Merkliste,
halbes Tempo, Zählung, Modell). Im Browser simuliert: Geräte-Ausblendung, Touch-Position (Befehle an die Handy),
Script-Merkliste, Mini-Player ✕, Leiste anpassen.
**Nicht getestet:** Direkt-Position und Modell-Erkennung an der echten Handy, Bild-in-Bild beim App-Wechsel auf dem
Pixel, Schwarzbild-Schutz auf Android, HereSphere-Anmeldung in der echten Brille.
