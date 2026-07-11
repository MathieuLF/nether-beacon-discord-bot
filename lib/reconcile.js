const {
  ChannelType,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
  PermissionFlagsBits,
} = require('discord.js');
const { loadServerPlan } = require('./config');
const {
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

const findUniqueRole = (guild, roleName, registry = null, report = null) => {
  const storedId = registry?.roles?.[roleName];
  if (storedId) {
    const storedRole = guild.roles.cache.get(storedId);
    if (storedRole) {
      const duplicateNames = guild.roles.cache.filter((role) => role.name === roleName && role.id !== storedId);
      if (duplicateNames.size > 0 && report) {
      rememberFix(report, `le rôle ${roleName} existe aussi hors du registre géré : ${formatMatches(duplicateNames)}`);
      }
      return { value: storedRole, source: 'registry' };
    }

    if (report) {
      rememberFix(report, `l'ID enregistré pour le rôle ${roleName} n'existe plus; recherche par nom`);
    }
  }

  const matches = guild.roles.cache.filter((role) => role.name === roleName);
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

    if (report) {
      rememberFix(report, `l'ID enregistré pour la catégorie ${sectionDef.category} n'existe plus; recherche par nom`);
    }
  }

  const desiredMatches = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === sectionDef.category,
  );
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

    if (report) {
      rememberFix(report, `l'ID enregistré pour le salon ${channelDef.name} n'existe plus; recherche par nom`);
    }
  }

  const desiredMatches = guild.channels.cache.filter(
    (channel) => channel.type === channelType && channel.name === channelDef.name,
  );
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
    if (legacyNames.length === 0) {
      return { value: null };
    }

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

const requiresAdministratorConflict = (role, roleDef) =>
  roleDef.permissions.includes('Administrator') && (role.permissions.bitfield & administratorBits) !== administratorBits;

const mergeOverwrite = (channel, overwriteId, managedBits, nextAllowBits, nextDenyBits) => {
  const current = channel.permissionOverwrites.cache.get(overwriteId);
  const allow = ((current?.allow.bitfield || 0n) & ~managedBits) | nextAllowBits;
  const deny = ((current?.deny.bitfield || 0n) & ~managedBits) | nextDenyBits;

  return {
    id: overwriteId,
    allow,
    deny,
  };
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
  const managedBits = new Set([channelDef.preset]);
  if (channelDef.everyonePreset) managedBits.add(channelDef.everyonePreset);
  if (channelDef.readPreset) managedBits.add(channelDef.readPreset);
  const allManagedBits = [...managedBits].reduce((bits, presetName) => bits | presetBits[presetName], 0n);

  const overwriteMap = new Map(
    channel.permissionOverwrites.cache.map((overwrite) => [
      overwrite.id,
      {
        id: overwrite.id,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
        type: overwrite.type,
      },
    ]),
  );

  const everyone = roleMap['@everyone'];
  if (channelDef.private) {
    overwriteMap.set(
      everyone.id,
      mergeOverwrite(channel, everyone.id, allManagedBits, 0n, allManagedBits),
    );
  } else if (channelDef.everyonePreset) {
    const everyoneBits = presetBits[channelDef.everyonePreset];
    overwriteMap.set(
      everyone.id,
      mergeOverwrite(channel, everyone.id, everyoneBits, everyoneBits, 0n),
    );
  }

  for (const role of expandGroups(roleMap, channelDef.groups)) {
    const allowBits = presetBits[channelDef.preset];
    overwriteMap.set(role.id, mergeOverwrite(channel, role.id, allowBits, allowBits, 0n));
  }

  const readPresetName = channelDef.readPreset || 'defaultText';
  for (const role of expandGroups(roleMap, channelDef.readGroups || [])) {
    const allowBits = presetBits[readPresetName];
    overwriteMap.set(role.id, mergeOverwrite(channel, role.id, allowBits, allowBits, 0n));
  }

  const nextOverwrites = [...overwriteMap.values()];
  if (hasSamePermissionOverwrites(channel, nextOverwrites)) {
    return false;
  }

  await channel.permissionOverwrites.set(nextOverwrites, managedReason);
  return true;
};

