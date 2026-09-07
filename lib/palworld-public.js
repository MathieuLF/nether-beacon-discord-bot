const { SafeHttpError, createHttpJsonClient } = require('./http-json-client');
const { firstNumber } = require('./metrics');
const {
  sanitizePalworldText,
  sanitizePublicPlayers,
  stripPrivatePalworldFields,
} = require('./palworld-safety');

const DEFAULT_PUBLIC_BASE_URL = 'https://gaylemon.mathieu.pro';
const DEFAULT_PUBLIC_CACHE_TTL_MS = 15000;
const DEFAULT_PUBLIC_TIMEOUT_MS = 5000;
const DEFAULT_MAX_PUBLIC_AGE_SECONDS = 300;

const normalizeBaseUrl = (value) => {
  const raw = String(value || DEFAULT_PUBLIC_BASE_URL).trim() || DEFAULT_PUBLIC_BASE_URL;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Gaylemon public base URL must use HTTP or HTTPS');
  }
  return url.toString().replace(/\/+$/, '');
};

const publicAvailabilityUrl = (baseUrl) => `${normalizeBaseUrl(baseUrl)}/data/public-availability.json`;
const publicMetricsUrl = (baseUrl) => `${normalizeBaseUrl(baseUrl)}/data/public-metrics.json`;

const parseDateTime = (value) => {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : null;
};

const isFreshnessValueStale = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized && !['available', 'current', 'fresh', 'ok', 'up'].includes(normalized));
};

const ageIssues = (source, value, nowMs, maxAgeSeconds) => {
  const time = parseDateTime(value);
  if (time === null) return [`${source}-timestamp-missing`];
  if (time > nowMs + 60000) return [`${source}-timestamp-future`];
  return nowMs - time > maxAgeSeconds * 1000 ? [`${source}-age-exceeded`] : [];
};

const freshnessIssuesFromAvailability = (payload, nowMs, maxAgeSeconds) => {
  const issues = ageIssues('availability', payload?.updatedAt, nowMs, maxAgeSeconds);
  if (payload?.ok === false) issues.push('availability-not-ok');
  if (isFreshnessValueStale(payload?.status) && payload?.status !== 'down') issues.push(`availability-${payload.status}`);

  for (const entry of Array.isArray(payload?.dataFreshness) ? payload.dataFreshness : []) {
    if (entry?.ok === false || isFreshnessValueStale(entry?.status)) {
      issues.push(`${entry?.name || 'dataset'}-${entry?.status || 'not-ok'}`);
    }
  }

  return issues;
};

const freshnessIssuesFromMetrics = (payload, nowMs, maxAgeSeconds) => {
  const issues = ageIssues('metrics', payload?.updatedAt || payload?.provenance?.observedAt, nowMs, maxAgeSeconds);
  if (payload?.ok === false) issues.push('metrics-not-ok');
  if (isFreshnessValueStale(payload?.provenance?.freshness)) issues.push(`metrics-${payload.provenance.freshness}`);
  if (isFreshnessValueStale(payload?.provenance?.sourceStatus)) issues.push(`source-${payload.provenance.sourceStatus}`);

  return issues;
};

const normalizePublicAvailability = (payload, { nowMs = Date.now(), maxAgeSeconds = DEFAULT_MAX_PUBLIC_AGE_SECONDS } = {}) => {
  const safePayload = stripPrivatePalworldFields(payload || {});
  const summary = safePayload.summary || {};
  const status = String(safePayload.status || summary.monitorStatus || 'unknown').toLowerCase();

  return {
    ok: safePayload.ok !== false,
    status,
    updatedAt: safePayload.updatedAt || null,
    updatedAtLocal: safePayload.updatedAtLocal || null,
    players: firstNumber(summary.players),
    maxPlayers: firstNumber(summary.maxPlayers),
    fps: firstNumber(summary.fps),
    fpsAverage: firstNumber(summary.fpsAverage),
    frameMs: firstNumber(summary.frameMs),
    uptimeLast24h: firstNumber(summary.uptimeLast24h, summary.uptimeLast24hObserved),
    unavailableSecondsLast24h: firstNumber(summary.unavailableSecondsLast24h, summary.unavailableSecondsLast24hObserved),
    fresh: freshnessIssuesFromAvailability(safePayload, nowMs, maxAgeSeconds).length === 0,
    freshnessIssues: freshnessIssuesFromAvailability(safePayload, nowMs, maxAgeSeconds),
  };
};

