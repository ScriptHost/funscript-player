# Funscript Player

Selbst gehosteter Web-Player, der Videos abspielt und **The Handy** synchron per Funscript steuert.

- Bibliothek: Videos + gleichnamige `.funscript` aus einem Server-Ordner (Unterordner werden durchsucht)
- Drag & Drop: lokale Video- und Funscript-Dateien direkt in den Browser ziehen (das Video wird **nicht** hochgeladen)
- Handy-Steuerung per Connection Key (WLAN, HSSP), Offset, Hubbegrenzung, Script umkehren
- Heatmap des Scripts unter dem Video (anklicken zum Springen)
- Reiter **Steuerung & Patterns**:
  - Direktsteuerung: Start/Stopp und Geschwindigkeit (Handy-Modus HAMP), Tastatur: Leertaste, ↑/↓
  - Pattern-Editor: Bewegungszyklen per Maus zeichnen, Vorlagen, Tempo, Endlosschleife, Export als .funscript
  - Script-Baukasten: Patterns mit Dauer und Tempo aneinanderreihen, abspielen oder als .funscript exportieren
  - Patterns und Scripts werden auf dem Server gespeichert (`data/store.json`) und sind auf allen Geräten gleich
- **Vibrator (Satisfyer u. a.)**: manuell steuern oder automatisch aus Video-Script, Pattern oder
  Direktsteuerung übersetzen (nach Geschwindigkeit oder Position, Min/Max, Vorlauf)
- Keine externen Abhängigkeiten, ein kleiner Container

## Aufbau

Oben stehen nur der Status von Handy und Satisfyer und das Menü ☰:

- **Status antippen** (`Handy: verbunden`, am Smartphone `↕ verbunden`) öffnet das Geräte-Fenster: Verbinden,
  Neu synchronisieren, Offset, Hub, Satisfyer verbinden, Stärke, Pause, Finale, Alles stoppen.
- **🔄 Geräte folgen dem Video** (⚙️ → Geräte ganz oben und im Menü): an = Sync, aus = nur schauen (Streamen).
- **Videos ohne Funscript:** unter dem Video „Selbst steuern“ – Handy-Geschwindigkeit und Satisfyer-Stärke
  von Hand, solange das Video läuft. Pause hält an, STOPP wie immer.
- Der Satisfyer braucht **kein eigenes Vibrations-Script** – er nutzt dasselbe Funscript wie die Handy.
- **☰ Menü**: Bibliothek, 🎮 Steuern (Direkt, Patterns, Script-Baukasten), ⚙️ Einstellungen.
- **Im Player** stehen die Regler fürs Schauen fest am Video (am Smartphone darunter, am PC rechts daneben);
  abschaltbar unter ⚙️ → Anzeige. Der Titel „Funscript Player“ führt zur Bibliothek bzw. zurück zum laufenden Video.

Die **Bibliothek** zeigt Stash-Szenen als Kacheln (Vorschauvideo beim Drüberfahren, endloses Scrollen).
Über *Tags*, *Darsteller*, *Studios* stöbern; ein Klick setzt einen Filter-Chip, mehrere Filter lassen sich
kombinieren. Im Player sind Studio, Darsteller und Tags anklickbar, Marker springen an die Stelle.
Die Zurück-Geste am Smartphone führt vom Player zur Bibliothek.

## Ordner einbinden

Jeder Ordner unter `/media/<Name>` wird eine eigene Quelle in der Bibliothek und in HereSphere –
in der `docker-compose.yml` einfach weitere Zeilen unter `volumes` ergänzen, z. B.
`- /srv/downloads:/media/Downloads:ro`. Video und Script brauchen denselben Namen (`Name.mp4` + `Name.funscript`).

## VR-Brille (HereSphere)

In HereSphere im Browser `https://player.<domain>/heresphere` öffnen. Es erscheinen **nur VR-Videos**: Stash-Szenen mit
mindestens einem VR-Tag (z. B. „VR“, „180°“, „360°“), Ordner-Videos mit VR-Kennung im Dateinamen. Kategorien: *Alle mit Script*,
deine gespeicherten Stash-Filter und die eingebundenen Ordner – mit Vorschau, Tags, Markern und Funscript.
Die Handy steuert HereSphere selbst (Connection Key in HereSphere eintragen). Das VR-Format wird an
Dateinamen (`_180`, `_LR`, `_TB`, `_360`, `MKX200`, `fisheye` …) und VR-Tags erkannt.
Eine Anmeldung im Reverse Proxy muss für `/heresphere` ausgenommen sein.
Wer HereSphere nicht nutzt, schaltet es unter ⚙️ → VR-Brille ab (oder fest mit `HERESPHERE=off` in der
`docker-compose.yml`) – dann antwortet der Server dort nicht mehr und die Ausnahme kann weg.

