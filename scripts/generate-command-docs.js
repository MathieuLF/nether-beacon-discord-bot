const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { commandPayload, commandPayloadForProfile, ADMIN_COMMAND_NAMES, STAFF_COMMAND_NAMES } = require('../lib/commands');

const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const renderCommandDocs = () => commandPayload.map((command) => {
  const profiles = ['minimal', 'pokemon', 'full'].filter((profile) => commandPayloadForProfile(profile).some((entry) => entry.name === command.name));
  const access = ADMIN_COMMAND_NAMES.has(command.name) ? 'Administrateurs' : STAFF_COMMAND_NAMES.has(command.name) ? 'Administrateurs et modérateurs' : 'Tous les membres';
  return `            <article class="command"><h3><code>/${command.name}</code></h3><p>${escapeHtml(command.description)}</p><p class="command-access">${access} · ${profiles.join(', ')}</p></article>`;
}).join('\n');

const updateCommandDocs = ({ check = false } = {}) => {
  const target = path.join(__dirname, '../docs/site/index.html');
  const html = fs.readFileSync(target, 'utf8');
  let next = html.replace(/<!-- commands:start -->[\s\S]*?<!-- commands:end -->/, `<!-- commands:start -->\n${renderCommandDocs()}\n<!-- commands:end -->`);
  for (const asset of ['site.css', 'site.js']) {
    const content = fs.readFileSync(path.join(__dirname, '../docs/site/assets', asset), 'utf8').replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
    next = next.replace(new RegExp(`assets/${asset.replace('.', '\\.')}([?]v=[a-f0-9]+)?`, 'g'), `assets/${asset}?v=${hash}`);
  }
  if (!html.includes('<!-- commands:start -->')) throw new Error('Command documentation marker missing');
  if (check && html !== next) throw new Error('Command docs out of date; run node scripts/generate-command-docs.js');
  if (!check) fs.writeFileSync(target, next);
};
if (require.main === module) updateCommandDocs({ check: process.argv.includes('--check') });
module.exports = { updateCommandDocs };
