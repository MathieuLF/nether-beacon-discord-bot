const {
  ChannelType,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
  PermissionFlagsBits,
} = require('discord.js');
const { loadServerPlan } = require('./config');
const { withManagedWrite } = require('./managed-queue');
const {
  assertRegistryIdentity,
  channelRegistryKey,
  findProbableMatches,
  loadManagedIds,
  rememberCategoryId,
  rememberChannelId,
  rememberRoleId,
  saveManagedIds,
  touchManagedIds,
} = require('./managed-ids');

const plan = loadServerPlan();
const P = PermissionFlagsBits;

const managedReason = `${plan.managedMarker} managed sync`;

const explicitContentFilterMap = {
  Disabled: GuildExplicitContentFilter.Disabled,
  MembersWithoutRoles: GuildExplicitContentFilter.MembersWithoutRoles,
  AllMembers: GuildExplicitContentFilter.AllMembers,
};

const verificationLevelMap = {
  None: GuildVerificationLevel.None,
  Low: GuildVerificationLevel.Low,
  Medium: GuildVerificationLevel.Medium,
  High: GuildVerificationLevel.High,
  VeryHigh: GuildVerificationLevel.VeryHigh,
};

const channelTypeMap = {
  GuildText: ChannelType.GuildText,
  GuildVoice: ChannelType.GuildVoice,
};

const toBits = (permissionNames = []) =>
  permissionNames.reduce((bitfield, permissionName) => bitfield | BigInt(P[permissionName]), 0n);

const administratorBits = toBits(['Administrator']);

const presetBits = Object.fromEntries(
  Object.entries(plan.presets).map(([presetName, permissionNames]) => [presetName, toBits(permissionNames)]),
);

const makeReport = (mode) => ({
  mode,
  checkedAt: new Date().toISOString(),
  created: [],
  updated: [],
  warnings: [],
  conflicts: [],
  toCreate: [],
  toFix: [],
  ok: [],
  eventChannelId: null,
  logChannelId: null,
  summary: '',
});

const finalizeReport = (report) => {
  report.summary = [
    `${report.mode}`,
    `conformes=${report.ok.length}`,
    `créés=${report.created.length}`,
    `corrigés=${report.updated.length}`,
    `avertissements=${report.warnings.length}`,
    `conflits=${report.conflicts.length}`,
  ].join(' ');
  return report;
};

const summarizeItem = (prefix, value) => `${prefix}: ${value}`;

const uniqueByNames = (collection, names) => {
  const lookup = new Set(names);
  return collection.filter((item) => lookup.has(item.name));
};

const formatMatches = (collection) => [...collection.values()].map((item) => `${item.name} (${item.id})`).join(', ');

const rememberFix = (report, message) => {
  report.warnings.push(message);
  report.toFix.push(message);
};

const rememberCreate = (report, message) => {
  report.warnings.push(`manquant : ${message}`);
  report.toCreate.push(message);
};

const findUniqueRole = (guild, roleName, registry = null, _report = null) => {
  const storedId = registry?.roles?.[roleName];
  if (storedId) {
    const storedRole = guild.roles.cache.get(storedId);
    if (storedRole) {
      const duplicateNames = guild.roles.cache.filter((role) => role.name === roleName && role.id !== storedId);
      if (duplicateNames.size > 0) {
        return { conflict: `plusieurs rôles nommés ${roleName}, dont le rôle géré ${storedId}` };
      }
      return { value: storedRole, source: 'registry' };
    }

    return { conflict: `l'ID enregistré pour le rôle ${roleName} n'existe plus; recapture manuelle requise` };
  }

  const matches = guild.roles.cache.filter((role) => role.name === roleName);
  if (registry && matches.size) return { conflict: `rôle ${roleName} existant sans ID enregistré; capture:ids requis` };
  if (matches.size > 1) {
    return { conflict: `plusieurs rôles nommés ${roleName}` };
  }

  if (matches.size === 0) {
    const probable = findProbableMatches([...guild.roles.cache.values()], [roleName]);
    if (probable.length > 0) {
      return { conflict: `doublon probable pour le rôle ${roleName} : ${probable.map((role) => `${role.name} (${role.id})`).join(', ')}` };
    }
  }

  return { value: matches.first() || null };
};

