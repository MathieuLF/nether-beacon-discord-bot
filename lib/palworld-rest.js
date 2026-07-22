const DEFAULT_ANNOUNCEMENT_MAX_LENGTH = 500;

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
  fetchPalworldJson,
  fetchPalworldMetrics,
  formatPalworldAnnouncementForDiscord,
  formatPalworldMetrics,
  normalizeAnnouncementMessage,
  normalizeMetrics,
  sendPalworldAnnouncement,
};
