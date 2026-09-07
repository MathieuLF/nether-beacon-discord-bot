const path = require('node:path');

const sourceIdentity = (source) => process.platform === 'win32' ? path.resolve(source).toLowerCase() : path.resolve(source);
const ensureMuseVolume = ({ name, project, source, run }) => {
  const expected = { 'dev.netherbeacon.project': project, 'dev.netherbeacon.source': sourceIdentity(source) };
  const names = run(['volume', 'ls', '--format', '{{.Name}}'], true).split(/\r?\n/);
  if (!names.includes(name)) {
    run(['volume', 'create', ...Object.entries(expected).flatMap(([key, value]) => ['--label', `${key}=${value}`]), name]);
  }
  // Re-read even after create: Docker may have returned a pre-existing volume.
  const volume = JSON.parse(run(['volume', 'inspect', name], true))[0];
  if (!volume || Object.entries(expected).some(([key, value]) => volume.Labels?.[key] !== value)) {
    throw new Error('Existing Muse volume has unknown or foreign ownership. Initialization refused; preserve and review the existing volume. An already initialized installation does not need init:local.');
  }
};

module.exports = { ensureMuseVolume };
