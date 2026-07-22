const PRIVATE_FIELD_NAMES = new Set([
  'accountname',
  'account_name',
  'ip',
  'ipaddress',
  'ip_address',
  'location',
  'password',
  'playerid',
  'player_id',
  'steamid',
  'steam_id',
  'userid',
  'user_id',
]);

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const IPV4_PATTERN = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const STEAM_ID_PATTERN = /\b(?:steam_)?7656\d{13}\b/gi;
const LONG_ID_PATTERN = /\b\d{15,20}\b/g;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s"'<>]+/g;
const UNIX_PATH_PATTERN = /(^|\s)\/(?:home|root|var|opt|srv|mnt|data|app|bot)\/[^\s"'<>]+/g;
const PRIVATE_KV_PATTERN = /\b(accountName|account_name|playerId|player_id|userId|user_id|steamId|steam_id|ip|ipAddress|ip_address|password)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;})\]]+)/gi;

const normalizePrivateFieldName = (fieldName) => String(fieldName || '').replace(/[-\s]/g, '_').toLowerCase();

const isPrivateFieldName = (fieldName) => PRIVATE_FIELD_NAMES.has(normalizePrivateFieldName(fieldName));

const redactKnownSecrets = (text, secrets = []) => {
  let output = String(text ?? '');
  for (const secret of secrets.filter((entry) => typeof entry === 'string' && entry.length >= 4)) {
    output = output.split(secret).join('[secret]');
  }
  return output;
};

const sanitizePalworldText = (value, secrets = []) => {
  let output = redactKnownSecrets(value, secrets);

  return output
    .replace(PRIVATE_KV_PATTERN, '$1=[masque]')
    .replace(IPV4_PATTERN, '[ip masquee]')
    .replace(STEAM_ID_PATTERN, '[steam id masque]')
    .replace(LONG_ID_PATTERN, '[identifiant masque]')
    .replace(WINDOWS_PATH_PATTERN, '[chemin masque]')
    .replace(UNIX_PATH_PATTERN, '$1[chemin masque]');
};

const looksPrivateIdentifier = (value) => {
  const text = String(value || '').trim();
  for (const pattern of [IPV4_PATTERN, STEAM_ID_PATTERN, LONG_ID_PATTERN, WINDOWS_PATH_PATTERN, UNIX_PATH_PATTERN]) {
    pattern.lastIndex = 0;
  }
  return (
    IPV4_PATTERN.test(text) ||
    STEAM_ID_PATTERN.test(text) ||
    LONG_ID_PATTERN.test(text) ||
    WINDOWS_PATH_PATTERN.test(text) ||
    UNIX_PATH_PATTERN.test(` ${text}`)
  );
};

const sanitizePublicPlayerName = (value) => {
  const name = String(value || '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name || name.length > 80) return null;
  if (looksPrivateIdentifier(name)) return null;
  if (!/[\p{Letter}\p{Number}]/u.test(name)) return null;

  return name;
};

const readPublicPlayerName = (player) => {
  if (!player || typeof player !== 'object' || Array.isArray(player)) return null;
  return sanitizePublicPlayerName(player.name);
};

const sanitizePublicPlayers = (players) => {
  if (!Array.isArray(players)) return [];

  const names = [];
  const seen = new Set();
  for (const player of players) {
    const name = readPublicPlayerName(player);
    const key = name?.toLocaleLowerCase('fr-CA');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
};

const stripPrivatePalworldFields = (value) => {
  if (Array.isArray(value)) return value.map(stripPrivatePalworldFields);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isPrivateFieldName(key))
      .map(([key, entry]) => [key, stripPrivatePalworldFields(entry)]),
  );
};

module.exports = {
  isPrivateFieldName,
  sanitizePalworldText,
  sanitizePublicPlayerName,
  sanitizePublicPlayers,
  stripPrivatePalworldFields,
};
