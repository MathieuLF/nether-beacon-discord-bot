const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const writeJsonAtomic = (targetPath, payload) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, targetPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};

module.exports = { writeJsonAtomic };
