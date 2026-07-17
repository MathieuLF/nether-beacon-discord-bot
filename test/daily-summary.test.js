const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildDailySummaryMessage,
  createDailySummarySettings,
  getSummaryUrl,
  shouldRunDailySummary,
} = require('../lib/daily-summary');

test('daily summary defaults to Palworld and yesterday at 01:00 America/Toronto', () => {
  const settings = createDailySummarySettings({
    BOT_PALWORLD_CHANNEL_NAME: '🐾・palworld',
    BOT_TIMEZONE: 'America/Toronto',
  });

  assert.deepEqual(settings.channelNames, ['🐾・palworld']);
  assert.equal(settings.hour, 1);
  assert.equal(settings.minute, 0);

  const schedule = shouldRunDailySummary(new Date('2026-07-17T05:00:00.000Z'), settings);

  assert.equal(schedule.due, true);
  assert.equal(schedule.dateKey, '2026-07-16');
  assert.equal(getSummaryUrl(settings, schedule.dateKey), 'https://gaylemon.mathieu.pro/resume?jour=2026-07-16');
});

test('daily summary accepts explicit channel ids and names', () => {
  const settings = createDailySummarySettings({
    GAYLEMON_DAILY_SUMMARY_CHANNEL_IDS: '111,222',
    GAYLEMON_DAILY_SUMMARY_CHANNEL_NAMES: '🐾・palworld',
    GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS: '333',
  });

  assert.deepEqual(settings.channelIds, ['111', '222']);
  assert.deepEqual(settings.channelNames, ['🐾・palworld']);
  assert.deepEqual(settings.commandChannelIds, ['333']);
});

test('daily summary message keeps the link in plain text without buttons or redundant fields', () => {
  const settings = createDailySummarySettings({
    BOT_PALWORLD_CHANNEL_NAME: '🐾・palworld',
  });
  const payload = buildDailySummaryMessage(settings, '2026-07-16', { ok: true }, 'scheduled');
  const embed = payload.embeds[0].toJSON();

  assert.equal(payload.components, undefined);
  assert.equal(embed.fields, undefined);
  assert.equal(embed.footer, undefined);
  assert.match(embed.description, /https:\/\/gaylemon\.mathieu\.pro\/resume\?jour=2026-07-16/);
  assert.doesNotMatch(embed.description, /sont réunis au même endroit/);
  assert.doesNotMatch(embed.description, /mise à jour/);
});
