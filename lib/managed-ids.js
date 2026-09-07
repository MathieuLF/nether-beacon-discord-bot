const fs = require('fs');
const { ChannelType } = require('discord.js');
const { paths } = require('./config');
const { writeJsonAtomic } = require('./atomic-json');

const registryVersion = 1;

const emptyManagedIds = () => ({
  version: registryVersion,
  guildId: null,
  managedMarker: null,
  updatedAt: null,
  roles: {},
  categories: {},
  channels: {},
  stats: {},
  revision: 0,
});

const normalizeManagedIds = (value) => {
  const isObject = (item) => item && typeof item === 'object' && !Array.isArray(item);
  if (!isObject(value) || value.version !== registryVersion) throw new Error('Invalid managed ID registry version or format');
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0)) throw new Error('Invalid managed ID registry revision');
  for (const field of ['guildId', 'managedMarker']) {
    if (value[field] !== null && (typeof value[field] !== 'string' || !value[field])) {
      throw new Error(`Invalid managed ID registry ${field}`);
    }
  }
  for (const field of ['roles', 'categories', 'channels', 'stats']) {
    if (field === 'stats' && value.stats === undefined) continue; // Version 1 before Stats IDs.
    if (!isObject(value[field]) || Object.values(value[field]).some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error(`Invalid managed ID registry ${field}`);
    }
  }
  return { ...emptyManagedIds(), ...value, stats: { ...value.stats } };
};