## Bildverbesserung

„✨ Bildverbesserung“ unter dem Video bzw. ✨ in der Bedienleiste (schaltet Aus → Natürlich → Schärfer → Maximal).
Läuft per WebGL auf der Grafik des Abspielgeräts, der Server merkt davon nichts:

- Skalieren auf Bildschirmgröße: Catmull-Rom (bikubisch) beim Vergrößern, Mittelung beim Verkleinern
- Schärfen mit AMD FidelityFX CAS (schärft weiche Stellen, ohne Säume)
- Kontrast, Sättigung, Helligkeit, Anti-Banding (Dithering gegen Farbtreppen)
- „Eigene“ Werte und Vorher/Nachher-Vergleich (geteiltes Bild)

Kein KI-Upscaling: es entstehen keine neuen Details, vorhandene werden besser sichtbar.

### HQ-Stream vom Server (Intel Quick Sync)

Im selben Bedienfeld: **Aus / Sauber / Stark** und Zielauflösung (720p/1080p/1440p). Der Server wandelt
das Video live mit ffmpeg um: `denoise_vaapi` → `scale_vaapi` (hq) → `sharpness_vaapi` → `h264_vaapi` –
alles auf der Video-Hardware der Intel-Grafik, wie Jellyfin. Ohne `/dev/dri` oder bei Fehlern automatisch
per CPU (hqdn3d → Lanczos → unsharp → x264). Die Browser-Verbesserung kommt danach noch obendrauf.

- Spulen startet die Umwandlung an der neuen Stelle neu (≈ 1 s); Handy/Vibrator bleiben synchron.
- „Leistung testen“ wandelt 20 s um und zeigt die Geschwindigkeit (ab ~1,5× Echtzeit flüssig).
- Docker: `devices: /dev/dri` und `group_add` mit der GID der Gruppe `render` (`getent group render`).
  Prüfen im Container: `docker exec Handy-Player vainfo`.
- `HQ_ACCEL=vaapi|cpu` erzwingt einen Weg, `HQ_MAX` begrenzt gleichzeitige Umwandlungen.

## Docker mit Traefik

Die `docker-compose.yml` ist für ein Traefik-Setup
vorbereitet (Labels und Netze selbst ergänzen); erreichbar unter `https://player.${DOMAIN}`
(`DOMAIN` aus deiner `.env`). Anzupassen: Videoordner und ggf. `STASH_URL` (am besten der interne
Containername, z. B. `http://Stash:9999`).

## Smartphone: Vollbild, App, Sicherheit

- **Vollbild** (⛶ oben rechts im Video oder Doppelklick): füllt den ganzen Bildschirm, dreht auf Android ins
  Querformat. „Füllen“ zoomt randlos (schneidet etwas ab), „Einpassen“ zeigt das ganze Bild.
  Tippen = Bedienung ein/aus, doppelt tippen links/rechts = ±10 s, Zeitleiste mit Heatmap und Markern.
- **Als App installieren** (Chrome: Menü → „App installieren“, iPhone/Bluefy: „Zum Home-Bildschirm“):
  startet ohne Browserleisten – auf dem iPhone ist das der einzige Weg zu echtem Vollbild.
  Braucht HTTPS mit gültigem Zertifikat (Reverse Proxy).
- Der Bildschirm bleibt an, solange etwas läuft.
- **Not-Aus**: roter STOPP-Knopf (schwebend bzw. im Vollbild oben rechts), Esc-Taste oder „Alles stoppen“.
  Stoppt Video, Handy, Patterns und Vibratoren sofort. Optional automatisch bei Bildschirmsperre/App-Wechsel.
  Der rote STOPP-Knopf über dem Video lässt sich unter ⚙️ Einstellungen → Sicherheit ausblenden.
- Grenzen: max. Geschwindigkeit der Direktsteuerung (⚙️ Einstellungen → Sicherheit), „Maximum“ beim Vibrator gilt
  auch für die manuelle Stärke.

