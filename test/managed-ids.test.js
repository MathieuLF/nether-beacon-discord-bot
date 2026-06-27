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

test('captureManagedIdsFromDiscordSnapshot captures exact managed resources', () => {
  const snapshot = {
    guildId: 'guild-1',
    roles: plan.roles.map((role, index) => makeRole(`role-${index}`, role.name)),
    channels: [
      makeChannel('cat-community', '🌍 Communauté', ChannelType.GuildCategory),
      makeChannel('cat-voice', '🎙️ Vocaux', ChannelType.GuildCategory),
      makeChannel('cat-admin', '🛡️ Administration', ChannelType.GuildCategory),
    makeChannel('general', '💬・général', ChannelType.GuildText, 'cat-community'),
    makeChannel('tests', '🧪・essais', ChannelType.GuildText, 'cat-community'),
      makeChannel('events', '📜・arrivées-et-départs', ChannelType.GuildText, 'cat-community'),
      makeChannel('invites', '🎮・invitations', ChannelType.GuildText, 'cat-community'),
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
  assert.equal(registry.channels['🌍 Communauté::GuildText::💬・général'], 'general');
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
