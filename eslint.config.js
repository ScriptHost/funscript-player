'use strict';

// ESLint (1.19.9) – läuft nur auf GitHub (Workflow „Tests“), nicht im Image. Lokal:
//   npm ci && npx eslint .   (Versionen fest in package-lock.json)
// Oberfläche (2.0): ES-Module mit import/export – ESLint findet so fehlende Importe (no-undef) und
// Schreibzugriffe auf importierte Namen (no-import-assign). Nur die Sprachdateien sind noch klassische Skripte.
const globals = require('globals');

const I18N_FILES = ['public/i18n.js', 'public/i18n-en.js'];

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  'no-unreachable': 'error',
  'no-import-assign': 'error',
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
    ignores: I18N_FILES,
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, I18N: 'readonly' } },
    rules,
  },
  {
    files: I18N_FILES,
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser } },
    rules,
  },
  {
    files: ['server.js', 'lib/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
];
