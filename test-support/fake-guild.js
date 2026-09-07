const { Collection, ChannelType, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const { plan } = require('../lib/reconcile');

const fakeGuild = () => {
  const writes = [];
  let sequence = 0;
  const guild = {
    id: 'guild', name: 'Test guild', memberCount: 0,
    channels: { cache: new Collection(), fetch: async () => guild.channels.cache },
    members: { cache: new Collection(), fetch: async () => guild.members.cache },
    presences: { cache: new Collection() },
    roles: { everyone: { id: 'guild' }, cache: new Collection() },
  };
  for (const [index, definition] of plan.roles.entries()) {
    const role = { ...definition, id: `role-${index}`, permissions: new PermissionsBitField(definition.permissions.map((name) => P[name])), members: new Collection() };
    guild.roles.cache.set(role.id, role);
  }
  guild.roles.fetch = async () => guild.roles.cache;
  guild.channels.setPositions = async (positions) => { writes.push({ operation: 'positions', positions }); };
  const channel = (payload) => {
    const item = { id: payload.id || `channel-${++sequence}`, type: payload.type, name: payload.name,
      parentId: payload.parent || null, topic: payload.topic || null, rawPosition: sequence, position: sequence };
    const updatePolicy = (overwrites) => {
      item.permissionOverwrites.cache = new Collection(overwrites.map((entry) => [entry.id, {
        id: entry.id, allow: new PermissionsBitField(entry.allow), deny: new PermissionsBitField(entry.deny),
      }]));
    };
    item.permissionOverwrites = { set: async (overwrites) => { writes.push({ operation: 'policy', id: item.id, overwrites }); updatePolicy(overwrites); } };
    updatePolicy(payload.permissionOverwrites || []);
    item.edit = async (changes) => {
      writes.push({ operation: 'edit', id: item.id, changes });
      if (changes.permissionOverwrites) updatePolicy(changes.permissionOverwrites);
      if (changes.name) item.name = changes.name;
      if (changes.parent) item.parentId = changes.parent;
      return item;
    };
    item.setPosition = async (position) => { writes.push({ operation: 'position', id: item.id, position }); };
    item.delete = async () => { throw new Error('No channel deletion is permitted in this fixture'); };
    item.isTextBased = () => item.type === ChannelType.GuildText;
    guild.channels.cache.set(item.id, item);
    return item;
  };
  guild.channels.create = async (payload) => { writes.push({ operation: 'create', payload }); return channel(payload); };
  return { guild, writes, channel };
};
module.exports = { fakeGuild };
