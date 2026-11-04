'use strict';

// ESLint (1.19.9) – läuft nur auf GitHub (Workflow „Tests“), nicht im Image. Lokal:
//   npm ci && npx eslint .   (Versionen fest in package-lock.json)
// Die Skripte der Oberfläche teilen sich EINEN globalen Namensraum (klassische <script>-Dateien in fester
// Reihenfolge). Damit ESLint Tippfehler in Namen findet, ohne gemeinsame Namen anzumeckern, werden alle
// Namen, die eine Datei auf oberster Ebene anlegt, für die anderen als bekannt eingetragen.
const fs = require('fs');
const path = require('path');
const globals = require('globals');

const PUBLIC = path.join(__dirname, 'public');
const shared = {};
for (const f of fs.readdirSync(PUBLIC).filter((n) => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) shared[m[1]] = 'writable';
  // const { a, b } = … auf oberster Ebene
  for (const m of src.matchAll(/^(?:const|let)\s+\{([^}]+)\}\s*=/gm)) for (const n of m[1].split(',')) shared[n.trim().split(':').pop().trim()] = 'writable';
}

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-self-assign': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-redeclare': ['error', { builtinGlobals: false }],
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

module.exports = [
  { ignores: ['node_modules/**', 'docs/**', 'data/**'] },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, ...shared } },
    rules,
  },
  {
    files: ['server.js', 'lib/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
];
