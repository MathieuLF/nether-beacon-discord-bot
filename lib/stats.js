const { ChannelType } = require('discord.js');
const { loadServerPlan } = require('./config');
const { loadManagedIds, saveManagedIds, touchManagedIds } = require('./managed-ids');
const { STATS_PREFIXES, statsOverwrites, statsCategories } = require('./stats-identity');
const { withManagedWrite } = require('./managed-queue');
const { createStatsRefreshDebouncer } = require('./stats-debounce');

const statsNames = (snapshot) => {
  const approximate = snapshot.complete ? '' : '~';
  const values = {
    date: snapshot.date, online: `en ligne : ${approximate}${snapshot.onlineUsers}`,
    idle: `absents : ${approximate}${snapshot.idleUsers}`, dnd: `occupés : ${approximate}${snapshot.dndUsers}`,
    offline: `déco : ${approximate}${snapshot.offlineUsers}`, voice: `en vocal : ${approximate}${snapshot.voiceUsers}`,
    users: `joueurs : ${approximate}${snapshot.humanUsers}`, bots: `robots : ${approximate}${snapshot.botUsers}`,
    channels: `salons : ${snapshot.channels}`, roles: `rôles actifs : ${approximate}${snapshot.roles}`,
  };
  return Object.entries(values).map(([key, value]) => ({ key, name: `${STATS_PREFIXES[key]}${value}` }));
};

const preflightStats = (guild, registry) => {
  const channels = [...guild.channels.cache.values()];
  const categoryId = registry.stats.category;
  if (!categoryId) {
    if (Object.keys(registry.stats).length || statsCategories(channels).length) {
      throw new Error('Stats existantes sans identifiants fiables : exécute capture:ids après vérification.');
    }
    return null;
  }
  const category = guild.channels.cache.get(categoryId);
  if (category?.type !== ChannelType.GuildCategory) throw new Error('ID de catégorie Stats absent ou invalide; répare le registre.');
  for (const [key, prefix] of Object.entries(STATS_PREFIXES)) {
    const storedId = registry.stats[key];
    const stored = guild.channels.cache.get(storedId);
    if (storedId && (stored?.type !== ChannelType.GuildVoice || stored.parentId !== category.id)) {
      throw new Error(`ID Stats ${key} absent, déplacé ou invalide; répare le registre.`);
    }
    if (!storedId && channels.some((channel) => channel.parentId === category.id && channel.type === ChannelType.GuildVoice && channel.name.startsWith(prefix))) {
      throw new Error(`Salon Stats ${key} non enregistré; capture:ids requis.`);
    }
  }
  return category;
};

