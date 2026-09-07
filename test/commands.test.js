const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');
const {
  ADMIN_COMMAND_NAMES,
  POKEDEX_COMMAND_NAMES,
  PUBLIC_COMMAND_NAMES,
  STAFF_COMMAND_NAMES,
  commandHash,
  commandPayload,
  commandPayloadForProfile,
  commandPayloadHash,
  summarizeCommandDiff,
} = require('../lib/commands');

const FULL_COMMAND_NAMES = [
  'status',
  'audit',
  'resync',
  'help',
  'welcome-preview',
  'stats-refresh',
  'diag',
  'cache-status',
  'announce-palworld',
  'pokemon',
  'weakness',
  'move',
  'ability',
  'type',
  'random-pokemon',
  'metrics-palworld',
  'resume-hier',
];

test('command hash is stable and command diff reports missing and extra names', () => {
  assert.equal(commandPayloadHash(commandPayload), commandHash);

  const diff = summarizeCommandDiff([{ name: 'status' }, { name: 'legacy-command' }]);

  assert.equal(diff.hash, commandHash);
  assert.ok(diff.missing.includes('diag'));
  assert.ok(diff.missing.includes('cache-status'));
  assert.deepEqual(diff.extra, ['legacy-command']);
});

test('runtime profiles expose only their approved commands', () => {
  assert.deepEqual(
    commandPayloadForProfile('minimal').map((command) => command.name),
    ['status', 'help', 'metrics-palworld', 'resume-hier'],
  );
  assert.deepEqual(
    commandPayloadForProfile('pokemon').map((command) => command.name),
    [
      'status',
      'help',
      'pokemon',
      'weakness',
      'move',
      'ability',
      'type',
      'random-pokemon',
      'metrics-palworld',
      'resume-hier',
    ],
  );
  assert.equal(commandPayloadForProfile('full'), commandPayload);
  assert.throws(() => commandPayloadForProfile('unknown'), /Unknown bot profile/);
});

test('full profile has an exact, non-overlapping access classification', () => {
  assert.deepEqual(commandPayload.map((command) => command.name), FULL_COMMAND_NAMES);
  assert.ok(commandPayload.every((command) => command.dm_permission === false));

  const classified = [
    ...ADMIN_COMMAND_NAMES,
    ...STAFF_COMMAND_NAMES,
    ...PUBLIC_COMMAND_NAMES,
  ];
  assert.equal(new Set(classified).size, FULL_COMMAND_NAMES.length);
  assert.deepEqual(new Set(classified), new Set(FULL_COMMAND_NAMES));

  for (const command of commandPayload) {
    if (ADMIN_COMMAND_NAMES.has(command.name)) {
      assert.equal(command.default_member_permissions, String(PermissionFlagsBits.Administrator));
    } else if (STAFF_COMMAND_NAMES.has(command.name)) {
      assert.equal(command.default_member_permissions, String(PermissionFlagsBits.ManageMessages));
    } else {
      assert.equal(command.default_member_permissions, undefined);
    }
  }
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
