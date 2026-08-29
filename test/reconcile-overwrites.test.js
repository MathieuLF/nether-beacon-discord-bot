const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');
const { _private } = require('../lib/reconcile');

const makeOverwriteCache = (entries) => ({
  size: entries.length,
  get: (id) => entries.find((entry) => entry.id === id) || null,
  map: (callback) => entries.map(callback),
});

test('ensureManagedOverwrites skips Discord writes when permissions already match', async () => {
  const defaultTextBits = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
  let writes = 0;
  const channel = {
    permissionOverwrites: {
      cache: makeOverwriteCache([
        {
          id: 'everyone',
          allow: { bitfield: defaultTextBits },
          deny: { bitfield: 0n },
          type: 0,
        },
      ]),
      set: async () => {
        writes += 1;
      },
    },
  };

  const changed = await _private.ensureManagedOverwrites(
    channel,
    { '@everyone': { id: 'everyone' } },
    {
      preset: 'defaultText',
      everyonePreset: 'defaultText',
      groups: [],
    },
  );

  assert.equal(changed, false);
  assert.equal(writes, 0);
});

test('hasDesiredRelativeOrder accepts channels already sorted by position', () => {
  const channels = [
    { id: 'general', position: 0 },
    { id: 'palworld', position: 1 },
    { id: 'pokemon-go', position: 2 },
    { id: 'minecraft', position: 3 },
  ];

  assert.equal(_private.hasDesiredRelativeOrder(channels), true);
});

test('shouldUpdateManagedTopic fixes a topic copied from another managed channel', () => {
  assert.equal(
    _private.shouldUpdateManagedTopic(
      'Discussions, astuces, bases et entraide autour de Palworld.',
      'Raids, sorties, échanges, captures et entraide autour de Pokémon GO.',
    ),
    true,
  );
  assert.equal(
    _private.shouldUpdateManagedTopic(
      'Sujet personnalisé par un humain.',
      'Raids, sorties, échanges, captures et entraide autour de Pokémon GO.',
    ),
    false,
  );
});

test('ensureSectionChannelOrder reorders managed channels by plan order', async () => {
  const calls = [];
  const guild = {
    channels: {
      setPositions: async (positions) => {
        calls.push(positions);
      },
    },
  };
  const report = { updated: [] };
  const channels = [
    { id: 'general', position: 0 },
    { id: 'palworld', position: 1 },
    { id: 'pokemon-go', position: 7 },
    { id: 'minecraft', position: 8 },
    { id: 'events', position: 2 },
  ];

  const changed = await _private.ensureSectionChannelOrder(
    guild,
    { category: '🌍 Communauté' },
    channels,
    report,
  );

  assert.equal(changed, true);
  assert.deepEqual(calls, [[
    { channel: 'general', position: 0 },
    { channel: 'palworld', position: 1 },
    { channel: 'pokemon-go', position: 2 },
    { channel: 'minecraft', position: 3 },
    { channel: 'events', position: 4 },
  ]]);
  assert.deepEqual(report.updated, ['ordre des salons 🌍 Communauté']);
});
