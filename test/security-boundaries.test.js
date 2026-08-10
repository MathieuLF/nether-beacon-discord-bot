const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Collection, PermissionFlagsBits } = require('discord.js');
const { hasStaffAccess } = require('../lib/access-control');
const { createHttpJsonClient, SafeHttpError } = require('../lib/http-json-client');
const { _private: reconcilePrivate } = require('../lib/reconcile');
const { _private: pokedexPrivate } = require('../lib/pokedex');
const { normalizeDiscordReplyPayload, normalizePokedexFallbackPayload } = require('../lib/pokedex-reply');

const rootDir = path.resolve(__dirname, '..');

const roleInteraction = (roles) => ({
  inCachedGuild: () => true,
  memberPermissions: { has: () => false },
  member: { roles: { cache: new Collection(roles.map((role) => [role.id, role])) } },
});

test('staff authorization binds to stable role IDs and ignores duplicate names', () => {
  const settings = { adminRoleId: 'admin-managed', modRoleId: 'mod-managed' };

  assert.equal(hasStaffAccess(roleInteraction([{ id: 'mod-managed', name: 'Mod' }]), settings), true);
  assert.equal(hasStaffAccess(roleInteraction([{ id: 'rogue', name: 'Mod' }]), settings), false);
});

test('stale or duplicate managed role identity fails closed', () => {
  const guild = {
    roles: {
      cache: new Collection([
        ['managed', { id: 'managed', name: 'Mod' }],
        ['duplicate', { id: 'duplicate', name: 'Mod' }],
      ]),
    },
  };

  assert.match(
    reconcilePrivate.findUniqueRole(guild, 'Mod', { roles: { Mod: 'missing' } }).conflict,
    /enregistré|registre/i,
  );
  assert.match(
    reconcilePrivate.findUniqueRole(guild, 'Mod', { roles: { Mod: 'managed' } }).conflict,
    /plusieurs|doublon/i,
  );
});

test('managed channel reconciliation removes unexpected overwrites', async () => {
  const defaultTextBits = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
  const entries = [
    { id: 'everyone', allow: { bitfield: defaultTextBits }, deny: { bitfield: 0n }, type: 0 },
    { id: 'rogue-member', allow: { bitfield: PermissionFlagsBits.ViewChannel }, deny: { bitfield: 0n }, type: 1 },
  ];
  let written = null;
  const channel = {
    permissionOverwrites: {
      cache: {
        size: entries.length,
        get: (id) => entries.find((entry) => entry.id === id) || null,
        map: (callback) => entries.map(callback),
      },
      set: async (overwrites) => { written = overwrites; },
    },
  };

  await reconcilePrivate.ensureManagedOverwrites(
    channel,
    { '@everyone': { id: 'everyone' } },
    { preset: 'defaultText', everyonePreset: 'defaultText', groups: [] },
  );

  assert.deepEqual(written.map((overwrite) => overwrite.id), ['everyone']);
});

test('managed role reconciliation removes permissions outside the declared plan', () => {
  const roleDef = {
    name: 'Mod',
    color: 123,
    hoist: false,
    permissions: ['ManageMessages'],
  };
  const updates = reconcilePrivate.buildStrictRoleUpdates({
    name: 'Mod',
    color: 123,
    hoist: false,
    permissions: { bitfield: PermissionFlagsBits.ManageMessages | PermissionFlagsBits.Administrator },
  }, roleDef);

  assert.equal(updates.permissions, PermissionFlagsBits.ManageMessages);
});

test('shared HTTP client rejects a body over the configured byte limit', async () => {
  const client = createHttpJsonClient({
    defaultMaxResponseBytes: 16,
    fetchImpl: async () => new Response(JSON.stringify({ value: 'x'.repeat(32) }), {
      status: 200,
      headers: { 'content-length': '32', 'content-type': 'application/json' },
    }),
  });

  await assert.rejects(
    client.getJson('https://example.test/data'),
    (error) => error instanceof SafeHttpError && error.code === 'RESPONSE_TOO_LARGE',
  );
});

test('shared HTTP client enforces the byte limit on a streamed body without Content-Length', async () => {
  const chunks = [Buffer.from('{"value":"'), Buffer.from('x'.repeat(32)), Buffer.from('"}')];
  const client = createHttpJsonClient({
    defaultMaxResponseBytes: 16,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: new ReadableStream({
        pull(controller) {
          if (chunks.length === 0) controller.close();
          else controller.enqueue(chunks.shift());
        },
      }),
    }),
  });

  await assert.rejects(
    client.getJson('https://example.test/stream'),
    (error) => error instanceof SafeHttpError && error.code === 'RESPONSE_TOO_LARGE',
  );
});

test('Pokédex artwork metadata enforces host, IP and cache-key boundaries', async () => {
  const publicLookup = async () => [{ address: '185.199.108.133', family: 4 }];
  const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];

  await assert.doesNotReject(() => pokedexPrivate.validateAssetUrl(
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/6.png',
    { lookup: publicLookup },
  ));
  await assert.rejects(
    pokedexPrivate.validateAssetUrl('https://127.0.0.1/internal.png', { lookup: privateLookup }),
    /host|address|private/i,
  );
  assert.throws(() => pokedexPrivate.assetTargetPath('../outside'), /cache key|outside/i);
  assert.throws(
    () => pokedexPrivate.validateApiUrl('https://example.test/api/v2/pokemon/1'),
    /approved origin/i,
  );
});

test('Compose isolates Alpha and Muse credentials in separate services', () => {
  const compose = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /^  nether-beacon-muse:\s*$/m);

  const alphaBlock = compose.split(/^  nether-beacon-muse:\s*$/m)[0];
  assert.doesNotMatch(alphaBlock, /MUSE_DISCORD_TOKEN|MUSE_SPOTIFY_CLIENT_SECRET|MUSE_YOUTUBE_API_KEY/);
  assert.doesNotMatch(alphaBlock, /muse-data:\/data/);

  const museBlock = compose.split(/^  nether-beacon-muse:\s*$/m)[1];
  assert.doesNotMatch(museBlock, /DISCORD_BOT_TOKEN|BOT_PALWORLD_REST_API_PASSWORD/);
  assert.doesNotMatch(museBlock, /\.\/runtime:\/bot\/runtime/);
  assert.doesNotMatch(compose, /^\s+pid:\s*host\s*$/m);
});

test('Pokédex image validation rejects non-image cache content', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nether-beacon-image-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const target = path.join(tempDir, 'not-an-image.png');
  fs.writeFileSync(target, 'not really a PNG', 'utf8');
  assert.equal(pokedexPrivate.hasValidImageSignature(target), false);
});

test('Pokédex replies disable mentions and never expose attachment errors', () => {
  const normal = normalizeDiscordReplyPayload('hello <@123>');
  const fallback = normalizePokedexFallbackPayload('hello', new Error('C:\\secret\\runtime'));

  assert.deepEqual(normal.allowedMentions, { parse: [] });
  assert.deepEqual(fallback.allowedMentions, { parse: [] });
  assert.doesNotMatch(fallback.content, /secret|runtime/i);
  assert.match(pokedexPrivate.escapeDiscordMarkdown('**spoof** <@123>'), /\\\*\\\*spoof/);
});