const findUniqueCategory = (guild, sectionDef, registry = null, report = null) => {
  const storedId = registry?.categories?.[sectionDef.category];
  if (storedId) {
    const storedCategory = guild.channels.cache.get(storedId);
    if (storedCategory?.type === ChannelType.GuildCategory) {
      const duplicateNames = guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildCategory && channel.name === sectionDef.category && channel.id !== storedId,
      );
      const legacyNames = sectionDef.legacyNames || [];
      const legacyMatches = uniqueByNames(
        guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory && channel.id !== storedId),
        legacyNames,
      );

      if (duplicateNames.size > 0 && report) {
        rememberFix(report, `la catégorie ${sectionDef.category} existe aussi hors du registre géré : ${formatMatches(duplicateNames)}`);
      }
      if (legacyMatches.size > 0 && report) {
        rememberFix(report, `ancienne catégorie encore présente pour ${sectionDef.category} : ${formatMatches(legacyMatches)}`);
      }

      return { value: storedCategory, source: 'registry' };
    }

    return { conflict: `l'ID enregistré pour la catégorie ${sectionDef.category} n'existe plus ou a un mauvais type; réparation du registre requise` };
  }

  const desiredMatches = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === sectionDef.category,
  );
  if (registry && findProbableMatches([...guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).values()], [sectionDef.category, ...(sectionDef.legacyNames || [])]).length) {
    return { conflict: `catégorie ${sectionDef.category} existante sans ID enregistré; capture:ids requis` };
  }
  const legacyNames = sectionDef.legacyNames || [];
  const legacyMatches = uniqueByNames(
    guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory),
    legacyNames,
  );

  if (desiredMatches.size > 1) {
    return { conflict: `plusieurs catégories nommées ${sectionDef.category}` };
  }
  if (desiredMatches.size === 1) {
    if (legacyMatches.size > 0) {
      return { conflict: `la catégorie ${sectionDef.category} existe déjà pendant que d'anciens noms de catégorie sont encore présents` };
    }
    return { value: desiredMatches.first() };
  }

  if (legacyNames.length === 0) {
    return { value: null };
  }

  if (legacyMatches.size > 1) {
    return { conflict: `plusieurs anciennes catégories correspondent à ${sectionDef.category}` };
  }

  if (legacyMatches.size === 0) {
    const probable = findProbableMatches(
      [...guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).values()],
      [sectionDef.category, ...legacyNames],
    );
    if (probable.length > 0) {
      return { conflict: `doublon probable pour la catégorie ${sectionDef.category} : ${probable.map((channel) => `${channel.name} (${channel.id})`).join(', ')}` };
    }
  }

  return { value: legacyMatches.first() || null };
};

