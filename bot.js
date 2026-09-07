const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
} = require('discord.js');
const { config } = require('dotenv');
config();

const { validateBotEnvironment } = require('./lib/env');
const env = validateBotEnvironment(process.env);
const { paths } = require('./lib/config');
const {
  createCooldown,
  resolveAllowedChannels,
  defaultMemberRole,
  hasAdminAccess: interactionHasAdminAccess,
  hasStaffAccess: interactionHasStaffAccess,
} = require('./lib/access-control');
const {
  commandPayloadForProfile,
  commandPayloadHash,
} = require('./lib/commands');
const {
  plan,
  auditGuild,
  syncGuild,
  findManagedChannelIdByName,
  findManagedLogChannelId,
} = require('./lib/reconcile');
const { loadManagedIds, assertRegistryIdentity } = require('./lib/managed-ids');
const {
  createAdminState,
  readJson,
  updateRuntimeFiles: writeRuntimeFiles,
} = require('./lib/runtime-state');
const { createStatsManager } = require('./lib/stats');
const {
  createPalworldRestClient,
  formatPalworldAnnouncementForDiscord,
  normalizeAnnouncementMessage,
} = require('./lib/palworld-rest');
const {
  createPalworldPublicClient,
  formatPublicPalworldStatus,
} = require('./lib/palworld-public');
const { sanitizePalworldText } = require('./lib/palworld-safety');
const {
  SUMMARY_COMMAND_NAME,
  buildDailySummaryMessage,
  createDailySummarySettings,
  getPreviousLocalDateKey,
  inspectSummaryAvailability,
} = require('./lib/daily-summary');
const {
  formatAbilitySummary,
  formatMoveSummary,
  formatPokemonSummary,
  formatRandomPokemonSummary,
  formatTypeSummary,
  formatWeaknessSummary,
} = require('./lib/pokedex');
const { acknowledgeInteraction, replyToInteraction } = require('./lib/interaction-response');
const { createInteractionHandler } = require('./lib/interaction-router');
const { publicVoiceTransition } = require('./lib/voice-events');
const { museProcessState } = require('./lib/service-health');
const pkg = require('./package.json');

const BOT_TOKEN = env.DISCORD_BOT_TOKEN;
const GUILD_ID = env.DISCORD_GUILD_ID;
const BOT_TIMEZONE = env.BOT_TIMEZONE;
const BOT_PROFILE = env.BOT_PROFILE;
const FULL_PROFILE_ENABLED = BOT_PROFILE === 'full';
const commandPayload = commandPayloadForProfile(BOT_PROFILE);
const enabledCommandNames = new Set(commandPayload.map((command) => command.name));
const commandHash = commandPayloadHash(commandPayload);

fs.mkdirSync(paths.runtimeDir, { recursive: true });

const ADMIN_ROLE_NAME = plan.adminRoleName;
const DEFAULT_MEMBER_ROLE_NAME = plan.defaultMemberRoleName;
const WELCOME_CHANNEL_NAME = plan.welcomeChannelName;
const STATS_EVENT_DEBOUNCE_MS = env.BOT_STATS_EVENT_DEBOUNCE_MS;
const STATS_VOICE_REFRESH_INTERVAL_MS = env.BOT_STATS_VOICE_REFRESH_INTERVAL_MS;
const PALWORLD_CHANNEL_NAME = env.BOT_PALWORLD_CHANNEL_NAME;
const dailySummarySettings = createDailySummarySettings(
  {
    ...process.env,
    BOT_PALWORLD_CHANNEL_NAME: PALWORLD_CHANNEL_NAME,
    BOT_TIMEZONE,
    GAYLEMON_PUBLIC_BASE_URL: env.GAYLEMON_PUBLIC_BASE_URL,
  },
);
const PALWORLD_REST_API_URL = env.BOT_PALWORLD_REST_API_URL;
const PALWORLD_REST_API_USERNAME = env.BOT_PALWORLD_REST_API_USERNAME;
const PALWORLD_REST_API_PASSWORD = env.BOT_PALWORLD_REST_API_PASSWORD;
const PALWORLD_REST_FETCH_TIMEOUT_MS = env.BOT_PALWORLD_REST_FETCH_TIMEOUT_MS;
const PALWORLD_REST_CIRCUIT_BREAKER_MS = env.BOT_PALWORLD_REST_CIRCUIT_BREAKER_MS;
const PALWORLD_METRICS_COOLDOWN_MS = env.BOT_PALWORLD_METRICS_COOLDOWN_MS;
const PALWORLD_ADMIN_COOLDOWN_MS = env.BOT_PALWORLD_ADMIN_COOLDOWN_MS;
const PALWORLD_PUBLIC_FETCH_TIMEOUT_MS = env.BOT_PALWORLD_PUBLIC_FETCH_TIMEOUT_MS;
const PALWORLD_PUBLIC_CACHE_TTL_MS = env.BOT_PALWORLD_PUBLIC_CACHE_TTL_MS;
const PALWORLD_ADMIN_CHANNEL_IDS = env.BOT_PALWORLD_ADMIN_CHANNEL_IDS;
const PALWORLD_ADMIN_CHANNEL_NAMES = env.BOT_PALWORLD_ADMIN_CHANNEL_NAMES.length
  ? env.BOT_PALWORLD_ADMIN_CHANNEL_NAMES
  : [PALWORLD_CHANNEL_NAME];
