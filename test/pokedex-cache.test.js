const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _private } = require('../lib/pokedex');

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

test('memory cache evicts least-recently-used entries at the configured bound', () => {
  const previous = process.env.BOT_POKEAPI_MAX_MEMORY_ENTRIES;
  process.env.BOT_POKEAPI_MAX_MEMORY_ENTRIES = '16';
  _private.clearEndpointCaches();
  try {
    for (let index = 0; index < 17; index += 1) {
      _private.rememberMemoryEntry(`/entry-${index}`, { cachedAt: Date.now(), payload: { index } });
    }
    assert.equal(_private.memoryCacheKeys().length, 16);
    assert.equal(_private.memoryCacheKeys().includes('/entry-0'), false);
  } finally {
    if (previous === undefined) delete process.env.BOT_POKEAPI_MAX_MEMORY_ENTRIES;
    else process.env.BOT_POKEAPI_MAX_MEMORY_ENTRIES = previous;
    _private.clearEndpointCaches();
  }
});

test('disk cache quota removes the oldest file deterministically', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nether-beacon-pokedex-quota-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const oldest = path.join(tempDir, 'oldest.json');
  const newest = path.join(tempDir, 'newest.json');
  fs.writeFileSync(oldest, '12345678');
  fs.writeFileSync(newest, 'abcdefgh');
  fs.utimesSync(oldest, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
  fs.utimesSync(newest, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));

  _private.enforceDirectoryQuota(tempDir, { byteLimit: 12, fileLimit: 2 });

  assert.equal(fs.existsSync(oldest), false);
  assert.equal(fs.existsSync(newest), true);
});

test('disk cache quota enforces the aggregate file-count bound', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nether-beacon-pokedex-count-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  for (let index = 0; index < 3; index += 1) {
    const target = path.join(tempDir, `${index}.json`);
    fs.writeFileSync(target, String(index));
    fs.utimesSync(target, new Date(2026, 0, index + 1), new Date(2026, 0, index + 1));
  }

  _private.enforceDirectoryQuota(tempDir, { byteLimit: 1024, fileLimit: 2 });

  assert.deepEqual(fs.readdirSync(tempDir).sort(), ['1.json', '2.json']);
});

test('distinct upstream requests are rejected above the global concurrency bound', async () => {
  const previous = process.env.BOT_POKEAPI_MAX_CONCURRENT_REQUESTS;
  process.env.BOT_POKEAPI_MAX_CONCURRENT_REQUESTS = '1';
  _private.clearEndpointCaches();
  let release;
  _private.setRequestJsonForTests(() => new Promise((resolve) => { release = resolve; }));
  try {
    const first = _private.fetchEndpoint(`/busy-first-${Date.now()}`);
    await assert.rejects(_private.fetchEndpoint(`/busy-second-${Date.now()}`), /busy/i);
    release({ ok: true });
    await first;
  } finally {
    _private.setRequestJsonForTests(null);
    _private.clearEndpointCaches();
    if (previous === undefined) delete process.env.BOT_POKEAPI_MAX_CONCURRENT_REQUESTS;
    else process.env.BOT_POKEAPI_MAX_CONCURRENT_REQUESTS = previous;
  }
});

test('fetchEndpoint deduplicates concurrent upstream requests', async () => {
  _private.clearEndpointCaches();
  const endpoint = `/test-concurrent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let upstreamCalls = 0;

  _private.setRequestJsonForTests(async (url) => {
    upstreamCalls += 1;
    await delay(20);
    return { ok: true, url };
  });

  try {
    const [first, second, third] = await Promise.all([
      _private.fetchEndpoint(endpoint),
      _private.fetchEndpoint(endpoint),
      _private.fetchEndpoint(endpoint),
    ]);

    assert.equal(upstreamCalls, 1);
    assert.deepEqual(first, second);
    assert.deepEqual(second, third);

    const cached = await _private.fetchEndpoint(endpoint);
    assert.equal(upstreamCalls, 1);
    assert.deepEqual(cached, first);
  } finally {
    _private.setRequestJsonForTests(null);
    _private.clearEndpointCaches();
  }
});
