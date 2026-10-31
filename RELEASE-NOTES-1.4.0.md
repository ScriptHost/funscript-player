# Handy Player 1.4.0 – Zurückschreiben in Stash + Script-Werkzeuge

## Zurückschreiben in Stash
Stash bleibt die Verwaltung – der Player schreibt nur zurück, was beim Schauen anfällt.

### Im Player (unter dem Titel, nur bei Stash-Szenen)
| Element | Wirkung in Stash |
|---|---|
| ★★★★★ | Bewertung (1–5 Sterne = 20–100). Gleichen Stern nochmal = Bewertung entfernen |
| ♡/♥ Favorit | Tag **„Favorit“** an/aus |
| 💦 Zahl / − | O-Zähler +1 / letztes O zurücknehmen |
| 📍 Marker setzen (Taste **P**) | Marker „Lieblingsstelle m:ss“ an der aktuellen Stelle, Tag **„Lieblingsstelle“** |

### In HereSphere
Bewertung und Favorit, die du in der Brille setzt, landen ebenfalls in Stash – und HereSphere zeigt
die Werte aus Stash an.

**Warum ein Tag für „Favorit“:** Szenen haben in Stash kein Favoriten-Feld (nur Darsteller). Ein Tag
ist die übliche Lösung – so macht es auch Stashs eigene HereSphere-Anbindung – und du kannst in Stash
danach filtern (z. B. als gespeicherter Filter „Favoriten“). Fehlende Tags legt der Player einmalig an.
Die Namen lassen sich per `STASH_FAVORITE_TAG` / `STASH_MARKER_TAG` ändern.

**Warum Marker mit Tag:** Stash verlangt für jeden Marker einen Haupt-Tag. „Lieblingsstelle“ macht
deine selbst gesetzten Marker in Stash sofort auffindbar.

## 🛠️ Script-Werkzeuge
⚙️ Einstellungen → Script-Werkzeuge. Jedes einzeln einschaltbar, **standardmäßig aus**. Sie
rechnen das Script nur beim Abspielen um – **deine Dateien werden nie verändert**. Die Heatmap zeigt,
was tatsächlich an Handy und Vibrator geht, und unter den Schaltern steht, was beim aktuellen Video
passiert ist.

### Auf vollen Hub strecken
Nutzt ein Script nur z. B. 30–70 %, wird es auf 0–100 % gedehnt (deine Hub-Begrenzung gilt danach wie
gewohnt). Scripts, die schon fast den ganzen Bereich nutzen, bleiben unverändert.
**Warum:** Viele Scripts sind vorsichtig erstellt und fühlen sich dadurch flach an.

### Zu schnelle Stellen glätten
Bewegungen über der Höchstgeschwindigkeit (Standard 400 %/s, einstellbar) werden auf genau diese
Geschwindigkeit gekürzt.
**Warum:** Was schneller ist als die Handy schafft, kürzt sie selbst ab – unregelmäßig und ruckelig.
Vorher sauber begrenzt fühlt es sich gleichmäßiger an.

### 🎯 Offset per Takt einmessen (Taste **T**)
In der Handy-Karte: Video starten, Knopf drücken und 8× im Takt tippen – immer wenn im Bild ein Stoß
„unten“ ankommt. Der Player vergleicht das mit den Tiefpunkten im Script, nimmt den Median (Ausreißer
zählen nicht) und speichert den Offset für diese Szene.
**Warum:** Am Regler schieben ist Raten. Tippen im Takt ist schneller und genauer.

## Reihenfolge, falls mehreres aktiv ist
Script → Hub strecken → Spitzen glätten → (Finale „sanfter“: halbes Tempo) → Handy/Vibrator.

## Getestet (Browser, nachgebauter Stash, simulierte Handy)
- Sterne setzen/entfernen, Favorit an/aus, O +1/−1, Marker setzen (erscheint sofort in Liste/Zeitleiste)
- HereSphere: Anzeige von Bewertung/Favorit, Setzen von 5 ★ + Favorit, Tag wird einmalig angelegt
- Hub 30–70 → 0–100; Glätten 1000/2000 %/s → genau 400 %/s; Werkzeuge aus = Original
- Takt-Einmessen: simulierte Tipps 120 ms vor dem Script (±20 ms Streuung) → 120 ms Offset

**Nicht getestet:** mit deinem echten Stash (Mutationen können sich je nach Stash-Version leicht
unterscheiden – für O-Zähler und Play-Count gibt es Rückfälle für ältere Versionen) und das
Einmessen mit echten Tipps (menschliche Reaktion kann einige 10 ms ausmachen).
