/** @param {unknown} timestamp */
const isRecent = (timestamp, now = Date.now(), maxAgeMs = 90000) => {
  if (typeof timestamp !== 'string' || !timestamp) return false;
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -5000 && age <= maxAgeMs;
};

/** @param {{healthy?: boolean, gatewayReady?: boolean, timestamp?: string} | null} heartbeat */
const isAdminHealthy = (heartbeat, now = Date.now()) => Boolean(heartbeat?.healthy && heartbeat?.gatewayReady && isRecent(heartbeat.timestamp, now));
/** @param {{running?: boolean, heartbeatAt?: string} | null} state */
const museProcessState = (state, now = Date.now()) => ({ ...state, running: Boolean(state?.running && isRecent(state.heartbeatAt, now)) });

module.exports = { isRecent, isAdminHealthy, museProcessState };