const findUniqueChannel = (guild, categoryId, channelDef, sectionDef = null, registry = null, report = null) => {
  const channelType = channelTypeMap[channelDef.type];
  const storedId = sectionDef ? registry?.channels?.[channelRegistryKey(sectionDef, channelDef)] : null;
  if (storedId) {
    const storedChannel = guild.channels.cache.get(storedId);
    if (storedChannel?.type === channelType) {
      const duplicateNames = guild.channels.cache.filter(
        (channel) => channel.type === channelType && channel.name === channelDef.name && channel.id !== storedId,
      );
      const legacyNames = channelDef.legacyNames || [];
      const legacyMatches = uniqueByNames(
        guild.channels.cache.filter((channel) => channel.type === channelType && channel.parentId === categoryId && channel.id !== storedId),
        legacyNames,
      );

      if (duplicateNames.size > 0 && report) {
        rememberFix(report, `le salon ${channelDef.name} existe aussi hors du registre géré : ${formatMatches(duplicateNames)}`);
      }
      if (legacyMatches.size > 0 && report) {
        rememberFix(report, `ancien salon encore présent pour ${channelDef.name} : ${formatMatches(legacyMatches)}`);
      }

      return { value: storedChannel, source: 'registry' };
    }

    return { conflict: `l'ID enregistré pour le salon ${channelDef.name} n'existe plus ou a un mauvais type; réparation du registre requise` };
  }

  const desiredMatches = guild.channels.cache.filter(
    (channel) => channel.type === channelType && channel.name === channelDef.name,
  );
  if (registry && findProbableMatches([...guild.channels.cache.filter((channel) => channel.type === channelType).values()], [channelDef.name, ...(channelDef.legacyNames || [])]).length) {
    return { conflict: `salon ${channelDef.name} existant sans ID enregistré; capture:ids requis` };
  }
  const matchesInCategory = desiredMatches.filter((channel) => channel.parentId === categoryId);
  const legacyNames = channelDef.legacyNames || [];
  const legacyMatches = uniqueByNames(
    guild.channels.cache.filter((channel) => channel.type === channelType && channel.parentId === categoryId),
    legacyNames,
  );

  if (matchesInCategory.size > 1) {
    return { conflict: `plusieurs salons nommés ${channelDef.name} dans la catégorie cible` };
  }

  if (matchesInCategory.size === 1) {
    if (legacyMatches.size > 0) {
      return { conflict: `le salon ${channelDef.name} existe déjà pendant que d'anciens noms de salon sont encore présents dans la catégorie cible` };
    }
    return { value: matchesInCategory.first() };
  }

  const allMatches = guild.channels.cache.filter(
    (channel) => channel.type === channelType && channel.name === channelDef.name,
  );

  if (allMatches.size === 0) {
    if (legacyMatches.size > 1) {
      return { conflict: `plusieurs anciens salons correspondent à ${channelDef.name} dans la catégorie cible` };
    }

    if (legacyMatches.size === 1) {
      return { value: legacyMatches.first() };
    }

    const probable = findProbableMatches(
      [...guild.channels.cache.filter((channel) => channel.type === channelType && channel.parentId === categoryId).values()],
      [channelDef.name, ...legacyNames],
    );
    if (probable.length > 0) {
      return { conflict: `doublon probable pour le salon ${channelDef.name} : ${probable.map((channel) => `${channel.name} (${channel.id})`).join(', ')}` };
    }

    return { value: null };
  }

  if (allMatches.size === 1) {
    const existing = allMatches.first();
    if (channelDef.allowExistingMove) {
      return { value: existing };
    }
    const currentParent = existing.parent?.name || 'no-category';
    return { conflict: `le salon ${channelDef.name} existe hors de ${currentParent}` };
  }

  return { conflict: `plusieurs salons nommés ${channelDef.name} existent sur le serveur` };
};

const expandGroups = (roleMap, groupNames) => {
  const roles = [];

  for (const groupName of groupNames) {
    const roleNames = plan.groups[groupName] || [];
    for (const roleName of roleNames) {
      if (roleMap[roleName]) roles.push(roleMap[roleName]);
    }
  }

  return roles;
};

const buildManagedTopic = (channelDef) => {
  if (channelDef.type !== 'GuildText') return undefined;
  const baseTopic = channelDef.topic?.trim();
  return baseTopic || undefined;
};

const managedTopics = new Set(
  plan.sections.flatMap((section) => section.channels.map(buildManagedTopic).filter(Boolean)),
);

const shouldUpdateManagedTopic = (currentTopic, desiredTopic) => {
  if (!desiredTopic) return false;
  if (!currentTopic) return true;
  if (currentTopic === desiredTopic) return false;
  if (currentTopic.includes('[managed:')) return true;
  return managedTopics.has(currentTopic);
};

const sortByPosition = (left, right) => {
  const positionDiff = (left.position || 0) - (right.position || 0);
  if (positionDiff !== 0) return positionDiff;
  return left.id.localeCompare(right.id);
};

const getIds = (channels) => channels.map((channel) => channel.id);

const hasDesiredRelativeOrder = (orderedChannels) => {
  const desiredIds = getIds(orderedChannels);
  const currentIds = getIds([...orderedChannels].sort(sortByPosition));
  return desiredIds.every((id, index) => currentIds[index] === id);
};

const ensureSectionChannelOrder = async (guild, section, orderedChannels, report) => {
  if (orderedChannels.length < 2 || hasDesiredRelativeOrder(orderedChannels)) {
    return false;
  }

  const firstPosition = Math.min(...orderedChannels.map((channel) => channel.position || 0));
  await guild.channels.setPositions(
    orderedChannels.map((channel, index) => ({
      channel: channel.id,
      position: firstPosition + index,
    })),
  );
  report.updated.push(`ordre des salons ${section.category}`);
  return true;
};

