const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { normalizeChannelName } = require('./access-control');

const STATS_NAMES = ['Stats', 'Stats serveur'];
const STATS_PREFIXES = { date: '📅・', online: '🟢・', idle: '🌙・', dnd: '⛔・', offline: '🔴・', voice: '🎙️・', users: '👥・', bots: '🤖・', channels: '#️⃣・', roles: '🎭・' };
const statsOverwrites = (everyoneId) => [{ id: everyoneId, allow: P.ViewChannel, deny: P.Connect | P.Speak | P.UseVAD | P.Stream }];
const statsCategories = (channels) => channels.filter((channel) => channel.type === ChannelType.GuildCategory
  && STATS_NAMES.some((name) => normalizeChannelName(name) === normalizeChannelName(channel.name)));

const captureStatsIds = (channels, registry, report) => {
  const candidates = statsCategories(channels);
  const storedCategory = registry.stats.category;
  if (storedCategory && !channels.some((channel) => channel.id === storedCategory && channel.type === ChannelType.GuildCategory)) {
    report.conflicts.push('stored Stats category is missing; repair registry explicitly');
    return;
  }
  if (!storedCategory && candidates.length > 1) {
    report.conflicts.push('multiple Stats categories; capture refused');
    return;
  }
  const category = storedCategory ? channels.find((channel) => channel.id === storedCategory) : candidates[0];
  if (!category) return;
  const remember = (key, channel) => {
    const expected = statsOverwrites(registry.guildId)[0];
    const overwrites = channel.permission_overwrites || [];
    if (!registry.stats[key] && (overwrites.length !== 1 || overwrites[0].id !== expected.id
      || String(overwrites[0].allow) !== String(expected.allow) || String(overwrites[0].deny) !== String(expected.deny))) {
      report.conflicts.push(`Stats ${key} does not have the existing public read-only policy; review before capture`);
      return;
    }
    registry.stats[key] = channel.id;
  };
  remember('category', category);
  for (const [key, prefix] of Object.entries(STATS_PREFIXES)) {
    const storedId = registry.stats[key];
    if (storedId) {
      if (!channels.some((channel) => channel.id === storedId && channel.type === ChannelType.GuildVoice && channel.parent_id === category.id)) {
        report.conflicts.push(`stored Stats ${key} is missing or moved; repair registry explicitly`);
      }
      continue;
    }
    const matches = channels.filter((channel) => channel.type === ChannelType.GuildVoice && channel.parent_id === category.id && channel.name.startsWith(prefix));
    if (matches.length > 1) report.conflicts.push(`multiple Stats channels for ${key}`);
    else if (matches.length === 1) remember(key, matches[0]);
  }
};

module.exports = { STATS_NAMES, STATS_PREFIXES, statsOverwrites, statsCategories, captureStatsIds };