const loadManagedIds = () => {
  try {
    return normalizeManagedIds(JSON.parse(fs.readFileSync(paths.managedIdsPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyManagedIds();
    throw new Error('Cannot read managed ID registry; restore or repair it before continuing', { cause: error });
  }
};

const saveManagedIds = (registry) => {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  const lockPath = `${paths.managedIdsPath}.lock`;
  let descriptor;
  try {
    // The lock covers the compare-and-swap, across capture and bot processes.
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const current = loadManagedIds();
    const normalized = normalizeManagedIds(registry);
    if (current.revision !== normalized.revision) throw new Error('Managed registry changed concurrently; reload before retrying');
    normalized.revision += 1;
    writeJsonAtomic(paths.managedIdsPath, normalized);
    registry.revision = normalized.revision;
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
      fs.unlinkSync(lockPath);
    }
  }
};

const assertRegistryIdentity = (registry, guildId, plan) => {
  if (registry.guildId && registry.guildId !== guildId) throw new Error('Managed ID registry belongs to another guild');
  if (registry.managedMarker && registry.managedMarker !== plan.managedMarker) throw new Error('Managed ID registry belongs to another server plan');
  // Version 1 retained old keys after plan moves. Those historical aliases are
  // harmless; only identities still addressed by this plan must be distinct.
  const activeIds = [
    ...plan.roles.map((role) => registry.roles[role.name]),
    ...plan.sections.map((section) => registry.categories[section.category]),
    ...plan.sections.flatMap((section) => section.channels.map((channel) => registry.channels[channelRegistryKey(section, channel)])),
    ...Object.values(registry.stats || {}),
  ].filter(Boolean);
  if (new Set(activeIds).size !== activeIds.length) throw new Error('Duplicate active identities in managed registry');
  return registry;
};

const touchManagedIds = (registry, guildId, plan) => {
  assertRegistryIdentity(registry, guildId, plan);
  registry.version = registryVersion;
  registry.guildId = guildId;
  registry.managedMarker = plan.managedMarker;
  registry.updatedAt = new Date().toISOString();
  registry.roles ||= {};
  registry.categories ||= {};
  registry.channels ||= {};
  registry.stats ||= {};
  return registry;
};

const channelRegistryKey = (section, channelDef) => `${section.category}::${channelDef.type}::${channelDef.name}`;

const rememberRoleId = (registry, roleName, roleId) => {
  registry.roles[roleName] = roleId;
};

const rememberCategoryId = (registry, section, categoryId) => {
  registry.categories[section.category] = categoryId;
};

const rememberChannelId = (registry, section, channelDef, channelId) => {
  registry.channels[channelRegistryKey(section, channelDef)] = channelId;
};

const normalizeManagedName = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .toLowerCase();

const sameManagedName = (left, right) => normalizeManagedName(left) === normalizeManagedName(right);

const findProbableMatches = (items, names, excludedIds = new Set()) => {
  const normalizedNames = new Set(names.map(normalizeManagedName));
  return items.filter((item) => !excludedIds.has(item.id) && normalizedNames.has(normalizeManagedName(item.name)));
};

const formatNames = (items) => items.map((item) => `${item.name} (${item.id})`).join(', ');

const findSnapshotRole = (roles, roleDef, report) => {
  const exact = roles.filter((role) => role.name === roleDef.name);
  if (exact.length > 1) {
    report.conflicts.push(`multiple roles named ${roleDef.name}`);
    return null;
  }
  if (exact.length === 1) return exact[0];

  const probable = findProbableMatches(roles, [roleDef.name]);
  if (probable.length > 0) {
    report.conflicts.push(`probable duplicate role for ${roleDef.name}: ${formatNames(probable)}`);
  }
  return null;
};

const findSnapshotCategory = (channels, section, report) => {
  const categories = channels.filter((channel) => channel.type === ChannelType.GuildCategory);
  const exact = categories.filter((channel) => channel.name === section.category);
  const legacy = categories.filter((channel) => (section.legacyNames || []).includes(channel.name));

  if (exact.length > 1) {
    report.conflicts.push(`multiple categories named ${section.category}`);
    return null;
  }

  if (exact.length === 1) {
    if (legacy.length > 0) {
      report.warnings.push(`category ${section.category} exists while legacy category names are still present`);
    }
    return exact[0];
  }

  if (legacy.length > 1) {
    report.conflicts.push(`multiple legacy categories match ${section.category}`);
    return null;
  }

  if (legacy.length === 1) return legacy[0];

  const probable = findProbableMatches(categories, [section.category, ...(section.legacyNames || [])]);
  if (probable.length > 0) {
    report.conflicts.push(`probable duplicate category for ${section.category}: ${formatNames(probable)}`);
  }
  return null;
};

const snapshotChannelTypeMap = {
  GuildText: ChannelType.GuildText,
  GuildVoice: ChannelType.GuildVoice,
};

const findSnapshotChannel = (channels, section, channelDef, category, report) => {
  const type = snapshotChannelTypeMap[channelDef.type];
  const typed = channels.filter((channel) => channel.type === type);
  const inCategory = typed.filter((channel) => channel.parent_id === category.id);
  const exactInCategory = inCategory.filter((channel) => channel.name === channelDef.name);
  const legacyInCategory = inCategory.filter((channel) => (channelDef.legacyNames || []).includes(channel.name));

  if (exactInCategory.length > 1) {
    report.conflicts.push(`multiple channels named ${channelDef.name} in target category`);
    return null;
  }

  if (exactInCategory.length === 1) {
    if (legacyInCategory.length > 0) {
      report.warnings.push(`channel ${channelDef.name} exists while legacy channel names are still present`);
    }
    return exactInCategory[0];
  }

  if (legacyInCategory.length > 1) {
    report.conflicts.push(`multiple legacy channels match ${channelDef.name} in target category`);
    return null;
  }

  if (legacyInCategory.length === 1) return legacyInCategory[0];

  const exactAnywhere = typed.filter((channel) => channel.name === channelDef.name);
  if (exactAnywhere.length === 1 && channelDef.allowExistingMove) return exactAnywhere[0];
  if (exactAnywhere.length > 0) {
    report.conflicts.push(`channel ${channelDef.name} exists outside target category`);
    return null;
  }

  const probable = findProbableMatches(inCategory, [channelDef.name, ...(channelDef.legacyNames || [])]);
  if (probable.length > 0) {
    report.conflicts.push(`probable duplicate channel for ${channelDef.name}: ${formatNames(probable)}`);
  }
  return null;
};

const captureManagedIdsFromDiscordSnapshot = (plan, snapshot, currentRegistry = emptyManagedIds()) => {
  const registry = touchManagedIds(structuredClone(normalizeManagedIds(currentRegistry)), snapshot.guildId, plan);
  const report = {
    capturedRoles: 0,
    capturedCategories: 0,
    capturedChannels: 0,
    warnings: [],
    conflicts: [],
  };

  const existing = (items, storedId, type, label, fallback) => {
    if (!storedId) return fallback();
    const item = items.find((candidate) => candidate.id === storedId && (type === undefined || candidate.type === type));
    if (!item) report.conflicts.push(`stored ${label} is missing or invalid; repair registry explicitly`);
    return item || null;
  };

  for (const roleDef of plan.roles) {
    const role = existing(snapshot.roles, registry.roles[roleDef.name], undefined, roleDef.name, () => findSnapshotRole(snapshot.roles, roleDef, report));
    if (!role) continue;
    rememberRoleId(registry, roleDef.name, role.id);
    report.capturedRoles += 1;
  }

  for (const section of plan.sections) {
    const category = existing(snapshot.channels, registry.categories[section.category], ChannelType.GuildCategory, section.category, () => findSnapshotCategory(snapshot.channels, section, report));
    if (!category) continue;
    rememberCategoryId(registry, section, category.id);
    report.capturedCategories += 1;

    for (const channelDef of section.channels) {
      const channel = existing(snapshot.channels, registry.channels[channelRegistryKey(section, channelDef)], snapshotChannelTypeMap[channelDef.type], channelDef.name, () => findSnapshotChannel(snapshot.channels, section, channelDef, category, report));
      if (!channel) continue;
      rememberChannelId(registry, section, channelDef, channel.id);
      report.capturedChannels += 1;
    }
  }

  require('./stats-identity').captureStatsIds(snapshot.channels, registry, report);

  return { registry, report };
};

module.exports = {
  assertRegistryIdentity,
  normalizeManagedIds,
  captureManagedIdsFromDiscordSnapshot,
  channelRegistryKey,
  emptyManagedIds,
  findProbableMatches,
  loadManagedIds,
  normalizeManagedName,
  rememberCategoryId,
  rememberChannelId,
  rememberRoleId,
  sameManagedName,
  saveManagedIds,
  touchManagedIds,
};