const normalizePublicMetrics = (payload, { nowMs = Date.now(), maxAgeSeconds = DEFAULT_MAX_PUBLIC_AGE_SECONDS } = {}) => {
  const safePayload = stripPrivatePalworldFields(payload || {});
  const metrics = safePayload.metrics || {};

  return {
    ok: safePayload.ok !== false,
    updatedAt: safePayload.updatedAt || safePayload.provenance?.observedAt || null,
    serverName: safePayload.server?.name || null,
    serverVersion: safePayload.server?.version || safePayload.provenance?.gameVersion || null,
    players: firstNumber(metrics.players),
    maxPlayers: firstNumber(metrics.maxPlayers),
    fps: firstNumber(metrics.fps),
    fpsAverage: firstNumber(metrics.fpsAverage),
    frameMs: firstNumber(metrics.frameMs),
    days: firstNumber(metrics.days),
    baseCamps: firstNumber(metrics.baseCamps, metrics.baseCampCount),
    uptimeSeconds: firstNumber(metrics.uptimeSeconds),
    uptimeLabel: typeof metrics.uptime === 'string' ? sanitizePalworldText(metrics.uptime) : null,
    playerNames: sanitizePublicPlayers(safePayload.players),
    fresh: freshnessIssuesFromMetrics(safePayload, nowMs, maxAgeSeconds).length === 0,
    freshnessIssues: freshnessIssuesFromMetrics(safePayload, nowMs, maxAgeSeconds),
  };
};

const mergePublicStatus = ({ availability, metrics, checkedAt }) => {
  const freshnessIssues = [
    ...(availability?.freshnessIssues || []),
    ...(metrics?.freshnessIssues || []),
    ...(!availability ? ['availability-unavailable'] : []),
    ...(!metrics ? ['metrics-unavailable'] : []),
  ];

  return {
    source: 'gaylemon-public-json',
    checkedAt,
    fresh: freshnessIssues.length === 0,
    freshnessIssues,
    status: availability?.fresh ? availability.status : 'unknown',
    serverName: metrics?.serverName || null,
    serverVersion: metrics?.serverVersion || null,
    players: firstNumber(metrics?.players, availability?.players),
    maxPlayers: firstNumber(metrics?.maxPlayers, availability?.maxPlayers),
    fps: firstNumber(metrics?.fps, availability?.fps),
    fpsAverage: firstNumber(metrics?.fpsAverage, availability?.fpsAverage),
    frameMs: firstNumber(metrics?.frameMs, availability?.frameMs),
    uptimeSeconds: firstNumber(metrics?.uptimeSeconds),
    uptimeLabel: metrics?.uptimeLabel || null,
    days: firstNumber(metrics?.days),
    baseCamps: firstNumber(metrics?.baseCamps),
    uptimeLast24h: firstNumber(availability?.uptimeLast24h),
    unavailableSecondsLast24h: firstNumber(availability?.unavailableSecondsLast24h),
    playerNames: metrics?.playerNames || [],
    updatedAt: metrics?.updatedAt || availability?.updatedAt || null,
    availabilityUpdatedAt: availability?.updatedAt || null,
    metricsUpdatedAt: metrics?.updatedAt || null,
  };
};

