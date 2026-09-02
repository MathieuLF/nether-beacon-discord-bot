const assert = require('node:assert/strict');
const test = require('node:test');
const { ChannelType, Collection, PermissionFlagsBits } = require('discord.js');
const { plan, _private } = require('../lib/reconcile');

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
    { id: 'minecraft-vh', position: 4 },
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
    { id: 'minecraft-vh', position: 9 },
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
    { channel: 'minecraft-vh', position: 4 },
    { channel: 'events', position: 5 },
  ]]);
  assert.deepEqual(report.updated, ['ordre des salons 🌍 Communauté']);
});

test('ensureManagedCategoryOrder keeps managed categories contiguous in plan order', async () => {
  const calls = [];
  const categories = [
    { id: 'community', type: ChannelType.GuildCategory, position: 0 },
    { id: 'unmanaged', type: ChannelType.GuildCategory, position: 1 },
    { id: 'hall', type: ChannelType.GuildCategory, position: 2 },
    { id: 'archives', type: ChannelType.GuildCategory, position: 3 },
  ];
  const guild = {
    channels: {
      cache: new Collection(categories.map((category) => [category.id, category])),
      setPositions: async (positions) => {
        calls.push(positions);
      },
    },
  };
  const report = { updated: [] };

  const changed = await _private.ensureManagedCategoryOrder(
    guild,
    [categories[0], categories[2], categories[3]],
    report,
  );

  assert.equal(changed, true);
  assert.deepEqual(calls, [[
    { channel: 'community', position: 0 },
    { channel: 'hall', position: 1 },
    { channel: 'archives', position: 2 },
  ]]);
  assert.deepEqual(report.updated, ['ordre des catégories gérées']);
});

test('findUniqueChannel reuses invitations when moving it from Hall to Archives', () => {
  const archivesSection = plan.sections.find((section) => section.category === '🗃️ Archives');
  const invitations = archivesSection.channels.find((channel) => channel.name === '🎮・invitations');
  const existingChannel = {
    id: 'existing-invitations',
    name: invitations.name,
    type: ChannelType[invitations.type],
    parentId: 'cat-hall',
    parent: { name: '🚪 Le Hall' },
  };
  const guild = {
    channels: {
      cache: new Collection([[existingChannel.id, existingChannel]]),
    },
  };

  const result = _private.findUniqueChannel(
    guild,
    'cat-archives',
    invitations,
    archivesSection,
  );

  assert.equal(result.conflict, undefined);
  assert.equal(result.value.id, 'existing-invitations');
});
