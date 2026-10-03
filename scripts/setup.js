const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const expectedNode = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
const expectedNpm = require('../package.json').packageManager.split('@')[1];
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run setup through npm run setup.');
const runNpm = (args, capture = false) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd: root,
  stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8',
});

if (process.versions.node !== expectedNode) {
  throw new Error(`Setup requires Node ${expectedNode}; select it with nvm or your Cloud runtime settings.`);
}
if (runNpm(['--version'], true).trim() !== expectedNpm) {
  throw new Error(`Setup requires npm ${expectedNpm}; install it with npm install --global npm@${expectedNpm}.`);
}
runNpm(['ci', '--no-fund', '--no-audit']);
console.log('Setup complete. No .env, Discord connection, Docker service or application database required for check:dev.');
