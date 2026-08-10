const fs = require('fs');
const { paths } = require('./lib/config');

const maxAgeMs = 90000;

const readJson = (targetPath) => JSON.parse(fs.readFileSync(targetPath, 'utf8'));

try {
  const heartbeat = readJson(paths.adminHeartbeatPath);
  const heartbeatAge = Date.now() - new Date(heartbeat.timestamp).getTime();

  if (!heartbeat.healthy) {
    throw new Error('admin bot heartbeat is unhealthy');
  }

  if (Number.isNaN(heartbeatAge) || heartbeatAge > maxAgeMs) {
    throw new Error('admin bot heartbeat is stale');
  }

  console.log('healthy');
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
