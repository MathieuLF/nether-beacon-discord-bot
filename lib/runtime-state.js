const fs = require('fs');
const { paths } = require('./config');
const { writeJsonAtomic: writeJson } = require('./atomic-json');

const createAdminState = ({ version, guildId }) => ({
  version,
  guildId,
  guildName: null,
  startedAt: new Date().toISOString(),
  readyAt: null,
  eventChannelId: null,
  logChannelId: null,
  commandsRegisteredAt: null,
  lastAudit: null,
  lastSync: null,
  lastStats: null,
  lastDailySummary: null,
  lastPalworldRest: null,
  lastMemberEvent: null,
  lastVoiceEvent: null,
  lastError: null,
  healthy: false,
  gatewayReady: false,
  activeTask: null,
});

const readJson = (targetPath) => {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const updateRuntimeFiles = (state) => {
  writeJson(paths.adminStatePath, state);
  writeJson(paths.adminHeartbeatPath, {
    healthy: state.healthy,
    gatewayReady: state.gatewayReady,
    activeTask: state.activeTask,
    guildId: state.guildId,
    eventChannelId: state.eventChannelId,
    logChannelId: state.logChannelId,
    readyAt: state.readyAt,
    timestamp: new Date().toISOString(),
    version: state.version,
  });
};

module.exports = {
  createAdminState,
  readJson,
  updateRuntimeFiles,
  writeJson,
};
