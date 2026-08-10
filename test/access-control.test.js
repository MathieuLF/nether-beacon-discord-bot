const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');
const {
  createCooldown,
  hasAdminAccess,
  hasStaffAccess,
  isChannelAllowed,
} = require('../lib/access-control');

const roleCache = (roles) => ({
  has: (id) => roles.some((role) => role.id === id),
  some: (predicate) => roles.some((role) => predicate(role)),
});

const interaction = ({ adminPermission = false, roles = [] } = {}) => ({
  inCachedGuild: () => true,
  memberPermissions: {
    has: (permission) => adminPermission && permission === PermissionFlagsBits.Administrator,
  },
  member: {
    roles: {
      cache: roleCache(roles),
    },
  },
});

test('staff Palworld permissions accept Administrator or managed Admin/Mod role IDs only', () => {
  const settings = { adminRoleId: 'admin-id', modRoleId: 'mod-id' };

  assert.equal(hasAdminAccess(interaction({ adminPermission: true }), 'admin-id'), true);
  assert.equal(hasStaffAccess(interaction({ roles: [{ id: 'admin-id', name: 'Admin' }] }), settings), true);
  assert.equal(hasStaffAccess(interaction({ roles: [{ id: 'mod-id', name: 'Mod' }] }), settings), true);
  assert.equal(hasStaffAccess(interaction({ roles: [{ id: 'rogue', name: 'Mod' }] }), settings), false);
});

test('cooldown reserves immediately and releases after duration', () => {
  let now = 1000;
  const cooldown = createCooldown({ durationMs: 30000, now: () => now });

  assert.equal(cooldown.reserve('announce-palworld'), 0);
  assert.equal(cooldown.reserve('announce-palworld'), 30);

  now += 31000;
  assert.equal(cooldown.reserve('announce-palworld'), 0);
});

test('channel allowlist accepts configured IDs and normalized names', () => {
  assert.equal(isChannelAllowed({ id: '123', name: 'autre' }, { channelIds: ['123'] }), true);
  assert.equal(isChannelAllowed({ id: '999', name: '🐾・palworld' }, { channelNames: ['palworld'] }), true);
  assert.equal(isChannelAllowed({ id: '999', name: 'general' }, { channelNames: ['palworld'] }), false);
});
