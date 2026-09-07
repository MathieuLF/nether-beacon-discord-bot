const test = require('node:test');
const assert = require('node:assert/strict');
const { createPalworldPublicClient, normalizePublicAvailability, normalizePublicMetrics, formatPublicPalworldStatus } = require('../lib/palworld-public');
const { normalizeMetrics, createPalworldRestClient } = require('../lib/palworld-rest');
const { buildDailySummaryMessage, createDailySummarySettings } = require('../lib/daily-summary');
const { isAdminHealthy, museProcessState } = require('../lib/service-health');

const now = Date.parse('2026-09-06T12:00:00Z');
const updatedAt = new Date(now - 1000).toISOString();
const json = (payload) => new Response(JSON.stringify(payload));

test('unknown metrics remain unknown; real zero and numeric strings survive', () => {
  for (const value of [null, undefined, '', ' ', false, [], {}, 'NaN']) {
    assert.equal(normalizeMetrics({ currentPlayers: value }).currentPlayers, null);
    assert.equal(normalizePublicMetrics({ metrics: { players: value } }).players, null);
  }
  assert.equal(normalizeMetrics({ currentPlayers: 0 }).currentPlayers, 0);
  assert.equal(normalizeMetrics({ currentPlayers: '3' }).currentPlayers, 3);
  assert.equal(normalizePublicAvailability({ summary: { uptimeLast24h: null, uptimeLast24hObserved: 98 } }).uptimeLast24h, 98);
});

test('availability and metrics reject missing, invalid, old and future timestamps as fresh', () => {
  for (const timestamp of [null, '', 'invalid', '2020-01-01T00:00:00Z', '2027-01-01T00:00:00Z']) {
    assert.equal(normalizePublicAvailability({ ok: true, status: 'up', updatedAt: timestamp }, { nowMs: now }).fresh, false);
    assert.equal(normalizePublicMetrics({ ok: true, updatedAt: timestamp }, { nowMs: now }).fresh, false);
  }
  assert.equal(normalizePublicAvailability({ ok: true, status: 'up', updatedAt }, { nowMs: now }).fresh, true);
});

test('partial upstream failures are visible, preserve fallback measurements and never fake freshness', async () => {
  for (const broken of ['metrics', 'availability']) {
    const client = createPalworldPublicClient({ now: () => now, fetchImpl: async (url) => {
      if (url.includes(`public-${broken}`)) return new Response('', { status: 503 });
      return json({ ok: true, status: 'up', updatedAt, metrics: { players: 3 }, summary: { players: 4 } });
    } });
    const status = await client.fetchStatus();
    assert.equal(status.fresh, false);
    assert.equal(status.players, broken === 'metrics' ? 4 : 3);
    assert.ok(status.freshnessIssues.includes(`${broken}-unavailable`));
    assert.match(formatPublicPalworldStatus(status), /incomplètes/);
  }
  const client = createPalworldPublicClient({ now: () => now, fetchImpl: async () => json(null) });
  await assert.rejects(client.fetchStatus, { code: 'PUBLIC_DATA_UNAVAILABLE' });
});

test('a null metric falls back to availability and stale availability cannot assert online', async () => {
  const client = createPalworldPublicClient({ now: () => now, fetchImpl: async (url) => json(url.includes('availability')
    ? { ok: true, status: 'up', updatedAt: '2020-01-01T00:00:00Z', summary: { players: 4 } }
    : { ok: true, updatedAt, metrics: { players: null } }) });
  const status = await client.fetchStatus();
  assert.equal(status.players, 4);
  assert.equal(status.status, 'unknown');
});

test('an announcement cannot be sent twice after a lost response', async () => {
  let delivered = 0;
  const client = createPalworldRestClient({ apiUrl: 'http://localhost/v1/api', username: 'test', password: 'test', fetchImpl: async () => {
    delivered += 1;
    throw new TypeError('response lost after delivery');
  } });
  await assert.rejects(() => client.sendAnnouncement('test'));
  assert.equal(delivered, 1);
});

test('daily recap differentiates unavailable, page-only and confirmed data', () => {
  const settings = createDailySummarySettings({});
  const render = (availability) => buildDailySummaryMessage(settings, '2026-09-05', availability).embeds[0].toJSON().description;
  assert.match(render({ ok: false, indexOk: false }), /pas confirmé disponible/);
  assert.match(render({ ok: true, indexOk: false }), /données n’ont pas pu être confirmées/);
  assert.match(render({ ok: true, indexOk: true }), /est disponible/);
});

test('fresh heartbeats require gateway readiness and stale Muse process state is not online', () => {
  assert.equal(isAdminHealthy({ healthy: true, gatewayReady: false, timestamp: updatedAt }, now), false);
  assert.equal(isAdminHealthy({ healthy: true, gatewayReady: true, timestamp: updatedAt }, now), true);
  for (const heartbeatAt of ['invalid', '2020-01-01T00:00:00Z', '2027-01-01T00:00:00Z']) {
    assert.equal(museProcessState({ running: true, heartbeatAt }, now).running, false);
  }
});
