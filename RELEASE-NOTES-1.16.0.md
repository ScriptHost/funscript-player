# Funscript Player 1.16.0 – Aufgeräumt beim Schauen, Mitschnitt zum Video, Tests

## Beim Schauen: nur, was verbunden ist
- **Eine Status-Anzeige oben** für beide Geräte („↕ verbunden · 〰 1 Gerät · 🔋 64 %“). Antippen öffnet das
  Geräte-Fenster – dort und nur dort wird **verbunden** (Satisfyer per Bluetooth, Geräteliste, Motoren, Trennen,
  Handy-Verbinden).
- **Unter dem Video ein gemeinsamer Bereich ohne Reiter**, nur für verbundene Geräte: „Geräte pausieren“ (beide),
  Offset (gilt jetzt auch für den Satisfyer), Hub und Neu synchronisieren nur mit Handy, Stärke-Anzeige und
  „Stärke für diese Szene“ nur mit Satisfyer, Finale, Alles stoppen. Ohne Gerät nur ein kurzer Hinweis.
  Gilt auch für „Selbst steuern“, 🎮 Steuern und die Touch-Fläche.
- **Sync ist Standard:** „Geräte folgen dem Video“ ist beim Start und nach 🎮 Steuern an; der Schalter steht nur
  noch unter ⚙️ → Geräte. Alte, unbemerkt gespeicherte „nur schauen“-Zustände wurden einmal zurückgesetzt.
  Folgen die Geräte trotzdem nicht, zeigt der Player einen Hinweis mit „Einschalten“.
- **„Keine Steuerung · Selbst steuern“** steht bei Videos ohne Funscript immer da, sobald ein Gerät verbunden ist
  – auch im Modus „nur schauen“.
- **STOPP-Option** (⚙️ → Sicherheit) blendet schwebenden STOPP, Vollbild-STOPP und „Alles stoppen“ unter dem Video
  aus; im Geräte-Fenster oben bleibt „Alles stoppen“ immer.

## Touch-Steuerung (aus der Beta) mit Aufnahme
- Die Finger-Fläche ist jetzt immer da (🎮 Steuern und „Selbst steuern“).
- **⏺ Aufnehmen:** als Pattern speichern (🎮 Patterns, Script-Baukasten), als .funscript herunterladen oder zum
  Video speichern. Standard: Finger-Höhe = Tempo der Stöße. 🧪 Beta (⚙️ → Geräte): Finger-Höhe = Position.

## Mitschnitt zum Video
Bei „Selbst steuern“ zeichnet **⏺ Mitschnitt zum Video** auf, wie du Handy und Satisfyer steuerst – an der
Video-Zeit. **„Als Script zu diesem Video speichern“** macht daraus ein Funscript; beim nächsten Abspielen läuft es
genau so synchron mit (auch nach Spulen). Ordner-Videos: Datei daneben (nur ohne `:ro` im Volume, sonst auf dem
Server); Stash-Szenen: auf dem Player-Server (Stash bleibt unverändert). Vorhandene Dateien werden nie
überschrieben. Auch über „📂 Datei“ geladene Scripts lassen sich so zu einem Video speichern.
Abschaltbar unter ⚙️ → Bibliothek.

## Script-Automatik je Gerät
Die Handy bekommt eine Fassung mit Kürzen auf das, was sie physisch schafft; der Satisfyer bekommt dasselbe Script
**ungekürzt** (dafür ggf. ruhiger). Beide gleichzeitig. Die Info-Zeile nennt nur, was für die verbundenen Geräte gilt.

## Pro Szene gemerkt
Neben Offset und Preset jetzt auch **Hub** und **„Stärke für diese Szene“** (Satisfyer).

## Bibliothek, Anzeige
- **Nach Intensität filtern/sortieren** (ruhig / mittel / intensiv, sortiert ruhig ↔ intensiv) – gilt für die
  geladenen Szenen.
- **Mini-Player beim Stöbern** (Standard unten links, einstellbar unter ⚙️ → Anzeige; „Nur Leiste“ möglich).
  Dazu ⧉ in der Player-Leiste für Bild-in-Bild über anderen Apps.
- Kompakte Kopfzeile nur noch auf schmalen Bildschirmen; Pixel-Erkennung über die neuere Browser-Schnittstelle
  (Chrome nennt das Modell nicht mehr im normalen Gerätenamen).

## Geräte
- **Satisfyer-Akku** in der Status-Anzeige (wenn das Gerät ihn meldet). Die Handy hat keinen Akku.
- **Verzögerung gemessen:** Bluetooth-Laufzeit zum Satisfyer -> Vorlauf automatisch (abschaltbar); Antwortzeit der
  Handy-Cloud wird angezeigt (dort gleicht die Uhr aus, kein Vorlauf nötig).
- **Bluetooth:** Wird nichts gefunden, gibt es direkt „Nicht dabei? Alle Bluetooth-Geräte anzeigen“. Hängt eine
  Übertragung, wartet der Player höchstens 1 s – die Vibration kann nicht mehr dauerhaft stehen bleiben.

## Fernbedienung
Lautstärke und Ton des Bildschirms vom Smartphone; am Bildschirm „📱 Ferngesteuert von …“ mit „Trennen“.

## Sonstiges
- Domain in `docker-compose.yml`, README und Doku: `handy.${DOMAIN}`.
- **Automatische Tests:** `node --test "test/*.test.js"` – Script-Logik und Server (Einstellungen, Intensität,
  eigene Scripts, Fernbedienung, HereSphere). 14 Tests, alle grün.

## Getestet
Automatische Tests (14/14). Im Browser mit simuliertem Satisfyer: nur verbundene Geräte sichtbar, Verbinden nur
im Pop-up, Sync-Standard und Hinweis, Selbst steuern im Modus „nur schauen“, Mitschnitt, Mini-Player,
Intensitäts-Filter, Smartphone-Breite. **Nicht getestet:** echte Geräte (Akku, gemessene Verzögerung, Touch-Aufnahme
abspielen), Speichern neben Videos auf deinem Server, Fernbedienung mit zwei echten Geräten.