const hasDesiredContiguousOrder = (orderedChannels, allChannels) => {
  if (orderedChannels.length === 0) return true;
  const currentIds = getIds([...allChannels].sort(sortByPosition));
  const firstIndex = currentIds.indexOf(orderedChannels[0].id);
  if (firstIndex < 0) return false;
  return orderedChannels.every((channel, index) => currentIds[firstIndex + index] === channel.id);
};

const getGuildCategories = (guild) => [
  ...guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .values(),
];

const ensureManagedCategoryOrder = async (guild, orderedCategories, report) => {
  if (
    orderedCategories.length < 2
    || hasDesiredContiguousOrder(orderedCategories, getGuildCategories(guild))
  ) {
    return false;
  }

  const firstPosition = Math.min(...orderedCategories.map((category) => category.position || 0));
  await guild.channels.setPositions(
    orderedCategories.map((category, index) => ({
      channel: category.id,
      position: firstPosition + index,
    })),
  );
  report.updated.push('ordre des catégories gérées');
  return true;
};

const requiresAdministratorConflict = (role, roleDef) =>
  roleDef.permissions.includes('Administrator') && (role.permissions.bitfield & administratorBits) !== administratorBits;

const buildStrictRoleUpdates = (role, roleDef) => {
  const desiredPermissions = toBits(roleDef.permissions);
  const updates = {};
  if (role.color !== roleDef.color) updates.color = roleDef.color;
  if (role.hoist !== roleDef.hoist) updates.hoist = roleDef.hoist;
  if (desiredPermissions !== role.permissions.bitfield) updates.permissions = desiredPermissions;
  if (role.name !== roleDef.name) updates.name = roleDef.name;
  return updates;
};

const mergeDesiredOverwrite = (overwriteMap, overwriteId, allowBits, denyBits) => {
  const current = overwriteMap.get(overwriteId) || { id: overwriteId, allow: 0n, deny: 0n };
  overwriteMap.set(overwriteId, {
    id: overwriteId,
    allow: (current.allow | allowBits) & ~denyBits,
    deny: (current.deny | denyBits) & ~allowBits,
  });
};

const buildDesiredOverwrites = (roleMap, channelDef) => {
  const managedPresets = new Set([channelDef.preset]);
  if (channelDef.everyonePreset) managedPresets.add(channelDef.everyonePreset);
  if (channelDef.readPreset) managedPresets.add(channelDef.readPreset);
  const allManagedBits = [...managedPresets].reduce((bits, presetName) => bits | presetBits[presetName], 0n);
  const overwriteMap = new Map();
  const everyone = roleMap['@everyone'];

  if (channelDef.private) {
    mergeDesiredOverwrite(overwriteMap, everyone.id, 0n, allManagedBits | P.ViewChannel);
  } else if (channelDef.everyonePreset) {
    mergeDesiredOverwrite(overwriteMap, everyone.id, presetBits[channelDef.everyonePreset], 0n);
  }

  for (const role of expandGroups(roleMap, channelDef.groups)) {
    mergeDesiredOverwrite(overwriteMap, role.id, presetBits[channelDef.preset], 0n);
  }

  const readPresetName = channelDef.readPreset || 'defaultText';
  for (const role of expandGroups(roleMap, channelDef.readGroups || [])) {
    mergeDesiredOverwrite(overwriteMap, role.id, presetBits[readPresetName], 0n);
  }

  return [...overwriteMap.values()];
};

// A wholly private category inherits the intersection of child access groups.
// Mixed/public categories remain neutral; every child receives its own policy.
const categoryDefinition = (section) => {
  if (!section.channels.length || !section.channels.every((channel) => channel.private)) return null;
  const common = section.channels.reduce((groups, channel) => groups.filter((group) => channel.groups.includes(group)), section.channels[0].groups);
  return { name: section.category, private: true, groups: common, preset: 'defaultText' };
};

const hasSamePermissionOverwrites = (channel, nextOverwrites) => {
  if (channel.permissionOverwrites.cache.size !== nextOverwrites.length) return false;

  for (const nextOverwrite of nextOverwrites) {
    const current = channel.permissionOverwrites.cache.get(nextOverwrite.id);
    if (!current) return false;
    if (current.allow.bitfield !== nextOverwrite.allow) return false;
    if (current.deny.bitfield !== nextOverwrite.deny) return false;
  }

  return true;
};