const createStatsManager = ({ state, updateRuntimeFiles, noteRuntimeError, client, guildId, timeZone,
  debounceMs = 15000, refreshIntervalMs = 300000, now = () => Date.now(),
  loadRegistry = loadManagedIds, saveRegistry = saveManagedIds, memberTimeoutMs = 10000 }) => {
  let initialMembersFetched = false;
  let lastVoiceRefreshAt = 0;
  let interval;
  let memberRequest;

  const snapshotFor = async (guild, category) => {
    if (!initialMembersFetched || guild.members.cache.size < guild.memberCount) {
      let timer;
      try {
        memberRequest ||= guild.members.fetch().finally(() => { memberRequest = null; });
        await Promise.race([memberRequest, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('stats member fetch timeout')), memberTimeoutMs); })]);
        initialMembersFetched = true;
      } catch (error) {
        noteRuntimeError('stats:members', error);
      } finally { clearTimeout(timer); }
    }
    const members = [...guild.members.cache.values()];
    const humans = members.filter((member) => !member.user.bot);
    const countPresence = (status) => humans.filter((member) => (guild.presences.cache.get(member.id)?.status || member.presence?.status || 'offline') === status).length;
    const onlineUsers = countPresence('online');
    const idleUsers = countPresence('idle');
    const dndUsers = countPresence('dnd');
    return {
      date: new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date(now())),
      complete: members.length >= guild.memberCount,
      onlineUsers, idleUsers, dndUsers, offlineUsers: humans.length - onlineUsers - idleUsers - dndUsers,
      voiceUsers: humans.filter((member) => member.voice?.channelId && member.voice.channel?.parentId !== category.id).length,
      humanUsers: humans.length, botUsers: members.length - humans.length,
      channels: guild.channels.cache.filter((channel) => channel.type !== ChannelType.GuildCategory && channel.parentId !== category.id).size,
      roles: guild.roles.cache.filter((role) => role.id !== guild.id && role.members.size > 0).size,
    };
  };

  const refresh = (guild, origin) => withManagedWrite(async () => {
    try {
      // Fetch the authoritative channel inventory before deciding what may be created.
      await guild.channels.fetch();
      const registry = touchManagedIds(loadRegistry(), guild.id, loadServerPlan());
      let category = preflightStats(guild, registry);
      const overwrites = statsOverwrites(guild.roles.everyone.id);
      const persist = (key, id) => { registry.stats[key] = id; saveRegistry(registry); };
      if (!category) {
        category = await guild.channels.create({ name: 'Stats', type: ChannelType.GuildCategory, permissionOverwrites: overwrites });
        persist('category', category.id);
      }
      const ensurePolicy = async (channel) => {
        const current = channel.permissionOverwrites.cache.get(overwrites[0].id);
        if (channel.permissionOverwrites.cache.size !== 1 || current?.allow.bitfield !== overwrites[0].allow || current?.deny.bitfield !== overwrites[0].deny) {
          await channel.permissionOverwrites.set(overwrites, 'NetherBeacon: Stats permissions');
        }
      };
      await ensurePolicy(category);
      if (category.name !== 'Stats') await category.edit({ name: 'Stats' });
      const snapshot = await snapshotFor(guild, category);
      const force = ['startup', 'slash-resync', 'slash-stats-refresh'].includes(origin);
      const shouldWrite = force || !lastVoiceRefreshAt || now() - lastVoiceRefreshAt >= refreshIntervalMs;
      if (shouldWrite) {
        const ordered = [];
        for (const { key, name } of statsNames(snapshot)) {
          let channel = guild.channels.cache.get(registry.stats[key]);
          if (!channel) {
            channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: overwrites });
            persist(key, channel.id);
          } else {
            if (channel.name !== name) await channel.edit({ name, permissionOverwrites: overwrites });
            await ensurePolicy(channel);
          }
          ordered.push(channel);
        }
        const sorted = [...ordered].sort((a, b) => a.rawPosition - b.rawPosition);
        if (sorted.some((channel, index) => channel.id !== ordered[index].id)) {
          await guild.channels.setPositions(ordered.map((channel, position) => ({ channel: channel.id, position })));
        }
        lastVoiceRefreshAt = now();
      }
      const categories = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildCategory).sort((a, b) => a.rawPosition - b.rawPosition);
      if (categories.at(-1)?.id !== category.id) await category.setPosition(categories.length - 1);
      state.lastStats = { at: new Date(now()).toISOString(), snapshot, presenceCacheSize: guild.presences.cache.size };
      updateRuntimeFiles();
      return { status: shouldWrite ? 'updated' : 'sampled', complete: snapshot.complete };
    } catch (error) {
      noteRuntimeError(`stats:${origin}`, error);
      return { status: 'failed', error };
    }
  });

  const debouncer = createStatsRefreshDebouncer(debounceMs, refresh);
  return {
    refresh,
    schedule: (guild, origin) => debouncer.schedule(guild, origin),
    start: () => {
      if (interval) return;
      interval = setInterval(() => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) void refresh(guild, 'interval');
      }, refreshIntervalMs);
      interval.unref();
    },
    stop: () => { clearInterval(interval); interval = null; debouncer.cancel?.(); },
  };
};

module.exports = { createStatsManager, preflightStats, statsNames };
