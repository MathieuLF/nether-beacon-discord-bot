const { EmbedBuilder } = require('discord.js');

const SUMMARY_COMMAND_NAME = 'resume-hier';
const DEFAULT_PUBLIC_BASE_URL = 'https://gaylemon.mathieu.pro';
const DEFAULT_TIME_ZONE = 'America/Toronto';
const DEFAULT_CHANNEL_NAMES = ['🐾・palworld'];

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

const createDailySummarySettings = (env, plan) => {
  const defaultNames = unique([
    env.BOT_PALWORLD_CHANNEL_NAME,
    ...DEFAULT_CHANNEL_NAMES,
  ]);
  const channelNames = parseList(env.GAYLEMON_DAILY_SUMMARY_CHANNEL_NAMES);
  const commandChannelNames = parseList(env.GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_NAMES);

  return {
    commandName: SUMMARY_COMMAND_NAME,
    publicBaseUrl: normalizeBaseUrl(env.GAYLEMON_PUBLIC_BASE_URL || env.BOT_GAYLEMON_PUBLIC_BASE_URL),
    timeZone: String(env.GAYLEMON_DAILY_SUMMARY_TIME_ZONE || env.BOT_TIMEZONE || env.TZ || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE,
    hour: clampInteger(env.GAYLEMON_DAILY_SUMMARY_HOUR, 1, 0, 23),
    minute: clampInteger(env.GAYLEMON_DAILY_SUMMARY_MINUTE, 0, 0, 59),
    postWindowMinutes: clampInteger(env.GAYLEMON_DAILY_SUMMARY_POST_WINDOW_MINUTES, 120, 1, 720),
    fetchTimeoutMs: clampInteger(env.GAYLEMON_DAILY_SUMMARY_FETCH_TIMEOUT_MS, 5000, 1000, 30000),
    channelIds: parseList(env.GAYLEMON_DAILY_SUMMARY_CHANNEL_IDS),
    channelNames: channelNames.length ? channelNames : defaultNames,
    commandChannelIds: parseList(env.GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS),
    commandChannelNames: commandChannelNames.length ? commandChannelNames : (channelNames.length ? channelNames : defaultNames),
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

const shouldRunDailySummary = (date, settings) => {
  const parts = getLocalDateTimeParts(date, settings.timeZone);
  const currentMinute = parts.hour * 60 + parts.minute;
  const targetMinute = settings.hour * 60 + settings.minute;
  const minutesAfterTarget = currentMinute - targetMinute;

  return {
    due: minutesAfterTarget >= 0 && minutesAfterTarget <= settings.postWindowMinutes,
    dateKey: shiftDateKey(parts.dateKey, -1),
    localDateKey: parts.dateKey,
    localHour: parts.hour,
    localMinute: parts.minute,
    minutesAfterTarget,
  };
};

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

const probeUrl = async (url, settings, fetchImpl) => {
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

    return {
      ok: response.ok,
      status: response.status,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'request-failed'),
    };
  } finally {
    clearTimeout(timer);
  }
};

const inspectSummaryAvailability = async (settings, dateKey, fetchImpl = globalThis.fetch) => {
  const summaryUrl = getSummaryUrl(settings, dateKey);
  const indexUrl = getIndexUrl(settings);
  const [summaryResult, indexResult] = await Promise.all([
    probeUrl(summaryUrl, settings, fetchImpl),
    probeUrl(indexUrl, settings, fetchImpl),
  ]);

  let index = null;
  if (indexResult.ok) {
    try {
      index = await indexResult.response.json();
    } catch (error) {
      index = null;
    }
  }

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

const buildDailySummaryMessage = (settings, dateKey, availability, origin = 'scheduled') => {
  const summaryUrl = getSummaryUrl(settings, dateKey);
  const label = formatDateLabel(dateKey);
  const intro = origin === 'manual'
    ? 'Le récap de la veille est là: ouvre-le pour revoir les stats et les moments de la journée.'
    : 'Le récap quotidien est prêt: stats, activité et faits marquants de la veille.';
  const description = [
    intro,
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

const normalizeDailySummaryState = (payload, guildId = null) => {
  if (payload && typeof payload === 'object' && payload.dates && typeof payload.dates === 'object') {
    return {
      version: 1,
      guildId,
      ...payload,
      dates: payload.dates,
    };
  }

  return {
    version: 1,
    guildId,
    dates: {},
  };
};

const hasDailySummaryBeenSent = (state, dateKey, channelId) =>
  Boolean(state?.dates?.[dateKey]?.channels?.[channelId]?.sentAt);

const markDailySummarySent = (state, dateKey, channel, availability, sentAt = new Date().toISOString()) => {
  const nextState = normalizeDailySummaryState(state, state?.guildId || null);
  if (!nextState.dates[dateKey]) {
    nextState.dates[dateKey] = { channels: {} };
  }

  nextState.dates[dateKey].channels[channel.id] = {
    channelId: channel.id,
    channelName: channel.name || null,
    sentAt,
    verified: Boolean(availability?.ok),
    detail: availability?.detail || null,
  };

  return nextState;
};

module.exports = {
  SUMMARY_COMMAND_NAME,
  createDailySummarySettings,
  getPreviousLocalDateKey,
  getSummaryUrl,
  hasDailySummaryBeenSent,
  inspectSummaryAvailability,
  buildDailySummaryMessage,
  markDailySummarySent,
  normalizeDailySummaryState,
  shouldRunDailySummary,
};