const ensureManagedOverwrites = async (channel, roleMap, channelDef) => {
  const nextOverwrites = buildDesiredOverwrites(roleMap, channelDef);
  if (hasSamePermissionOverwrites(channel, nextOverwrites)) {
    return false;
  }

  await channel.permissionOverwrites.set(nextOverwrites, managedReason);
  return true;
};

const auditManagedOverwrites = (channel, roleMap, channelDef, report) => {
  const issues = [];
  const expected = buildDesiredOverwrites(roleMap, channelDef);
  if (!hasSamePermissionOverwrites(channel, expected)) {
    const expectedIds = new Set(expected.map((overwrite) => overwrite.id));
    const unexpected = channel.permissionOverwrites.cache
      .map((overwrite) => overwrite.id)
      .filter((id) => !expectedIds.has(id));
    issues.push('les permissions ne correspondent pas exactement au plan géré');
    if (unexpected.length > 0) issues.push(`overwrites inattendus : ${unexpected.join(', ')}`);
  }

  if (issues.length > 0) {
    rememberFix(report, `dérive de permissions sur ${channelDef.name} : ${issues.join('; ')}`);
  }
};

const auditManagedTopic = (channel, channelDef, report) => {
  if (channelDef.type !== 'GuildText') return;

  const desiredTopic = buildManagedTopic(channelDef);
  if (desiredTopic && channel.topic !== desiredTopic) {
    report.warnings.push(`dérive de sujet sur le salon ${channelDef.name}`);
  }
};

const buildRoleMap = (guild, registry, report) => {
  const roleMap = { '@everyone': guild.roles.everyone };
  let invalid = false;
  for (const roleDef of plan.roles) {
    const result = findUniqueRole(guild, roleDef.name, registry, report);
    if (result.conflict) {
      report.conflicts.push(result.conflict);
      invalid = true;
      continue;
    }
    if (!result.value) {
      report.conflicts.push(`le rôle géré ${roleDef.name} est introuvable`);
      invalid = true;
      continue;
    }
    roleMap[roleDef.name] = result.value;
  }
  return invalid ? null : roleMap;
};

const auditGuildSettings = (guild, report) => {
  const desiredExplicitContentFilter = explicitContentFilterMap[plan.guild.explicitContentFilter];
  const desiredVerificationLevel = verificationLevelMap[plan.guild.verificationLevel];

  if (guild.explicitContentFilter === desiredExplicitContentFilter) {
    report.ok.push('filtre de contenu explicite');
  } else {
    report.warnings.push(
      summarizeItem('filtre de contenu explicite', `${guild.explicitContentFilter} -> ${desiredExplicitContentFilter}`),
    );
  }

  if (guild.verificationLevel === desiredVerificationLevel) {
    report.ok.push('niveau de vérification');
  } else {
    report.warnings.push(
      summarizeItem('niveau de vérification', `${guild.verificationLevel} -> ${desiredVerificationLevel}`),
    );
  }
};

const ensureGuildSettings = async (guild, report) => {
  const desiredExplicitContentFilter = explicitContentFilterMap[plan.guild.explicitContentFilter];
  const desiredVerificationLevel = verificationLevelMap[plan.guild.verificationLevel];

  const updates = {};
  if (guild.explicitContentFilter !== desiredExplicitContentFilter) {
    updates.explicitContentFilter = desiredExplicitContentFilter;
  }
  if (guild.verificationLevel !== desiredVerificationLevel) {
    updates.verificationLevel = desiredVerificationLevel;
  }

  if (Object.keys(updates).length > 0) {
    await guild.edit({ ...updates, reason: managedReason });
    report.updated.push('paramètres serveur');
  } else {
    report.ok.push('paramètres serveur');
  }
};

