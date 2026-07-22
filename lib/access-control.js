const { PermissionFlagsBits } = require('discord.js');

const hasRoleNamed = (member, roleName) => {
  if (!roleName) return false;
  const roles = member?.roles?.cache;
  if (!roles) return false;
  if (typeof roles.some === 'function') return roles.some((role) => role.name === roleName);
  if (typeof roles.values === 'function') return [...roles.values()].some((role) => role.name === roleName);
  return false;
};

const hasAdminAccess = (interaction, adminRoleName) => {
  if (!interaction?.inCachedGuild?.()) return false;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return hasRoleNamed(interaction.member, adminRoleName);
};

const hasStaffAccess = (interaction, { adminRoleName, modRoleName }) => {
  if (hasAdminAccess(interaction, adminRoleName)) return true;
  if (!interaction?.inCachedGuild?.()) return false;
  return hasRoleNamed(interaction.member, modRoleName);
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
  if (channelIds.includes(channel.id)) return true;
  const normalizedNames = new Set(channelNames.map(normalizeChannelName).filter(Boolean));
  return normalizedNames.has(normalizeChannelName(channel.name));
};

module.exports = {
  createCooldown,
  hasAdminAccess,
  hasStaffAccess,
  isChannelAllowed,
  normalizeChannelName,
};
