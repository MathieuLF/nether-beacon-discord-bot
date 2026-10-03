const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run validation through npm run check:dev.');
const snapshot = () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const hashes = files.map((file) => {
    const target = path.join(root, file);
    return [file, fs.existsSync(target) ? createHash('sha256').update(fs.readFileSync(target)).digest('hex') : null];
  });
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root, encoding: 'utf8' });
  return JSON.stringify({ hashes, status });
};
const before = snapshot();
let failure;
try {
  for (const script of ['syntax', 'validate:config', 'lint', 'typecheck', 'test', 'build:site']) {
    execFileSync(process.execPath, [npmCli, 'run', script], { cwd: root, stdio: 'inherit' });
  }
} catch (error) {
  failure = error;
}
if (snapshot() !== before) throw new Error('Validation changed non-ignored source files or Git status. Inspect the diff; nothing was restored.', { cause: failure });
if (failure) throw failure;
console.log('Development validation passed; source contents and Git status unchanged.');
