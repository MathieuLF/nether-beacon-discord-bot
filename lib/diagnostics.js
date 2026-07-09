const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

const formatLine = (label, value) => `- **${label}** : ${value}`;

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value, timeZone = 'America/Toronto') => {
  if (!value) return 'jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone,
  }).format(date)} (${timeZone})`;
};

const redactSensitive = (value, secrets = []) => {
  let output = String(value ?? '');

  for (const secret of secrets.filter((entry) => typeof entry === 'string' && entry.length >= 6)) {
    output = output.split(secret).join('[secret]');
  }

  return output
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, '[secret]')
    .replace(/\b(Bot|Bearer)\s+[^\s]+/gi, '$1 [secret]')
    .replace(/\b(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s]+/gi, '$1=[secret]');
};

const collectDirectoryStats = (rootDir) => {
  const stats = {
    exists: fs.existsSync(rootDir),
    files: 0,
    directories: 0,
    bytes: 0,
    oldestMtime: null,
    newestMtime: null,
  };

  if (!stats.exists) return stats;

  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      let stat = null;

      try {
        stat = fs.statSync(entryPath);
      } catch (error) {
        continue;
      }

      if (entry.isDirectory()) {
        stats.directories += 1;
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;

      stats.files += 1;
      stats.bytes += stat.size;
      const mtime = stat.mtime.toISOString();
      if (!stats.oldestMtime || mtime < stats.oldestMtime) stats.oldestMtime = mtime;
      if (!stats.newestMtime || mtime > stats.newestMtime) stats.newestMtime = mtime;
    }
  }

  return stats;
};

const formatDirectoryStats = (label, stats, timeZone) => [
  `**${label}**`,
  formatLine('Présent', stats.exists ? 'oui' : 'non'),
  formatLine('Fichiers', stats.files),
  formatLine('Dossiers', stats.directories),
  formatLine('Taille', formatBytes(stats.bytes)),
  formatLine('Plus récent', formatDate(stats.newestMtime, timeZone)),
].join('\n');

const formatDiagnostics = ({
  state,
  guild,
  supervisor,
  pingMs,
  commandHash,
  commandCount,
  dependencies,
  timeZone = 'America/Toronto',
  secrets = [],
}) => {
  const museState = supervisor?.children?.muse;
  const adminState = supervisor?.children?.admin;
  const lastStats = state.lastStats?.snapshot;

  return [
    '**🧪 Diagnostic Alpha**',
    '',
    '**Runtime**',
    formatLine('Version', redactSensitive(state.version, secrets)),
    formatLine('Serveur', redactSensitive(guild ? `${guild.name} (${guild.id})` : state.guildId, secrets)),
    formatLine('Alpha', adminState?.running ? 'en ligne' : 'hors ligne'),
    formatLine('Bravo', museState?.running ? 'en ligne' : 'hors ligne'),
    formatLine('Uptime Alpha', state.startedAt ? formatDate(state.startedAt, timeZone) : 'inconnu'),
    formatLine('Tâche active', redactSensitive(state.activeTask || 'aucune', secrets)),
    formatLine('Ping Gateway', Number.isFinite(pingMs) ? `${Math.round(pingMs)} ms` : 'non disponible'),
    '',
    '**Commandes**',
    formatLine('Hash local', redactSensitive(commandHash, secrets)),
    formatLine('Nombre local', commandCount),
    formatLine('Enregistrées', formatDate(state.commandsRegisteredAt, timeZone)),
    '',
    '**Derniers signaux**',
    formatLine('Stats', formatDate(state.lastStats?.at, timeZone)),
    formatLine('Joueurs', lastStats ? `${lastStats.humanUsers} humains, ${lastStats.botUsers} robots` : 'non disponible'),
    formatLine('Présences cache', state.lastStats?.presenceCacheSize ?? 'non détecté'),
    formatLine('Erreur', redactSensitive(state.lastError || 'aucune', secrets)),
    '',
    '**Dépendances**',
    formatLine('discord.js', dependencies?.discordJs || 'inconnu'),
    formatLine('dotenv', dependencies?.dotenv || 'inconnu'),
  ].join('\n').slice(0, 1900);
};

const formatCacheStatus = ({ runtimeDir = paths.runtimeDir, timeZone = 'America/Toronto' } = {}) => {
  const pokedexDir = path.join(runtimeDir, 'pokedex-cache');
  const assetDir = path.join(pokedexDir, 'assets');

  return [
    '**🧰 État des caches locaux**',
    '',
    formatDirectoryStats('Runtime', collectDirectoryStats(runtimeDir), timeZone),
    '',
    formatDirectoryStats('Pokédex JSON', collectDirectoryStats(pokedexDir), timeZone),
    '',
    formatDirectoryStats('Assets Pokédex', collectDirectoryStats(assetDir), timeZone),
    '',
    '_Aucun contenu de fichier ni secret environnement n’est affiché._',
  ].join('\n').slice(0, 1900);
};

module.exports = {
  collectDirectoryStats,
  formatCacheStatus,
  formatDiagnostics,
  redactSensitive,
};
