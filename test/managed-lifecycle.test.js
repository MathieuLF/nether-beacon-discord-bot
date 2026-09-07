const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { paths } = require('../lib/config');
const { plan, _private } = require('../lib/reconcile');
const { emptyManagedIds, loadManagedIds, saveManagedIds, touchManagedIds, normalizeManagedIds, captureManagedIdsFromDiscordSnapshot } = require('../lib/managed-ids');
const { fakeGuild } = require('../test-support/fake-guild');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nether-beacon-registry-test-'));
paths.runtimeDir = directory;
paths.managedIdsPath = path.join(directory, 'managed-ids.json');
test.after(() => {
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('registry bootstraps only for ENOENT and rejects corruption, wrong provenance and schema', () => {
  assert.equal(loadManagedIds().guildId, null);
  fs.writeFileSync(paths.managedIdsPath, '{broken');
  assert.throws(loadManagedIds, /Cannot read/);
  for (const payload of [null, [], {}, { ...emptyManagedIds(), version: 9 }, { ...emptyManagedIds(), channels: [] }, { ...emptyManagedIds(), roles: { admin: null } }]) {
    assert.throws(() => normalizeManagedIds(payload), /Invalid/);
  }
  assert.throws(() => touchManagedIds({ ...emptyManagedIds(), guildId: 'other' }, 'guild', plan), /another guild/);
  assert.throws(() => touchManagedIds({ ...emptyManagedIds(), managedMarker: 'other' }, 'guild', plan), /another server plan/);
  fs.unlinkSync(paths.managedIdsPath); // Explicit restore/bootstrap after damaged file.
  saveManagedIds(touchManagedIds(emptyManagedIds(), 'guild', plan));
  assert.equal(loadManagedIds().guildId, 'guild');
  assert.deepEqual(fs.readdirSync(directory), ['managed-ids.json']);
});

test('private categories and channels have final ACLs in the create request', async () => {
  fs.rmSync(paths.managedIdsPath, { force: true });
  const fixture = fakeGuild();
  const registry = touchManagedIds(emptyManagedIds(), fixture.guild.id, plan);
  for (const role of fixture.guild.roles.cache.values()) registry.roles[role.name] = role.id;
  await _private.ensureSections(fixture.guild, _private.makeReport('resync'), registry);
  const privateNames = plan.sections.flatMap((section) => section.channels.filter((channel) => channel.private).map((channel) => channel.name));
  const administration = plan.sections.find((section) => section.channels.every((channel) => channel.private));
  const privateCreates = fixture.writes.filter((entry) => entry.operation === 'create' && [...privateNames, administration.category].includes(entry.payload.name));
  assert.equal(privateCreates.length, privateNames.length + 1);
  for (const { payload } of privateCreates) {
    assert.ok(payload.permissionOverwrites.some((entry) => entry.id === 'guild' && (entry.deny & P.ViewChannel) !== 0n));
    assert.ok(payload.permissionOverwrites.some((entry) => entry.id !== 'guild' && (entry.allow & P.ViewChannel) !== 0n));
  }
  assert.equal(fixture.writes.filter((entry) => entry.operation === 'policy').length, 0, 'creation already carries exact permissions');
});

test('IDs survive a later Discord failure and no stale category/channel ID falls back by name', async () => {
  fs.rmSync(paths.managedIdsPath, { force: true });
  const fixture = fakeGuild();
  const create = fixture.guild.channels.create;
  fixture.guild.channels.create = async (payload) => {
    if (fixture.writes.length) throw new Error('Discord failure on second create');
    return create(payload);
  };
  const registry = touchManagedIds(emptyManagedIds(), fixture.guild.id, plan);
  for (const role of fixture.guild.roles.cache.values()) registry.roles[role.name] = role.id;
  await assert.rejects(() => _private.ensureSections(fixture.guild, _private.makeReport('resync'), registry), /second create/);
  const firstSection = plan.sections[0];
  assert.equal(loadManagedIds().categories[firstSection.category], 'channel-1');
  const definition = firstSection.channels[0];
  fixture.channel({ id: 'replacement', name: definition.name, type: ChannelType.GuildText, parent: 'category' });
  registry.channels[`${firstSection.category}::${definition.type}::${definition.name}`] = 'deleted';
  assert.match(_private.findUniqueChannel(fixture.guild, 'category', definition, firstSection, registry).conflict, /registre/);
});

test('moved private channels carry the restriction in the same edit payload', async () => {
  fs.rmSync(paths.managedIdsPath, { force: true });
  const fixture = fakeGuild();
  const section = plan.sections.find((candidate) => candidate.channels.some((channel) => channel.private));
  const definition = section.channels.find((channel) => channel.private);
  const registry = touchManagedIds(emptyManagedIds(), fixture.guild.id, plan);
  const existing = fixture.channel({ id: 'existing', name: definition.name, type: ChannelType.GuildText, parent: 'outside' });
  registry.channels[`${section.category}::${definition.type}::${definition.name}`] = existing.id;
  for (const role of fixture.guild.roles.cache.values()) registry.roles[role.name] = role.id;
  await _private.ensureSections(fixture.guild, _private.makeReport('resync'), registry);
  const change = fixture.writes.find((entry) => entry.operation === 'edit' && entry.id === existing.id);
  assert.ok(change.changes.parent);
  assert.ok(change.changes.permissionOverwrites.some((entry) => entry.id === 'guild' && (entry.deny & P.ViewChannel) !== 0n));
});

test('capture preserves existing identities and reports missing IDs without replacing them by name', () => {
  const registry = touchManagedIds(emptyManagedIds(), 'guild', plan);
  const roleName = plan.roles[0].name;
  registry.roles[roleName] = 'owned';
  const { registry: captured, report } = captureManagedIdsFromDiscordSnapshot(plan, { guildId: 'guild', roles: [{ id: 'replacement', name: roleName }], channels: [] }, registry);
  assert.ok(report.conflicts.some((conflict) => conflict.includes('stored')));
  assert.equal(captured.roles[roleName], 'owned');
});

test('v1 historical aliases from moved channels remain compatible but active identity collisions are rejected', () => {
  const registry = emptyManagedIds();
  registry.channels['🌍 Communauté::GuildText::🧪・essais'] = 'same-channel';
  registry.channels['🗃️ Archives::GuildText::🧪・essais'] = 'same-channel';
  assert.doesNotThrow(() => touchManagedIds(normalizeManagedIds(registry), 'guild', plan));
  registry.channels['🗃️ Archives::GuildText::🎮・invitations'] = 'same-channel';
  assert.throws(() => touchManagedIds(registry, 'guild', plan), /Duplicate active/);
});

test('a stale capture cannot overwrite a newer bot registry revision', () => {
  const captureSnapshot = loadManagedIds();
  const botSnapshot = loadManagedIds();
  botSnapshot.stats.category = 'new-stats';
  saveManagedIds(botSnapshot);
  assert.throws(() => saveManagedIds(captureSnapshot), /changed concurrently/);
  assert.equal(loadManagedIds().stats.category, 'new-stats');
  assert.equal(fs.existsSync(`${paths.managedIdsPath}.lock`), false);
});

test('missing mappings in a provenanced registry do not authorize unique names', () => {
  const fixture = fakeGuild();
  const registry = touchManagedIds(emptyManagedIds(), fixture.guild.id, plan);
  assert.match(_private.findUniqueRole(fixture.guild, plan.roles[0].name, registry).conflict, /capture:ids/);
  const section = plan.sections[0];
  fixture.channel({ name: section.category, type: ChannelType.GuildCategory });
  const definition = section.channels[0];
  fixture.channel({ name: definition.name, type: ChannelType.GuildText, parent: 'unowned-category' });
  assert.match(_private.findUniqueChannel(fixture.guild, 'unowned-category', definition, section, registry).conflict, /capture:ids/);
});
