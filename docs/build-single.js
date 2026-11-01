// Baut aus docs/ EINE eigenständige HTML-Datei zum Weitergeben (CSS und Animation eingebettet, ohne Entwickler-Link).
// Aufruf im Projektordner: node docs/build-single.js ../Funscript-Player-Vorstellung.html
const fs = require('fs');
let html = fs.readFileSync('docs/index.html', 'utf8');
const css = fs.readFileSync('docs/style.css', 'utf8');
const js = fs.readFileSync('docs/sync-demo.js', 'utf8');
if (js.includes('</script')) throw new Error('script would close early');
const swap = (a, b) => { if (!html.includes(a)) throw new Error('missing: ' + a); html = html.replace(a, b); };
swap('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`);
swap('<script src="sync-demo.js"></script>', `<script>\n${js}\n</script>`);
const js2 = fs.readFileSync('docs/try-demo.js', 'utf8');
if (js2.includes('</script')) throw new Error('script would close early');
swap('<script src="try-demo.js"></script>', `<script>\n${js2}\n</script>`);
// DE/EN-Schalter
for (const f of ['hero.js', 'i18n-en.js', 'i18n.js']) {
  const code = fs.readFileSync('docs/' + f, 'utf8');
  if (code.includes('</script')) throw new Error('script would close early');
  swap(`<script src="${f}"></script>`, `<script>\n${code}\n</script>`);
}
// Entwickler-Seite ist nicht dabei -> Links entfernen
swap('      <a href="dev.html">Entwickler</a>\n', '');
swap('<span><a href="https://github.com/ScriptHost/funscript-player">GitHub</a> · <a href="dev.html">Entwickler-Doku →</a></span>', '<span><a href="https://github.com/ScriptHost/funscript-player">GitHub</a></span>');
if (/href="(?!#|https?:)[^"]+"|src="(?!data:)[^"]+"/.test(html)) throw new Error('still has external references');
fs.writeFileSync(process.argv[2], html);
console.log('ok', Math.round(html.length / 1024) + ' KB');
