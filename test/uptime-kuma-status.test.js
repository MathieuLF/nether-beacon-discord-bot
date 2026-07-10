const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildSnapshot,
  defaultState,
  parseStatusPageUrl,
  planUptimeKumaAnnouncements,
  planUptimeKumaFetchFailure,
} = require('../lib/uptime-kuma-status');

const endpoints = parseStatusPageUrl('https://uptime.mathieu.pro/status/palworld');

const pageData = (maintenanceList = []) => ({
  config: {
    title: 'Palworld - Gaylémon',
  },
  publicGroupList: [
    {
      id: 1,
      name: 'Services',
      monitorList: [
        {
          id: 1,
          name: 'Palworld - Gaylémon',
          type: 'push',
        },
      ],
    },
  ],
  maintenanceList,
  incidents: [],
});

const heartbeatData = (status) => ({
  heartbeatList: {
    1: [
      {
        status,
        time: '2026-07-10 13:06:11.057',
        msg: '',
        ping: status === 1 ? 16.8 : null,
      },
    ],
  },
  uptimeList: {
    '1_24': 1,
  },
});

test('parseStatusPageUrl derives public status page endpoints', () => {
  assert.deepEqual(endpoints, {
    slug: 'palworld',
    pageUrl: 'https://uptime.mathieu.pro/status/palworld',
    statusApiUrl: 'https://uptime.mathieu.pro/api/status-page/palworld',
    heartbeatApiUrl: 'https://uptime.mathieu.pro/api/status-page/heartbeat/palworld',
  });
});

test('planUptimeKumaAnnouncements announces status changes without repeating stable status', () => {
  const upSnapshot = buildSnapshot(pageData(), heartbeatData(1), endpoints);
  const first = planUptimeKumaAnnouncements(upSnapshot, defaultState());

  assert.equal(first.messages.length, 1);
  assert.match(first.messages[0], /est actif/);

  const repeated = planUptimeKumaAnnouncements(upSnapshot, first.state);
  assert.equal(repeated.messages.length, 0);

  const downSnapshot = buildSnapshot(pageData(), heartbeatData(0), endpoints);
  const down = planUptimeKumaAnnouncements(downSnapshot, repeated.state);

  assert.equal(down.messages.length, 1);
  assert.match(down.messages[0], /est inactif/);
});

test('planUptimeKumaAnnouncements announces maintenance revisions once and closure once', () => {
  const maintenance = {
    id: 12,
    title: 'Redémarrage serveur',
    description: 'Maintenance planifiée',
    status: 'scheduled',
    active: true,
    timeslotList: [
      {
        startDate: '2026-07-10T20:00:00.000Z',
        endDate: '2026-07-10T20:30:00.000Z',
      },
    ],
  };
  const snapshot = buildSnapshot(pageData([maintenance]), heartbeatData(1), endpoints);
  const first = planUptimeKumaAnnouncements(snapshot, defaultState());

  assert.equal(first.messages.length, 2);
  assert.match(first.messages[1], /Maintenance Palworld/);
  assert.match(first.messages[1], /Redémarrage serveur/);

  const repeated = planUptimeKumaAnnouncements(snapshot, first.state);
  assert.equal(repeated.messages.length, 0);

  const clearedSnapshot = buildSnapshot(pageData(), heartbeatData(1), endpoints);
  const cleared = planUptimeKumaAnnouncements(clearedSnapshot, repeated.state);

  assert.equal(cleared.messages.length, 1);
  assert.match(cleared.messages[0], /terminée/);
});

test('planUptimeKumaFetchFailure logs Kuma outages without public Palworld messages', () => {
  const error = new Error('connect ECONNREFUSED');
  const first = planUptimeKumaFetchFailure({
    error,
    previousState: defaultState(),
    statusPageUrl: endpoints.pageUrl,
    checkedAt: '2026-07-10T13:30:00.000Z',
  });

  assert.equal(first.logMessages.length, 1);
  assert.match(first.logMessages[0], /Uptime Kuma indisponible/);
  assert.equal(first.state.uptimeKumaReachable, false);

  const repeated = planUptimeKumaFetchFailure({
    error,
    previousState: first.state,
    statusPageUrl: endpoints.pageUrl,
    checkedAt: '2026-07-10T13:31:00.000Z',
  });

  assert.equal(repeated.logMessages.length, 0);
});

test('planUptimeKumaAnnouncements logs Kuma recovery without replaying stable Palworld status', () => {
  const upSnapshot = buildSnapshot(pageData(), heartbeatData(1), endpoints);
  const initial = planUptimeKumaAnnouncements(upSnapshot, defaultState());
  const failed = planUptimeKumaFetchFailure({
    error: new Error('fetch failed'),
    previousState: initial.state,
    statusPageUrl: endpoints.pageUrl,
    checkedAt: '2026-07-10T13:30:00.000Z',
  });
  const recovered = planUptimeKumaAnnouncements(upSnapshot, failed.state);

  assert.equal(recovered.messages.length, 0);
  assert.equal(recovered.logMessages.length, 1);
  assert.match(recovered.logMessages[0], /Uptime Kuma est revenu/);
  assert.equal(recovered.state.uptimeKumaReachable, true);
});
