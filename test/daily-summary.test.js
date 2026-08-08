const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildDailySummaryMessage,
  createDailySummarySettings,
  getPreviousLocalDateKey,
  getSummaryUrl,
} = require('../lib/daily-summary');

test('manual daily summary defaults to Palworld and the previous Toronto day', () => {
  const settings = createDailySummarySettings({
    BOT_PALWORLD_CHANNEL_NAME: '🐾・palworld',
    BOT_TIMEZONE: 'America/Toronto',
  });

  assert.deepEqual(settings.commandChannelNames, ['🐾・palworld']);

  const dateKey = getPreviousLocalDateKey(new Date('2026-07-17T05:00:00.000Z'), settings.timeZone);
  assert.equal(dateKey, '2026-07-16');
  assert.equal(getSummaryUrl(settings, dateKey), 'https://gaylemon.mathieu.pro/resume?jour=2026-07-16');
});

test('legacy schedule variables cannot reactivate automatic publication', () => {
  const settings = createDailySummarySettings({
    GAYLEMON_DAILY_SUMMARY_HOUR: '1',
    GAYLEMON_DAILY_SUMMARY_MINUTE: '0',
    GAYLEMON_DAILY_SUMMARY_POST_WINDOW_MINUTES: '120',
    GAYLEMON_DAILY_SUMMARY_CHANNEL_IDS: '111',
    GAYLEMON_DAILY_SUMMARY_CHANNEL_NAMES: '🐾・palworld',
  });

  assert.equal('hour' in settings, false);
  assert.equal('minute' in settings, false);
  assert.equal('postWindowMinutes' in settings, false);
  assert.equal('channelIds' in settings, false);
  assert.equal('channelNames' in settings, false);
});

test('manual daily summary accepts explicit command channel ids and names', () => {
  const settings = createDailySummarySettings({
    GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS: '333',
    GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_NAMES: '🐾・palworld',
  });

  assert.deepEqual(settings.commandChannelIds, ['333']);
  assert.deepEqual(settings.commandChannelNames, ['🐾・palworld']);
});

test('daily summary message keeps the link in plain text without buttons or redundant fields', () => {
  const settings = createDailySummarySettings({
    BOT_PALWORLD_CHANNEL_NAME: '🐾・palworld',
  });
  const payload = buildDailySummaryMessage(settings, '2026-07-16');
  const embed = payload.embeds[0].toJSON();

  assert.equal(payload.components, undefined);
  assert.equal(embed.fields, undefined);
  assert.equal(embed.footer, undefined);
  assert.match(embed.description, /https:\/\/gaylemon\.mathieu\.pro\/resume\?jour=2026-07-16/);
  assert.doesNotMatch(embed.description, /sont réunis au même endroit/);
  assert.doesNotMatch(embed.description, /mise à jour/);
});
