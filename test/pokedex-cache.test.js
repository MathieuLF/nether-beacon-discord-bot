const assert = require('node:assert/strict');
const test = require('node:test');
const { _private } = require('../lib/pokedex');

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
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