## Fernbedienung

Video am TV/PC, Bedienung und Satisfyer am Smartphone: Player auf beiden Geräten öffnen, am Smartphone in
der Bibliothek oben **„📺 Abspielen auf“** den Bildschirm wählen und eine Szene antippen. Das Smartphone zeigt
die Player-Leiste (Play, Spulen, Heatmap, ★/💦/📍, STOPP) und lässt den Satisfyer im Takt des Bildschirms
laufen. Die Handy steuert der Bildschirm, wenn sie dort verbunden ist. Details: `RELEASE-NOTES-1.8.0.md`.

## Stash

Mit `StashUrl` (Windows, `config.ps1`) bzw. `STASH_URL` (Docker) erscheint in der Bibliothek der Umschalter
**Ordner / Stash**. Der Player holt die Szenenliste per GraphQL und reicht Video, Funscript und Vorschaubild
über den eigenen Server durch – der Browser spricht nie direkt mit Stash, ein API-Key bleibt auf dem Server.

- Suche, Sortierung (Neueste, Datum, Titel, Zufall), „Nur mit Funscript“ = Stash-Filter *interaktiv*
- Filter nach Tag, Darsteller, Studio; „🎲 Zufällige Szene abspielen“ mit den aktuellen Filtern
- Stash-Marker als gelbe Striche in der Zeitleiste und als Sprungliste
- Bewerten (★), Favorit, O-Zähler (💦) und Marker setzen (📍) direkt in der Player-Leiste – auch im Vollbild
- Weiterschauen: startet an der in Stash gespeicherten Position; Position, Spieldauer und Play-Count
  werden an Stash zurückgemeldet
- Kann der Browser das Originalformat nicht (MKV, HEVC …), schaltet der Player automatisch auf Stashs
  Live-Umwandlung (`stream.mp4`) um
- Direktlink zu einer Szene: `https://<player>/?stash=<Szenen-ID>` – z. B. für einen eigenen Button in Stash
- API-Key nur nötig, wenn in Stash ein Login gesetzt ist (Stash → Einstellungen → Sicherheit → API-Key)

## Vibrator / Satisfyer

**Direkt per Bluetooth (empfohlen, wie bei XToys):** Player auf dem Gerät öffnen, das die
Bluetooth-Verbindung hält (z. B. Smartphone), dann „＋ Satisfyer verbinden“.

- Android / PC / Mac: Chrome oder Edge. iPhone: Safari kann kein Bluetooth – App „Bluefy“ nutzen.
- Web Bluetooth braucht eine **sichere Verbindung**: gültiges Zertifikat über deinen Reverse Proxy, oder die
  `windows\cert\handy-player.cer` auf dem Smartphone als vertrauenswürdig installieren.
- Satisfyer-Protokoll laut Buttplug.io: Init `0x01`, pro Motor 4 Bytes Stärke (0–100), alle 500 ms wiederholt.
  Für Geräte mit zwei Motoren in der Geräteliste „2 Motoren“ wählen.

**Alternativ über Intiface Central** (Android/iOS-App, unterstützt sehr viele Geräte): In Intiface unter
Einstellungen „Listen on all interfaces“ aktivieren, Server starten, im Player die IP des Smartphones
eintragen. Bei HTTPS leitet der Server die Verbindung über `/intiface` weiter (nur private IP-Adressen).
Dein Reverse Proxy muss dafür WebSockets durchreichen (nginx: `proxy_set_header Upgrade $http_upgrade;`
und `proxy_set_header Connection "upgrade";`).

## Installation (Debian + Docker)

```bash
scp -r handy-player debian-server:/opt/
ssh debian-server
cd /opt/handy-player
nano docker-compose.yml     # Medienpfad + AUTH_USER/AUTH_PASS anpassen
docker compose up -d --build
```

Ordnerstruktur der Bibliothek:

```
/srv/media/filme/
├── film1.mp4
├── film1.funscript
└── Serie/
    ├── teil2.mp4
    └── teil2.funscript
```

Der Container läuft als User `node` (UID 1000) und braucht Leserechte auf den Ordner.

## Installation (Windows, ohne Docker)