const auditRoles = (guild, report, registry) => {
  for (const roleDef of plan.roles) {
    const result = findUniqueRole(guild, roleDef.name, registry, report);
    if (result.conflict) {
      report.conflicts.push(result.conflict);
      continue;
    }

    if (!result.value) {
      rememberCreate(report, `rôle ${roleDef.name}`);
      continue;
    }

    if (requiresAdministratorConflict(result.value, roleDef)) {
      report.conflicts.push(`le rôle ${roleDef.name} existe sans Administrator et ne sera pas promu automatiquement`);
      continue;
    }

    const changes = buildStrictRoleUpdates(result.value, roleDef);
    if (Object.keys(changes).length) {
      rememberFix(report, `le rôle ${roleDef.name} dérive du plan : ${Object.keys(changes).join(', ')}`);
    } else {
      report.ok.push(`rôle ${roleDef.name}`);
    }
  }
};

const ensureRoles = async (guild, report, registry) => {
  for (const roleDef of plan.roles) {
    const result = findUniqueRole(guild, roleDef.name, registry, report);
    if (result.conflict) {
      report.conflicts.push(result.conflict);
      continue;
    }

    const desiredPermissions = toBits(roleDef.permissions);

    if (!result.value) {
      const role = await guild.roles.create({
        name: roleDef.name,
        color: roleDef.color,
        hoist: roleDef.hoist,
        permissions: desiredPermissions,
        reason: managedReason,
      });
      report.created.push(`rôle ${roleDef.name}`);
      rememberRoleId(registry, roleDef.name, role.id);
      saveManagedIds(registry);
      continue;
    }

    const role = result.value;
    if (requiresAdministratorConflict(role, roleDef)) {
      report.conflicts.push(`le rôle ${roleDef.name} existe sans Administrator et demande une confirmation manuelle`);
      continue;
    }

    const updates = buildStrictRoleUpdates(role, roleDef);

    if (Object.keys(updates).length > 0) {
      await role.edit({ ...updates, reason: managedReason });
      report.updated.push(`rôle ${roleDef.name}`);
    } else {
      report.ok.push(`rôle ${roleDef.name}`);
    }

    rememberRoleId(registry, roleDef.name, role.id);
    saveManagedIds(registry);
  }
};

const auditSections = (guild, report, registry) => {
  const roleMap = buildRoleMap(guild, registry, report);
  if (!roleMap) return;

  const orderedCategories = [];

  for (const section of plan.sections) {
    const categoryResult = findUniqueCategory(guild, section, registry, report);
    if (categoryResult.conflict) {
      report.conflicts.push(categoryResult.conflict);
      continue;
    }

    if (!categoryResult.value) {
      rememberCreate(report, `catégorie ${section.category}`);
    } else if (categoryResult.value.name !== section.category) {
      rememberFix(report, `la catégorie ${categoryResult.value.name} sera renommée en ${section.category}`);
    } else {
      const policy = categoryDefinition(section);
      if (!policy || hasSamePermissionOverwrites(categoryResult.value, buildDesiredOverwrites(roleMap, policy))) {
        report.ok.push(`catégorie ${section.category}`);
      }
    }

    if (categoryResult.value && categoryDefinition(section)) {
      auditManagedOverwrites(categoryResult.value, roleMap, categoryDefinition(section), report);
    }

    if (categoryResult.value) orderedCategories.push(categoryResult.value);
    const targetCategoryId = categoryResult.value?.id || `missing:${section.category}`;

    for (const channelDef of section.channels) {
      const channelResult = findUniqueChannel(guild, targetCategoryId, channelDef, section, registry, report);

      if (channelResult.conflict) {
        report.conflicts.push(channelResult.conflict);
        continue;
      }

      if (!channelResult.value) {
        rememberCreate(report, `salon ${channelDef.name}`);
        continue;
      }

      if (channelDef.name === plan.logChannelName) {
        report.logChannelId = channelResult.value.id;
      }
      if (channelDef.name === plan.eventChannelName) {
        report.eventChannelId = channelResult.value.id;
      }

      if (channelResult.value.name !== channelDef.name) {
        rememberFix(report, `le salon ${channelResult.value.name} sera renommé en ${channelDef.name}`);
      } else if (channelResult.value.parentId !== targetCategoryId) {
        rememberFix(report, `le salon ${channelDef.name} sera déplacé vers ${section.category}`);
      }

      const issueCount = report.warnings.length;
      auditManagedTopic(channelResult.value, channelDef, report);
      auditManagedOverwrites(channelResult.value, roleMap, channelDef, report);
      if (report.warnings.length === issueCount && channelResult.value.name === channelDef.name && channelResult.value.parentId === targetCategoryId) {
        report.ok.push(`salon ${channelDef.name}`);
      }
    }
  }

  if (
    orderedCategories.length !== plan.sections.length
    || !hasDesiredContiguousOrder(orderedCategories, getGuildCategories(guild))
  ) {
    rememberFix(report, 'l’ordre des catégories gérées sera ajusté');
  }
};

