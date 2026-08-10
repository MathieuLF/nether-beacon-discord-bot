const fs = require('fs');
const path = require('path');

const maxAgeMs = 90000;
const peerStateDir = process.env.BOT_PEER_STATE_DIR || '/bot/peer-state';
const statePath = path.join(peerStateDir, 'muse-state.json');

try {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const heartbeatAge = Date.now() - new Date(state.heartbeatAt).getTime();
  if (!state.running) throw new Error('Muse is not running');
  if (Number.isNaN(heartbeatAge) || heartbeatAge > maxAgeMs) throw new Error('Muse heartbeat is stale');
  console.log('healthy');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
