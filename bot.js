const fs = require('fs');
const path = require('path');
const {
  Client,
  ChannelType,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require('discord.js');
const { config } = require('dotenv');
const { paths } = require('./lib/config');
const {
  POKEDEX_COMMAND_NAMES,
  STAFF_COMMAND_NAMES,
  commandHash,
  commandPayload,
} = require('./lib/commands');
const {
  formatCacheStatus,
  formatDiagnostics,
} = require('./lib/diagnostics');
const {
  plan,
  auditGuild,
  syncGuild,
  formatReportForChat,
  findManagedChannelIdByName,
  findManagedLogChannelId,
} = require('./lib/reconcile');
const {
  createAdminState,
  readJson,
  updateRuntimeFiles: writeRuntimeFiles,
} = require('./lib/runtime-state');
const { createStatsRefreshDebouncer } = require('./lib/stats-debounce');
const {
  fetchUptimeKumaSnapshot,
  loadUptimeKumaState,
  planUptimeKumaAnnouncements,
  planUptimeKumaFetchFailure,
  saveUptimeKumaState,
} = require('./lib/uptime-kuma-status');
const {
  fetchPalworldMetrics,
  fetchPalworldPlayers,
  formatPalworldAnnouncementForDiscord,
  formatPalworldMetrics,
  loadPalworldPlayerState,
  normalizeAnnouncementMessage,
  planPalworldPlayerAnnouncements,
  planPalworldPlayerFetchFailure,
  savePalworldPlayerState,
  sendPalworldAnnouncement,
} = require('./lib/palworld-rest');
const {
  autocompletePokedex,
  formatAbilitySummary,
  formatMoveSummary,
  formatPokemonSummary,
  formatRandomPokemonSummary,
  formatTypeSummary,
  formatWeaknessSummary,
} = require('./lib/pokedex');
const pkg = require('./package.json');

config();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();
const GUILD_ID = process.env.DISCORD_GUILD_ID?.trim();
const BOT_TIMEZONE = process.env.BOT_TIMEZONE?.trim() || 'America/Toronto';

if (!BOT_TOKEN || !GUILD_ID) {
  throw new Error('Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in .env');
}

fs.mkdirSync(paths.runtimeDir, { recursive: true });

const readPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const P = PermissionFlagsBits;
const ADMIN_ROLE_NAME = plan.adminRoleName;
const DEFAULT_MEMBER_ROLE_NAME = plan.defaultMemberRoleName;
const WELCOME_CHANNEL_NAME = plan.welcomeChannelName;
const STATS_CATEGORY_NAME = 'Stats';
const STATS_CATEGORY_LEGACY_NAMES = ['Stats serveur'];
const STATS_LIVE_CHANNEL_NAME = '📊・stats-live';
const STATS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STATS_VOICE_REFRESH_INTERVAL_MS = readPositiveInteger(
  process.env.BOT_STATS_VOICE_REFRESH_INTERVAL_MS,
  STATS_REFRESH_INTERVAL_MS,
);
const STATS_EVENT_DEBOUNCE_MS = readPositiveInteger(process.env.BOT_STATS_EVENT_DEBOUNCE_MS, 15000);
const STATS_MEMBER_FETCH_TIMEOUT_MS = 10000;
const UPTIME_KUMA_STATUS_PAGE_URL = process.env.BOT_UPTIME_KUMA_STATUS_PAGE_URL?.trim() || '';
const UPTIME_KUMA_STATUS_CHANNEL_NAME = process.env.BOT_UPTIME_KUMA_STATUS_CHANNEL_NAME?.trim() || '🐾・palworld';
const UPTIME_KUMA_POLL_INTERVAL_MS = readPositiveInteger(process.env.BOT_UPTIME_KUMA_POLL_INTERVAL_MS, 60000);
const UPTIME_KUMA_FETCH_TIMEOUT_MS = readPositiveInteger(process.env.BOT_UPTIME_KUMA_FETCH_TIMEOUT_MS, 10000);
const UPTIME_KUMA_STATE_PATH = path.join(paths.runtimeDir, 'uptime-kuma-status.json');
const PALWORLD_CHANNEL_NAME = process.env.BOT_PALWORLD_CHANNEL_NAME?.trim() || UPTIME_KUMA_STATUS_CHANNEL_NAME;
const PALWORLD_REST_API_URL = process.env.BOT_PALWORLD_REST_API_URL?.trim() || '';
const PALWORLD_REST_API_USERNAME = process.env.BOT_PALWORLD_REST_API_USERNAME?.trim() || '';
const PALWORLD_REST_API_PASSWORD = process.env.BOT_PALWORLD_REST_API_PASSWORD || '';
const PALWORLD_REST_FETCH_TIMEOUT_MS = readPositiveInteger(process.env.BOT_PALWORLD_REST_FETCH_TIMEOUT_MS, 10000);
const PALWORLD_PLAYER_POLL_INTERVAL_MS = readPositiveInteger(process.env.BOT_PALWORLD_PLAYER_POLL_INTERVAL_MS, 60000);
const PALWORLD_METRICS_COOLDOWN_MS = readPositiveInteger(process.env.BOT_PALWORLD_METRICS_COOLDOWN_MS, 4 * 60 * 1000);
const PALWORLD_PLAYER_STATE_PATH = path.join(paths.runtimeDir, 'palworld-players.json');
const MOD_ROLE_NAME = 'Mod';
const STATS_CHANNEL_PREFIXES = {
  date: '📅・',
  online: '🟢・',
  idle: '🌙・',
  dnd: '⛔・',
  offline: '🔴・',
  voice: '🎙️・',
  users: '👥・',
  bots: '🤖・',
  channels: '#️⃣・',
  roles: '🎭・',
};
const PUBLIC_COMMAND_COOLDOWN_MS = 5000;
const publicCommandCooldowns = new Map();
let lastPalworldMetricsCommandAt = 0;

const formatLine = (label, value) => `- **${label}** : ${value}`;

const formatBotMessage = (title, lines = []) => [
  `**${title}**`,
  ...lines,
].join('\n');

const formatCommandList = (commands) => commands.map((command) => `\`${command}\``).join(' ');

const toPermissionBits = (permissions) => permissions.reduce((bits, permission) => bits | BigInt(permission), 0n);
const STATS_EVERYONE_ALLOW_BITS = toPermissionBits([P.ViewChannel]);
const STATS_EVERYONE_DENY_BITS = toPermissionBits([P.Connect, P.Speak, P.UseVAD, P.Stream]);

const formatTimestamp = (value) => {
  if (!value) return 'jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: BOT_TIMEZONE,
  }).format(date)} (${BOT_TIMEZONE})`;
};

const formatStatsDate = (value = new Date()) =>
  new Intl.DateTimeFormat('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: BOT_TIMEZONE,
  }).format(value);

const getStatsPermissionOverwrites = (guild) => [
  {
    id: guild.roles.everyone.id,
    allow: STATS_EVERYONE_ALLOW_BITS,
    deny: STATS_EVERYONE_DENY_BITS,
  },
];

const hasManagedStatsOverwrites = (channel, guild) => {
  if (channel.permissionOverwrites.cache.size !== 1) return false;
  const everyoneOverwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
  if (!everyoneOverwrite) return false;

  return (
    everyoneOverwrite.allow.bitfield === STATS_EVERYONE_ALLOW_BITS &&
    everyoneOverwrite.deny.bitfield === STATS_EVERYONE_DENY_BITS
  );
};

const ensureManagedStatsOverwrites = async (channel, guild, reason) => {
  if (hasManagedStatsOverwrites(channel, guild)) return;
  await tryDiscordWrite(channel.permissionOverwrites.set(getStatsPermissionOverwrites(guild), reason), reason);
};

const state = createAdminState({
  version: pkg.version,
  guildId: GUILD_ID,
});

const withTimeout = async (promise, timeoutMs, label) => {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const tryDiscordWrite = async (promise, label) => {
  try {
    return await promise;
  } catch (error) {
    console.warn(`${label}: ${error.message}`);
    return null;
  }
};

const updateRuntimeFiles = () => writeRuntimeFiles(state);

const startHeartbeat = () => {
  updateRuntimeFiles();
  setInterval(updateRuntimeFiles, 15000).unref();
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
});

const hasAdminAccess = (interaction) => {
  if (!interaction.inCachedGuild()) return false;
  if (interaction.memberPermissions?.has(P.Administrator)) return true;
  return interaction.member.roles.cache.some((role) => role.name === ADMIN_ROLE_NAME);
};

const hasStaffAccess = (interaction) => {
  if (hasAdminAccess(interaction)) return true;
  if (!interaction.inCachedGuild()) return false;
  return interaction.member.roles.cache.some((role) => role.name === MOD_ROLE_NAME);
};

const isPalworldRestConfigured = () =>
  Boolean(PALWORLD_REST_API_URL && PALWORLD_REST_API_USERNAME && PALWORLD_REST_API_PASSWORD);

const getPalworldRestOptions = () => ({
  apiUrl: PALWORLD_REST_API_URL,
  username: PALWORLD_REST_API_USERNAME,
  password: PALWORLD_REST_API_PASSWORD,
  timeoutMs: PALWORLD_REST_FETCH_TIMEOUT_MS,
});

const getPublicCommandCooldown = (userId) => {
  const now = Date.now();

  for (const [cachedUserId, previousAt] of publicCommandCooldowns.entries()) {
    if (now - previousAt > PUBLIC_COMMAND_COOLDOWN_MS) {
      publicCommandCooldowns.delete(cachedUserId);
    }
  }

  const previous = publicCommandCooldowns.get(userId) || 0;
  const remaining = PUBLIC_COMMAND_COOLDOWN_MS - (now - previous);
  if (remaining > 0) return Math.ceil(remaining / 1000);

  publicCommandCooldowns.set(userId, now);
  return 0;
};

const reservePalworldMetricsCooldown = () => {
  const now = Date.now();
  const remaining = PALWORLD_METRICS_COOLDOWN_MS - (now - lastPalworldMetricsCommandAt);
  if (remaining > 0) return Math.ceil(remaining / 1000);

  lastPalworldMetricsCommandAt = now;
  return 0;
};

const runPokedexCommand = async (interaction) => {
  if (interaction.commandName === 'pokemon') {
    return formatPokemonSummary(interaction.options.getString('name', true));
  }

  if (interaction.commandName === 'weakness') {
    return formatWeaknessSummary(interaction.options.getString('pokemon', true));
  }

  if (interaction.commandName === 'move') {
    return formatMoveSummary(interaction.options.getString('name', true));
  }

  if (interaction.commandName === 'ability') {
    return formatAbilitySummary(interaction.options.getString('name', true));
  }

  if (interaction.commandName === 'type') {
    return formatTypeSummary(interaction.options.getString('name', true));
  }

  if (interaction.commandName === 'random-pokemon') {
    return formatRandomPokemonSummary();
  }

  throw new Error('Unknown Pokédex command.');
};

const normalizeDiscordReplyPayload = (result) => {
  if (typeof result === 'string') {
    return { content: result.slice(0, 1990) };
  }

  return {
    ...result,
    content: result.content?.slice(0, 1990) || '',
  };
};

const normalizePokedexFallbackPayload = (result, error) => {
  const content = typeof result === 'string' ? result : result?.content || '';
  return {
    content: [
      content.slice(0, 1750),
      '',
      '_Image non jointe cette fois-ci : Discord a refusé l’envoi de l’attachement._',
      `_Détail technique : ${error.message}_`,
    ].join('\n').slice(0, 1990),
  };
};

const formatPokedexLookupError = (error) =>
  formatBotMessage('⚠️ Pokédex', [
    formatLine('Erreur', error.message),
    'Utilise les noms anglais, par exemple `charizard`, `mr-mime`, `thunderbolt` ou `fairy`.',
  ]);

const refreshGuild = async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.fetch();
  return guild;
};

const getLogChannelId = (guild) => state.logChannelId || findManagedLogChannelId(guild);
const getEventChannelId = (guild) => state.eventChannelId || findManagedChannelIdByName(guild, plan.eventChannelName);
const getWelcomeChannelId = (guild) => findManagedChannelIdByName(guild, WELCOME_CHANNEL_NAME);
const getUptimeKumaStatusChannelId = (guild) => findManagedChannelIdByName(guild, UPTIME_KUMA_STATUS_CHANNEL_NAME);
const getPalworldChannelId = (guild) => findManagedChannelIdByName(guild, PALWORLD_CHANNEL_NAME);

const sendMessageToChannel = async (guild, channelId, message, options = {}) => {
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) {
    const payload = typeof message === 'string'
      ? { content: message.slice(0, 1990) }
      : { ...message, content: message.content?.slice(0, 1990) || '' };
    return await channel.send({ ...payload, ...options }).catch(() => null);
  }
  return null;
};

const sendLog = async (guild, message) => sendMessageToChannel(guild, getLogChannelId(guild), message);
const sendEventLog = async (guild, message) => sendMessageToChannel(guild, getEventChannelId(guild), message);

let uptimeKumaPollTimer = null;
let uptimeKumaBootstrapTimer = null;
let uptimeKumaPollInFlight = false;

const pollUptimeKumaStatus = async (guild, origin) => {
  if (!UPTIME_KUMA_STATUS_PAGE_URL || uptimeKumaPollInFlight) return;

  uptimeKumaPollInFlight = true;

  try {
    const snapshot = await fetchUptimeKumaSnapshot({
      statusPageUrl: UPTIME_KUMA_STATUS_PAGE_URL,
      timeoutMs: UPTIME_KUMA_FETCH_TIMEOUT_MS,
    });
    const previousState = loadUptimeKumaState(UPTIME_KUMA_STATE_PATH);
    const planned = planUptimeKumaAnnouncements(snapshot, previousState);

    state.lastUptimeKuma = {
      at: snapshot.checkedAt,
      status: snapshot.overallStatus,
      title: snapshot.title,
      events: snapshot.events.length,
    };
    updateRuntimeFiles();

    if (!planned.messages.length && !planned.logMessages.length) {
      saveUptimeKumaState(UPTIME_KUMA_STATE_PATH, planned.state);
      return;
    }

    if (planned.messages.length) {
      const channelId = getUptimeKumaStatusChannelId(guild);
      if (!channelId) {
        throw new Error(`managed channel ${UPTIME_KUMA_STATUS_CHANNEL_NAME} not found`);
      }

      for (const message of planned.messages) {
        await sendMessageToChannel(guild, channelId, message);
      }
    }

    for (const message of planned.logMessages) {
      await sendLog(guild, message);
    }

    saveUptimeKumaState(UPTIME_KUMA_STATE_PATH, planned.state);
  } catch (error) {
    const previousState = loadUptimeKumaState(UPTIME_KUMA_STATE_PATH);
    const planned = planUptimeKumaFetchFailure({
      error,
      previousState,
      statusPageUrl: UPTIME_KUMA_STATUS_PAGE_URL,
    });

    state.lastUptimeKuma = {
      at: planned.state.updatedAt,
      status: 'kuma-unreachable',
      title: 'Uptime Kuma',
      events: 0,
    };
    state.lastError = `uptime-kuma:${origin}: ${error.message}`;
    updateRuntimeFiles();

    for (const message of planned.logMessages) {
      await sendLog(guild, message);
    }

    saveUptimeKumaState(UPTIME_KUMA_STATE_PATH, planned.state);
  } finally {
    uptimeKumaPollInFlight = false;
  }
};

const startUptimeKumaScheduler = (guild) => {
  if (!UPTIME_KUMA_STATUS_PAGE_URL || uptimeKumaPollTimer || uptimeKumaBootstrapTimer) return;

  uptimeKumaBootstrapTimer = setTimeout(async () => {
    uptimeKumaBootstrapTimer = null;
    await pollUptimeKumaStatus(guild, 'startup');

    uptimeKumaPollTimer = setInterval(async () => {
      const cachedGuild = client.guilds.cache.get(GUILD_ID);
      if (cachedGuild) await pollUptimeKumaStatus(cachedGuild, 'interval');
    }, UPTIME_KUMA_POLL_INTERVAL_MS);
    uptimeKumaPollTimer.unref();
  }, 10000);
  uptimeKumaBootstrapTimer.unref();
};

let palworldPlayerPollTimer = null;
let palworldPlayerBootstrapTimer = null;
let palworldPlayerPollInFlight = false;

const sendPalworldPublicMessage = async (guild, message) => {
  const channelId = getPalworldChannelId(guild);
  if (!channelId) {
    return false;
  }

  const sent = await sendMessageToChannel(guild, channelId, message, { allowedMentions: { parse: [] } });
  return Boolean(sent);
};

const pollPalworldPlayers = async (guild, origin) => {
  if (!isPalworldRestConfigured() || palworldPlayerPollInFlight) return;

  palworldPlayerPollInFlight = true;

  try {
    const snapshot = await fetchPalworldPlayers(getPalworldRestOptions());
    const previousState = loadPalworldPlayerState(PALWORLD_PLAYER_STATE_PATH);
    const planned = planPalworldPlayerAnnouncements(snapshot, previousState);

    state.lastPalworldRest = {
      at: snapshot.checkedAt,
      status: 'players-ok',
      players: snapshot.players.length,
    };
    updateRuntimeFiles();

    if (planned.messages.length && !getPalworldChannelId(guild)) {
      await sendLog(guild, formatBotMessage('⚠️ Salon Palworld introuvable', [
        formatLine('Salon attendu', PALWORLD_CHANNEL_NAME),
        formatLine('Origine', `palworld-players:${origin}`),
      ]));
    } else {
      for (const message of planned.messages) {
        const sent = await sendPalworldPublicMessage(guild, message);
        if (sent) {
          state.lastPalworldPlayerEvent = message.split('\n')[0].replace(/\*/g, '');
        } else {
          await sendLog(guild, formatBotMessage('⚠️ Événement Palworld non publié', [
            formatLine('Salon', PALWORLD_CHANNEL_NAME),
            formatLine('Origine', `palworld-players:${origin}`),
          ]));
        }
      }
    }

    for (const message of planned.logMessages) {
      await sendLog(guild, message);
    }

    savePalworldPlayerState(PALWORLD_PLAYER_STATE_PATH, planned.state);
    updateRuntimeFiles();
  } catch (error) {
    const previousState = loadPalworldPlayerState(PALWORLD_PLAYER_STATE_PATH);
    const planned = planPalworldPlayerFetchFailure({
      error,
      previousState,
    });

    state.lastPalworldRest = {
      at: planned.state.updatedAt,
      status: 'api-unreachable',
      players: Object.keys(planned.state.players).length,
    };
    state.lastError = `palworld-players:${origin}: ${error.message}`;
    updateRuntimeFiles();

    for (const message of planned.logMessages) {
      await sendLog(guild, message);
    }

    savePalworldPlayerState(PALWORLD_PLAYER_STATE_PATH, planned.state);
  } finally {
    palworldPlayerPollInFlight = false;
  }
};

const startPalworldPlayerScheduler = (guild) => {
  if (!isPalworldRestConfigured() || palworldPlayerPollTimer || palworldPlayerBootstrapTimer) return;

  palworldPlayerBootstrapTimer = setTimeout(async () => {
    palworldPlayerBootstrapTimer = null;
    await pollPalworldPlayers(guild, 'startup');

    palworldPlayerPollTimer = setInterval(async () => {
      const cachedGuild = client.guilds.cache.get(GUILD_ID);
      if (cachedGuild) await pollPalworldPlayers(cachedGuild, 'interval');
    }, PALWORLD_PLAYER_POLL_INTERVAL_MS);
    palworldPlayerPollTimer.unref();
  }, 15000);
  palworldPlayerBootstrapTimer.unref();
};

const buildWelcomeMessage = (memberOrMention) =>
  formatBotMessage(`👋 Bienvenue ${memberOrMention} dans Gaymers`, [
    'Pose tes affaires, regarde les salons, et lance une game quand tu veux.',
  ]);

const sendWelcomeMessage = async (member) => {
  const channelId = getWelcomeChannelId(member.guild);
  await sendMessageToChannel(member.guild, channelId, buildWelcomeMessage(member));
};

const assignDefaultMemberRole = async (member) => {
  if (member.user?.bot) return;

  const matches = member.guild.roles.cache.filter((role) => role.name === DEFAULT_MEMBER_ROLE_NAME);
  if (matches.size !== 1) {
    await sendLog(
      member.guild,
      formatBotMessage("⚠️ Rôle d'arrivée ignoré", [
        formatLine('Membre', formatMember(member)),
        formatLine('Rôle attendu', DEFAULT_MEMBER_ROLE_NAME),
        formatLine('Rôles trouvés', matches.size),
      ]),
    );
    return;
  }

  const role = matches.first();
  if (member.roles.cache.has(role.id)) return;

  await member.roles.add(role, "NeatherBeacon: rôle par défaut pour un nouveau membre").catch(async (error) => {
    await sendLog(member.guild, formatBotMessage("⚠️ Rôle d'arrivée impossible", [
      formatLine('Membre', formatMember(member)),
      formatLine('Erreur', error.message),
    ]));
  });
};

const registerSlashCommands = async (guild) => {
  await guild.commands.set(commandPayload);
  state.commandsRegisteredAt = new Date().toISOString();
  updateRuntimeFiles();
};

const knownSecretValues = () => [
  BOT_TOKEN,
  process.env.MUSE_DISCORD_TOKEN,
  process.env.MUSE_YOUTUBE_API_KEY,
  process.env.MUSE_SPOTIFY_CLIENT_ID,
  process.env.MUSE_SPOTIFY_CLIENT_SECRET,
  PALWORLD_REST_API_PASSWORD,
].filter(Boolean);

const markTask = (taskName) => {
  state.activeTask = taskName;
  updateRuntimeFiles();
};

const clearTask = () => {
  state.activeTask = null;
  updateRuntimeFiles();
};

const noteRuntimeError = (origin, error) => {
  state.lastError = `${origin}: ${error.message}`;
  updateRuntimeFiles();
  console.error(`[${origin}]`, error);
};

const sortByPosition = (left, right) => left.rawPosition - right.rawPosition;

const ensureStatsCategoryLast = async (guild, category) => {
  const categories = [...guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).values()].sort(sortByPosition);
  if (!categories.length || categories.at(-1)?.id === category.id) {
    return;
  }

  const ordered = categories.filter((channel) => channel.id !== category.id);
  ordered.push(category);

  await tryDiscordWrite(
    guild.channels.setPositions(
      ordered.map((channel, index) => ({
        channel: channel.id,
        position: index,
      })),
    ),
    'NeatherBeacon: move stats category last',
  );
};

const findStatsCategoryCandidates = (guild) => {
  const managedNames = new Set([STATS_CATEGORY_NAME, ...STATS_CATEGORY_LEGACY_NAMES]);
  return [...guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory && managedNames.has(channel.name)).values()].sort(sortByPosition);
};

const ensureStatsCategory = async (guild) => {
  const candidates = findStatsCategoryCandidates(guild);
  const exact = candidates.filter((channel) => channel.name === STATS_CATEGORY_NAME);
  const legacy = candidates.filter((channel) => STATS_CATEGORY_LEGACY_NAMES.includes(channel.name));

  if (exact.length > 1) {
    console.warn(`Multiple "${STATS_CATEGORY_NAME}" categories detected. Reusing the first one.`);
  }

  if (exact.length && legacy.length) {
    console.warn(`Both "${STATS_CATEGORY_NAME}" and legacy stats categories detected. Reusing "${STATS_CATEGORY_NAME}".`);
  }

  let category = exact[0] || legacy[0] || null;

  if (!category) {
    category = await tryDiscordWrite(
      guild.channels.create({
        name: STATS_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: getStatsPermissionOverwrites(guild),
      }),
      'NeatherBeacon: create stats category',
    );
  } else {
    if (category.name !== STATS_CATEGORY_NAME) {
      category = await tryDiscordWrite(
        category.edit({ name: STATS_CATEGORY_NAME }, 'NeatherBeacon: rename legacy stats category'),
        'NeatherBeacon: rename stats category',
      ) || category;
    }

    await ensureManagedStatsOverwrites(category, guild, 'NeatherBeacon: lock managed stats category');
  }

  if (!category) {
    throw new Error("La catégorie Stats n'est pas disponible.");
  }

  await ensureStatsCategoryLast(guild, category);
  return category;
};

const removeLegacyStatsTimeChannels = async (category) => {
  const legacyChannels = [...category.children.cache.filter(
    (channel) =>
      channel.type === ChannelType.GuildVoice &&
      channel.name.startsWith('🕘・'),
  ).values()];

  for (const channel of legacyChannels) {
    await tryDiscordWrite(
      channel.delete('NeatherBeacon: remove obsolete time stats channel'),
      `NeatherBeacon: remove obsolete stats time channel ${channel.id}`,
    );
  }
};

const removeStatsLiveChannels = async (category) => {
  const liveChannels = [...category.children.cache.filter(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.name === STATS_LIVE_CHANNEL_NAME,
  ).values()];

  for (const channel of liveChannels) {
    await tryDiscordWrite(
      channel.delete('NeatherBeacon: remove obsolete text stats channel'),
      `NeatherBeacon: remove obsolete text stats channel ${channel.id}`,
    );
  }
};

const findManagedStatsVoiceChannel = (guild, category, prefix) => {
  const candidates = [...guild.channels.cache.filter(
    (channel) =>
      channel.parentId === category.id &&
      channel.type === ChannelType.GuildVoice &&
      channel.name.startsWith(prefix),
  ).values()].sort(sortByPosition);

  if (candidates.length > 1) {
    console.warn(`Multiple managed stats channels detected for prefix "${prefix}". Reusing the first one.`);
  }

  return candidates[0] || null;
};

const ensureManagedStatsVoiceChannel = async (guild, category, prefix, name) => {
  let channel = findManagedStatsVoiceChannel(guild, category, prefix);

  if (!channel) {
    channel = await tryDiscordWrite(
      guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: getStatsPermissionOverwrites(guild),
      }),
      `NeatherBeacon: create stats channel ${prefix}`,
    );
    return channel;
  }

  const updates = {};
  if (channel.name !== name) {
    updates.name = name;
  }

  if (channel.parentId !== category.id) {
    updates.parent = category.id;
  }

  if (Object.keys(updates).length) {
    channel = await tryDiscordWrite(
      channel.edit(updates, 'NeatherBeacon: refresh managed stats channel'),
      `NeatherBeacon: refresh stats channel ${prefix}`,
    ) || channel;
  }

  await ensureManagedStatsOverwrites(channel, guild, 'NeatherBeacon: lock managed stats channel');

  return channel;
};

const buildStatsChannelNames = (snapshot) => [
  { prefix: STATS_CHANNEL_PREFIXES.date, name: `${STATS_CHANNEL_PREFIXES.date}${snapshot.date}` },
  { prefix: STATS_CHANNEL_PREFIXES.online, name: `${STATS_CHANNEL_PREFIXES.online}en ligne : ${snapshot.onlineUsers}` },
  { prefix: STATS_CHANNEL_PREFIXES.idle, name: `${STATS_CHANNEL_PREFIXES.idle}absents : ${snapshot.idleUsers}` },
  { prefix: STATS_CHANNEL_PREFIXES.dnd, name: `${STATS_CHANNEL_PREFIXES.dnd}occupés : ${snapshot.dndUsers}` },
  { prefix: STATS_CHANNEL_PREFIXES.offline, name: `${STATS_CHANNEL_PREFIXES.offline}déco : ${snapshot.offlineUsers}` },
  { prefix: STATS_CHANNEL_PREFIXES.voice, name: `${STATS_CHANNEL_PREFIXES.voice}en vocal : ${snapshot.voiceUsers}` },
  { prefix: STATS_CHANNEL_PREFIXES.users, name: `${STATS_CHANNEL_PREFIXES.users}joueurs : ${snapshot.humanUsers}` },
  { prefix: STATS_CHANNEL_PREFIXES.bots, name: `${STATS_CHANNEL_PREFIXES.bots}robots : ${snapshot.botUsers}` },
  { prefix: STATS_CHANNEL_PREFIXES.channels, name: `${STATS_CHANNEL_PREFIXES.channels}salons : ${snapshot.channels}` },
  { prefix: STATS_CHANNEL_PREFIXES.roles, name: `${STATS_CHANNEL_PREFIXES.roles}rôles actifs : ${snapshot.roles}` },
];

let statsRefreshTimer = null;
let statsRefreshBootstrapTimer = null;
let hasFetchedInitialMembers = false;
let statsRefreshInFlight = false;
let statsRefreshQueuedGuild = null;
let lastStatsVoiceRefreshAt = 0;

const ensureStatsMemberCache = async (guild) => {
  if (hasFetchedInitialMembers && guild.members.cache.size >= guild.memberCount) {
    return;
  }

  try {
    await withTimeout(
      guild.members.fetch(),
      STATS_MEMBER_FETCH_TIMEOUT_MS,
      'stats member fetch',
    );
    hasFetchedInitialMembers = true;
  } catch (error) {
    console.warn(`Unable to fully refresh guild members cache for stats: ${error.message}`);
  }
};

const buildStatsSnapshot = async (guild, category) => {
  await ensureStatsMemberCache(guild);

  const members = [...guild.members.cache.values()];
  const humanMembers = members.filter((member) => !member.user.bot);
  const botMembers = members.filter((member) => member.user.bot);
  const getPresenceStatus = (member) => guild.presences.cache.get(member.id)?.status || member.presence?.status || 'offline';
  const onlineUsers = humanMembers.filter((member) => getPresenceStatus(member) === 'online').length;
  const idleUsers = humanMembers.filter((member) => getPresenceStatus(member) === 'idle').length;
  const dndUsers = humanMembers.filter((member) => getPresenceStatus(member) === 'dnd').length;
  const offlineUsers = Math.max(humanMembers.length - onlineUsers - idleUsers - dndUsers, 0);

  return {
    date: formatStatsDate(),
    onlineUsers,
    idleUsers,
    dndUsers,
    offlineUsers,
    voiceUsers: humanMembers.filter((member) => member.voice?.channelId && member.voice.channel?.parentId !== category.id).length,
    humanUsers: humanMembers.length,
    botUsers: botMembers.length,
    channels: guild.channels.cache.filter(
      (channel) => channel.type !== ChannelType.GuildCategory && channel.parentId !== category.id,
    ).size,
    roles: guild.roles.cache.filter((role) => role.id !== guild.id && role.members.size > 0).size,
  };
};

const shouldRefreshStatsVoiceChannels = (origin) => {
  if (origin === 'startup' || origin === 'slash-resync' || origin === 'slash-stats-refresh') return true;
  return Date.now() - lastStatsVoiceRefreshAt >= STATS_VOICE_REFRESH_INTERVAL_MS;
};

const refreshStatsDisplay = async (guild, origin) => {
  const category = await ensureStatsCategory(guild);
  await removeLegacyStatsTimeChannels(category);
  await removeStatsLiveChannels(category);
  const snapshot = await buildStatsSnapshot(guild, category);

  const channels = [];

  if (shouldRefreshStatsVoiceChannels(origin)) {
    for (const entry of buildStatsChannelNames(snapshot)) {
      const channel = await ensureManagedStatsVoiceChannel(guild, category, entry.prefix, entry.name);
      if (channel) {
        channels.push(channel);
      }
    }

    const currentOrder = [...category.children.cache.values()]
      .filter((channel) => channels.some((managedChannel) => managedChannel.id === channel.id))
      .sort(sortByPosition)
      .map((channel) => channel.id);
    const desiredOrder = channels.map((channel) => channel.id);

    if (currentOrder.join('|') !== desiredOrder.join('|')) {
      for (const [index, channel] of channels.entries()) {
        await tryDiscordWrite(
          channel.setPosition(index),
          `NeatherBeacon: position stats channel ${channel.name}`,
        );
      }
    }

    lastStatsVoiceRefreshAt = Date.now();
  }

  await ensureStatsCategoryLast(guild, category);

  state.lastStats = {
    at: new Date().toISOString(),
    snapshot,
    presenceCacheSize: guild.presences.cache.size,
  };
  updateRuntimeFiles();
};

const refreshStatsDisplaySafe = async (guild, origin) => {
  if (statsRefreshInFlight) {
    statsRefreshQueuedGuild = guild;
    return;
  }

  statsRefreshInFlight = true;

  try {
    await refreshStatsDisplay(guild, origin);
  } catch (error) {
    noteRuntimeError(`stats:${origin}`, error);
  } finally {
    statsRefreshInFlight = false;

    const queuedGuild = statsRefreshQueuedGuild;
    statsRefreshQueuedGuild = null;
    if (queuedGuild) {
      await refreshStatsDisplaySafe(queuedGuild, `${origin}:queued`);
    }
  }
};

const statsEventDebouncer = createStatsRefreshDebouncer(STATS_EVENT_DEBOUNCE_MS, refreshStatsDisplaySafe);
const queueStatsEventRefresh = (guild, origin) => {
  statsEventDebouncer.schedule(guild, origin);
};

const startStatsScheduler = () => {
  if (statsRefreshTimer || statsRefreshBootstrapTimer) {
    return;
  }

  const scheduleInterval = () => {
    if (statsRefreshTimer) {
      return;
    }

    statsRefreshTimer = setInterval(async () => {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        return;
      }

      await refreshStatsDisplaySafe(guild, 'interval');
    }, STATS_REFRESH_INTERVAL_MS);

    statsRefreshTimer.unref();
  };

  const initialDelay = STATS_REFRESH_INTERVAL_MS - (Date.now() % STATS_REFRESH_INTERVAL_MS);
  statsRefreshBootstrapTimer = setTimeout(async () => {
    statsRefreshBootstrapTimer = null;

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
      await refreshStatsDisplaySafe(guild, 'minute-boundary');
    }

    scheduleInterval();
  }, initialDelay);

  statsRefreshBootstrapTimer.unref();
};

const summarizeStatus = (guild) => {
  const supervisor = readJson(paths.supervisorStatePath);
  const museState = supervisor?.children?.muse;
  const adminState = supervisor?.children?.admin;
  return [
    '**🛰️ NeatherBeacon Alpha en bref**',
    '',
    '**État général**',
    formatLine('Version', state.version),
    formatLine('Uptime', formatDuration(state.startedAt)),
    formatLine('Serveur', `${guild.name} (${guild.id})`),
    formatLine('Alpha', adminState?.running ? 'en ligne' : 'hors ligne'),
    formatLine('Bravo', museState?.running ? 'en ligne' : 'hors ligne'),
    formatLine('Tâche active', state.activeTask || 'aucune'),
    '',
    '**Canaux suivis**',
    formatLine('Logs', state.logChannelId || 'non détecté'),
    formatLine('Événements', state.eventChannelId || 'non détecté'),
    '',
    '**Derniers signaux**',
    formatLine('Resync', formatTimestamp(state.lastSync?.at)),
    formatLine('Audit', formatTimestamp(state.lastAudit?.at)),
    formatLine('Stats', formatTimestamp(state.lastStats?.at)),
    formatLine('Palworld', UPTIME_KUMA_STATUS_PAGE_URL ? `${state.lastUptimeKuma?.status || 'en attente'} (${formatTimestamp(state.lastUptimeKuma?.at)})` : 'désactivé'),
    formatLine('Palworld REST', isPalworldRestConfigured() ? `${state.lastPalworldRest?.status || 'en attente'} (${formatTimestamp(state.lastPalworldRest?.at)})` : 'désactivé'),
    formatLine('Membre', state.lastMemberEvent || 'aucun'),
    formatLine('Vocal', state.lastVoiceEvent || 'aucun'),
    '',
    '**Détails techniques**',
    formatLine('Dépendances', `discord.js ${pkg.dependencies['discord.js']}, dotenv ${pkg.dependencies.dotenv}, undici ${pkg.overrides?.undici || 'non forcé'}`),
    formatLine('Hash commandes', commandHash),
    formatLine('Debounce Stats', `${STATS_EVENT_DEBOUNCE_MS}ms`),
    formatLine('Refresh Stats vocal', `${STATS_VOICE_REFRESH_INTERVAL_MS}ms`),
    formatLine('Fuseau horaire', BOT_TIMEZONE),
    formatLine('Présences en cache', state.lastStats?.presenceCacheSize ?? 'non détecté'),
    formatLine('Dernière erreur', state.lastError || 'aucune'),
    '',
    '*Adresse publique non requise en v1 : gateway Discord + slash commands.*',
  ].join('\n');
};

let taskInFlight = null;

const runManagedTask = async (taskName, runner) => {
  if (taskInFlight) {
    throw new Error(`Une tâche est déjà en cours : ${taskInFlight}`);
  }

  taskInFlight = taskName;
  markTask(taskName);

  try {
    return await runner();
  } finally {
    taskInFlight = null;
    clearTask();
  }
};

const runAudit = async (guild, origin) =>
  runManagedTask(`audit:${origin}`, async () => {
    const report = await auditGuild(guild);
    state.eventChannelId = report.eventChannelId || state.eventChannelId;
    state.logChannelId = report.logChannelId || state.logChannelId;
    state.lastAudit = {
      at: report.checkedAt,
      summary: report.summary,
    };
    state.healthy = true;
    updateRuntimeFiles();
    return report;
  });

const runSync = async (guild, origin) =>
  runManagedTask(`resync:${origin}`, async () => {
    const report = await syncGuild(guild);
    state.eventChannelId = report.eventChannelId || state.eventChannelId;
    state.logChannelId = report.logChannelId || state.logChannelId;
    state.lastSync = {
      at: report.checkedAt,
      summary: report.summary,
    };
    state.healthy = true;
    updateRuntimeFiles();
    return report;
  });

const formatMember = (member) => {
  const user = member?.user || member;
  const tag = user?.tag || user?.username || 'unknown-user';
  const id = member?.id || user?.id || 'unknown-id';
  return `${tag} (${id})`;
};

const formatDuration = (startedAt) => {
  const started = new Date(startedAt).getTime();
  const duration = Math.max(Date.now() - started, 0);
  const days = Math.floor(duration / 86400000);
  const hours = Math.floor((duration % 86400000) / 3600000);
  const minutes = Math.floor((duration % 3600000) / 60000);
  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
};

const replyPalworldRestNotConfigured = async (interaction) => {
  await interaction.reply({
    content: formatBotMessage('⚠️ Palworld REST désactivé', [
      'Les variables `BOT_PALWORLD_REST_API_URL`, `BOT_PALWORLD_REST_API_USERNAME` et `BOT_PALWORLD_REST_API_PASSWORD` doivent être configurées côté bot.',
    ]),
    ephemeral: true,
  });
};

const runPalworldMetricsCommand = async (interaction) => {
  if (!isPalworldRestConfigured()) {
    await replyPalworldRestNotConfigured(interaction);
    return;
  }

  const cooldownSeconds = reservePalworldMetricsCooldown();
  if (cooldownSeconds > 0) {
    await interaction.reply({
      content: formatBotMessage('⏳ Metrics Palworld', [
        `Les metrics sont limités globalement. Réessaie dans ${cooldownSeconds}s.`,
      ]),
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  await interaction.deferReply();

  try {
    const metrics = await fetchPalworldMetrics(getPalworldRestOptions());
    state.lastPalworldRest = {
      at: metrics.checkedAt,
      status: 'metrics-ok',
      players: metrics.currentPlayers,
    };
    updateRuntimeFiles();

    await interaction.editReply({
      content: formatPalworldMetrics(metrics, { timeZone: BOT_TIMEZONE }),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    state.lastPalworldRest = {
      at: new Date().toISOString(),
      status: 'metrics-error',
      players: state.lastPalworldRest?.players ?? null,
    };
    state.lastError = `palworld-metrics: ${error.message}`;
    updateRuntimeFiles();

    await interaction.editReply({
      content: formatBotMessage('⚠️ Metrics Palworld indisponibles', [
        "L'API REST Palworld ne répond pas correctement. Les détails techniques ont été envoyés aux logs.",
      ]),
    }).catch(() => undefined);
    await sendLog(interaction.guild, formatBotMessage('⚠️ Metrics Palworld indisponibles', [
      formatLine('Erreur', error.message),
    ]));
  }
};

const runPalworldAnnouncementCommand = async (interaction, guild) => {
  if (!isPalworldRestConfigured()) {
    await replyPalworldRestNotConfigured(interaction);
    return;
  }

  const palworldChannelId = getPalworldChannelId(guild);
  if (!palworldChannelId) {
    await interaction.reply({
      content: formatBotMessage('⚠️ Salon Palworld introuvable', [
        formatLine('Salon attendu', PALWORLD_CHANNEL_NAME),
      ]),
      ephemeral: true,
    });
    return;
  }

  if (interaction.channelId !== palworldChannelId) {
    await interaction.reply({
      content: formatBotMessage('📣 Annonce Palworld', [
        `Utilise cette commande directement dans <#${palworldChannelId}> pour que l’annonce Discord reste au bon endroit.`,
      ]),
      ephemeral: true,
    });
    return;
  }

  const message = normalizeAnnouncementMessage(interaction.options.getString('message', true));
  await interaction.deferReply({ ephemeral: true });

  try {
    await sendPalworldAnnouncement({
      ...getPalworldRestOptions(),
      message,
    });

    const discordAnnouncementSent = await sendPalworldPublicMessage(
      guild,
      formatPalworldAnnouncementForDiscord({
        message,
        authorName: interaction.member?.displayName || interaction.user.tag || interaction.user.username,
      }),
    );

    await interaction.editReply({
      content: discordAnnouncementSent
        ? formatBotMessage('📣 Annonce Palworld envoyée', [
          'Elle est visible dans Discord et relayée en jeu.',
        ])
        : formatBotMessage('⚠️ Annonce Palworld partielle', [
          "Elle a été relayée en jeu, mais Discord n'a pas confirmé la publication publique.",
          'Les détails techniques ont été envoyés aux logs.',
        ]),
    });

    state.lastPalworldRest = {
      at: new Date().toISOString(),
      status: 'announce-ok',
      players: state.lastPalworldRest?.players ?? null,
    };
    updateRuntimeFiles();

    await sendLog(guild, formatBotMessage(discordAnnouncementSent ? '📣 Annonce Palworld' : '⚠️ Annonce Palworld partielle', [
      formatLine('Auteur', formatMember(interaction.member)),
      formatLine('Salon', PALWORLD_CHANNEL_NAME),
      formatLine('Visible dans Discord', discordAnnouncementSent ? 'oui' : 'non confirmé'),
      formatLine('Relayée en jeu', 'oui'),
    ]));
  } catch (error) {
    state.lastPalworldRest = {
      at: new Date().toISOString(),
      status: 'announce-error',
      players: state.lastPalworldRest?.players ?? null,
    };
    state.lastError = `palworld-announce: ${error.message}`;
    updateRuntimeFiles();

    await interaction.editReply({
      content: formatBotMessage('⚠️ Annonce Palworld non envoyée', [
        "L'annonce n'a pas été publiée parce que l'API REST Palworld n'a pas confirmé la réception.",
      ]),
    }).catch(() => undefined);

    await sendLog(guild, formatBotMessage('⚠️ Annonce Palworld échouée', [
      formatLine('Auteur', formatMember(interaction.member)),
      formatLine('Erreur', error.message),
    ]));
  }
};

