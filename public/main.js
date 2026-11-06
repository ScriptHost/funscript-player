// Start (2.0): einziges <script type="module"> in index.html. Die Module haben keine Seiteneffekte beim Laden –
// jedes hat eine init()-Funktion, die hier in fester Reihenfolge läuft (früher: Ladekette über boot.js).
// modulesReady (state.js) zeigt anderen Modulen, welche init() schon gelaufen ist.
import { modulesReady } from './state.js';
import { applyLang } from './lang.js';
import { init as app } from './app.js';
import { init as library } from './library.js';
import { init as control } from './control.js';
import { init as vibe } from './vibe.js';
import { init as fullscreen } from './fullscreen.js';
import { init as gestures } from './gestures.js';
import { init as enhance } from './enhance.js';
import { init as hq } from './hq.js';
import { init as finale } from './finale.js';
import { init as tools } from './tools.js';
import { init as stroker } from './stroker.js';
import { init as selfctl } from './selfctl.js';
import { init as touchpad } from './touchpad.js';
import { init as settings } from './settings.js';
import { init as nav } from './nav.js';
import { init as player } from './player.js';

// Sprache zuerst: feste Texte (auch in <template>) – danach setzen die Module ihre wechselnden Texte selbst
applyLang();
for (const tpl of document.querySelectorAll('template')) applyLang(tpl.content);
for (const [name, init] of Object.entries({ app, library, control, vibe, fullscreen, gestures, enhance, hq, finale, tools, stroker, selfctl, touchpad, settings })) {
  modulesReady.add(name);
  init();
}
nav();         // Bereiche-Leiste + Anzeige-Schalter
player();      // Geräte-Dock am Video
if (/[?&]selbsttest\b/.test(location.search)) {
  document.body.append(Object.assign(document.createElement('script'), { type: 'module', src: 'selftest.js' }));
}
