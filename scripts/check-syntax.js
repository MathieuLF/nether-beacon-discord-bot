const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [];
const collect = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
};
for (const directory of ['lib', 'scripts', 'test', 'test-support', 'docs/site/assets']) collect(path.join(root, directory));
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(root, entry.name));
}
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`Syntax checked: ${files.length} JavaScript files. No application code executed.`);
