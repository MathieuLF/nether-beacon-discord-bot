const assert = require('node:assert/strict');
const test = require('node:test');
const {
  commandHash,
  commandPayload,
  commandPayloadHash,
  summarizeCommandDiff,
} = require('../lib/commands');

test('command hash is stable and command diff reports missing and extra names', () => {
  assert.equal(commandPayloadHash(commandPayload), commandHash);

  const diff = summarizeCommandDiff([{ name: 'status' }, { name: 'legacy-command' }]);

  assert.equal(diff.hash, commandHash);
  assert.ok(diff.missing.includes('diag'));
  assert.ok(diff.missing.includes('cache-status'));
  assert.deepEqual(diff.extra, ['legacy-command']);
});

test('Pokédex slash command options expose autocomplete', () => {
  for (const commandName of ['pokemon', 'weakness', 'move', 'ability', 'type']) {
    const command = commandPayload.find((entry) => entry.name === commandName);
    assert.ok(command, `missing command ${commandName}`);
    assert.equal(command.options[0].autocomplete, true, `${commandName} should autocomplete`);
  }
});
