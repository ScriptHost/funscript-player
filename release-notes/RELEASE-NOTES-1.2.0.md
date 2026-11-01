# Handy Player 1.2.0 – Was sich geändert hat und warum

## Deine Wünsche

### 1. Handy bleibt synchron (Auto-Korrektur + ⟳-Knopf)
**Was:** Alle 30 s sendet der Player der Handy die echte Videoposition neu, alle 5 min gleicht er die Uhr
mit dem Handy-Server ab, und beim Zurückkehren in die App wird sofort neu ausgerichtet. Dazu gibt es
**⟳** in der Bedienleiste (Taste **S**) und „⟳ Neu synchronisieren“ in der Handy-Karte. Abschaltbar
über „Sync automatisch nachkorrigieren“.
**Warum:** Die Handy spielt das Script nach ihrer eigenen Uhr ab. Puffern, kurze Ruckler oder
Uhrendrift lassen beide langsam auseinanderlaufen – ohne dass ein Ereignis das bemerkt. Regelmäßiges
Neu-Ausrichten fängt das ab, bevor es spürbar wird.

### 2. Vorschaubilder beim Spulen
**Was:** Fährst oder ziehst du über die Zeitleiste, erscheint das passende Bild aus den Sprites, die
Stash beim „Generieren“ erzeugt (plus Zeitangabe).
**Warum:** Man findet die gewünschte Stelle sofort statt blind zu springen. Funktioniert nur bei
Stash-Szenen, für die Stash Sprites erzeugt hat (Stash → Aufgaben → Generieren → Sprites).

### 3. „Einfach das beste Bild“ statt vieler Filter
**Was:** In ⚙️ Einstellungen gibt es oben nur noch **Automatisch – bestes Bild / Aus – Original**.
„Automatisch“ entscheidet pro Video: Hochrechnen auf dem Server nur, wenn das Video kleiner als der
Bildschirm ist; Schärfe im Browser passend zum Vergrößerungsfaktor (kleines Video auf großem
Bildschirm = mehr Schärfe, volle Auflösung = nur ein Hauch); Anti-Banding immer an. Alle Einzelregler
liegen unter „Erweitert“. ✨ im Player schaltet zwischen Automatisch und Original.
**Warum:** Die richtige Einstellung hängt vom Video und vom Gerät ab – das kann der Player besser
ausrechnen als man es von Hand einstellt. Bestehende Geräte werden einmalig auf „Automatisch“ umgestellt.

### 4. Handy verbindet sich beim Start automatisch
**Was:** Ist ein Connection Key gespeichert, verbindet der Player beim Öffnen automatisch (abschaltbar).
Bereits einmal gekoppelte Satisfyer verbindet Chrome ebenfalls automatisch wieder, wenn sie in
Reichweite sind (nur wo der Browser `getDevices` erlaubt; sonst wie bisher per Knopf).
**Warum:** Ein Klick weniger bei jedem Start.

### 5. Titel statt Dateiname
**Was:** Hat eine Szene in Stash keinen Titel, macht der Player aus dem Dateinamen einen lesbaren:
`Studio_Name.Szene-Titel_1080p_60fps.mp4` → „Studio Name Szene-Titel“ (Unterstriche/Punkte weg,
Auflösung, fps, Codecs und VR-Kennungen entfernt). Gilt auch für Ordner-Videos und HereSphere.
Gepflegte Stash-Titel bleiben unverändert.
**Warum:** Dateinamen sind oft technisch und schwer lesbar.

### 6. HQ passt sich bei Ruckeln selbst an
**Was:** Stockt der HQ-Stream dreimal innerhalb einer Minute, schaltet der Player eine Stufe zurück:
1440p → 1080p → 720p → Original. Kurz nach Start oder Spulen wird nicht gezählt. Ist ein Video
einmal aufs Original zurückgefallen, bleibt es in dieser Sitzung dort.
**Warum:** Ob der N305 und das Netz mithalten, hängt vom Video und der Tageslast ab. Lieber
automatisch eine Stufe weniger als ständiges Puffern.

### 7. 🔥 Finale-Knopf
**Was:** 🔥 in der Bedienleiste, in der Geräte-Spalte oder Taste **O**: Die Handy wird vom Script
gelöst und fährt gleichmäßig in einem eigenen Bereich, der Vibrator läuft mit fester Stärke, das Video
spielt weiter. Nochmal drücken → zurück zum Video-Sync (dein Hub wird wiederhergestellt). Optional
automatisch zurück nach x Sekunden. Not-Aus beendet Finale ebenfalls.
Einstellbar in ⚙️ Einstellungen → 🔥 Finale: Geschwindigkeit, Hub von/bis, Vibration, Rückkehr-Zeit.
**Standard:** langsam (30 %), flacher Hub (40–70 %), Vibration 50 %.
**Warum so:** Du hast dir „viel langsamer, nicht so hoch/tief“ gewünscht. In meinem Plan stand
versehentlich „kurz und schnell“ – die Standardwerte folgen deinem ursprünglichen Wunsch, alles ist
frei einstellbar. Die Obergrenze aus „Sicherheit“ gilt auch hier.

## Meine eigenen Ergänzungen

### Offset pro Szene
**Was:** Verstellst du den Video-Offset, merkt sich der Player den Wert für genau diese Szene
(Anzeige „· Szene“). Neue Szenen starten mit dem allgemeinen Offset.
**Warum:** Manche Scripts sind ein paar hundert Millisekunden versetzt, andere nicht – ein globaler
Wert passt nie für alle.

### „Weiterschauen“-Reihe
**Was:** Oben in der Stash-Bibliothek (ungefilterte Ansicht) eine Reihe mit angefangenen Szenen,
zuletzt gesehene zuerst. Nutzt die Positionen, die der Player ohnehin an Stash meldet.
**Warum:** Der schnellste Weg zurück zu dem, was du zuletzt geschaut hast.

### Diese Release-Notiz
**Was:** Ab jetzt bekommt jede Version eine Notiz mit „was“ und „warum“, zusätzlich zum kurzen
`CHANGELOG.md`.

## Was ich nicht verändert habe
- Bisherige Funktionen bleiben, wie sie sind; neue Standards (Auto-Qualität, Auto-Connect,
  Auto-Sync) lassen sich einzeln abschalten.
- Kein Teil davon schreibt in deine Stash- oder Medienordner.

## Getestet
Mit nachgebautem Stash und simulierter Handy im Browser (Desktop): Titel, Weiterschauen, Sprites,
Auto-Qualität, Offset pro Szene, Auto-Connect-Versuch (echter Handy-Server mit Test-Key),
manueller und automatischer Sync, Finale an/aus, Finale + Not-Aus, HQ-Rückschaltung.
**Nicht getestet:** echte Handy, echter Satisfyer, echte Stash-Sprites, Intel-Grafik auf dem N305.
