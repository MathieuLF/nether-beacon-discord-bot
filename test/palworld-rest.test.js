const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPalworldRestClient,
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
      return new Response(JSON.stringify({
          serverfps: 59.8,
          currentplayernum: 2,
          maxplayernum: 32,
          serverframetime: 16.72,
          uptime: 3661,
          basecampnum: 4,
          days: 12,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
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
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(calls[0].url, 'http://127.0.0.1:8212/v1/api/announce');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: 'Maintenance dans 5 minutes' });
});

test('Palworld REST client retries one transient network error and does not retry HTTP failures', async () => {
  const calls = [];
  const transient = new TypeError('fetch failed');
  transient.code = 'ECONNRESET';

  const client = createPalworldRestClient({
    apiUrl: 'http://127.0.0.1:8212/v1/api',
    username: 'admin',
    password: 'secret',
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) throw transient;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await client.sendAnnouncement('Serveur ouvert');
  assert.equal(calls.length, 2);
});

test('Palworld REST client opens a short circuit when the local API is down', async () => {
  let now = Date.parse('2026-07-22T21:10:00.000Z');
  let calls = 0;
  const down = new TypeError('connect ECONNREFUSED 127.0.0.1');
  down.code = 'ECONNREFUSED';

  const client = createPalworldRestClient({
    apiUrl: 'http://127.0.0.1:8212/v1/api',
    username: 'admin',
    password: 'secret',
    circuitBreakerMs: 30000,
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      throw down;
    },
  });

  await assert.rejects(() => client.sendAnnouncement('Test'), { code: 'NETWORK_ERROR' });
  assert.equal(calls, 2, 'one transient retry is allowed');

  await assert.rejects(() => client.sendAnnouncement('Test'), { code: 'CIRCUIT_OPEN' });
  assert.equal(calls, 2, 'open circuit should avoid another local API call');

  now += 31000;
  await assert.rejects(() => client.sendAnnouncement('Test'), { code: 'NETWORK_ERROR' });
  assert.equal(calls, 4, 'circuit closes after the short cool-off window');
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
  assert.doesNotMatch(message, /192\.168\.|7656119|playerId|userId|accountName|secret/i);
  assert.ok(message.length <= 1900);
});
