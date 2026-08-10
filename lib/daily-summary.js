const { EmbedBuilder } = require('discord.js');
const { ResponseTooLargeError, readJsonResponse } = require('./bounded-response');

const SUMMARY_COMMAND_NAME = 'resume-hier';
const DEFAULT_PUBLIC_BASE_URL = 'https://gaylemon.mathieu.pro';
const DEFAULT_TIME_ZONE = 'America/Toronto';
const DEFAULT_CHANNEL_NAMES = ['🐾・palworld'];
const DEFAULT_MAX_JSON_BYTES = 256 * 1024;
const summaryInflight = new Map();

const clampInteger = (value, fallback, min, max) => {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const parseList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const unique = (values) => [...new Set(values.filter(Boolean))];

const normalizeBaseUrl = (value) => {
  const raw = String(value || DEFAULT_PUBLIC_BASE_URL).trim() || DEFAULT_PUBLIC_BASE_URL;
  return raw.replace(/\/+$/, '');
};

const createDailySummarySettings = (env) => {
  const defaultNames = unique([
    env.BOT_PALWORLD_CHANNEL_NAME,
    ...DEFAULT_CHANNEL_NAMES,
  ]);
  const commandChannelNames = parseList(env.GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_NAMES);

  return {
    commandName: SUMMARY_COMMAND_NAME,
    publicBaseUrl: normalizeBaseUrl(env.GAYLEMON_PUBLIC_BASE_URL || env.BOT_GAYLEMON_PUBLIC_BASE_URL),
    timeZone: String(env.GAYLEMON_DAILY_SUMMARY_TIME_ZONE || env.BOT_TIMEZONE || env.TZ || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE,
    fetchTimeoutMs: clampInteger(env.GAYLEMON_DAILY_SUMMARY_FETCH_TIMEOUT_MS, 5000, 1000, 30000),
    maxJsonBytes: clampInteger(env.GAYLEMON_DAILY_SUMMARY_MAX_JSON_BYTES, DEFAULT_MAX_JSON_BYTES, 1024, 1024 * 1024),
    commandChannelIds: parseList(env.GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS),
    commandChannelNames: commandChannelNames.length ? commandChannelNames : defaultNames,
  };
};

const getLocalDateTimeParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);

  return {
    year,
    month,
    day,
    hour,
    minute,
    dateKey: [
      String(year).padStart(4, '0'),
      String(month).padStart(2, '0'),
      String(day).padStart(2, '0'),
    ].join('-'),
  };
};

const shiftDateKey = (dateKey, days) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
};

const getPreviousLocalDateKey = (date, timeZone) =>
  shiftDateKey(getLocalDateTimeParts(date, timeZone).dateKey, -1);

const formatDateLabel = (dateKey) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const getSummaryUrl = (settings, dateKey) =>
  `${settings.publicBaseUrl}/resume?jour=${encodeURIComponent(dateKey)}`;

const getIndexUrl = (settings) =>
  `${settings.publicBaseUrl}/data/public-events-index.json`;

const probeUrl = async (url, settings, fetchImpl, { readJson = false } = {}) => {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 0, error: 'fetch-unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.fetchTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/json;q=0.9,*/*;q=0.5',
      },
    });

    let json = null;
    if (readJson && response.ok) {
      json = await readJsonResponse(response, { maxBytes: settings.maxJsonBytes || DEFAULT_MAX_JSON_BYTES });
    } else if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }

    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.name === 'AbortError'
        ? 'timeout'
        : (error instanceof ResponseTooLargeError ? 'response-too-large' : (error?.message || 'request-failed')),
    };
  } finally {
    clearTimeout(timer);
  }
};

const inspectSummaryAvailabilityOnce = async (settings, dateKey, fetchImpl) => {
  const summaryUrl = getSummaryUrl(settings, dateKey);
  const indexUrl = getIndexUrl(settings);
  const [summaryResult, indexResult] = await Promise.all([
    probeUrl(summaryUrl, settings, fetchImpl),
    probeUrl(indexUrl, settings, fetchImpl, { readJson: true }),
  ]);

  const index = indexResult.ok ? indexResult.json : null;

  const ok = summaryResult.ok;
  const indexOk = Boolean(index?.ok);
  const updatedAt = typeof index?.updatedAt === 'string' ? index.updatedAt : null;
  const totalEvents = Number(index?.summary?.totalEvents || index?.summary?.events || 0);

  return {
    ok,
    indexOk,
    updatedAt,
    totalEvents: Number.isFinite(totalEvents) ? totalEvents : 0,
    summaryStatus: summaryResult.status,
    indexStatus: indexResult.status,
    detail: ok
      ? (indexOk ? 'resume-et-index-disponibles' : 'resume-disponible-index-non-verifie')
      : 'resume-non-verifie',
  };
};

const inspectSummaryAvailability = async (settings, dateKey, fetchImpl = globalThis.fetch) => {
  const key = `${getSummaryUrl(settings, dateKey)}|${getIndexUrl(settings)}`;
  if (summaryInflight.has(key)) return summaryInflight.get(key);
  const request = inspectSummaryAvailabilityOnce(settings, dateKey, fetchImpl)
    .finally(() => summaryInflight.delete(key));
  summaryInflight.set(key, request);
  return request;
};

const buildDailySummaryMessage = (settings, dateKey) => {
  const summaryUrl = getSummaryUrl(settings, dateKey);
  const label = formatDateLabel(dateKey);
  const description = [
    'Le récap de la veille est là: ouvre-le pour revoir les stats et les moments de la journée.',
    '',
    summaryUrl,
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x2f8f83)
    .setTitle(`Gaylemon - Le récap du ${label}`)
    .setURL(summaryUrl)
    .setDescription(description)
    .setTimestamp(new Date());

  return {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
};

module.exports = {
  SUMMARY_COMMAND_NAME,
  createDailySummarySettings,
  getPreviousLocalDateKey,
  getSummaryUrl,
  inspectSummaryAvailability,
  buildDailySummaryMessage,
};