const createPalworldPublicClient = ({
  publicBaseUrl = DEFAULT_PUBLIC_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PUBLIC_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_PUBLIC_CACHE_TTL_MS,
  maxAgeSeconds = DEFAULT_MAX_PUBLIC_AGE_SECONDS,
  now = () => Date.now(),
} = {}) => {
  const baseUrl = normalizeBaseUrl(publicBaseUrl);
  const http = createHttpJsonClient({
    fetchImpl,
    defaultTimeoutMs: timeoutMs,
    defaultCacheTtlMs: cacheTtlMs,
    now,
  });

  const fetchStatus = async () => {
    const checkedAt = new Date(now()).toISOString();
    const [availabilityResult, metricsResult] = await Promise.allSettled([
      http.getJson(publicAvailabilityUrl(baseUrl), { timeoutMs, cacheTtlMs }),
      http.getJson(publicMetricsUrl(baseUrl), { timeoutMs, cacheTtlMs }),
    ]);

    const isPayload = (result, field) => result.status === 'fulfilled'
      && result.value && !Array.isArray(result.value) && typeof result.value === 'object'
      && result.value[field] && typeof result.value[field] === 'object' && !Array.isArray(result.value[field]);
    const availability = isPayload(availabilityResult, 'summary')
      ? normalizePublicAvailability(availabilityResult.value, { nowMs: now(), maxAgeSeconds })
      : null;
    const metrics = isPayload(metricsResult, 'metrics')
      ? normalizePublicMetrics(metricsResult.value, { nowMs: now(), maxAgeSeconds })
      : null;

    if (!availability && !metrics) {
      throw new SafeHttpError('PUBLIC_DATA_UNAVAILABLE', 'Gaylemon public data is unavailable');
    }

    return mergePublicStatus({ availability, metrics, checkedAt });
  };

  return {
    baseUrl,
    clearCache: http.clearCache,
    fetchStatus,
  };
};

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

const formatDate = (value, timeZone = 'America/Toronto') => {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'non disponible';

  return `${new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone,
  }).format(date)} (${timeZone})`;
};

const formatPlayersMetric = (currentPlayers, maxPlayers) => {
  if (Number.isFinite(currentPlayers) && Number.isFinite(maxPlayers)) {
    return `${formatMetricNumber(currentPlayers)}/${formatMetricNumber(maxPlayers)}`;
  }
  if (Number.isFinite(currentPlayers)) return formatMetricNumber(currentPlayers);
  return 'non disponible';
};

const formatStatusLabel = (status) => {
  if (status === 'up') return 'en ligne';
  if (status === 'down') return 'hors ligne';
  return 'non confirmé';
};

const formatPublicPalworldStatus = (status, { timeZone = 'America/Toronto' } = {}) => {
  const playerNames = status.playerNames.length
    ? status.playerNames.slice(0, 12).join(', ')
    : null;
  const extraPlayers = status.playerNames.length > 12 ? `, +${status.playerNames.length - 12}` : '';
  const uptime = status.uptimeLabel || formatDurationSeconds(status.uptimeSeconds);

  return [
    '**📊 Palworld Gaylemon**',
    '',
    `- **État** : ${formatStatusLabel(status.status)}`,
    `- **Joueurs** : ${formatPlayersMetric(status.players, status.maxPlayers)}`,
    playerNames ? `- **En ligne** : ${playerNames}${extraPlayers}` : null,
    `- **FPS serveur** : ${formatMetricNumber(status.fps, 1)}`,
    `- **Frame time serveur** : ${formatMetricNumber(status.frameMs, 2)} ms`,
    `- **Uptime serveur** : ${uptime}`,
    `- **Jours en jeu** : ${formatMetricNumber(status.days)}`,
    `- **Bases** : ${formatMetricNumber(status.baseCamps)}`,
    Number.isFinite(status.uptimeLast24h)
      ? `- **Disponibilité 24h** : ${formatMetricNumber(status.uptimeLast24h, 2)} %`
      : null,
    `- **Lecture publique** : ${formatDate(status.updatedAt, timeZone)}`,
    '',
    status.fresh ? null : '_Les données publiques sont temporairement figées ou incomplètes._',
  ].filter(Boolean).join('\n').slice(0, 1900);
};

module.exports = {
  DEFAULT_MAX_PUBLIC_AGE_SECONDS,
  DEFAULT_PUBLIC_BASE_URL,
  DEFAULT_PUBLIC_CACHE_TTL_MS,
  DEFAULT_PUBLIC_TIMEOUT_MS,
  createPalworldPublicClient,
  formatPublicPalworldStatus,
  normalizePublicAvailability,
  normalizePublicMetrics,
  publicAvailabilityUrl,
  publicMetricsUrl,
};
