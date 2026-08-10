const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  formatCacheStatus,
  formatDiagnostics,
} = require('../lib/diagnostics');

test('diagnostic output redacts known secrets', () => {
  const secret = 'super-secret-token-123456';
  const output = formatDiagnostics({
    state: {
      version: '1.1.0',
      guildId: 'guild-1',
      startedAt: '2026-01-01T00:00:00.000Z',
      commandsRegisteredAt: '2026-01-01T00:00:00.000Z',
      activeTask: null,
      lastStats: null,
      lastError: `request failed token=${secret}`,
    },
    guild: { name: 'Test Guild', id: 'guild-1' },
    services: {
      children: {
        admin: { running: true },
        muse: { running: true },
      },
    },
    pingMs: 42,
    commandHash: 'abc123',
    commandCount: 14,
    dependencies: {
      discordJs: '14.26.4',
      dotenv: '17.4.2',
    },
    secrets: [secret],
  });

  assert.equal(output.includes(secret), false);
  assert.ok(output.includes('[secret]'));
});

test('cache status reports metadata only', () => {
  const secret = 'secret-cache-content-123456';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nether-beacon-cache-'));
  fs.mkdirSync(path.join(tempDir, 'pokedex-cache', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'pokedex-cache', 'assets', 'sample.txt'), secret, 'utf8');

  const output = formatCacheStatus({ runtimeDir: tempDir });

  assert.equal(output.includes(secret), false);
  assert.ok(output.includes('Assets Pokédex'));
});
