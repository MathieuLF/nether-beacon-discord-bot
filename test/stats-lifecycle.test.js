const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { createStatsManager } = require('../lib/stats');
const { statsOverwrites } = require('../lib/stats-identity');
const { emptyManagedIds, captureManagedIdsFromDiscordSnapshot } = require('../lib/managed-ids');
const { loadServerPlan } = require('../lib/config');
const { fakeGuild } = require('../test-support/fake-guild');

const setup = () => {
  const fixture = fakeGuild();
  let registry = emptyManagedIds();
  const manager = createStatsManager({ state: {}, updateRuntimeFiles() {}, noteRuntimeError() {}, client: {}, guildId: fixture.guild.id, timeZone: 'UTC',
    loadRegistry: () => structuredClone(registry), saveRegistry: (next) => { registry = structuredClone(next); } });
  return { ...fixture, manager, registry: () => registry, setRegistry: (value) => { registry = value; } };
};

test('Stats refuses existing unregistered or duplicate categories before any write', async () => {
  for (const count of [1, 2]) {
    const fixture = setup();
    for (let i = 0; i < count; i++) fixture.channel({ name: 'Stats', type: ChannelType.GuildCategory });
    assert.equal((await fixture.manager.refresh(fixture.guild, 'startup')).status, 'failed');
    assert.equal(fixture.writes.length, 0);
  }
});

test('fresh Stats creation persists IDs; legacy and duplicate-looking unowned resources survive', async () => {
  const fixture = setup();
  assert.equal((await fixture.manager.refresh(fixture.guild, 'startup')).status, 'updated');
  const registry = fixture.registry();
  assert.equal(Object.keys(registry.stats).length, 11);
  const category = registry.stats.category;
  const extras = [fixture.channel({ name: '🕘・custom', type: ChannelType.GuildVoice, parent: category }),
    fixture.channel({ name: '📊・stats-live', type: ChannelType.GuildText, parent: category }),
    fixture.channel({ name: '🟢・private custom', type: ChannelType.GuildVoice, parent: category })];
  fixture.writes.length = 0;
  const results = await Promise.all([fixture.manager.refresh(fixture.guild, 'interval'), fixture.manager.refresh(fixture.guild, 'slash-stats-refresh')]);
  assert.deepEqual(results.map((result) => result.status), ['sampled', 'updated']);
  for (const extra of extras) assert.equal(fixture.writes.some((write) => write.id === extra.id), false);
});

test('missing Stats identity refuses a matching-prefix replacement and a failed write returns failure', async () => {
  const fixture = setup();
  await fixture.manager.refresh(fixture.guild, 'startup');
  const id = fixture.registry().stats.online;
  const original = fixture.guild.channels.cache.get(id);
  fixture.guild.channels.cache.delete(id);
  fixture.channel({ name: original.name, type: ChannelType.GuildVoice, parent: original.parentId, permissionOverwrites: statsOverwrites('guild') });
  fixture.writes.length = 0;
  assert.equal((await fixture.manager.refresh(fixture.guild, 'slash-stats-refresh')).status, 'failed');
  assert.equal(fixture.writes.length, 0);
  fixture.guild.channels.cache.set(id, original);
  original.name = 'needs update';
  original.edit = async () => { throw new Error('Discord write refused'); };
  const result = await fixture.manager.refresh(fixture.guild, 'slash-stats-refresh');
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /refused/);
});

test('explicit capture upgrades legacy public Stats without replacing their identities', async () => {
  const fixture = setup();
  const category = fixture.channel({ id: 'legacy-category', name: 'Stats serveur', type: ChannelType.GuildCategory, permissionOverwrites: statsOverwrites('guild') });
  fixture.channel({ id: 'legacy-online', name: '🟢・en ligne : 3', type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: statsOverwrites('guild') });
  const snapshot = {
    guildId: 'guild', roles: [...fixture.guild.roles.cache.values()],
    channels: [...fixture.guild.channels.cache.values()].map((channel) => ({ ...channel, parent_id: channel.parentId,
      permission_overwrites: [...channel.permissionOverwrites.cache.values()].map((entry) => ({ id: entry.id, allow: String(entry.allow.bitfield), deny: String(entry.deny.bitfield) })) })),
  };
  const { registry, report } = captureManagedIdsFromDiscordSnapshot(loadServerPlan(), snapshot, emptyManagedIds());
  assert.equal(report.conflicts.length, 0);
  fixture.setRegistry(registry);
  assert.equal((await fixture.manager.refresh(fixture.guild, 'startup')).status, 'updated');
  assert.equal(fixture.registry().stats.category, 'legacy-category');
  assert.equal(fixture.registry().stats.online, 'legacy-online');
  assert.equal(category.name, 'Stats');
});