const MOD_ROLE_NAME = 'Mod';
const PUBLIC_COMMAND_COOLDOWN_MS = 5000;
const publicCommandCooldown = createCooldown({ durationMs: PUBLIC_COMMAND_COOLDOWN_MS });
const pokedexGlobalCooldown = createCooldown({ durationMs: env.BOT_POKEAPI_GLOBAL_COOLDOWN_MS });
const palworldMetricsCooldown = createCooldown({ durationMs: PALWORLD_METRICS_COOLDOWN_MS });
const palworldAdminCooldown = createCooldown({ durationMs: PALWORLD_ADMIN_COOLDOWN_MS });

const palworldPublicClient = createPalworldPublicClient({
  publicBaseUrl: env.GAYLEMON_PUBLIC_BASE_URL,
  timeoutMs: PALWORLD_PUBLIC_FETCH_TIMEOUT_MS,
  cacheTtlMs: PALWORLD_PUBLIC_CACHE_TTL_MS,
});

const palworldAdminClient = (PALWORLD_REST_API_URL && PALWORLD_REST_API_USERNAME && PALWORLD_REST_API_PASSWORD)
  ? createPalworldRestClient({
    apiUrl: PALWORLD_REST_API_URL,
    username: PALWORLD_REST_API_USERNAME,
    password: PALWORLD_REST_API_PASSWORD,
    timeoutMs: PALWORLD_REST_FETCH_TIMEOUT_MS,
    circuitBreakerMs: PALWORLD_REST_CIRCUIT_BREAKER_MS,
  })
  : null;

const formatLine = (label, value) => `- **${label}** : ${value}`;

const formatBotMessage = (title, lines = []) => [
  `**${title}**`,
  ...lines,
].join('\n');

const formatCommandList = (commands) => commands.map((command) => `\`${command}\``).join(' ');

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

const state = createAdminState({
  version: pkg.version,
  guildId: GUILD_ID,
});

let stopping = false;
const updateRuntimeFiles = () => {
  state.gatewayReady = !stopping && client.isReady();
  state.healthy = Boolean(state.readyAt && state.gatewayReady);
  writeRuntimeFiles(state);
};

const startHeartbeat = () => {
  updateRuntimeFiles();
  setInterval(updateRuntimeFiles, 15000).unref();
};

const gatewayIntents = [GatewayIntentBits.Guilds];
if (FULL_PROFILE_ENABLED) {
  gatewayIntents.push(
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  );
}

const client = new Client({ intents: gatewayIntents });

const getManagedRoleIds = () => {
  const registry = assertRegistryIdentity(loadManagedIds(), GUILD_ID, plan);
  if (registry.guildId !== GUILD_ID) {
    return { adminRoleId: null, modRoleId: null };
  }
  return {
    adminRoleId: registry.roles?.[ADMIN_ROLE_NAME] || null,
    modRoleId: registry.roles?.[MOD_ROLE_NAME] || null,
  };
};

const readServiceState = () => ({
  children: {
    admin: { running: state.healthy },
    muse: museProcessState(readJson(paths.museStatePath)),
  },
});

const hasAdminAccess = (interaction) => {
  return interactionHasAdminAccess(interaction, getManagedRoleIds().adminRoleId);
};

