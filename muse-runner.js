const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { buildMuseEnv } = require('./lib/muse-env');
const { writeJsonAtomic } = require('./lib/atomic-json');

if (!process.env.MUSE_DISCORD_TOKEN?.trim()) {
  throw new Error('Missing required environment variable MUSE_DISCORD_TOKEN');
}

const peerStateDir = process.env.BOT_PEER_STATE_DIR || '/bot/peer-state';
const statePath = path.join(peerStateDir, 'muse-state.json');
fs.mkdirSync(peerStateDir, { recursive: true });

const state = {
  running: false,
  startedAt: new Date().toISOString(),
  heartbeatAt: null,
  pid: null,
  exitCode: null,
  signal: null,
};

const writeState = () => writeJsonAtomic(statePath, state);

const child = spawn('node', ['--enable-source-maps', '/usr/app/dist/scripts/migrate-and-start.js'], {
  cwd: '/usr/app',
  env: buildMuseEnv(),
  stdio: 'inherit',
});

state.running = true;
state.pid = child.pid;
state.heartbeatAt = new Date().toISOString();
writeState();

const heartbeat = setInterval(() => {
  state.heartbeatAt = new Date().toISOString();
  writeState();
}, 15000);
heartbeat.unref();

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  setTimeout(() => child.kill('SIGKILL'), 10000).unref();
};

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

child.on('error', (error) => {
  state.running = false;
  state.error = error.message;
  state.heartbeatAt = new Date().toISOString();
  writeState();
  process.exitCode = 1;
});

child.on('exit', (exitCode, signal) => {
  clearInterval(heartbeat);
  state.running = false;
  state.exitCode = exitCode;
  state.signal = signal;
  state.heartbeatAt = new Date().toISOString();
  writeState();
  process.exit(exitCode || (signal ? 1 : 0));
});
