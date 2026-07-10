const crypto = require('crypto');
const fs = require('fs');

const PLAYER_STATE_VERSION = 2;
const DEFAULT_ANNOUNCEMENT_MAX_LENGTH = 500;
const DEFAULT_PLAYER_EVENT_GRACE_MS = 2 * 60 * 1000;

const defaultPlayerState = () => ({
  version: PLAYER_STATE_VERSION,
  updatedAt: null,
  apiReachable: null,
  hasBaseline: false,
  lastFetchError: null,
  players: {},
  pendingPlayerEvents: {},
});

const normalizePlayerState = (value) => ({
  ...defaultPlayerState(),
  ...(value && typeof value === 'object' ? value : {}),
  version: PLAYER_STATE_VERSION,
  players: value?.players && typeof value.players === 'object' ? value.players : {},
  pendingPlayerEvents: value?.pendingPlayerEvents && typeof value.pendingPlayerEvents === 'object'
    ? value.pendingPlayerEvents
    : {},
});

const loadPalworldPlayerState = (statePath) => {
  try {
    return normalizePlayerState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch (error) {
    return defaultPlayerState();
  }
};

const savePalworldPlayerState = (statePath, state) => {
  fs.writeFileSync(statePath, JSON.stringify(normalizePlayerState(state), null, 2), 'utf8');
};

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('BOT_PALWORLD_REST_API_URL is not configured');
  return new URL(raw).toString().replace(/\/+$/, '');
};

const normalizeAnnouncementMessage = (message, maxLength = DEFAULT_ANNOUNCEMENT_MAX_LENGTH) => {
  const normalized = String(message || '').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('Announcement message cannot be empty');
  if (normalized.length > maxLength) {
    throw new Error(`Announcement message must be ${maxLength} characters or less`);
  }
  return normalized;
};

const basicAuthHeader = (username, password) => {
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) throw new Error('Palworld REST API credentials are not configured');
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
};

const fetchPalworldJson = async ({
  apiUrl,
  username,
  password,
  endpoint,
  method = 'GET',
  body = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
}) => {
  if (!fetchImpl) throw new Error('fetch is not available in this Node runtime');

  const url = `${normalizeBaseUrl(apiUrl)}/${String(endpoint || '').replace(/^\/+/, '')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthHeader(username, password),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      throw new Error(`Palworld REST ${endpoint} returned HTTP ${response.status}`);
    }

    if (response.status === 204) return null;

    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Palworld REST ${endpoint} returned invalid JSON`);
    }
  } finally {
    clearTimeout(timer);
  }
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pickMetric = (source, names) => {
  for (const name of names) {
    if (source?.[name] !== undefined && source?.[name] !== null) {
      return source[name];
    }
  }
  return null;
};

const normalizeMetrics = (payload, checkedAt = new Date().toISOString()) => {
  const source = payload?.metrics && typeof payload.metrics === 'object' ? payload.metrics : payload;
  return {
    checkedAt,
    serverFps: toNumber(pickMetric(source, ['serverfps', 'serverFps', 'serverFPS'])),
    currentPlayers: toNumber(pickMetric(source, ['currentplayernum', 'currentPlayers', 'currentPlayerNum'])),
    maxPlayers: toNumber(pickMetric(source, ['maxplayernum', 'maxPlayers', 'maxPlayerNum'])),
    serverFrameTime: toNumber(pickMetric(source, ['serverframetime', 'serverFrameTime'])),
    uptimeSeconds: toNumber(pickMetric(source, ['uptime', 'uptimeSeconds'])),
    baseCampCount: toNumber(pickMetric(source, ['basecampnum', 'baseCampCount', 'baseCampNum'])),
    days: toNumber(pickMetric(source, ['days', 'inGameDays'])),
  };
};

const fetchPalworldMetrics = async (options) =>
  normalizeMetrics(await fetchPalworldJson({ ...options, endpoint: '/metrics' }));

const formatMetricNumber = (value, digits = 0) =>
  Number.isFinite(value) ? value.toLocaleString('fr-CA', { maximumFractionDigits: digits }) : 'non disponible';

const formatDurationSeconds = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return 'non disponible';

  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];

  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
};

const formatCheckedAt = (checkedAt, timeZone = 'America/Toronto') => {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return checkedAt || 'non disponible';

  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone,
  }).format(date);
};

const formatPlayersMetric = (currentPlayers, maxPlayers) => {
  if (Number.isFinite(currentPlayers) && Number.isFinite(maxPlayers)) {
    return `${formatMetricNumber(currentPlayers)}/${formatMetricNumber(maxPlayers)}`;
  }
  if (Number.isFinite(currentPlayers)) return formatMetricNumber(currentPlayers);
  return 'non disponible';
};