const auditOverwriteAllow = (channel, overwriteId, expectedBits, label, issues) => {
  const current = channel.permissionOverwrites.cache.get(overwriteId);
  const allowBits = current?.allow.bitfield || 0n;
  const denyBits = current?.deny.bitfield || 0n;

  if ((allowBits & expectedBits) !== expectedBits || (denyBits & expectedBits) !== 0n) {
    issues.push(`${label} devrait autoriser les permissions gérées`);
  }
};

const auditOverwriteDeny = (channel, overwriteId, expectedBits, label, issues) => {
  const current = channel.permissionOverwrites.cache.get(overwriteId);
  const allowBits = current?.allow.bitfield || 0n;
  const denyBits = current?.deny.bitfield || 0n;

  if ((allowBits & expectedBits) !== 0n || (denyBits & expectedBits) !== expectedBits) {
    issues.push(`${label} devrait refuser les permissions gérées`);
  }
};

const auditManagedOverwrites = (channel, roleMap, channelDef, report) => {
  const managedBits = new Set([channelDef.preset]);
  if (channelDef.everyonePreset) managedBits.add(channelDef.everyonePreset);
  if (channelDef.readPreset) managedBits.add(channelDef.readPreset);
  const allManagedBits = [...managedBits].reduce((bits, presetName) => bits | presetBits[presetName], 0n);
  const issues = [];
  const everyone = roleMap['@everyone'];

  if (channelDef.private) {
    auditOverwriteDeny(channel, everyone.id, allManagedBits, '@everyone', issues);
  } else if (channelDef.everyonePreset) {
    auditOverwriteAllow(channel, everyone.id, presetBits[channelDef.everyonePreset], '@everyone', issues);
  }

  for (const role of expandGroups(roleMap, channelDef.groups)) {
    auditOverwriteAllow(channel, role.id, presetBits[channelDef.preset], role.name, issues);
  }

  const readPresetName = channelDef.readPreset || 'defaultText';
  for (const role of expandGroups(roleMap, channelDef.readGroups || [])) {
    auditOverwriteAllow(channel, role.id, presetBits[readPresetName], role.name, issues);
  }

  if (issues.length > 0) {
    report.warnings.push(`dérive de permissions sur le salon ${channelDef.name} : ${issues.join('; ')}`);
  }
};

const auditManagedTopic = (channel, channelDef, report) => {
  if (channelDef.type !== 'GuildText') return;

  const desiredTopic = buildManagedTopic(channelDef);
  if (desiredTopic && channel.topic !== desiredTopic) {
    report.warnings.push(`dérive de sujet sur le salon ${channelDef.name}`);
  }
};

const buildRoleMap = (guild) => {
  const roleMap = { '@everyone': guild.roles.everyone };
  for (const role of guild.roles.cache.values()) {
    roleMap[role.name] = role;
  }
  return roleMap;
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

    if (result.value.name !== roleDef.name) {
      rememberFix(report, `le rôle ${result.value.name} sera renommé en ${roleDef.name}`);
    }

    report.ok.push(`rôle ${roleDef.name}`);
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
      continue;
    }

    const role = result.value;
    if (requiresAdministratorConflict(role, roleDef)) {
      report.conflicts.push(`le rôle ${roleDef.name} existe sans Administrator et demande une confirmation manuelle`);
      continue;
    }

    const updates = {};
    const mergedPermissions = role.permissions.bitfield | desiredPermissions;

    if (role.color !== roleDef.color) updates.color = roleDef.color;
    if (role.hoist !== roleDef.hoist) updates.hoist = roleDef.hoist;
    if (mergedPermissions !== role.permissions.bitfield) updates.permissions = mergedPermissions;
    if (role.name !== roleDef.name) updates.name = roleDef.name;

    if (Object.keys(updates).length > 0) {
      await role.edit({ ...updates, reason: managedReason });
      report.updated.push(`rôle ${roleDef.name}`);
    } else {
      report.ok.push(`rôle ${roleDef.name}`);
    }

    rememberRoleId(registry, roleDef.name, role.id);
  }
};

