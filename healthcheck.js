const fs = require('fs');
const { paths } = require('./lib/config');
const { isAdminHealthy } = require('./lib/service-health');

const readJson = (targetPath) => JSON.parse(fs.readFileSync(targetPath, 'utf8'));

try {
  const heartbeat = readJson(paths.adminHeartbeatPath);
  if (!isAdminHealthy(heartbeat)) throw new Error('admin bot is disconnected, unhealthy or heartbeat is stale');

  console.log('healthy');
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
