const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');
const {
  POKEDEX_COMMAND_NAMES,
  PUBLIC_COMMAND_NAMES,
  STAFF_COMMAND_NAMES,
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

test('Palworld slash commands expose public metrics and staff announcement', () => {
  assert.ok(PUBLIC_COMMAND_NAMES.has('metrics-palworld'));
  assert.ok(PUBLIC_COMMAND_NAMES.has('resume-hier'));
  assert.ok(STAFF_COMMAND_NAMES.has('announce-palworld'));
  assert.ok(!POKEDEX_COMMAND_NAMES.has('metrics-palworld'));

  const metrics = commandPayload.find((entry) => entry.name === 'metrics-palworld');
  assert.ok(metrics, 'missing metrics-palworld command');
  assert.equal(metrics.default_member_permissions, undefined);

  const summary = commandPayload.find((entry) => entry.name === 'resume-hier');
  assert.ok(summary, 'missing resume-hier command');
  assert.equal(summary.default_member_permissions, undefined);

  const announce = commandPayload.find((entry) => entry.name === 'announce-palworld');
  assert.ok(announce, 'missing announce-palworld command');
  assert.equal(announce.default_member_permissions, String(PermissionFlagsBits.ManageMessages));
  assert.equal(announce.options[0].name, 'message');
  assert.equal(announce.options[0].max_length, 500);
});
