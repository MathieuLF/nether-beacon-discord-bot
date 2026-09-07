const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('PowerShell restart refuses foreign ownership and failed builds, permits the owned project', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('pwsh', ['-NoProfile', '-File', path.join(__dirname, '../test-support/restart-ownership.ps1'), '-Source', path.join(__dirname, '../scripts/rebuild-restart.ps1')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ownership scenarios passed/);
});
