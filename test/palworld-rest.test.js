const assert = require('node:assert/strict');
const test = require('node:test');
const {
  fetchPalworldMetrics,
  formatPalworldAnnouncementForDiscord,
  formatPalworldMetrics,
  normalizeAnnouncementMessage,
  sendPalworldAnnouncement,
} = require('../lib/palworld-rest');

test('fetchPalworldMetrics calls the REST metrics endpoint with Basic auth', async () => {
  const calls = [];
  const metrics = await fetchPalworldMetrics({
    apiUrl: 'http://127.0.0.1:8212/v1/api/',
    username: 'admin',
    password: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          serverfps: 59.8,
          currentplayernum: 2,
          maxplayernum: 32,
          serverframetime: 16.72,
          uptime: 3661,
          basecampnum: 4,
          days: 12,
        }),
      };
    },
  });

  assert.equal(calls[0].url, 'http://127.0.0.1:8212/v1/api/metrics');
  assert.equal(calls[0].options.headers.Authorization, 'Basic YWRtaW46c2VjcmV0');
  assert.equal(metrics.currentPlayers, 2);
  assert.match(formatPalworldMetrics(metrics), /2\/32/);
  assert.match(formatPalworldMetrics(metrics), /1h 1m/);
});

test('sendPalworldAnnouncement posts the normalized message to the announce endpoint', async () => {
  const calls = [];
  await sendPalworldAnnouncement({
    apiUrl: 'http://127.0.0.1:8212/v1/api',
    username: 'admin',
    password: 'secret',
    message: '  Maintenance dans 5 minutes  ',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
      };
    },
  });

  assert.equal(calls[0].url, 'http://127.0.0.1:8212/v1/api/announce');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: 'Maintenance dans 5 minutes' });
});

test('formatPalworldAnnouncementForDiscord is public-safe and length-limited', () => {
  assert.equal(normalizeAnnouncementMessage('  Bonjour   le serveur  '), 'Bonjour le serveur');

  const message = formatPalworldAnnouncementForDiscord({
    message: '@everyone boss Alpha dans 5 minutes',
    authorName: 'Modo\nTest',
  });

  assert.match(message, /Annonce Palworld/);
  assert.match(message, /@everyone boss Alpha/);
  assert.match(message, /ModoTest/);
  assert.ok(message.length <= 1900);
});
