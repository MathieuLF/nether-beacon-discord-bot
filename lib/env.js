const DEFAULT_TIME_ZONE = 'America/Toronto';
const BOT_PROFILES = new Set(['minimal', 'pokemon', 'full']);

const parseList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const parsePositiveInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const requireValue = (env, name, errors) => {
  const value = String(env[name] || '').trim();
  if (!value) errors.push(`${name} is required`);
  return value;
};

const validateBotProfile = (value, errors) => {
  const profile = String(value || 'minimal').trim().toLowerCase() || 'minimal';
  if (!BOT_PROFILES.has(profile)) {
    errors.push('BOT_PROFILE must be minimal, pokemon or full');
  }
  return profile;
};

const validateUrl = (value, name, errors, { required = false } = {}) => {
  const raw = String(value || '').trim();
  if (!raw) {
    if (required) errors.push(`${name} is required`);
    return '';
  }

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      errors.push(`${name} must use HTTP or HTTPS`);
    }
    if (url.username || url.password) {
      errors.push(`${name} must not include credentials`);
    }
    return url.toString().replace(/\/+$/, '');
  } catch (error) {
    errors.push(`${name} must be a valid URL`);
    return raw;
  }
};

const validateTimeZone = (value, name, errors) => {
  const timeZone = String(value || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch (error) {
    errors.push(`${name} must be a valid IANA time zone`);
  }
  return timeZone;
};

const validateSnowflakeList = (values, name, errors) => {
  for (const value of values) {
    if (!/^\d{10,25}$/.test(value)) {
      errors.push(`${name} contains an invalid Discord ID`);
      return;
    }
  }
};

const validatePalworldRestConfig = (env, errors) => {
  const apiUrl = validateUrl(env.BOT_PALWORLD_REST_API_URL, 'BOT_PALWORLD_REST_API_URL', errors);
  const username = String(env.BOT_PALWORLD_REST_API_USERNAME || '').trim();
  const password = String(env.BOT_PALWORLD_REST_API_PASSWORD || '');
  const configuredParts = [apiUrl, username, password].filter(Boolean).length;

  if (configuredParts > 0 && configuredParts < 3) {
    errors.push('Palworld REST admin config must include URL, username and password together');
  }

  return {
    BOT_PALWORLD_REST_API_URL: apiUrl,
    BOT_PALWORLD_REST_API_USERNAME: username,
    BOT_PALWORLD_REST_API_PASSWORD: password,
  };
};

const validateBotEnvironment = (env = process.env, { requireDiscord = true } = {}) => {
  const errors = [];
  const dailySummaryCommandChannelIds = parseList(env.GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS);
  const palworldAdminChannelIds = parseList(env.BOT_PALWORLD_ADMIN_CHANNEL_IDS);

  validateSnowflakeList(dailySummaryCommandChannelIds, 'GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS', errors);
  validateSnowflakeList(palworldAdminChannelIds, 'BOT_PALWORLD_ADMIN_CHANNEL_IDS', errors);

  const normalized = {
    DISCORD_BOT_TOKEN: requireDiscord ? requireValue(env, 'DISCORD_BOT_TOKEN', errors) : String(env.DISCORD_BOT_TOKEN || '').trim(),
    DISCORD_GUILD_ID: requireDiscord ? requireValue(env, 'DISCORD_GUILD_ID', errors) : String(env.DISCORD_GUILD_ID || '').trim(),
    BOT_PROFILE: validateBotProfile(env.BOT_PROFILE, errors),
    BOT_TIMEZONE: validateTimeZone(env.BOT_TIMEZONE || env.TZ || DEFAULT_TIME_ZONE, 'BOT_TIMEZONE', errors),
    BOT_STATS_EVENT_DEBOUNCE_MS: parsePositiveInteger(env.BOT_STATS_EVENT_DEBOUNCE_MS, 15000, { min: 1000, max: 300000 }),
    BOT_STATS_VOICE_REFRESH_INTERVAL_MS: parsePositiveInteger(env.BOT_STATS_VOICE_REFRESH_INTERVAL_MS, 300000, { min: 60000, max: 3600000 }),
    BOT_PALWORLD_CHANNEL_NAME: String(env.BOT_PALWORLD_CHANNEL_NAME || '🐾・palworld').trim() || '🐾・palworld',
    BOT_PALWORLD_PUBLIC_CACHE_TTL_MS: parsePositiveInteger(env.BOT_PALWORLD_PUBLIC_CACHE_TTL_MS, 15000, { min: 10000, max: 30000 }),
    BOT_PALWORLD_PUBLIC_FETCH_TIMEOUT_MS: parsePositiveInteger(env.BOT_PALWORLD_PUBLIC_FETCH_TIMEOUT_MS, 5000, { min: 1000, max: 15000 }),
    BOT_PALWORLD_REST_FETCH_TIMEOUT_MS: parsePositiveInteger(env.BOT_PALWORLD_REST_FETCH_TIMEOUT_MS, 5000, { min: 1000, max: 15000 }),
    BOT_PALWORLD_REST_CIRCUIT_BREAKER_MS: parsePositiveInteger(env.BOT_PALWORLD_REST_CIRCUIT_BREAKER_MS, 30000, { min: 5000, max: 300000 }),
    BOT_PALWORLD_ADMIN_COOLDOWN_MS: parsePositiveInteger(env.BOT_PALWORLD_ADMIN_COOLDOWN_MS, 30000, { min: 5000, max: 600000 }),
    BOT_PALWORLD_METRICS_COOLDOWN_MS: parsePositiveInteger(env.BOT_PALWORLD_METRICS_COOLDOWN_MS, 240000, { min: 5000, max: 3600000 }),
    BOT_PALWORLD_ADMIN_CHANNEL_IDS: palworldAdminChannelIds,
    BOT_PALWORLD_ADMIN_CHANNEL_NAMES: parseList(env.BOT_PALWORLD_ADMIN_CHANNEL_NAMES),
    GAYLEMON_PUBLIC_BASE_URL: validateUrl(env.GAYLEMON_PUBLIC_BASE_URL || env.BOT_GAYLEMON_PUBLIC_BASE_URL || 'https://gaylemon.mathieu.pro', 'GAYLEMON_PUBLIC_BASE_URL', errors, { required: true }),
    GAYLEMON_DAILY_SUMMARY_TIME_ZONE: validateTimeZone(env.GAYLEMON_DAILY_SUMMARY_TIME_ZONE || env.BOT_TIMEZONE || DEFAULT_TIME_ZONE, 'GAYLEMON_DAILY_SUMMARY_TIME_ZONE', errors),
    GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS: dailySummaryCommandChannelIds,
    ...validatePalworldRestConfig(env, errors),
  };

  if (normalized.DISCORD_GUILD_ID && !/^\d{10,25}$/.test(normalized.DISCORD_GUILD_ID)) {
    errors.push('DISCORD_GUILD_ID must be a Discord ID');
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration: ${errors.join('; ')}`);
  }

  return normalized;
};

module.exports = {
  parseList,
  parsePositiveInteger,
  validateBotEnvironment,
};
