'use strict';

// Start (1.19.5 aus index.html ausgelagert – die Content-Security-Policy erlaubt keine Skripte im HTML):
// Sprache anwenden und für die Entwicklung mit ?selbsttest den Selbsttest nachladen.
I18N.start();
if (/[?&]selbsttest\b/.test(location.search)) document.body.append(Object.assign(document.createElement('script'), { src: 'selftest.js' }));