Alles Nötige liegt im Ordner `windows\`.

1. Ordner `handy-player` auf die VM kopieren, z. B. nach `C:\handy-player`.
2. `windows\config.ps1` anpassen: Medienordner, Port, Zugangsdaten, HTTPS ja/nein, Zertifikatsnamen.
3. PowerShell **als Administrator** öffnen:

   ```powershell
   cd C:\handy-player\windows
   powershell -ExecutionPolicy Bypass -File .\setup.ps1
   ```

   Das Skript installiert Node.js (winget), erzeugt bei Bedarf ein selbstsigniertes Zertifikat,
   öffnet den Port in der Firewall und startet den Player automatisch beim Systemstart
   (geplante Aufgabe „Handy Player“, Logs in `windows\logs\`).

Optionen von `setup.ps1`:

| Option | Wirkung |
|---|---|
| `-FirewallFrom 192.168.1.10` | Port nur für diese IP öffnen (z. B. deinen Reverse Proxy) |
| `-AtLogon` | Autostart bei Benutzeranmeldung statt als SYSTEM – nötig für verbundene Netzlaufwerke |
| `-NoAutostart` | Kein Autostart; manuell per Doppelklick auf `start.cmd` starten |

**HTTPS-Varianten**

- *Reverse Proxy terminiert TLS (empfohlen):* in `config.ps1` `Https = $false`, ggf. `BindHost = '127.0.0.1'`
  (Proxy auf derselben VM) oder Firewall per `-FirewallFrom` auf die Proxy-IP beschränken.
- *Direkt HTTPS im Player:* `Https = $true`. Entweder das selbstsignierte Zertifikat nutzen und die
  erzeugte `windows\cert\handy-player.cer` auf deinen Geräten als vertrauenswürdig importieren,
  oder ein Zertifikat deiner internen CA als `.pfx` unter `PfxFile` ablegen.

Autostart und Firewall-Regel entfernen: `windows\uninstall.ps1` (als Administrator).

**Medien auf einem NAS:** UNC-Pfad wie `\\nas\filme` in `MediaDir` eintragen. Läuft der Dienst als SYSTEM,
braucht das Computerkonto der VM Leserechte auf die Freigabe, sonst `-AtLogon` verwenden.

## Reverse Proxy

Den Proxy einfach auf `http://127.0.0.1:8080` zeigen lassen. Wichtig ist nur, dass Range-Requests
durchgereicht werden (Standard) und kein Puffern großer Antworten erzwungen wird.

**nginx**

```nginx
server {
    listen 443 ssl http2;
    server_name player.example.lan;
    # ssl_certificate …;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_buffering off;
        client_max_body_size 1m;
    }
}
```

**Caddy**

```
player.example.lan {
    reverse_proxy 127.0.0.1:8080
}
```

**Traefik / Nginx Proxy Manager:** einfach auf Port 8080 des Containers zeigen; den `ports`-Eintrag
dann ggf. durch das gemeinsame Docker-Netzwerk des Proxys ersetzen.

## Anmeldung

Mit `AUTH_USER`/`AUTH_PASS` schützt der Container sich selbst per HTTP Basic Auth.
Übernimmt dein Proxy bereits die Anmeldung (Authelia, Authentik …), beide Variablen leer lassen.
Ohne irgendeine Anmeldung bitte nicht ins Internet stellen.

## Bedienung

1. Seite öffnen, unter **⚙️ Einstellungen → Geräte** den Connection Key eingeben – der Player verbindet sofort
   (die Handy muss im WLAN-Modus und online sein).
2. Video aus der Bibliothek wählen oder Video + Funscript in den Player ziehen.
3. Abspielen. Pause, Spulen und Puffern werden automatisch nachsynchronisiert.
4. Läuft die Handy vor oder nach: **Offset** verschieben (positiv = Handy früher).

## Hinweise

- **Datenschutz:** Für die WLAN-Steuerung wird nur das Funscript (als CSV mit neutralem Dateinamen
  `script.csv`) auf Handys Script-Hosting geladen. Videos und Titel bleiben auf deinem Server.
- **Videoformate:** Was dein Browser kann – MP4 (H.264/H.265) und WebM laufen überall, MKV je nach Browser.
- **Geschwindigkeit:** Bei Wiedergabe ≠ 1× wird die Handy angehalten (HSSP v2 kennt keine Wiedergaberate).
- Genutzt wird die Handy API v2. Falls Handy sie irgendwann abschaltet, muss nur die Klasse `Handy`
  in `public/app.js` angepasst werden.
