const assert = require('node:assert/strict');
const test = require('node:test');
const { validateBotEnvironment } = require('../lib/env');

const baseEnv = {
  DISCORD_BOT_TOKEN: 'bot-token',
  DISCORD_GUILD_ID: '123456789012345678',
  BOT_TIMEZONE: 'America/Toronto',
  GAYLEMON_PUBLIC_BASE_URL: 'https://gaylemon.mathieu.pro',
};

test('environment validation defaults Palworld public HTTP settings to short safe values', () => {
  const env = validateBotEnvironment(baseEnv);

  assert.equal(env.BOT_PROFILE, 'minimal');
  assert.equal(env.BOT_PALWORLD_PUBLIC_FETCH_TIMEOUT_MS, 5000);
  assert.equal(env.BOT_PALWORLD_PUBLIC_CACHE_TTL_MS, 15000);
  assert.equal(env.BOT_PALWORLD_REST_FETCH_TIMEOUT_MS, 5000);
});

test('environment validation accepts pokemon and full profiles and rejects unknown profiles', () => {
  assert.equal(validateBotEnvironment({ ...baseEnv, BOT_PROFILE: 'pokemon' }).BOT_PROFILE, 'pokemon');
  assert.equal(validateBotEnvironment({ ...baseEnv, BOT_PROFILE: 'full' }).BOT_PROFILE, 'full');
  assert.throws(
    () => validateBotEnvironment({ ...baseEnv, BOT_PROFILE: 'public' }),
    /BOT_PROFILE must be minimal, pokemon or full/,
  );
});

test('environment validation rejects partial Palworld REST admin config', () => {
  assert.throws(() => validateBotEnvironment({
    ...baseEnv,
    BOT_PALWORLD_REST_API_URL: 'http://127.0.0.1:8212/v1/api',
    BOT_PALWORLD_REST_API_USERNAME: 'admin',
  }), /URL, username and password/);
});

test('environment validation rejects credentials embedded in URLs', () => {
  assert.throws(() => validateBotEnvironment({
    ...baseEnv,
    BOT_PALWORLD_REST_API_URL: 'http://admin:secret@127.0.0.1:8212/v1/api',
    BOT_PALWORLD_REST_API_USERNAME: 'admin',
    BOT_PALWORLD_REST_API_PASSWORD: 'secret',
  }), /must not include credentials/);
});
