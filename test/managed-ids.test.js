const assert = require('node:assert/strict');
const test = require('node:test');
const { ChannelType } = require('discord.js');
const { loadServerPlan } = require('../lib/config');
const {
  captureManagedIdsFromDiscordSnapshot,
  normalizeManagedName,
} = require('../lib/managed-ids');

const plan = loadServerPlan();

const makeRole = (id, name) => ({ id, name });
const makeChannel = (id, name, type, parentId = null) => ({ id, name, type, parent_id: parentId });

test('server plan keeps Archives directly below Administration', () => {
  assert.deepEqual(
    plan.sections.map((section) => section.category),
    ['🌍 Communauté', '🚪 Le Hall', '🎙️ Vocaux', '🛡️ Administration', '🗃️ Archives'],
  );
});

test('captureManagedIdsFromDiscordSnapshot captures exact managed resources', () => {
  const snapshot = {
    guildId: 'guild-1',
    roles: plan.roles.map((role, index) => makeRole(`role-${index}`, role.name)),
    channels: [
      makeChannel('cat-community', '🌍 Communauté', ChannelType.GuildCategory),
      makeChannel('cat-hall', '🚪 Le Hall', ChannelType.GuildCategory),
      makeChannel('cat-archives', '🗃️ Archives', ChannelType.GuildCategory),
      makeChannel('cat-voice', '🎙️ Vocaux', ChannelType.GuildCategory),
      makeChannel('cat-admin', '🛡️ Administration', ChannelType.GuildCategory),
      makeChannel('general', '💬・général', ChannelType.GuildText, 'cat-community'),
      makeChannel('palworld', '🐾・palworld', ChannelType.GuildText, 'cat-community'),
      makeChannel('pokemon-go', '📍・pokemon-go', ChannelType.GuildText, 'cat-community'),
      makeChannel('minecraft', '⛏️・minecraft', ChannelType.GuildText, 'cat-community'),
      makeChannel('minecraft-vh', '🔮・minecraft-vh', ChannelType.GuildText, 'cat-community'),
      makeChannel('events', '📜・arrivées-et-départs', ChannelType.GuildText, 'cat-hall'),
      makeChannel('tests', '🧪・essais', ChannelType.GuildText, 'cat-archives'),
      makeChannel('invites', '🎮・invitations', ChannelType.GuildText, 'cat-archives'),
      makeChannel('voice', '🎧・salon-vocal', ChannelType.GuildVoice, 'cat-voice'),
      makeChannel('in-game', '🎮・en-partie', ChannelType.GuildVoice, 'cat-voice'),
      makeChannel('logs', '📚・logs', ChannelType.GuildText, 'cat-admin'),
      makeChannel('admin-text', '🧠・admin-texte', ChannelType.GuildText, 'cat-admin'),
      makeChannel('admin-voice', '👑・admin-vocal', ChannelType.GuildVoice, 'cat-admin'),
    ],
  };

  const { registry, report } = captureManagedIdsFromDiscordSnapshot(plan, snapshot);

  assert.equal(report.conflicts.length, 0);
  assert.equal(report.capturedRoles, plan.roles.length);
  assert.equal(report.capturedCategories, plan.sections.length);
  assert.equal(report.capturedChannels, plan.sections.reduce((count, section) => count + section.channels.length, 0));
  assert.equal(registry.roles['Noob Spawn'], 'role-0');
  assert.equal(registry.categories['🌍 Communauté'], 'cat-community');
  assert.equal(registry.categories['🚪 Le Hall'], 'cat-hall');
  assert.equal(registry.categories['🗃️ Archives'], 'cat-archives');
  assert.equal(registry.channels['🌍 Communauté::GuildText::💬・général'], 'general');
  assert.equal(registry.channels['🌍 Communauté::GuildText::🐾・palworld'], 'palworld');
  assert.equal(registry.channels['🌍 Communauté::GuildText::📍・pokemon-go'], 'pokemon-go');
  assert.equal(registry.channels['🌍 Communauté::GuildText::⛏️・minecraft'], 'minecraft');
  assert.equal(registry.channels['🌍 Communauté::GuildText::🔮・minecraft-vh'], 'minecraft-vh');
  assert.equal(registry.channels['🚪 Le Hall::GuildText::📜・arrivées-et-départs'], 'events');
  assert.equal(registry.channels['🗃️ Archives::GuildText::🧪・essais'], 'tests');
  assert.equal(registry.channels['🗃️ Archives::GuildText::🎮・invitations'], 'invites');
});

test('captureManagedIdsFromDiscordSnapshot accepts moved managed channels when allowExistingMove is set', () => {
  const snapshot = {
    guildId: 'guild-1',
    roles: plan.roles.map((role, index) => makeRole(`role-${index}`, role.name)),
    channels: [
      makeChannel('cat-community', '🌍 Communauté', ChannelType.GuildCategory),
      makeChannel('cat-hall', '🚪 Le Hall', ChannelType.GuildCategory),
      makeChannel('cat-archives', '🗃️ Archives', ChannelType.GuildCategory),
      makeChannel('invites', '🎮・invitations', ChannelType.GuildText, 'cat-hall'),
      makeChannel('events', '📜・arrivées-et-départs', ChannelType.GuildText, 'cat-community'),
      makeChannel('tests', '🧪・essais', ChannelType.GuildText, 'cat-community'),
    ],
  };

  const { registry, report } = captureManagedIdsFromDiscordSnapshot(plan, snapshot);

  assert.equal(report.conflicts.length, 0);
  assert.equal(registry.channels['🚪 Le Hall::GuildText::📜・arrivées-et-départs'], 'events');
  assert.equal(registry.channels['🗃️ Archives::GuildText::🧪・essais'], 'tests');
  assert.equal(registry.channels['🗃️ Archives::GuildText::🎮・invitations'], 'invites');
});

test('captureManagedIdsFromDiscordSnapshot reuses the plain minecraft-vh legacy name', () => {
  const snapshot = {
    guildId: 'guild-1',
    roles: plan.roles.map((role, index) => makeRole(`role-${index}`, role.name)),
    channels: [
      makeChannel('cat-community', '🌍 Communauté', ChannelType.GuildCategory),
      makeChannel('minecraft-vh', 'minecraft-vh', ChannelType.GuildText, 'cat-community'),
    ],
  };

  const { registry, report } = captureManagedIdsFromDiscordSnapshot(plan, snapshot);

  assert.equal(report.conflicts.length, 0);
  assert.equal(registry.channels['🌍 Communauté::GuildText::🔮・minecraft-vh'], 'minecraft-vh');
});

test('captureManagedIdsFromDiscordSnapshot blocks probable duplicate channels', () => {
  const snapshot = {
    guildId: 'guild-1',
    roles: plan.roles.map((role, index) => makeRole(`role-${index}`, role.name)),
    channels: [
      makeChannel('cat-community', '🌍 Communauté', ChannelType.GuildCategory),
      makeChannel('cat-voice', '🎙️ Vocaux', ChannelType.GuildCategory),
      makeChannel('cat-admin', '🛡️ Administration', ChannelType.GuildCategory),
      makeChannel('general-no-accent', '💬・general', ChannelType.GuildText, 'cat-community'),
    ],
  };

  const { report } = captureManagedIdsFromDiscordSnapshot(plan, snapshot);

  assert.ok(report.conflicts.some((conflict) => conflict.includes('probable duplicate channel for 💬・général')));
});

test('normalizeManagedName ignores accents, emoji separators and case', () => {
  assert.equal(normalizeManagedName('💬・Général'), normalizeManagedName('general'));
});