const helpText = [
  '**🧭 Aide rapide - NeatherBeacon**',
  '',
  'Alpha gère le serveur, les logs et les stats. Bravo s’occupe de la musique via Muse.',
  '',
  '**Fonctions**',
  '- audit non destructif du serveur cible',
  '- resynchronisation additive des rôles, catégories et salons gérés',
  '- logs des arrivées, départs et mouvements vocaux',
  '- catégorie Stats publique, vocale, verrouillée, mise à jour toutes les 5 minutes avec les KPI joueurs',
  '- Palworld: metrics publics, connexions/déconnexions et annonces Discord vers jeu',
  '- Muse auto-hébergé dans le même conteneur',
  `- commandes admin: ${formatCommandList(['/status', '/audit', '/resync', '/help', '/welcome-preview', '/stats-refresh', '/diag', '/cache-status'])}`,
  `- commande admin/modo: ${formatCommandList(['/announce-palworld'])}`,
  `- commandes Palworld publiques: ${formatCommandList(['/metrics-palworld'])}`,
  `- commandes Pokédex publiques: ${formatCommandList(['/pokemon', '/weakness', '/move', '/ability', '/type', '/random-pokemon'])}`,
  '',
  '**Prérequis**',
  '- deux bots Discord distincts',
  '- scope OAuth2 bot + applications.commands pour le bot admin',
  '- Server Members Intent pour le bot admin',
  '- Presence Intent pour les KPI en ligne / absent / déco',
  '- Manage Guild, Manage Roles, Manage Channels pour le bot admin',
  '- REST API Palworld activée si les commandes et événements Palworld sont utilisés',
  '',
  '**Notes**',
  "- aucune adresse publique n'est nécessaire en v1",
  '- le bot ne supprime pas les ressources existantes',
].join('\n');

