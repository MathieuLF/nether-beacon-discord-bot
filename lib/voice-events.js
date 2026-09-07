const { PermissionFlagsBits } = require('discord.js');

/** @param {import('discord.js').VoiceState} voiceState */
const publicChannelName = (voiceState) => {
  const channel = voiceState.channel;
  if (!channel) return null;
  return channel.permissionsFor(voiceState.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
    ? channel.name : null;
};

/**
 * Hidden and unavailable channels contribute no names or activity to public logs.
 * @param {import('discord.js').VoiceState} before
 * @param {import('discord.js').VoiceState} after
 * @param {string} guildId
 */
const publicVoiceTransition = (before, after, guildId) => {
  if (before.guild.id !== guildId || after.guild.id !== guildId || before.channelId === after.channelId) return null;
  const previous = publicChannelName(before);
  const next = publicChannelName(after);
  if (!previous && !next) return null;
  return { member: after.member || before.member, previous, next };
};

module.exports = { publicVoiceTransition };