const hasStaffAccess = (interaction) => {
  return interactionHasStaffAccess(interaction, getManagedRoleIds());
};

const isPalworldRestConfigured = () =>
  Boolean(PALWORLD_REST_API_URL && PALWORLD_REST_API_USERNAME && PALWORLD_REST_API_PASSWORD);

const getPublicCommandCooldown = (userId) => publicCommandCooldown.reserve(userId);

const reservePalworldMetricsCooldown = () => palworldMetricsCooldown.reserve('metrics-palworld');

const reservePalworldAdminCooldown = () => palworldAdminCooldown.reserve('palworld-admin');

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

const formatPokedexLookupError = () =>
  formatBotMessage('⚠️ Pokédex', [
    formatLine('Erreur', 'La recherche ne peut pas être terminée pour le moment.'),
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

const resolveDailySummaryChannels = (guild) => resolveAllowedChannels(guild, {
  channelIds: dailySummarySettings.commandChannelIds, channelNames: dailySummarySettings.commandChannelNames,
});
const resolvePalworldAdminChannels = (guild) => resolveAllowedChannels(guild, {
  channelIds: PALWORLD_ADMIN_CHANNEL_IDS, channelNames: PALWORLD_ADMIN_CHANNEL_NAMES,
});

const handleDailySummaryCommand = async (interaction, guild) => {
  const allowedChannels = resolveDailySummaryChannels(guild);
  const isAllowed = allowedChannels.some((channel) => channel.id === interaction.channelId);

  if (!isAllowed) {
    const channelList = allowedChannels.length
      ? allowedChannels.map((channel) => `<#${channel.id}>`).join(', ')
      : dailySummarySettings.commandChannelNames.map((name) => `#${name}`).join(', ');
    await replyToInteraction(interaction, {
      content: formatBotMessage('📊 Résumé Gaylemon', [
        `Utilise cette commande dans ${channelList || 'le salon Palworld configuré'}.`,
      ]),
      ephemeral: true,
    });
    return;
  }

  await acknowledgeInteraction(interaction, { ephemeral: false });
  const dateKey = getPreviousLocalDateKey(new Date(), dailySummarySettings.timeZone);
  const availability = await inspectSummaryAvailability(dailySummarySettings, dateKey);
  await interaction.editReply(buildDailySummaryMessage(dailySummarySettings, dateKey, availability));
  state.lastDailySummary = {
    at: new Date().toISOString(),
    dateKey,
    origin: 'manual',
    channels: [interaction.channelId],
    verified: Boolean(availability.ok),
    detail: availability.detail,
  };
  updateRuntimeFiles();
  await sendLog(guild, formatBotMessage('📊 Résumé Gaylemon manuel', [
    formatLine('Salon', interaction.channel?.name || interaction.channelId),
    formatLine('Journée', dateKey),
    formatLine('Vérifié', availability.ok ? 'oui' : 'non'),
  ]));
};

const sendPalworldPublicMessage = async (guild, message) => {
  const channelId = getPalworldChannelId(guild);
  if (!channelId) {
    return false;
  }

  const sent = await sendMessageToChannel(guild, channelId, message, { allowedMentions: { parse: [] } });
  return Boolean(sent);
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

  let role;
  try {
    const registry = assertRegistryIdentity(loadManagedIds(), member.guild.id, plan);
    role = defaultMemberRole(member.guild, registry, plan.roles.find((definition) => definition.name === DEFAULT_MEMBER_ROLE_NAME));
  } catch (error) { noteRuntimeError('default-member-role', error); }
  if (!role) {
    noteRuntimeError('default-member-role', new Error('Rôle d’arrivée non attribué : identifiant absent ou permissions non conformes.'));
    return;
  }

  if (member.roles.cache.has(role.id)) return;

  await member.roles.add(role, "NetherBeacon: rôle par défaut pour un nouveau membre").catch(async (error) => {
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
  PALWORLD_REST_API_URL,
  PALWORLD_REST_API_USERNAME,
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
  const safeMessage = sanitizePalworldText(error?.message || 'erreur interne', knownSecretValues());
  state.lastError = `${origin}: ${safeMessage}`;
  updateRuntimeFiles();
  console.error(`[${origin}] ${safeMessage}`);
};

const { refresh: refreshStatsDisplaySafe, schedule: queueStatsEventRefresh, start: startStatsScheduler } = createStatsManager({
  state, updateRuntimeFiles, noteRuntimeError, client, guildId: GUILD_ID, timeZone: BOT_TIMEZONE,
  debounceMs: STATS_EVENT_DEBOUNCE_MS, refreshIntervalMs: STATS_VOICE_REFRESH_INTERVAL_MS,
});

const summarizeStatus = (guild) => {
  const services = readServiceState();
  const museState = services?.children?.muse;
  const adminState = services?.children?.admin;
  return [
    '**🛰️ NetherBeacon Alpha en bref**',
    '',
    '**État général**',
    formatLine('Version', state.version),
    formatLine('Profil', BOT_PROFILE),
    formatLine('Uptime', formatDuration(state.startedAt)),
    formatLine('Serveur', `${guild.name} (${guild.id})`),
    formatLine('Alpha', adminState?.running ? 'en ligne' : 'hors ligne'),
    formatLine('Bravo', museState?.running ? 'processus actif · connexion Discord non vérifiée' : 'processus absent ou signal périmé'),
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
    formatLine('Résumé Gaylemon', state.lastDailySummary ? `${state.lastDailySummary.dateKey} (${formatTimestamp(state.lastDailySummary.at)})` : 'en attente'),
    formatLine('Palworld public', state.lastPalworldRest ? `${state.lastPalworldRest.status || 'en attente'} (${formatTimestamp(state.lastPalworldRest.at)})` : 'en attente'),
    formatLine('API admin Palworld', isPalworldRestConfigured() ? 'configurée pour les annonces staff' : 'désactivée'),
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
    formatLine('Dernière erreur', sanitizePalworldText(state.lastError || 'aucune', knownSecretValues())),
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
  await replyToInteraction(interaction, {
    content: formatBotMessage('⚠️ API admin Palworld désactivée', [
      'La passerelle admin locale n’est pas configurée côté bot.',
    ]),
    ephemeral: true,
  });
};

const runPalworldMetricsCommand = async (interaction) => {
  const cooldownSeconds = reservePalworldMetricsCooldown();
  if (cooldownSeconds > 0) {
    await replyToInteraction(interaction, {
      content: formatBotMessage('⏳ Metrics Palworld', [
        `Les metrics sont limités globalement. Réessaie dans ${cooldownSeconds}s.`,
      ]),
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  await acknowledgeInteraction(interaction, { ephemeral: false });

  try {
    const metrics = await palworldPublicClient.fetchStatus();
    state.lastPalworldRest = {
      at: metrics.checkedAt || new Date().toISOString(),
      status: metrics.fresh ? 'public-ok' : 'public-stale',
      players: metrics.players,
    };
    updateRuntimeFiles();

    await interaction.editReply({
      content: formatPublicPalworldStatus(metrics, { timeZone: BOT_TIMEZONE }),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    state.lastPalworldRest = {
      at: new Date().toISOString(),
      status: 'public-error',
      players: state.lastPalworldRest?.players ?? null,
    };
    state.lastError = 'palworld-public: donnees publiques indisponibles';
    updateRuntimeFiles();

    await interaction.editReply({
      content: formatBotMessage('⚠️ Metrics Palworld indisponibles', [
        'Les données publiques Gaylemon ne sont pas disponibles pour le moment.',
      ]),
    }).catch(() => undefined);
    await sendLog(interaction.guild, formatBotMessage('⚠️ Metrics Palworld indisponibles', [
      formatLine('Source', 'JSON publics Gaylemon'),
      formatLine('État', 'indisponible'),
    ]));
  }
};

const runPalworldAnnouncementCommand = async (interaction, guild) => {
  if (!isPalworldRestConfigured() || !palworldAdminClient) {
    await replyPalworldRestNotConfigured(interaction);
    return;
  }

  const allowedChannels = resolvePalworldAdminChannels(guild);
  const isAllowedChannel = allowedChannels.some((channel) => channel.id === interaction.channelId);
  if (!isAllowedChannel) {
    const channelList = allowedChannels.length
      ? allowedChannels.map((channel) => `<#${channel.id}>`).join(', ')
      : PALWORLD_ADMIN_CHANNEL_NAMES.map((name) => `#${name}`).join(', ');
    await replyToInteraction(interaction, {
      content: formatBotMessage('📣 Annonce Palworld', [
        `Utilise cette commande dans ${channelList || 'le salon Palworld configuré'}.`,
      ]),
      ephemeral: true,
    });
    return;
  }

  const palworldChannelId = getPalworldChannelId(guild);
  if (!palworldChannelId) {
    await replyToInteraction(interaction, {
      content: formatBotMessage('⚠️ Salon Palworld introuvable', [
        formatLine('Salon attendu', PALWORLD_CHANNEL_NAME),
      ]),
      ephemeral: true,
    });
    return;
  }

  let message;
  try {
    message = normalizeAnnouncementMessage(interaction.options.getString('message', true));
  } catch (error) {
    await replyToInteraction(interaction, {
      content: formatBotMessage('⚠️ Annonce Palworld', [
        'Le message est vide ou trop long.',
      ]),
      ephemeral: true,
    });
    return;
  }

  const cooldownSeconds = reservePalworldAdminCooldown();
  if (cooldownSeconds > 0) {
    await replyToInteraction(interaction, {
      content: formatBotMessage('⏳ Annonce Palworld', [
        `Réessaie dans ${cooldownSeconds}s.`,
      ]),
      ephemeral: true,
    });
    return;
  }

  await acknowledgeInteraction(interaction);

  try {
    await palworldAdminClient.sendAnnouncement(message);

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
      formatLine('Salon source', interaction.channel?.name || 'salon autorisé'),
      formatLine('Salon public', PALWORLD_CHANNEL_NAME),
      formatLine('Visible dans Discord', discordAnnouncementSent ? 'oui' : 'non confirmé'),
      formatLine('Relayée en jeu', 'oui'),
    ]));
  } catch (error) {
    state.lastPalworldRest = {
      at: new Date().toISOString(),
      status: 'announce-error',
      players: state.lastPalworldRest?.players ?? null,
    };
    state.lastError = 'palworld-announce: api-admin-indisponible';
    updateRuntimeFiles();

    await interaction.editReply({
      content: formatBotMessage('⚠️ Livraison Palworld non confirmée', [
        'La passerelle n’a pas confirmé la livraison. Vérifie en jeu avant de réessayer pour éviter un doublon.',
      ]),
    }).catch(() => undefined);

    await sendLog(guild, formatBotMessage('⚠️ Annonce Palworld échouée', [
      formatLine('Auteur', formatMember(interaction.member)),
      formatLine('État', 'passerelle locale indisponible'),
    ]));
  }
};

const buildStartupLogMessage = (startupReport) =>
  [
    '**🟢 NetherBeacon Alpha est en ligne**',
    '',
    'Alpha est revenu en ligne. La structure et les permissions gérées ont été synchronisées.',
    '',
    '**Synchronisation**',
    formatLine('Résultat', startupReport.summary),
    formatLine('Mode', 'ressources non destructives, permissions strictes'),
    '',
    '**Raccourcis admin**',
    formatCommandList(['/status', '/audit', '/resync', '/help', '/welcome-preview', '/stats-refresh', '/diag', '/cache-status']),
    '',
    '**Raccourci staff Palworld**',
    formatCommandList(['/announce-palworld']),
    '',
    '**Commandes publiques**',
    formatCommandList(['/metrics-palworld', `/${SUMMARY_COMMAND_NAME}`, '/pokemon', '/weakness', '/move', '/ability', '/type', '/random-pokemon']),
    '',
    '**À savoir**',
    '- Les logs techniques arrivent ici.',
    '- Les arrivées, départs et mouvements vocaux restent dans le canal public prévu.',
    '- Consulte `/status` pour le résultat des dernières statistiques.',
  ].join('\n');

client.once('clientReady', async () => {
  try {
    const guild = await refreshGuild();
    state.guildName = guild.name;

    await registerSlashCommands(guild);

    let startupReport = null;
    if (FULL_PROFILE_ENABLED) {
      startupReport = await runSync(guild, 'startup');
      state.eventChannelId = startupReport.eventChannelId || state.eventChannelId;
      state.logChannelId = startupReport.logChannelId || state.logChannelId;
    }
    state.readyAt = new Date().toISOString();
    state.healthy = true;
    updateRuntimeFiles();

    if (FULL_PROFILE_ENABLED) {
      const startupStats = await refreshStatsDisplaySafe(guild, 'startup');
      startStatsScheduler();
      const statsNotice = startupStats.status === 'failed' ? '\n\n⚠️ Stats indisponibles : vérifie les identifiants avec capture:ids avant leur remise en service.' : '';
      await sendLog(guild, buildStartupLogMessage(startupReport) + statsNotice);
    }
    console.log(`Admin bot ready for guild ${guild.name} (${guild.id}) with ${BOT_PROFILE} profile.`);
  } catch (error) {
    state.lastError = sanitizePalworldText(error?.message || 'startup failed', knownSecretValues());
    stopping = true;
    state.healthy = false;
    updateRuntimeFiles();
    console.error(state.lastError);
    process.exit(1);
  }
});

const handleInteraction = createInteractionHandler({
  GUILD_ID,
  enabledCommandNames,
  BOT_PROFILE,
  hasAdminAccess,
  hasStaffAccess,
  getPublicCommandCooldown,
  pokedexGlobalCooldown,
  runPokedexCommand,
  formatPokedexLookupError,
  runPalworldMetricsCommand,
  handleDailySummaryCommand,
  state,
  updateRuntimeFiles,
  runPalworldAnnouncementCommand,
  knownSecretValues,
  refreshGuild,
  summarizeStatus,
  buildWelcomeMessage,
  readServiceState,
  client,
  commandHash,
  commandPayload,
  BOT_TIMEZONE,
  runAudit,
  sendLog,
  runSync,
  refreshStatsDisplaySafe,
  formatBotMessage,
  formatLine
});
client.on('interactionCreate', (interaction) => {
  void handleInteraction(interaction).catch(async (error) => {
    noteRuntimeError('interaction', error);
    if (interaction.isChatInputCommand()) await replyToInteraction(interaction, { content: 'La commande ne peut pas être terminée. Consulte les diagnostics.', ephemeral: true }).catch(() => undefined);
  });
});

client.on('guildMemberAdd', async (member) => {
  if (!FULL_PROFILE_ENABLED) return;
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
  if (!FULL_PROFILE_ENABLED) return;
  if (member.guild.id !== GUILD_ID) return;
  await sendEventLog(member.guild, formatBotMessage('👋 Départ', [
    `${formatMember(member)} vient de quitter le serveur.`,
  ]));
  state.lastMemberEvent = `Départ : ${formatMember(member)}`;
  updateRuntimeFiles();
  await refreshStatsDisplaySafe(member.guild, 'member-remove');
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!FULL_PROFILE_ENABLED || newState.guild.id !== GUILD_ID || oldState.channelId === newState.channelId) return;
  queueStatsEventRefresh(newState.guild, 'voice-state');
  try {
    const transition = publicVoiceTransition(oldState, newState, GUILD_ID);
    if (!transition) return;
    const { member, previous, next } = transition;
    const action = previous && next ? `a changé de salon : ${previous} → ${next}`
      : next ? `a rejoint ${next}` : `a quitté ${previous}`;
    await sendEventLog(newState.guild, formatBotMessage('🎙️ Vocal', [formatLine('Membre', formatMember(member)), formatLine('Action', action)]));
    state.lastVoiceEvent = `${formatMember(member)} ${action}`;
    updateRuntimeFiles();
  } catch (error) { noteRuntimeError('voice-state', error); }
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!FULL_PROFILE_ENABLED) return;
  const guild = newPresence?.guild || oldPresence?.guild;
  if (!guild || guild.id !== GUILD_ID) return;

  const before = oldPresence?.status || 'offline';
  const after = newPresence?.status || 'offline';
  if (before === after) return;

  queueStatsEventRefresh(guild, 'presence-update');
});

process.on('SIGTERM', () => {
  stopping = true;
  state.healthy = false;
  updateRuntimeFiles();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  stopping = true;
  state.healthy = false;
  updateRuntimeFiles();
  client.destroy();
  process.exit(0);
});

for (const event of ['shardDisconnect', 'shardReconnecting', 'shardResume']) {
  client.on(event, updateRuntimeFiles);
}
client.on('error', (error) => noteRuntimeError('discord-client', error));
startHeartbeat();
client.login(BOT_TOKEN).catch((error) => {
  noteRuntimeError('login', error);
  process.exitCode = 1;
  client.destroy();
});
