const fs = require('fs');
const path = require('path');
const { isRecent } = require('./lib/service-health');
const peerStateDir = process.env.BOT_PEER_STATE_DIR || '/bot/peer-state';
const statePath = path.join(peerStateDir, 'muse-state.json');

try {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!state.running) throw new Error('Muse is not running');
  if (!isRecent(state.heartbeatAt)) throw new Error('Muse heartbeat is stale');
  console.log('process healthy (Discord connection not probed)');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
