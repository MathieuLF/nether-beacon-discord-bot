const assert = require('node:assert/strict');
const test = require('node:test');
const { buildMuseEnv } = require('../lib/muse-env');

test('Muse receives only its own secrets and required runtime variables', () => {
  const museEnv = buildMuseEnv({
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/home/node',
    LANG: 'C.UTF-8',
    DISCORD_BOT_TOKEN: 'alpha-secret',
    BOT_PALWORLD_REST_API_PASSWORD: 'palworld-secret',
    UNRELATED_SECRET: 'must-not-leak',
    MUSE_DISCORD_TOKEN: 'bravo-secret',
    MUSE_YOUTUBE_API_KEY: 'youtube-key',
    MUSE_SPOTIFY_CLIENT_ID: 'spotify-id',
    MUSE_SPOTIFY_CLIENT_SECRET: 'spotify-secret',
    MUSE_CACHE_LIMIT: '512MB',
  });

  assert.equal(museEnv.DISCORD_TOKEN, 'bravo-secret');
  assert.equal(museEnv.YOUTUBE_API_KEY, 'youtube-key');
  assert.equal(museEnv.SPOTIFY_CLIENT_ID, 'spotify-id');
  assert.equal(museEnv.SPOTIFY_CLIENT_SECRET, 'spotify-secret');
  assert.equal(museEnv.CACHE_LIMIT, '512MB');
  assert.equal(museEnv.PATH, '/usr/local/bin:/usr/bin');
  assert.equal(museEnv.HOME, '/home/node');
  assert.equal(museEnv.LANG, 'C.UTF-8');
  assert.equal(museEnv.DISCORD_BOT_TOKEN, undefined);
  assert.equal(museEnv.BOT_PALWORLD_REST_API_PASSWORD, undefined);
  assert.equal(museEnv.UNRELATED_SECRET, undefined);
});