const formatPalworldMetrics = (metrics, { timeZone = 'America/Toronto' } = {}) => [
  '**📊 Metrics Palworld**',
  '',
  `- **Joueurs** : ${formatPlayersMetric(metrics.currentPlayers, metrics.maxPlayers)}`,
  `- **FPS serveur** : ${formatMetricNumber(metrics.serverFps, 1)}`,
  `- **Frame time serveur** : ${formatMetricNumber(metrics.serverFrameTime, 2)} ms`,
  `- **Uptime serveur** : ${formatDurationSeconds(metrics.uptimeSeconds)}`,
  `- **Jours en jeu** : ${formatMetricNumber(metrics.days)}`,
  `- **Bases** : ${formatMetricNumber(metrics.baseCampCount)}`,
  `- **Lecture** : ${formatCheckedAt(metrics.checkedAt, timeZone)} (${timeZone})`,
].join('\n').slice(0, 1900);

const normalizePlayerName = (value) => {
  const name = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name ? name.slice(0, 80) : 'Joueur Palworld';
};

const playerIdentity = (player, index) => {
  const candidates = [
    player?.playerId,
    player?.userId,
    player?.steamId,
    player?.accountName,
    player?.name,
  ];
  const raw = candidates.find((candidate) => String(candidate || '').trim());
  return String(raw || `index:${index}`);
};

const hashPlayerIdentity = (identity) =>
  crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 24);

const normalizePlayer = (player, index) => ({
  key: hashPlayerIdentity(playerIdentity(player, index)),
  name: normalizePlayerName(player?.name),
});

const normalizePlayersPayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.players)) return payload.players;
  return [];
};

const buildPlayerSnapshot = (payload, checkedAt = new Date().toISOString()) => ({
  checkedAt,
  players: normalizePlayersPayload(payload).map(normalizePlayer),
});

const fetchPalworldPlayers = async (options) =>
  buildPlayerSnapshot(await fetchPalworldJson({ ...options, endpoint: '/players' }));

const playersByKey = (players = []) =>
  Object.fromEntries(players.map((player) => [player.key, { name: player.name }]));

const timestampMs = (value) => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const timestampFromMs = (value) => new Date(value).toISOString();

const normalizeGraceMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PLAYER_EVENT_GRACE_MS;
};

const formatPlayerNames = (players) => {
  const names = players.map((player) => player.name);
  const visible = names.slice(0, 5).join(', ');
  const remaining = names.length - 5;
  return remaining > 0 ? `${visible}, +${remaining} autres` : visible;
};

const playerChangeAnnouncement = (type, players, onlineCount) => {
  const joining = type === 'join';
  const plural = players.length > 1;
  const title = joining
    ? `**🟢 Palworld - ${plural ? 'Connexions' : 'Connexion'}**`
    : `**⚪ Palworld - ${plural ? 'Déconnexions' : 'Déconnexion'}**`;
  const action = joining
    ? (plural ? 'ont rejoint le serveur.' : 'a rejoint le serveur.')
    : (plural ? 'ont quitté le serveur.' : 'a quitté le serveur.');

  return [
    title,
    '',
    `- **${plural ? 'Joueurs' : 'Joueur'}** : ${formatPlayerNames(players)} ${action}`,
    `- **En ligne maintenant** : ${onlineCount}`,
  ].join('\n');
};

const pendingPlayerEvent = ({ type, player, checkedAt, graceMs }) => ({
  type,
  player: {
    name: normalizePlayerName(player?.name),
  },
  firstSeenAt: checkedAt,
  announceAfter: timestampFromMs(timestampMs(checkedAt) + graceMs),
});

const palworldApiUnavailableAnnouncement = ({ error, checkedAt }) => [
  '**⚠️ API REST Palworld indisponible**',
  '',
  "Alpha n'arrive pas à lire l'API REST Palworld. Aucun message public n'a été envoyé dans le salon Palworld.",
  `- **Erreur** : ${error.message}`,
  `- **Détecté** : ${checkedAt}`,
].join('\n');

const palworldApiRecoveredAnnouncement = (snapshot) => [
  '**✅ API REST Palworld revenue**',
  '',
  "Alpha lit de nouveau l'API REST Palworld. Les connexions/déconnexions ont été rebaselinées pour éviter les faux positifs.",
  `- **Joueurs en ligne** : ${snapshot.players.length}`,
  `- **Détecté** : ${snapshot.checkedAt}`,
].join('\n');

