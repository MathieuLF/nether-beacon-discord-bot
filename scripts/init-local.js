const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { ensureMuseVolume } = require('../lib/local-volume');

const root = path.resolve(__dirname, '..');
const music = process.argv.includes('--music');
const run = (args, capture = false) => {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Docker ${args[0]} failed; initialization stopped.`);
  return result.stdout;
};
const compose = music ? ['compose', '--profile', 'music'] : ['compose'];
const initialize = (service, directories) => {
  const code = `const fs=require('node:fs'); for (const dir of ${JSON.stringify(directories)}) { fs.mkdirSync(dir,{recursive:true}); fs.chownSync(dir,10001,10001); }`;
  run([...compose, 'run', '--rm', '--no-deps', '-T', '--user', '0:0', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--entrypoint', 'node', service, '-e', code]);
};

try {
  // No bot entrypoint is executed. Existing Muse volume data is preserved.
  run([...compose, 'build']);
  if (music) {
    const config = JSON.parse(run([...compose, 'config', '--format', 'json'], true));
    const volumeName = config.volumes?.['muse-data']?.name;
    if (!volumeName) throw new Error('Missing explicit Muse volume name.');
    ensureMuseVolume({ name: volumeName, project: config.name, source: root, run });
    initialize('nether-beacon-muse', ['/data', '/bot/peer-state']);
  }
  initialize('nether-beacon', ['/bot/runtime']);
  console.log('Local directories initialized for UID 10001. No bot started.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
