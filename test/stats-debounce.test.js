const assert = require('node:assert/strict');
const test = require('node:test');
const { createStatsRefreshDebouncer } = require('../lib/stats-debounce');

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

test('stats debouncer coalesces event bursts into one refresh', async () => {
  const calls = [];
  const debouncer = createStatsRefreshDebouncer(20, async (guild, origin) => {
    calls.push({ guildId: guild.id, origin });
  });

  debouncer.schedule({ id: 'guild-1' }, 'voice-state');
  debouncer.schedule({ id: 'guild-2' }, 'presence-update');
  debouncer.schedule({ id: 'guild-2' }, 'voice-state');

  await delay(60);

  assert.deepEqual(calls, [
    {
      guildId: 'guild-2',
      origin: 'debounced:voice-state+presence-update',
    },
  ]);
});
