const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionHandler } = require('../lib/interaction-router');
const { buildHelpText } = require('../lib/help');

const setup = (commandName, overrides = {}) => {
  const calls = [];
  const interaction = {
    commandName, guildId: 'guild', guild: { id: 'guild' }, user: { id: 'user' },
    isAutocomplete: () => false, isChatInputCommand: () => true,
    deferred: false, replied: false,
    async deferReply() { calls.push('ack'); this.deferred = true; },
    async reply(payload) { assert.equal(this.deferred, false); calls.push(payload); this.replied = true; },
    async editReply(payload) { assert.equal(this.deferred, true); calls.push(payload); },
  };
  const deps = {
    GUILD_ID: 'guild', enabledCommandNames: new Set([commandName]), BOT_PROFILE: 'full',
    hasAdminAccess: () => true, hasStaffAccess: () => false,
    state: {}, updateRuntimeFiles() {}, knownSecretValues: () => [],
    formatBotMessage: (title, lines) => [title, ...lines].join('\n'), formatLine: (label, value) => `${label}: ${value}`,
    refreshGuild: async () => { assert.equal(interaction.deferred, true); calls.push('fetch'); return { id: 'guild', name: 'Guild' }; },
    summarizeStatus: () => 'status', sendLog: async () => {}, ...overrides,
  };
  return { calls, interaction, run: () => createInteractionHandler(deps)(interaction) };
};

test('admin status acknowledges before a slow guild REST lookup', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const fixture = setup('status', { refreshGuild: () => pending });
  const request = fixture.run();
  await new Promise(setImmediate);
  assert.deepEqual(fixture.calls, ['ack']);
  release({ id: 'guild', name: 'Guild' });
  await request;
  assert.equal(fixture.calls[1].content, 'status');
});

test('deferred failures edit the initial reply and never report stats success', async () => {
  const fixture = setup('stats-refresh', { refreshStatsDisplaySafe: async () => ({ status: 'failed', error: new Error('write refused') }) });
  await fixture.run();
  assert.equal(fixture.calls[0], 'ack');
  assert.match(fixture.calls.at(-1).content, /write refused/);
  assert.doesNotMatch(fixture.calls.at(-1).content, /Stats rafraîchies/);
});

test('public help is profile-aware and does not disclose admin/staff commands', async () => {
  const fixture = setup('help', { hasAdminAccess: () => false });
  await fixture.run();
  assert.match(fixture.calls[0].content, /\/pokemon/);
  assert.doesNotMatch(fixture.calls[0].content, /\/resync|\/announce-palworld/);
  assert.doesNotMatch(buildHelpText({ profile: 'minimal' }), /\/pokemon|\/audit/);
  assert.match(buildHelpText({ profile: 'full', staff: true }), /\/announce-palworld/);
  assert.ok(buildHelpText({ profile: 'full', admin: true }).length < 2000);
});

test('denied administrative access never invokes the guild lookup', async () => {
  const fixture = setup('resync', { hasAdminAccess: () => false, refreshGuild: () => { throw new Error('must not fetch'); } });
  await fixture.run();
  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.calls[0].content, /Accès refusé/);
});

test('autocomplete returns before the Discord deadline when the upstream lookup stalls', async () => {
  const responses = [];
  const handler = createInteractionHandler({ GUILD_ID: 'guild', enabledCommandNames: new Set(['pokemon']), lookupAutocomplete: () => new Promise(() => {}), autocompleteTimeoutMs: 5 });
  await handler({ isAutocomplete: () => true, guildId: 'guild', commandName: 'pokemon', options: { getFocused: () => ({ value: 'char' }) }, respond: async (choices) => { responses.push(choices); } });
  assert.deepEqual(responses, [[]]);
});
