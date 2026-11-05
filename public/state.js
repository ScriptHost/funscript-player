// Gemeinsamer Zustand der Oberfläche (2.0). Hier liegt, was mehrere Module brauchen und was schon beim Laden
// da sein muss. Module werden in Abhängigkeits-Reihenfolge ausgeführt, nicht in der Reihenfolge in index.html.
export const video = document.getElementById('video');

// Welche Module schon laufen. Ersetzt die alten Prüfungen „typeof x === 'function'“ (= ist das spätere Skript
// schon geladen?): Bei Modulen gibt es importierte Funktionen sofort, ihr Zustand ist aber erst nutzbar, wenn das
// Modul läuft. Jedes Modul trägt sich als ERSTE Anweisung ein – wie früher, als seine Funktionen ab Skriptbeginn da waren.
export const modulesReady = new Set();