const buildStartupLogMessage = (startupReport) =>
  [
    '**🟢 NeatherBeacon Alpha est en ligne**',
    '',
    'Alpha est revenu en ligne. J’ai relu la structure du serveur sans toucher à l’existant.',
    '',
    '**Synchronisation**',
    formatLine('Résultat', startupReport.summary),
    formatLine('Mode', 'additif et non destructif'),
    '',
    '**Raccourcis admin**',
    formatCommandList(['/status', '/audit', '/resync', '/help', '/welcome-preview', '/stats-refresh', '/diag', '/cache-status']),
    '',
    '**Raccourci staff Palworld**',
    formatCommandList(['/announce-palworld']),
    '',
    '**Commandes publiques**',
    formatCommandList(['/metrics-palworld', '/pokemon', '/weakness', '/move', '/ability', '/type', '/random-pokemon']),
    '',
    '**À savoir**',
    '- Les logs techniques arrivent ici.',
    '- Les arrivées, départs et mouvements vocaux restent dans le canal public prévu.',
    '- Les Stats tournent automatiquement et restent visibles.',
  ].join('\n');

client.once('clientReady', async () => {
  try {
    const guild = await refreshGuild();
    state.guildName = guild.name;

    await registerSlashCommands(guild);

    const startupReport = await runSync(guild, 'startup');
    state.eventChannelId = startupReport.eventChannelId || state.eventChannelId;
    state.logChannelId = startupReport.logChannelId || state.logChannelId;
    state.readyAt = new Date().toISOString();
    state.healthy = true;
    updateRuntimeFiles();

    await refreshStatsDisplaySafe(guild, 'startup');
    startStatsScheduler();
    startUptimeKumaScheduler(guild);
    startPalworldPlayerScheduler(guild);

    await sendLog(
      guild,
      buildStartupLogMessage(startupReport),
    );
    console.log(`Admin bot ready for guild ${guild.name} (${guild.id}).`);
  } catch (error) {
    state.lastError = error.message;
    state.healthy = false;
    updateRuntimeFiles();
    console.error(error);
    process.exit(1);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.guildId !== GUILD_ID || !POKEDEX_COMMAND_NAMES.has(interaction.commandName)) {
      await interaction.respond([]).catch(() => undefined);
      return;
    }

    try {
      const focused = interaction.options.getFocused(true);
      const choices = await autocompletePokedex(interaction.commandName, focused.value);
      await interaction.respond(choices);
    } catch (error) {
      console.error(`[autocomplete:${interaction.commandName}] failed`, error);
      await interaction.respond([]).catch(() => undefined);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== GUILD_ID) {
    await interaction.reply({
      content: formatBotMessage('⛔ Mauvais serveur', ["Ce bot ne gère qu'un seul serveur cible."]),
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  if (POKEDEX_COMMAND_NAMES.has(interaction.commandName)) {
    const cooldownSeconds = getPublicCommandCooldown(interaction.user.id);
    if (cooldownSeconds > 0) {
      await interaction.reply({
        content: formatBotMessage('⏳ Doucement', [
          `Attends encore ${cooldownSeconds}s avant une autre commande publique.`,
        ]),
        ephemeral: true,
      }).catch(() => undefined);
      return;
    }

    try {
      await interaction.deferReply();
      const result = await runPokedexCommand(interaction);
      try {
        await interaction.editReply(normalizeDiscordReplyPayload(result));
      } catch (sendError) {
        console.error(`[pokedex:${interaction.commandName}] reply failed`, sendError);
        await interaction.editReply(normalizePokedexFallbackPayload(result, sendError));
      }
    } catch (error) {
      console.error(`[pokedex:${interaction.commandName}] lookup failed`, error);
      const content = formatPokedexLookupError(error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => undefined);
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
      }
    }
    return;
  }

  if (interaction.commandName === 'metrics-palworld') {
    await runPalworldMetricsCommand(interaction);
    return;
  }

  if (STAFF_COMMAND_NAMES.has(interaction.commandName)) {
    if (!hasStaffAccess(interaction)) {
      await interaction.reply({
        content: formatBotMessage('🔒 Accès refusé', ['Commande réservée aux administrateurs et modérateurs.']),
        ephemeral: true,
      }).catch(() => undefined);
      return;
    }

    try {
      const guild = await refreshGuild();
      state.guildName = guild.name;
      updateRuntimeFiles();

      if (interaction.commandName === 'announce-palworld') {
        await runPalworldAnnouncementCommand(interaction, guild);
        return;
      }
    } catch (error) {
      state.lastError = error.message;
      state.healthy = false;
      updateRuntimeFiles();
      const payload = {
        content: formatBotMessage('⚠️ Erreur Alpha', [
          formatLine('Message', error.message),
        ]),
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply(payload).catch(() => undefined);
      }
      return;
    }
  }

  if (!hasAdminAccess(interaction)) {
    await interaction.reply({
      content: formatBotMessage('🔒 Accès refusé', ['Commande réservée aux administrateurs.']),
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  try {
    const guild = await refreshGuild();
    state.guildName = guild.name;
    updateRuntimeFiles();

    if (interaction.commandName === 'status') {
      await interaction.reply({ content: summarizeStatus(guild), ephemeral: true });
      return;
    }

    if (interaction.commandName === 'help') {
      await interaction.reply({ content: helpText, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'welcome-preview') {
      await interaction.reply({
        content: formatBotMessage("👀 Prévisualisation de l'accueil", [
          buildWelcomeMessage(interaction.member),
        ]),
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'diag') {
      const supervisor = readJson(paths.supervisorStatePath);
      await interaction.reply({
        content: formatDiagnostics({
          state,
          guild,
          supervisor,
          pingMs: client.ws.ping,
          commandHash,
          commandCount: commandPayload.length,
          dependencies: {
            discordJs: pkg.dependencies['discord.js'],
            dotenv: pkg.dependencies.dotenv,
          },
          timeZone: BOT_TIMEZONE,
          secrets: knownSecretValues(),
        }),
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'cache-status') {
      await interaction.reply({
        content: formatCacheStatus({
          runtimeDir: paths.runtimeDir,
          timeZone: BOT_TIMEZONE,
        }),
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    if (interaction.commandName === 'audit') {
      const report = await runAudit(guild, 'slash');
      const message = formatReportForChat(report);
      await interaction.editReply({ content: message });
      await sendLog(guild, formatBotMessage('🔎 Audit admin', [
        formatLine('Résumé', report.summary),
      ]));
      return;
    }

    if (interaction.commandName === 'resync') {
      const report = await runSync(guild, 'slash');
      await refreshStatsDisplaySafe(guild, 'slash-resync');
      const message = formatReportForChat(report);
      await interaction.editReply({ content: message });
      await sendLog(guild, formatBotMessage('🔁 Resync admin', [
        formatLine('Résumé', report.summary),
      ]));
      return;
    }

    if (interaction.commandName === 'stats-refresh') {
      await refreshStatsDisplaySafe(guild, 'slash-stats-refresh');
      await interaction.editReply({
        content: formatBotMessage('📊 Stats rafraîchies', [
          'Les salons vocaux de statistiques ont été mis à jour.',
        ]),
      });
      await sendLog(guild, formatBotMessage('📊 Stats forcées', [
        formatLine('Action', 'commande admin `/stats-refresh`'),
      ]));
    }
  } catch (error) {
    state.lastError = error.message;
    state.healthy = false;
    updateRuntimeFiles();
    const payload = {
      content: formatBotMessage('⚠️ Erreur Alpha', [
        formatLine('Message', error.message),
      ]),
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => undefined);
    } else {
      await interaction.reply(payload).catch(() => undefined);
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  await assignDefaultMemberRole(member);
  await sendEventLog(member.guild, formatBotMessage('✨ Nouveau membre', [
    `${member} vient de rejoindre le serveur.`,
    formatLine('Rôle automatique', DEFAULT_MEMBER_ROLE_NAME),
  ]));
  state.lastMemberEvent = `Arrivée : ${formatMember(member)}`;
  updateRuntimeFiles();
  if (!member.user?.bot) {
    await sendWelcomeMessage(member);
  }
  await refreshStatsDisplaySafe(member.guild, 'member-add');
});

client.on('guildMemberRemove', async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  await sendEventLog(member.guild, formatBotMessage('👋 Départ', [
    `${formatMember(member)} vient de quitter le serveur.`,
  ]));
  state.lastMemberEvent = `Départ : ${formatMember(member)}`;
  updateRuntimeFiles();
  await refreshStatsDisplaySafe(member.guild, 'member-remove');
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (oldState.guildId !== GUILD_ID) return;
  if (oldState.channelId === newState.channelId) return;

  const member = newState.member || oldState.member;
  const before = oldState.channel?.name ?? null;
  const after = newState.channel?.name ?? null;

  if (!before && after) {
    await sendEventLog(newState.guild, formatBotMessage('🎙️ Vocal', [
      formatLine('Membre', formatMember(member)),
      formatLine('Action', `a rejoint ${after}`),
    ]));
    state.lastVoiceEvent = `${formatMember(member)} a rejoint ${after}`;
  } else if (before && !after) {
    await sendEventLog(oldState.guild, formatBotMessage('🎙️ Vocal', [
      formatLine('Membre', formatMember(member)),
      formatLine('Action', `a quitté ${before}`),
    ]));
    state.lastVoiceEvent = `${formatMember(member)} a quitté ${before}`;
  } else if (before && after) {
    await sendEventLog(newState.guild, formatBotMessage('🎙️ Vocal', [
      formatLine('Membre', formatMember(member)),
      formatLine('Avant', before),
      formatLine('Après', after),
    ]));
    state.lastVoiceEvent = `${formatMember(member)} a changé de salon: ${before} -> ${after}`;
  }
  updateRuntimeFiles();

  queueStatsEventRefresh(newState.guild, 'voice-state');
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  const guild = newPresence?.guild || oldPresence?.guild;
  if (!guild || guild.id !== GUILD_ID) return;

  const before = oldPresence?.status || 'offline';
  const after = newPresence?.status || 'offline';
  if (before === after) return;

  queueStatsEventRefresh(guild, 'presence-update');
});

process.on('SIGTERM', () => {
  state.healthy = false;
  updateRuntimeFiles();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  state.healthy = false;
  updateRuntimeFiles();
  client.destroy();
  process.exit(0);
});

startHeartbeat();
client.login(BOT_TOKEN);
