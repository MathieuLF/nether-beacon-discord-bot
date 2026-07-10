const fs = require('fs');
const { paths } = require('./config');

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
  lastUptimeKuma: null,
  lastMemberEvent: null,
  lastVoiceEvent: null,
  lastError: null,
  healthy: false,
  activeTask: null,
});

const writeJson = (targetPath, payload) => {
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
};

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
