const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPlayerSnapshot,
  defaultPlayerState,
  fetchPalworldMetrics,
  formatPalworldAnnouncementForDiscord,
  formatPalworldMetrics,
  normalizeAnnouncementMessage,
  planPalworldPlayerAnnouncements,
  planPalworldPlayerFetchFailure,
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

test('planPalworldPlayerAnnouncements baselines first poll then announces stable joins and leaves after grace', () => {
  const initialSnapshot = buildPlayerSnapshot({
    players: [
      { name: 'Lamball', playerId: 'player-1', ip: '10.0.0.1' },
      { name: 'Cattiva', playerId: 'player-2', location_x: 123 },
    ],
  }, '2026-07-10T12:00:00.000Z');
  const initial = planPalworldPlayerAnnouncements(initialSnapshot, defaultPlayerState());

  assert.equal(initial.messages.length, 0);
  assert.equal(initial.state.hasBaseline, true);

  const changedSnapshot = buildPlayerSnapshot({
    players: [
      { name: 'Lamball', playerId: 'player-1', ip: '10.0.0.1' },
      { name: 'Direhowl', playerId: 'player-3', location_x: 456 },
    ],
  }, '2026-07-10T12:01:00.000Z');
  const changed = planPalworldPlayerAnnouncements(changedSnapshot, initial.state);

  assert.equal(changed.messages.length, 0);
  assert.equal(Object.keys(changed.state.pendingPlayerEvents).length, 2);

  const stable = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({
      players: [
        { name: 'Lamball', playerId: 'player-1', ip: '10.0.0.1' },
        { name: 'Direhowl', playerId: 'player-3', location_x: 456 },
      ],
    }, '2026-07-10T12:03:01.000Z'),
    changed.state,
  );

  assert.equal(stable.messages.length, 2);
  assert.match(stable.messages[0], /Direhowl/);
  assert.match(stable.messages[1], /Cattiva/);
  assert.doesNotMatch(stable.messages.join('\n'), /10\.0\.0\.1|player-1|location/);
  assert.equal(Object.keys(stable.state.pendingPlayerEvents).length, 0);
});

test('planPalworldPlayerAnnouncements cancels quick disconnect and reconnect flaps', () => {
  const initial = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [{ name: 'Lamball', playerId: 'player-1' }] }, '2026-07-10T12:00:00.000Z'),
    defaultPlayerState(),
  );
  const disconnected = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [] }, '2026-07-10T12:01:00.000Z'),
    initial.state,
  );

  assert.equal(disconnected.messages.length, 0);
  assert.equal(Object.keys(disconnected.state.pendingPlayerEvents).length, 1);

  const reconnected = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [{ name: 'Lamball', playerId: 'player-1' }] }, '2026-07-10T12:01:45.000Z'),
    disconnected.state,
  );

  assert.equal(reconnected.messages.length, 0);
  assert.equal(Object.keys(reconnected.state.pendingPlayerEvents).length, 0);

  const stillOnline = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [{ name: 'Lamball', playerId: 'player-1' }] }, '2026-07-10T12:04:00.000Z'),
    reconnected.state,
  );

  assert.equal(stillOnline.messages.length, 0);
});

test('planPalworldPlayerAnnouncements can use a zero grace window for immediate event planning', () => {
  const initial = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [{ name: 'Lamball', playerId: 'player-1' }] }, '2026-07-10T12:00:00.000Z'),
    defaultPlayerState(),
  );
  const changed = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [{ name: 'Direhowl', playerId: 'player-3' }] }, '2026-07-10T12:01:00.000Z'),
    initial.state,
    { eventGraceMs: 0 },
  );

  assert.equal(changed.messages.length, 2);
  assert.match(changed.messages[0], /Direhowl/);
  assert.match(changed.messages[1], /Lamball/);
});

test('planPalworldPlayerFetchFailure logs outages privately once and rebaselines on recovery', () => {
  const initial = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [{ name: 'Lamball', playerId: 'player-1' }] }),
    defaultPlayerState(),
  );
  const failed = planPalworldPlayerFetchFailure({
    error: new Error('connect ECONNREFUSED'),
    previousState: initial.state,
    checkedAt: '2026-07-10T12:02:00.000Z',
  });

  assert.equal(failed.logMessages.length, 1);
  assert.match(failed.logMessages[0], /API REST Palworld indisponible/);

  const repeatedFailure = planPalworldPlayerFetchFailure({
    error: new Error('connect ECONNREFUSED'),
    previousState: failed.state,
  });
  assert.equal(repeatedFailure.logMessages.length, 0);

  const recovered = planPalworldPlayerAnnouncements(
    buildPlayerSnapshot({ players: [{ name: 'Direhowl', playerId: 'player-3' }] }, '2026-07-10T12:03:00.000Z'),
    failed.state,
  );

  assert.equal(recovered.messages.length, 0);
  assert.equal(recovered.logMessages.length, 1);
  assert.match(recovered.logMessages[0], /revenue/);
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