const auditSections = (guild, report, registry) => {
  const roleMap = buildRoleMap(guild);

  for (const section of plan.sections) {
    const categoryResult = findUniqueCategory(guild, section, registry, report);
    if (categoryResult.conflict) {
      report.conflicts.push(categoryResult.conflict);
      continue;
    }

    if (!categoryResult.value) {
      rememberCreate(report, `catégorie ${section.category}`);
      continue;
    }

    if (categoryResult.value.name !== section.category) {
      rememberFix(report, `la catégorie ${categoryResult.value.name} sera renommée en ${section.category}`);
    } else {
      report.ok.push(`catégorie ${section.category}`);
    }

    for (const channelDef of section.channels) {
      const channelResult = findUniqueChannel(guild, categoryResult.value.id, channelDef, section, registry, report);

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
      } else if (channelResult.value.parentId !== categoryResult.value.id) {
        rememberFix(report, `le salon ${channelDef.name} sera déplacé vers ${section.category}`);
      } else {
        report.ok.push(`salon ${channelDef.name}`);
      }

      auditManagedTopic(channelResult.value, channelDef, report);
      auditManagedOverwrites(channelResult.value, roleMap, channelDef, report);
    }
  }
};

const ensureSections = async (guild, report, registry) => {
  for (const section of plan.sections) {
    let category = null;
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

    const roleMap = buildRoleMap(guild);
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
          await channel.edit({ ...editPayload, reason: managedReason });
          report.updated.push(`salon ${channelDef.name}`);
        } else {
          report.ok.push(`salon ${channelDef.name}`);
        }
      }

      orderedChannels.push(channel);
      await ensureManagedOverwrites(channel, roleMap, channelDef);
      rememberChannelId(registry, section, channelDef, channel.id);

      if (channelDef.name === plan.logChannelName) {
        report.logChannelId = channel.id;
      }
      if (channelDef.name === plan.eventChannelName) {
        report.eventChannelId = channel.id;
      }
    }

    await ensureSectionChannelOrder(guild, section, orderedChannels, report);
  }
};

const findManagedChannelIdByName = (guild, managedChannelName) => {
  const registry = loadManagedIds();

  for (const section of plan.sections) {
    const channelDef = section.channels.find((channel) => channel.name === managedChannelName);
    if (!channelDef) continue;

    const storedId = registry.channels?.[channelRegistryKey(section, channelDef)];
    if (storedId && guild.channels.cache.get(storedId)) {
      return storedId;
    }

    const categoryResult = findUniqueCategory(guild, section);
    if (categoryResult.value) {
      const channelResult = findUniqueChannel(
        guild,
        categoryResult.value.id,
        channelDef,
      );
      if (channelResult.value) return channelResult.value.id;
    }
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
  const registry = loadManagedIds();
  await prepareGuild(guild);
  auditGuildSettings(guild, report);
  auditRoles(guild, report, registry);
  auditSections(guild, report, registry);
  if (!report.logChannelId) report.logChannelId = findManagedLogChannelId(guild);
  if (!report.eventChannelId) report.eventChannelId = findManagedChannelIdByName(guild, plan.eventChannelName);
  return finalizeReport(report);
};

const syncGuild = async (guild) => {
  const report = makeReport('resync');
  const registry = touchManagedIds(loadManagedIds(), guild.id, plan);
  await prepareGuild(guild);
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
};

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
    ensureManagedOverwrites,
    ensureSectionChannelOrder,
    hasDesiredRelativeOrder,
    hasSamePermissionOverwrites,
    shouldUpdateManagedTopic,
  },
};
