const { PermissionFlagsBits } = require('discord.js');

const hasRoleId = (member, roleId) => {
  if (!roleId) return false;
  const roles = member?.roles?.cache;
  if (!roles) return false;
  if (typeof roles.has === 'function' && roles.has(roleId)) return true;
  if (typeof roles.some === 'function') return roles.some((role) => role.id === roleId);
  if (typeof roles.values === 'function') return [...roles.values()].some((role) => role.id === roleId);
  return false;
};

const hasAdminAccess = (interaction, adminRoleId) => {
  if (!interaction?.inCachedGuild?.()) return false;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return hasRoleId(interaction.member, adminRoleId);
};

const hasStaffAccess = (interaction, { adminRoleId, modRoleId }) => {
  if (hasAdminAccess(interaction, adminRoleId)) return true;
  if (!interaction?.inCachedGuild?.()) return false;
  return hasRoleId(interaction.member, modRoleId);
};

const createCooldown = ({ durationMs, now = () => Date.now() }) => {
  const reservations = new Map();

  const reserve = (key) => {
    const nowMs = now();
    for (const [cachedKey, previousAt] of reservations.entries()) {
      if (nowMs - previousAt > durationMs) reservations.delete(cachedKey);
    }

    if (reservations.has(key)) {
      const previous = reservations.get(key);
      const remaining = durationMs - (nowMs - previous);
      if (remaining > 0) return Math.ceil(remaining / 1000);
    }

    reservations.set(key, nowMs);
    return 0;
  };

  return {
    clear: () => reservations.clear(),
    reserve,
  };
};

const normalizeChannelName = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .toLocaleLowerCase('fr-CA');

const isChannelAllowed = (channel, { channelIds = [], channelNames = [] } = {}) => {
  if (!channel) return false;
  if (channelIds.length) return channelIds.includes(channel.id);
  const normalizedNames = new Set(channelNames.map(normalizeChannelName).filter(Boolean));
  return normalizedNames.has(normalizeChannelName(channel.name));
};

const resolveAllowedChannels = (guild, { channelIds = [], channelNames = [] }) => {
  const textChannels = [...(guild?.channels?.cache?.values() || [])].filter((channel) => channel?.isTextBased?.() && typeof channel.send === 'function');
  // Configured IDs are authoritative. Names cannot broaden that allowlist.
  if (channelIds.length) return textChannels.filter((channel) => channelIds.includes(channel.id));
  const allowed = new Map();
  for (const name of channelNames) {
    const matches = textChannels.filter((channel) => normalizeChannelName(channel.name) === normalizeChannelName(name));
    if (matches.length === 1) allowed.set(matches[0].id, matches[0]);
  }
  return [...allowed.values()];
};

const defaultMemberRole = (guild, registry, definition) => {
  const role = guild.roles.cache.get(registry.roles?.[definition.name]);
  if (!role) return null;
  const expected = definition.permissions.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);
  // Do not give newcomers a role whose permissions drifted after reconciliation.
  return role.permissions.bitfield === expected ? role : null;
};

module.exports = {
  createCooldown,
  hasAdminAccess,
  hasStaffAccess,
  isChannelAllowed,
  normalizeChannelName,
  resolveAllowedChannels,
  defaultMemberRole,
};
