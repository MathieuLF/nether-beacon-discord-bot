const { createHttpJsonClient } = require('./http-json-client');
const { toNumber } = require('./metrics');
const {
  sanitizePalworldText,
  sanitizePublicPlayerName,
} = require('./palworld-safety');

const DEFAULT_ANNOUNCEMENT_MAX_LENGTH = 500;
const DEFAULT_REST_TIMEOUT_MS = 5000;
const DEFAULT_REST_CIRCUIT_BREAKER_MS = 30000;

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

const createPalworldRestClient = ({
  apiUrl,
  username,
  password,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_REST_TIMEOUT_MS,
  circuitBreakerMs = DEFAULT_REST_CIRCUIT_BREAKER_MS,
  now = () => Date.now(),
} = {}) => {
  const baseUrl = normalizeBaseUrl(apiUrl);
  const authorization = basicAuthHeader(username, password);
  const http = createHttpJsonClient({
    fetchImpl,
    defaultTimeoutMs: timeoutMs,
    defaultCircuitBreakerMs: circuitBreakerMs,
    now,
  });

  const fetchJson = async ({ endpoint, method = 'GET', body = null }) => {
    const url = `${baseUrl}/${String(endpoint || '').replace(/^\/+/, '')}`;
    return http.requestJson(url, {
      method,
      headers: {
        Authorization: authorization,
      },
      body,
      timeoutMs,
      circuitBreakerMs,
      // A timed-out POST may already have been delivered. Never duplicate announcements.
      retryTransient: method === 'GET',
    });
  };

  return {
    fetchJson,
    fetchMetrics: async () => normalizeMetrics(await fetchJson({ endpoint: '/metrics' })),
    getCircuitState: http.getCircuitState,
    sendAnnouncement: async (message) => fetchJson({
      endpoint: '/announce',
      method: 'POST',
      body: {
        message: normalizeAnnouncementMessage(message),
      },
    }),
  };
};

const fetchPalworldJson = async ({
  endpoint,
  method = 'GET',
  body = null,
  ...options
}) => createPalworldRestClient(options).fetchJson({ endpoint, method, body });

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
  createPalworldRestClient(options).fetchMetrics();

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

const normalizeDiscordDisplayName = (value) => {
  const name = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safeName = sanitizePublicPlayerName(name);
  return safeName ? safeName.slice(0, 80) : 'staff Discord';
};

const sendPalworldAnnouncement = async ({ message, ...options }) =>
  createPalworldRestClient(options).sendAnnouncement(message);

const formatPalworldAnnouncementForDiscord = ({ message, authorName }) => [
  '**📣 Annonce Palworld**',
  '',
  sanitizePalworldText(normalizeAnnouncementMessage(message)),
  '',
  `- **Publié par** : ${normalizeDiscordDisplayName(authorName || 'staff Discord')}`,
  '- **Relayé en jeu** : oui',
].join('\n').slice(0, 1900);

module.exports = {
  DEFAULT_REST_CIRCUIT_BREAKER_MS,
  DEFAULT_REST_TIMEOUT_MS,
  createPalworldRestClient,
  fetchPalworldJson,
  fetchPalworldMetrics,
  formatPalworldAnnouncementForDiscord,
  formatPalworldMetrics,
  normalizeAnnouncementMessage,
  normalizeMetrics,
  sendPalworldAnnouncement,
};
