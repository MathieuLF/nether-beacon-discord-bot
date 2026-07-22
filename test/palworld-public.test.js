const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPalworldPublicClient,
  formatPublicPalworldStatus,
  normalizePublicMetrics,
} = require('../lib/palworld-public');

const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(payload),
});

test('public Palworld client reads filtered Gaylemon JSON and formats nominal status', async () => {
  const calls = [];
  const client = createPalworldPublicClient({
    publicBaseUrl: 'https://gaylemon.mathieu.pro/',
    now: () => Date.parse('2026-07-22T21:10:00.000Z'),
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/data/public-availability.json')) {
        return jsonResponse({
          ok: true,
          status: 'up',
          updatedAt: '2026-07-22T17:09:59-04:00',
          summary: {
            uptimeLast24h: 99.5,
            players: 3,
            maxPlayers: 12,
            fps: 58,
          },
          dataFreshness: [{ name: 'metrics', status: 'fresh', ok: true }],
        });
      }

      return jsonResponse({
        ok: true,
        updatedAt: '2026-07-22T17:09:58-04:00',
        provenance: { freshness: 'current', sourceStatus: 'available' },
        metrics: {
          players: 3,
          maxPlayers: 12,
          fps: 58.7,
          frameMs: 16.8,
          days: 42,
          baseCamps: 5,
          uptimeSeconds: 3661,
        },
        players: [{ name: 'Sprince' }, { name: 'Alyross' }],
      });
    },
  });

  const status = await client.fetchStatus();
  const cachedStatus = await client.fetchStatus();
  const message = formatPublicPalworldStatus(status);

  assert.deepEqual(calls, [
    'https://gaylemon.mathieu.pro/data/public-availability.json',
    'https://gaylemon.mathieu.pro/data/public-metrics.json',
  ]);
  assert.equal(status.source, 'gaylemon-public-json');
  assert.equal(cachedStatus.players, 3);
  assert.equal(status.players, 3);
  assert.equal(status.maxPlayers, 12);
  assert.equal(status.fresh, true);
  assert.match(message, /3\/12/);
  assert.match(message, /Sprince, Alyross/);
});

test('public Palworld client keeps stale JSON usable but marks it as stale', async () => {
  const client = createPalworldPublicClient({
    publicBaseUrl: 'https://gaylemon.mathieu.pro',
    now: () => Date.parse('2026-07-22T21:10:00.000Z'),
    fetchImpl: async (url) => {
      if (url.endsWith('/data/public-availability.json')) {
        return jsonResponse({
          ok: true,
          status: 'up',
          updatedAt: '2026-07-22T16:00:00-04:00',
          summary: { players: 2, maxPlayers: 12 },
          dataFreshness: [{ name: 'metrics', status: 'stale', ok: false }],
        });
      }

      return jsonResponse({
        ok: true,
        updatedAt: '2026-07-22T15:00:00-04:00',
        provenance: { freshness: 'stale', sourceStatus: 'available' },
        metrics: { players: 2, maxPlayers: 12 },
        players: [{ name: 'Brian' }],
      });
    },
  });

  const status = await client.fetchStatus();
  const message = formatPublicPalworldStatus(status);

  assert.equal(status.players, 2);
  assert.equal(status.fresh, false);
  assert.match(message, /temporairement figées/);
});

test('public Palworld player sanitizer never falls back to private identifiers', () => {
  const metrics = normalizePublicMetrics({
    ok: true,
    updatedAt: '2026-07-22T21:09:00.000Z',
    provenance: { freshness: 'current', sourceStatus: 'available' },
    metrics: { players: 2, maxPlayers: 12 },
    players: [
      {
        accountName: '76561198000000000',
        playerId: 'pal-player-id',
        userId: 'steam_76561198000000000',
        ip: '192.168.0.42',
      },
      {
        name: 'MathieuLF',
        accountName: 'private-account',
        playerId: 'private-player',
        userId: 'private-user',
        ip: '10.0.0.5',
        location: { x: 12, y: 34, z: 56 },
      },
    ],
  }, {
    nowMs: Date.parse('2026-07-22T21:10:00.000Z'),
  });

  const message = formatPublicPalworldStatus({
    source: 'gaylemon-public-json',
    checkedAt: '2026-07-22T21:10:00.000Z',
    fresh: true,
    freshnessIssues: [],
    status: 'up',
    players: 2,
    maxPlayers: 12,
    fps: null,
    frameMs: null,
    uptimeSeconds: null,
    days: null,
    baseCamps: null,
    uptimeLast24h: null,
    playerNames: metrics.playerNames,
    updatedAt: metrics.updatedAt,
  });

  assert.deepEqual(metrics.playerNames, ['MathieuLF']);
  assert.doesNotMatch(message, /accountName|playerId|userId|steam_|\b(?:\d{1,3}\.){3}\d{1,3}\b|76561198000000000/i);
});
