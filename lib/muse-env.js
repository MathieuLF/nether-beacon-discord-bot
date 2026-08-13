const PASSTHROUGH_ENV_NAMES = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_ENV',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
];

const selectRuntimeEnv = (sourceEnv) => Object.fromEntries(
  PASSTHROUGH_ENV_NAMES
    .filter((name) => sourceEnv[name] !== undefined)
    .map((name) => [name, sourceEnv[name]]),
);

const buildMuseEnv = (sourceEnv = process.env) => ({
  ...selectRuntimeEnv(sourceEnv),
  DATA_DIR: '/data',
  DISCORD_TOKEN: sourceEnv.MUSE_DISCORD_TOKEN,
  YOUTUBE_API_KEY: sourceEnv.MUSE_YOUTUBE_API_KEY || '',
  SPOTIFY_CLIENT_ID: sourceEnv.MUSE_SPOTIFY_CLIENT_ID || '',
  SPOTIFY_CLIENT_SECRET: sourceEnv.MUSE_SPOTIFY_CLIENT_SECRET || '',
  CACHE_LIMIT: sourceEnv.MUSE_CACHE_LIMIT || '512MB',
  // L'image de production est immuable; yt-dlp évolue par reconstruction.
  YT_DLP_AUTO_UPDATE: 'false',
  ENABLE_SPONSORBLOCK: sourceEnv.MUSE_ENABLE_SPONSORBLOCK || 'false',
  BOT_STATUS: sourceEnv.MUSE_BOT_STATUS || 'online',
  BOT_ACTIVITY_TYPE: sourceEnv.MUSE_BOT_ACTIVITY_TYPE || 'LISTENING',
  BOT_ACTIVITY: sourceEnv.MUSE_BOT_ACTIVITY || 'Music',
  ENV_FILE: '/bot/muse.env',
});

module.exports = {
  buildMuseEnv,
};
