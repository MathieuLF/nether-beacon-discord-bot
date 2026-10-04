// Run inside the candidate image with --network none and a disposable /tmp.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const requireMuse = createRequire('/usr/app/package.json');

async function main() {
  assert.equal(process.getuid(), 10001);
  execFileSync('python3', ['/tmp/verify-zlib-runtime.py'], { timeout: 15000, stdio: 'inherit' });
  for (const installer of ['/opt/yt-dlp/bin/pip', '/usr/lib/python3.14/ensurepip', '/usr/local/bin/npm', '/usr/local/bin/yarn']) {
    assert.equal(fs.existsSync(installer), false, `Runtime must not retain ${installer}`);
  }
  const dataDir = fs.mkdtempSync('/tmp/muse-runtime-');
  const databaseUrl = `file:${dataDir}/smoke.sqlite`;
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    DATA_DIR: dataDir,
    ENV_FILE: `${dataDir}/absent.env`,
    DISCORD_TOKEN: 'offline-test-token',
    YOUTUBE_API_KEY: 'offline-test-key',
    SPOTIFY_CLIENT_ID: '',
    SPOTIFY_CLIENT_SECRET: '',
  });
  execFileSync('/usr/app/node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: '/usr/app', env: process.env, stdio: 'pipe', timeout: 60000,
  });
  const { PrismaClient } = requireMuse('@prisma/client');
  const client = new PrismaClient();
  try {
    await client.setting.create({ data: { guildId: 'offline-smoke' } });
    assert.equal((await client.setting.findUnique({ where: { guildId: 'offline-smoke' } })).defaultVolume, 100);
    await client.setting.delete({ where: { guildId: 'offline-smoke' } });
  } finally {
    await client.$disconnect();
  }
  const { OpusEncoder } = requireMuse('@discordjs/opus');
  const encoder = new OpusEncoder(48000, 2);
  const pcm = Buffer.alloc(960 * 2 * 2);
  assert.equal(encoder.decode(encoder.encode(pcm)).length, pcm.length);
  execFileSync('/usr/local/bin/ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'libopus', '-f', 'null', '-'], { timeout: 15000 });
  assert.match(execFileSync('/opt/yt-dlp/bin/yt-dlp', ['--version'], { encoding: 'utf8', timeout: 15000 }), /2026\.08\.19/);
  await import('/usr/app/dist/index.js');
  console.log('Muse runtime passed: migrations, SQLite write/read/delete, Opus, FFmpeg, yt-dlp and application imports; network disabled.');
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