const ensureSections = async (guild, report, registry) => {
  const roleMap = buildRoleMap(guild, registry, report);
  if (!roleMap) return;

  const orderedCategories = [];

  for (const section of plan.sections) {
    let category;
    const categoryResult = findUniqueCategory(guild, section, registry, report);

    if (categoryResult.conflict) {
      report.conflicts.push(categoryResult.conflict);
      continue;
    }

    if (!categoryResult.value) {
      category = await guild.channels.create({
        name: section.category,
        type: ChannelType.GuildCategory,
        reason: managedReason,
        permissionOverwrites: categoryDefinition(section) ? buildDesiredOverwrites(roleMap, categoryDefinition(section)) : [],
      });
      report.created.push(`catégorie ${section.category}`);
    } else {
      category = categoryResult.value;
      if (category.name !== section.category) {
        await category.edit({ name: section.category, reason: managedReason });
        report.updated.push(`catégorie ${section.category}`);
      } else {
        report.ok.push(`catégorie ${section.category}`);
      }
    }
    rememberCategoryId(registry, section, category.id);
    saveManagedIds(registry);
    if (categoryDefinition(section) && await ensureManagedOverwrites(category, roleMap, categoryDefinition(section))) {
      report.ok = report.ok.filter((item) => item !== `catégorie ${section.category}`);
      report.updated.push(`permissions de la catégorie ${section.category}`);
    }
    orderedCategories.push(category);

    const orderedChannels = [];

    for (const channelDef of section.channels) {
      const channelResult = findUniqueChannel(guild, category.id, channelDef, section, registry, report);

      if (channelResult.conflict) {
        report.conflicts.push(channelResult.conflict);
        continue;
      }

      const topic = buildManagedTopic(channelDef);
      const payload = {
        name: channelDef.name,
        type: channelTypeMap[channelDef.type],
        parent: category.id,
        reason: managedReason,
        permissionOverwrites: buildDesiredOverwrites(roleMap, channelDef),
      };

      if (channelDef.type === 'GuildText' && topic) {
        payload.topic = topic;
      }

      let channel = channelResult.value;

      if (!channel) {
        channel = await guild.channels.create(payload);
        report.created.push(`salon ${channelDef.name}`);
      } else {
        const editPayload = {};
        if (channel.parentId !== category.id) {
          editPayload.parent = category.id;
        }
        if (channel.name !== channelDef.name) {
          editPayload.name = channelDef.name;
        }
        if (channelDef.type === 'GuildText') {
          const desiredTopic = buildManagedTopic(channelDef);
          if (shouldUpdateManagedTopic(channel.topic, desiredTopic)) {
            editPayload.topic = desiredTopic;
          }
        }

        if (Object.keys(editPayload).length > 0) {
          await channel.edit({ ...editPayload, permissionOverwrites: buildDesiredOverwrites(roleMap, channelDef), reason: managedReason });
          report.updated.push(`salon ${channelDef.name}`);
        } else {
          report.ok.push(`salon ${channelDef.name}`);
        }
      }

      orderedChannels.push(channel);
      rememberChannelId(registry, section, channelDef, channel.id);
      saveManagedIds(registry);
      if (await ensureManagedOverwrites(channel, roleMap, channelDef)) {
        report.ok = report.ok.filter((item) => item !== `salon ${channelDef.name}`);
        report.updated.push(`permissions du salon ${channelDef.name}`);
      }

      if (channelDef.name === plan.logChannelName) {
        report.logChannelId = channel.id;
      }
      if (channelDef.name === plan.eventChannelName) {
        report.eventChannelId = channel.id;
      }
    }

    await ensureSectionChannelOrder(guild, section, orderedChannels, report);
  }

  await ensureManagedCategoryOrder(guild, orderedCategories, report);
};

