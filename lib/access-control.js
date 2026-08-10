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
