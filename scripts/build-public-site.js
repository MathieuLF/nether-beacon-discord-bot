const fs = require('node:fs');
const path = require('node:path');
const { updateCommandDocs } = require('./generate-command-docs');

updateCommandDocs({ check: true });
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error('public/ must not be a symbolic link');
if (path.dirname(path.resolve(output)) !== root) throw new Error('Invalid public build path');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(root, 'docs/site'), output, { recursive: true });
for (const file of ['docs/ASSETS.md', 'docs/LEGAL.md', 'docs/OPERATIONS.md', 'docs/PUBLICATION.md', 'LICENSE', 'NOTICE.md']) {
  fs.copyFileSync(path.join(root, file), path.join(output, path.basename(file)));
}
console.log('Static site assembled in public/');
