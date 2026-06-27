const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { paths } = require('./lib/config');

const requiredEnv = ['DISCORD_GUILD_ID', 'DISCORD_BOT_TOKEN', 'MUSE_DISCORD_TOKEN'];
for (const envName of requiredEnv) {
  if (!process.env[envName]?.trim()) {
    throw new Error(`Missing required environment variable ${envName}`);
  }
}

fs.mkdirSync(paths.runtimeDir, { recursive: true });
fs.writeFileSync(path.join('/bot', 'muse.env'), '', 'utf8');

const state = {
  startedAt: new Date().toISOString(),
  stopping: false,
  children: {
    admin: null,
    muse: null,
  },
};

const childRefs = new Map();

const writeState = () => {
  fs.writeFileSync(paths.supervisorStatePath, JSON.stringify(state, null, 2), 'utf8');
};

const pipeWithPrefix = (stream, prefix, output) => {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString();

    while (buffer.includes('\n')) {
      const lineBreak = buffer.indexOf('\n');
      const line = buffer.slice(0, lineBreak);
      buffer = buffer.slice(lineBreak + 1);
      output.write(`[${prefix}] ${line}\n`);
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      output.write(`[${prefix}] ${buffer}\n`);
    }
  });
};

const buildMuseEnv = () => ({
  ...process.env,
  DISCORD_TOKEN: process.env.MUSE_DISCORD_TOKEN,
  YOUTUBE_API_KEY: process.env.MUSE_YOUTUBE_API_KEY || '',
  SPOTIFY_CLIENT_ID: process.env.MUSE_SPOTIFY_CLIENT_ID || '',
  SPOTIFY_CLIENT_SECRET: process.env.MUSE_SPOTIFY_CLIENT_SECRET || '',
  CACHE_LIMIT: process.env.MUSE_CACHE_LIMIT || '2GB',
  YT_DLP_AUTO_UPDATE: process.env.MUSE_YT_DLP_AUTO_UPDATE || 'true',
  ENABLE_SPONSORBLOCK: process.env.MUSE_ENABLE_SPONSORBLOCK || 'false',
  BOT_STATUS: process.env.MUSE_BOT_STATUS || 'online',
  BOT_ACTIVITY_TYPE: process.env.MUSE_BOT_ACTIVITY_TYPE || 'LISTENING',
  BOT_ACTIVITY: process.env.MUSE_BOT_ACTIVITY || 'Music',
  ENV_FILE: '/bot/muse.env',
});

const spawnChild = (name, command, args, options) => {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pipeWithPrefix(child.stdout, name, process.stdout);
  pipeWithPrefix(child.stderr, name, process.stderr);

  state.children[name] = {
    command: [command, ...args].join(' '),
    pid: child.pid,
    running: true,
    startedAt: new Date().toISOString(),
    exitCode: null,
    signal: null,
  };
  writeState();

  child.on('exit', (exitCode, signal) => {
    state.children[name] = {
      ...state.children[name],
      running: false,
      exitCode,
      signal,
      stoppedAt: new Date().toISOString(),
    };
    writeState();

    if (!state.stopping) {
      console.error(`${name} exited unexpectedly.`);
      shutdown(1);
    } else if ([...childRefs.values()].every((ref) => ref.exitCode !== null || ref.signalCode !== null)) {
      process.exit(exitCode || 0);
    }
  });

  child.on('error', (error) => {
    state.children[name] = {
      ...(state.children[name] || {}),
      running: false,
      error: error.message,
      stoppedAt: new Date().toISOString(),
    };
    writeState();

    console.error(`${name} failed to start: ${error.message}`);
    if (!state.stopping) {
      shutdown(1);
    }
  });

  childRefs.set(name, child);
};

let shutdownStarted = false;
let exitCode = 0;

const childHasExited = (child) => child.exitCode !== null || child.signalCode !== null;

const signalChild = (child, signal) => {
  if (childHasExited(child)) return;

  try {
    child.kill(signal);
  } catch (error) {
    console.error(`Failed to send ${signal} to child process ${child.pid}: ${error.message}`);
  }
};

const shutdown = (code = 0) => {
  if (shutdownStarted) return;

  shutdownStarted = true;
  exitCode = code;
  state.stopping = true;
  writeState();

  for (const child of childRefs.values()) {
    signalChild(child, 'SIGTERM');
  }

  setTimeout(() => {
    for (const child of childRefs.values()) {
      signalChild(child, 'SIGKILL');
    }
    process.exit(exitCode);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

spawnChild('admin', 'node', ['/bot/bot.js'], {
  cwd: '/bot',
  env: process.env,
});

spawnChild('muse', 'node', ['--enable-source-maps', '/usr/app/dist/scripts/migrate-and-start.js'], {
  cwd: '/usr/app',
  env: buildMuseEnv(),
});

writeState();
