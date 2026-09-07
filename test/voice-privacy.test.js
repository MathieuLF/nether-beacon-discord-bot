const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, Collection, VoiceState, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { publicVoiceTransition } = require('../lib/voice-events');
const { resolveAllowedChannels, defaultMemberRole } = require('../lib/access-control');

test('actual Discord VoiceState routes public transitions and hides private channels', () => {
  const client = new Client({ intents: [] });
  const guild = { id: 'guild', client, roles: { everyone: { id: 'guild' } }, members: { cache: new Collection([['user', { id: 'user' }]]) }, channels: { cache: new Collection() } };
  for (const [id, permissions] of [['public', P.ViewChannel], ['private', 0n]]) {
    guild.channels.cache.set(id, { id, name: id, permissionsFor: () => new PermissionsBitField(permissions) });
  }
  const voice = (channel_id) => new VoiceState(guild, { user_id: 'user', channel_id });
  assert.equal(voice('public').guildId, undefined, 'fixture catches the original invalid property');
  assert.equal(publicVoiceTransition(voice(null), voice('public'), guild.id).next, 'public');
  assert.equal(publicVoiceTransition(voice(null), voice('private'), guild.id), null);
  assert.equal(publicVoiceTransition(voice('private'), voice(null), guild.id), null);
  assert.equal(publicVoiceTransition(voice('private'), voice('public'), guild.id).previous, null);
  assert.equal(publicVoiceTransition(voice('public'), voice('private'), guild.id).next, null);
  assert.equal(publicVoiceTransition(voice(null), voice('missing'), guild.id), null);
  assert.equal(publicVoiceTransition(voice(null), voice('public'), 'other'), null);
  client.destroy();
});

test('channel IDs take precedence and normalized duplicate names fail closed', () => {
  const channels = ['first', 'second'].map((id) => ({ id, name: '🐾・palworld', isTextBased: () => true, send() {} }));
  const guild = { channels: { cache: new Collection(channels.map((channel) => [channel.id, channel])) } };
  assert.deepEqual(resolveAllowedChannels(guild, { channelNames: ['Palworld'] }), []);
  assert.deepEqual(resolveAllowedChannels(guild, { channelIds: ['first'], channelNames: ['Palworld'] }).map((channel) => channel.id), ['first']);
  assert.deepEqual(resolveAllowedChannels(guild, { channelIds: ['missing'], channelNames: ['Palworld'] }), []);
});

test('newcomers receive only the registered role with unchanged declared permissions', () => {
  const definition = { name: 'Noob Spawn', permissions: ['ViewChannel'] };
  const owned = { id: 'owned', name: 'renamed', permissions: new PermissionsBitField(P.ViewChannel) };
  const foreign = { id: 'foreign', name: 'Noob Spawn', permissions: new PermissionsBitField(P.Administrator) };
  const guild = { roles: { cache: new Collection([['owned', owned], ['foreign', foreign]]) } };
  assert.equal(defaultMemberRole(guild, { roles: { 'Noob Spawn': 'owned' } }, definition), owned);
  assert.equal(defaultMemberRole(guild, { roles: {} }, definition), null);
  owned.permissions.add(P.Administrator);
  assert.equal(defaultMemberRole(guild, { roles: { 'Noob Spawn': 'owned' } }, definition), null);
});
