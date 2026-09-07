const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureMuseVolume } = require('../lib/local-volume');

test('local initialization refuses a legacy or foreign volume without adopting it', () => {
  for (const labels of [null, { 'dev.netherbeacon.project': 'foreign' }]) {
    const calls = [];
    assert.throws(() => ensureMuseVolume({ name: 'existing', project: 'local', source: process.cwd(), run: (args) => {
      calls.push(args);
      return args[1] === 'ls' ? 'existing\n' : JSON.stringify([{ Labels: labels }]);
    } }), /ownership/);
    assert.deepEqual(calls.map((args) => args[1]), ['ls', 'inspect']);
  }
});

test('fresh volumes are labelled and a create-name collision is checked before mounting', () => {
  const calls = [];
  assert.throws(() => ensureMuseVolume({ name: 'new', project: 'local', source: process.cwd(), run: (args) => {
    calls.push(args);
    if (args[1] === 'ls') return '';
    if (args[1] === 'create') return 'new';
    return JSON.stringify([{ Labels: {} }]);
  } }), /ownership/);
  assert.deepEqual(calls.map((args) => args[1]), ['ls', 'create', 'inspect']);
  assert.ok(calls[1].includes('dev.netherbeacon.project=local'));
});
