const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'runtime/**', 'public/**', 'muse-data/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  { files: ['docs/site/assets/*.js'], languageOptions: { sourceType: 'script', globals: globals.browser } },
  // These sanitizers intentionally strip ASCII controls from untrusted text.
  { files: ['lib/palworld-rest.js', 'lib/palworld-safety.js'], rules: { 'no-control-regex': 'off' } },
];