const findManagedChannelIdByName = (guild, managedChannelName) => {
  const registry = assertRegistryIdentity(loadManagedIds(), guild.id, plan);

  for (const section of plan.sections) {
    const channelDef = section.channels.find((channel) => channel.name === managedChannelName);
    if (!channelDef) continue;

    const storedId = registry.channels?.[channelRegistryKey(section, channelDef)];
    if (storedId) {
      return guild.channels.cache.get(storedId)?.type === channelTypeMap[channelDef.type] ? storedId : null;
    }

    // Message destinations must be owned too; never route a missing ID by name.
    return null;
  }
  return null;
};

const findManagedLogChannelId = (guild) => findManagedChannelIdByName(guild, plan.logChannelName);

const prepareGuild = async (guild) => {
  await guild.roles.fetch();
  await guild.channels.fetch();
};

const auditGuild = async (guild) => {
  const report = makeReport('audit');
  const registry = assertRegistryIdentity(loadManagedIds(), guild.id, plan);
  await prepareGuild(guild);
  auditGuildSettings(guild, report);
  auditRoles(guild, report, registry);
  auditSections(guild, report, registry);
  if (!report.logChannelId) report.logChannelId = findManagedLogChannelId(guild);
  if (!report.eventChannelId) report.eventChannelId = findManagedChannelIdByName(guild, plan.eventChannelName);
  return finalizeReport(report);
};

const syncGuild = (guild) => withManagedWrite(async () => {
  const report = makeReport('resync');
  const registry = assertRegistryIdentity(loadManagedIds(), guild.id, plan);
  await prepareGuild(guild);
  if (!registry.guildId && (
    [...guild.roles.cache.values()].some((role) => plan.roles.some((definition) => definition.name === role.name))
    || [...guild.channels.cache.values()].some((channel) => plan.sections.some((section) => section.category === channel.name))
  )) throw new Error('Ressources existantes sans registre : vérifie le serveur puis exécute capture:ids.');
  touchManagedIds(registry, guild.id, plan);
  await ensureGuildSettings(guild, report);
  await ensureRoles(guild, report, registry);
  await guild.roles.fetch();
  await guild.channels.fetch();
  await ensureSections(guild, report, registry);
  await guild.channels.fetch();
  saveManagedIds(registry);
  if (!report.logChannelId) report.logChannelId = findManagedLogChannelId(guild);
  if (!report.eventChannelId) report.eventChannelId = findManagedChannelIdByName(guild, plan.eventChannelName);
  return finalizeReport(report);
});

const formatReportForChat = (report) => {
  const lines = [
    `**📋 Rapport ${report.mode}**`,
    '',
    `- **Résumé** : ${report.summary}`,
    `- **OK** : ${report.ok.length} éléments conformes`,
  ];

  const appendSection = (title, items, limit = 8) => {
    if (!items.length) return;
    lines.push('');
    lines.push(`**${title}**`);
    for (const item of items.slice(0, limit)) lines.push(`- ${item}`);
    if (items.length > limit) lines.push(`- ... +${items.length - limit}`);
  };

  const plannedWarnings = new Set([...report.toCreate, ...report.toFix, ...report.toCreate.map((item) => `manquant : ${item}`)]);
  const otherWarnings = report.warnings.filter((warning) => !plannedWarnings.has(warning));

  appendSection('⛔ Conflits', report.conflicts);
  appendSection('➕ À créer', report.toCreate);
  appendSection('🛠️ À corriger', report.toFix);
  appendSection('⚠️ Avertissements', otherWarnings, 5);
  appendSection('✅ Créé', report.created);
  appendSection('🔁 Mis à jour', report.updated);

  return lines.join('\n').slice(0, 1900);
};

module.exports = {
  plan,
  auditGuild,
  syncGuild,
  formatReportForChat,
  findManagedChannelIdByName,
  findManagedLogChannelId,
  _private: {
    categoryDefinition,
    ensureSections,
    auditSections,
    makeReport,
    buildDesiredOverwrites,
    buildRoleMap,
    buildStrictRoleUpdates,
    ensureManagedOverwrites,
    ensureManagedCategoryOrder,
    ensureSectionChannelOrder,
    findUniqueChannel,
    hasDesiredContiguousOrder,
    hasDesiredRelativeOrder,
    hasSamePermissionOverwrites,
    findUniqueRole,
    shouldUpdateManagedTopic,
  },
};