const planPalworldPlayerAnnouncements = (snapshot, previousState, options = {}) => {
  const state = normalizePlayerState(previousState);
  const currentPlayers = playersByKey(snapshot.players);
  const messages = [];
  const logMessages = [];
  const shouldRebaseline = !state.hasBaseline || state.apiReachable === false;
  const graceMs = normalizeGraceMs(options.eventGraceMs);
  const nowMs = timestampMs(snapshot.checkedAt);
  const pendingPlayerEvents = { ...state.pendingPlayerEvents };

  if (state.apiReachable === false) {
    logMessages.push(palworldApiRecoveredAnnouncement(snapshot));
  }

  if (!shouldRebaseline) {
    for (const [key, player] of Object.entries(currentPlayers)) {
      if (state.players[key]) continue;

      if (pendingPlayerEvents[key]?.type === 'leave') {
        delete pendingPlayerEvents[key];
        continue;
      }

      if (!pendingPlayerEvents[key]) {
        pendingPlayerEvents[key] = pendingPlayerEvent({
          type: 'join',
          player,
          checkedAt: snapshot.checkedAt,
          graceMs,
        });
      }
    }

    for (const [key, player] of Object.entries(state.players)) {
      if (currentPlayers[key]) continue;

      if (pendingPlayerEvents[key]?.type === 'join') {
        delete pendingPlayerEvents[key];
        continue;
      }

      if (!pendingPlayerEvents[key]) {
        pendingPlayerEvents[key] = pendingPlayerEvent({
          type: 'leave',
          player,
          checkedAt: snapshot.checkedAt,
          graceMs,
        });
      }
    }

    const matured = {
      join: [],
      leave: [],
    };

    for (const [key, event] of Object.entries(pendingPlayerEvents)) {
      const stillRelevant = event.type === 'join'
        ? Boolean(currentPlayers[key])
        : !currentPlayers[key];

      if (!stillRelevant) {
        delete pendingPlayerEvents[key];
        continue;
      }

      if (nowMs >= timestampMs(event.announceAfter)) {
        matured[event.type].push(event.player);
        delete pendingPlayerEvents[key];
      }
    }

    if (matured.join.length) {
      messages.push(playerChangeAnnouncement('join', matured.join, snapshot.players.length));
    }

    if (matured.leave.length) {
      messages.push(playerChangeAnnouncement('leave', matured.leave, snapshot.players.length));
    }
  }

  return {
    messages,
    logMessages,
    state: normalizePlayerState({
      ...state,
      updatedAt: snapshot.checkedAt,
      apiReachable: true,
      hasBaseline: true,
      lastFetchError: null,
      players: currentPlayers,
      pendingPlayerEvents: shouldRebaseline ? {} : pendingPlayerEvents,
    }),
  };
};

const planPalworldPlayerFetchFailure = ({
  error,
  previousState,
  checkedAt = new Date().toISOString(),
}) => {
  const state = normalizePlayerState(previousState);
  const shouldAnnounce = state.apiReachable !== false;

  return {
    logMessages: shouldAnnounce
      ? [palworldApiUnavailableAnnouncement({ error, checkedAt })]
      : [],
    state: normalizePlayerState({
      ...state,
      updatedAt: checkedAt,
      apiReachable: false,
      lastFetchError: error.message,
    }),
  };
};

const sendPalworldAnnouncement = async ({ message, ...options }) =>
  fetchPalworldJson({
    ...options,
    endpoint: '/announce',
    method: 'POST',
    body: {
      message: normalizeAnnouncementMessage(message),
    },
  });

const formatPalworldAnnouncementForDiscord = ({ message, authorName }) => [
  '**📣 Annonce Palworld**',
  '',
  normalizeAnnouncementMessage(message),
  '',
  `- **Publié par** : ${normalizePlayerName(authorName || 'staff Discord')}`,
  '- **Relayé en jeu** : oui',
].join('\n').slice(0, 1900);

module.exports = {
  buildPlayerSnapshot,
  defaultPlayerState,
  fetchPalworldJson,
  fetchPalworldMetrics,
  fetchPalworldPlayers,
  formatPalworldAnnouncementForDiscord,
  formatPalworldMetrics,
  loadPalworldPlayerState,
  normalizeAnnouncementMessage,
  normalizeMetrics,
  planPalworldPlayerAnnouncements,
  planPalworldPlayerFetchFailure,
  savePalworldPlayerState,
  sendPalworldAnnouncement,
};
