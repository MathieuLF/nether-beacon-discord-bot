const fs = require('fs');
const { ChannelType } = require('discord.js');
const { paths } = require('./config');

const registryVersion = 1;

const emptyManagedIds = () => ({
  version: registryVersion,
  guildId: null,
  managedMarker: null,
  updatedAt: null,
  roles: {},
  categories: {},
  channels: {},
});

const normalizeManagedIds = (value) => ({
  ...emptyManagedIds(),
  ...(value && typeof value === 'object' ? value : {}),
  roles: value?.roles && typeof value.roles === 'object' ? value.roles : {},
  categories: value?.categories && typeof value.categories === 'object' ? value.categories : {},
  channels: value?.channels && typeof value.channels === 'object' ? value.channels : {},
});

const loadManagedIds = () => {
  try {
    return normalizeManagedIds(JSON.parse(fs.readFileSync(paths.managedIdsPath, 'utf8')));
  } catch (error) {
    return emptyManagedIds();
  }
};

const saveManagedIds = (registry) => {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(paths.managedIdsPath, JSON.stringify(normalizeManagedIds(registry), null, 2), 'utf8');
};

const touchManagedIds = (registry, guildId, plan) => {
  registry.version = registryVersion;
  registry.guildId = guildId;
  registry.managedMarker = plan.managedMarker;
  registry.updatedAt = new Date().toISOString();
  registry.roles ||= {};
  registry.categories ||= {};
  registry.channels ||= {};
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
  const registry = touchManagedIds(normalizeManagedIds(currentRegistry), snapshot.guildId, plan);
  const report = {
    capturedRoles: 0,
    capturedCategories: 0,
    capturedChannels: 0,
    warnings: [],
    conflicts: [],
  };

  for (const roleDef of plan.roles) {
    const role = findSnapshotRole(snapshot.roles, roleDef, report);
    if (!role) continue;
    rememberRoleId(registry, roleDef.name, role.id);
    report.capturedRoles += 1;
  }

  for (const section of plan.sections) {
    const category = findSnapshotCategory(snapshot.channels, section, report);
    if (!category) continue;
    rememberCategoryId(registry, section, category.id);
    report.capturedCategories += 1;

    for (const channelDef of section.channels) {
      const channel = findSnapshotChannel(snapshot.channels, section, channelDef, category, report);
      if (!channel) continue;
      rememberChannelId(registry, section, channelDef, channel.id);
      report.capturedChannels += 1;
    }
  }

  return { registry, report };
};

module.exports = {
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
