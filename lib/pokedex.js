const fs = require('fs');
const dns = require('dns');
const https = require('https');
const net = require('net');
const path = require('path');
const { paths } = require('./config');

const API_BASE_URL = 'https://pokeapi.co/api/v2';
const cacheDir = path.join(paths.runtimeDir, 'pokedex-cache');
const assetCacheDir = path.join(cacheDir, 'assets');
const endpointMemoryCache = new Map();
const endpointInflight = new Map();
const API_ORIGIN = new URL(API_BASE_URL).origin;
const ALLOWED_ASSET_HOSTS = new Set(['raw.githubusercontent.com']);
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10000;

const typeNames = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
];

const statLabels = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  'special-attack': 'Sp. Atk',
  'special-defense': 'Sp. Def',
  speed: 'Speed',
};

const escapeDiscordMarkdown = (value = '') => String(value)
  .replace(/([\\`*_{}\[\]()<>#+.!|~>-])/g, '\\$1');

const titleCase = (value) =>
  escapeDiscordMarkdown(String(value)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' '));

const cleanText = (value = '') => escapeDiscordMarkdown(
  String(value).replace(/\f/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
);

const readBoundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const cacheTtlMs = () => readBoundedInteger(process.env.BOT_POKEAPI_CACHE_TTL_DAYS, 30, 1, 365) * 24 * 60 * 60 * 1000;
const maxAssetBytes = () => readBoundedInteger(process.env.BOT_POKEAPI_MAX_ASSET_BYTES, 5 * 1024 * 1024, 65536, 10 * 1024 * 1024);
const maxJsonBytes = () => readBoundedInteger(process.env.BOT_POKEAPI_MAX_JSON_BYTES, 1024 * 1024, 65536, 2 * 1024 * 1024);
const maxMemoryEntries = () => readBoundedInteger(process.env.BOT_POKEAPI_MAX_MEMORY_ENTRIES, 64, 16, 256);
const maxCacheBytes = () => readBoundedInteger(process.env.BOT_POKEAPI_MAX_CACHE_BYTES, 256 * 1024 * 1024, 32 * 1024 * 1024, 1024 * 1024 * 1024);
const maxCacheFiles = () => readBoundedInteger(process.env.BOT_POKEAPI_MAX_CACHE_FILES, 512, 64, 4096);
const maxConcurrentRequests = () => readBoundedInteger(process.env.BOT_POKEAPI_MAX_CONCURRENT_REQUESTS, 4, 1, 8);

const normalizeLookup = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cachePathFor = (endpoint) =>
  path.join(cacheDir, `${endpoint.replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '')}.json`);

const rememberMemoryEntry = (endpoint, entry) => {
  endpointMemoryCache.delete(endpoint);
  endpointMemoryCache.set(endpoint, entry);
  while (endpointMemoryCache.size > maxMemoryEntries()) {
    endpointMemoryCache.delete(endpointMemoryCache.keys().next().value);
  }
};

const listCacheFiles = (rootDir) => {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
        const stat = fs.statSync(entryPath);
        files.push({ path: entryPath, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }
  return files.sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
};

const enforceDirectoryQuota = (rootDir, {
  byteLimit,
  fileLimit,
  incomingBytes = 0,
  protectedPath = null,
} = {}) => {
  if (incomingBytes > byteLimit) throw new Error('Pokédex cache entry exceeds the total cache quota.');

  const files = listCacheFiles(rootDir);
  const protectedResolved = protectedPath ? path.resolve(protectedPath) : null;
  const protectedExisting = protectedResolved
    ? files.find((entry) => path.resolve(entry.path) === protectedResolved)?.size || 0
    : 0;
  let bytes = files.reduce((total, entry) => total + entry.size, 0) - protectedExisting + incomingBytes;
  let count = files.length - (protectedExisting ? 1 : 0) + (incomingBytes > 0 ? 1 : 0);

  for (const entry of files) {
    if (bytes <= byteLimit && count <= fileLimit) break;
    if (protectedResolved && path.resolve(entry.path) === protectedResolved) continue;
    fs.rmSync(entry.path, { force: true });
    bytes -= entry.size;
    count -= 1;
  }

  if (bytes > byteLimit || count > fileLimit) throw new Error('Pokédex cache quota cannot be satisfied.');
};

const enforceCacheQuota = (options = {}) => enforceDirectoryQuota(cacheDir, {
  byteLimit: maxCacheBytes(),
  fileLimit: maxCacheFiles(),
  ...options,
});

const readCache = (endpoint) => {
  const cachedMemory = endpointMemoryCache.get(endpoint);
  if (cachedMemory && Date.now() - cachedMemory.cachedAt <= cacheTtlMs()) {
    rememberMemoryEntry(endpoint, cachedMemory);
    return cachedMemory.payload;
  }
  endpointMemoryCache.delete(endpoint);

  const cachePath = cachePathFor(endpoint);
  try {
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs > cacheTtlMs() || stat.size > maxJsonBytes()) {
      fs.rmSync(cachePath, { force: true });
      return null;
    }
    const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    rememberMemoryEntry(endpoint, {
      cachedAt: stat.mtimeMs,
      payload,
    });
    return payload;
  } catch (error) {
    return null;
  }
};

const writeCache = (endpoint, payload) => {
  fs.mkdirSync(cacheDir, { recursive: true });
  const targetPath = cachePathFor(endpoint);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(payload);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxJsonBytes()) throw new Error('PokéAPI JSON response is too large.');
  enforceCacheQuota({ incomingBytes: bytes, protectedPath: targetPath });
  fs.writeFileSync(tempPath, serialized, 'utf8');
  fs.renameSync(tempPath, targetPath);
  rememberMemoryEntry(endpoint, {
    cachedAt: Date.now(),
    payload,
  });
};

const validateApiUrl = (url) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.origin !== API_ORIGIN || !parsed.pathname.startsWith('/api/v2/')) {
    throw new Error('PokéAPI redirect escaped the approved origin.');
  }
  return parsed;
};

const defaultRequestJson = (url, { redirectCount = 0, deadlineAt = Date.now() + REQUEST_TIMEOUT_MS } = {}) =>
  new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = validateApiUrl(url);
    } catch (error) {
      reject(error);
      return;
    }
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      reject(new Error('PokéAPI request timed out.'));
      return;
    }
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      handler(value);
    };
    const request = https.get(
      parsed,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NetherBeacon Alpha Discord bot',
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirectCount >= MAX_REDIRECTS) {
            finish(reject, new Error('PokéAPI returned too many redirects.'));
            return;
          }
          const redirectUrl = new URL(response.headers.location, parsed).toString();
          defaultRequestJson(redirectUrl, { redirectCount: redirectCount + 1, deadlineAt })
            .then((value) => finish(resolve, value), (error) => finish(reject, error));
          return;
        }

        const declaredLength = Number.parseInt(response.headers['content-length'] || '0', 10);
        if (Number.isFinite(declaredLength) && declaredLength > maxJsonBytes()) {
          response.resume();
          finish(reject, new Error('PokéAPI JSON response is too large.'));
          return;
        }
        const chunks = [];
        let receivedBytes = 0;
        response.on('data', (chunk) => {
          const buffer = Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > maxJsonBytes()) {
            request.destroy(new Error('PokéAPI JSON response is too large.'));
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          if (response.statusCode === 404) {
            finish(reject, new Error('No matching PokéAPI entry found.'));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            finish(reject, new Error(`PokéAPI returned HTTP ${response.statusCode}.`));
            return;
          }

          try {
            finish(resolve, JSON.parse(Buffer.concat(chunks, receivedBytes).toString('utf8')));
          } catch (error) {
            finish(reject, new Error('PokéAPI returned invalid JSON.'));
          }
        });
      },
    );

    const deadlineTimer = setTimeout(() => {
      request.destroy(new Error('PokéAPI request timed out.'));
    }, remainingMs);
    request.setTimeout(remainingMs, () => request.destroy(new Error('PokéAPI request timed out.')));
    request.on('error', (error) => finish(reject, error));
  });

let requestJson = defaultRequestJson;

const fetchEndpoint = async (endpoint) => {
  const cached = readCache(endpoint);
  if (cached) return cached;

  if (endpointInflight.has(endpoint)) return endpointInflight.get(endpoint);
  if (endpointInflight.size >= maxConcurrentRequests()) {
    throw new Error('Pokédex is busy; retry shortly.');
  }

  const request = (async () => {
    const payload = await requestJson(`${API_BASE_URL}${endpoint}`);
    writeCache(endpoint, payload);
    return payload;
  })().finally(() => {
    endpointInflight.delete(endpoint);
  });

  endpointInflight.set(endpoint, request);
  return request;
};

const clearEndpointCaches = () => {
  endpointMemoryCache.clear();
  endpointInflight.clear();
};

const setRequestJsonForTests = (handler) => {
  requestJson = handler || defaultRequestJson;
};

const getEnglishEntry = (entries = [], field = 'flavor_text') => {
  const entry = [...entries].reverse().find((item) => item.language?.name === 'en' && item[field]);
  return cleanText(entry?.[field] || '');
};

const extractIdFromUrl = (url) => url.match(/\/(\d+)\/?$/)?.[1] || null;

const endpointFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== API_ORIGIN || !parsed.pathname.startsWith('/api/v2/')) return null;
    return parsed.pathname.replace('/api/v2', '').replace(/\/$/, '');
  } catch (error) {
    return null;
  }
};

const assetExtension = (url) => {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return ext;
  return '.png';
};

const isPrivateAddress = (address) => {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || /^fe[89ab]/.test(normalized);
  }
  return true;
};

const validateAssetUrl = async (rawUrl, { lookup = dns.promises.lookup } = {}) => {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('Pokédex artwork URL must use credential-free HTTPS.');
  }
  if (!ALLOWED_ASSET_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Pokédex artwork host is not approved.');
  }

  const resolved = await lookup(parsed.hostname, { all: true, verbatim: true });
  const addresses = Array.isArray(resolved) ? resolved : [resolved];
  if (addresses.length === 0 || addresses.some((entry) => !entry?.address || isPrivateAddress(entry.address))) {
    throw new Error('Pokédex artwork address is private or invalid.');
  }

  return {
    url: parsed,
    address: addresses[0].address,
    family: addresses[0].family,
  };
};

const assetTargetPath = (key, url = 'https://raw.githubusercontent.com/image.png') => {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(String(key))) {
    throw new Error('Invalid Pokédex artwork cache key.');
  }
  const filename = `${key}${assetExtension(url)}`;
  const targetPath = path.resolve(assetCacheDir, filename);
  const relative = path.relative(path.resolve(assetCacheDir), targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Pokédex artwork path is outside the cache directory.');
  }
  return { filename, targetPath };
};

const hasValidImageSignature = (targetPath) => {
  const header = Buffer.alloc(12);
  const descriptor = fs.openSync(targetPath, 'r');
  const bytes = fs.readSync(descriptor, header, 0, header.length, 0);
  fs.closeSync(descriptor);
  if (bytes < 3) return false;
  return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    header.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    header.subarray(0, 6).toString('ascii') === 'GIF89a' ||
    (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP');
};

const downloadToFile = async (url, tempPath, {
  redirectCount = 0,
  deadlineAt = Date.now() + 15000,
  lookup = dns.promises.lookup,
} = {}) => {
  if (redirectCount > MAX_REDIRECTS) throw new Error('Artwork returned too many redirects.');
  const validated = await validateAssetUrl(url, { lookup });
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new Error('Artwork download timed out.');

  await new Promise((resolve, reject) => {
    let output = null;
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (error && output) output.destroy();
      if (error) reject(error); else resolve();
    };
    const request = https.get(validated.url, {
      headers: { Accept: 'image/*', 'User-Agent': 'NetherBeacon Alpha Discord bot' },
      lookup: (_hostname, _options, callback) => callback(null, validated.address, validated.family),
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const redirectUrl = new URL(response.headers.location, validated.url).toString();
        downloadToFile(redirectUrl, tempPath, { redirectCount: redirectCount + 1, deadlineAt, lookup })
          .then(() => finish(), finish);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        finish(new Error(`Artwork download returned HTTP ${response.statusCode}.`));
        return;
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (!contentType.startsWith('image/')) {
        response.resume();
        finish(new Error('Artwork response is not an image.'));
        return;
      }
      const declaredLength = Number.parseInt(response.headers['content-length'] || '0', 10);
      if (Number.isFinite(declaredLength) && declaredLength > maxAssetBytes()) {
        response.resume();
        finish(new Error(`Artwork exceeds ${maxAssetBytes()} bytes.`));
        return;
      }

      let receivedBytes = 0;
      output = fs.createWriteStream(tempPath, { flags: 'wx' });
      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxAssetBytes()) {
          request.destroy(new Error(`Artwork exceeds ${maxAssetBytes()} bytes.`));
          return;
        }
        if (!output.write(chunk)) response.pause();
      });
      output.on('drain', () => response.resume());
      response.on('end', () => output.end(() => finish()));
      response.on('error', finish);
      output.on('error', finish);
    });
    const deadlineTimer = setTimeout(() => request.destroy(new Error('Artwork download timed out.')), remainingMs);
    request.setTimeout(remainingMs, () => request.destroy(new Error('Artwork download timed out.')));
    request.on('error', finish);
  });
};

const downloadFile = async (url, targetPath) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await downloadToFile(url, tempPath);
    if (!hasValidImageSignature(tempPath)) throw new Error('Artwork has an invalid image signature.');
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
};

const cacheAsset = async (url, key) => {
  if (!url) return null;

  const { filename, targetPath } = assetTargetPath(key, url);

  if (!fs.existsSync(targetPath)) {
    enforceCacheQuota({ incomingBytes: maxAssetBytes(), protectedPath: targetPath });
    await downloadFile(url, targetPath);
    enforceCacheQuota({ incomingBytes: fs.statSync(targetPath).size, protectedPath: targetPath });
  }

  return {
    filename,
    path: targetPath,
  };
};

const fetchPokemon = async (query) => fetchEndpoint(`/pokemon/${normalizeLookup(query)}`);

const fetchPokemonSpecies = async (pokemon) => {
  const speciesId = extractIdFromUrl(pokemon.species?.url || '');
  const fallback = speciesId || normalizeLookup(pokemon.species?.name || '') || validatePokemonId(pokemon.id);
  return fetchEndpoint(`/pokemon-species/${fallback}`);
};

const fetchEvolutionChain = async (species) => {
  const endpoint = endpointFromUrl(species?.evolution_chain?.url || '');
  if (!endpoint) return null;
  return fetchEndpoint(endpoint);
};

const flattenEvolutionChain = (node, entries = []) => {
  if (!node?.species?.name) return entries;
  entries.push(titleCase(node.species.name));
  for (const next of node.evolves_to || []) flattenEvolutionChain(next, entries);
  return entries;
};

const pokemonArtworkUrl = (pokemon) =>
  pokemon.sprites?.other?.['official-artwork']?.front_default ||
  pokemon.sprites?.other?.home?.front_default ||
  pokemon.sprites?.front_default ||
  null;

const validatePokemonId = (value) => {
  const raw = String(value ?? '');
  if (!/^\d{1,7}$/.test(raw)) throw new Error('PokéAPI returned an invalid Pokémon ID.');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000000) {
    throw new Error('PokéAPI returned an invalid Pokémon ID.');
  }
  return parsed;
};

const compactList = (items = []) => items.map((item) => titleCase(item.name)).join(', ') || 'None';

const formatPokemonSummary = async (query) => {
  const pokemon = await fetchPokemon(query);
  const pokemonId = validatePokemonId(pokemon.id);
  const species = await fetchPokemonSpecies(pokemon).catch(() => null);
  const evolution = species ? await fetchEvolutionChain(species).catch(() => null) : null;
  const types = pokemon.types.map((entry) => titleCase(entry.type.name)).join(' / ');
  const abilities = pokemon.abilities
    .map((entry) => `${titleCase(entry.ability.name)}${entry.is_hidden ? ' (Hidden)' : ''}`)
    .join(', ');
  const stats = pokemon.stats
    .map((entry) => `${statLabels[entry.stat.name] || titleCase(entry.stat.name)} ${entry.base_stat}`)
    .join(' | ');
  const description = getEnglishEntry(species?.flavor_text_entries || []);
  const genus = cleanText(species?.genera?.find((entry) => entry.language?.name === 'en')?.genus || '');
  const artworkUrl = pokemonArtworkUrl(pokemon);
  const artwork = await cacheAsset(artworkUrl, `pokemon-${pokemonId}`).catch(() => null);
  const evolutionLine = evolution ? flattenEvolutionChain(evolution.chain).join(' → ') : '';
  const labels = [
    species?.generation?.name ? `Generation: ${titleCase(species.generation.name)}` : null,
    species?.is_legendary ? 'Legendary' : null,
    species?.is_mythical ? 'Mythical' : null,
    species?.habitat?.name ? `Habitat: ${titleCase(species.habitat.name)}` : null,
  ].filter(Boolean).join(' | ');

  const content = [
    `**🔎 Pokédex: ${titleCase(pokemon.name)} #${String(pokemonId).padStart(4, '0')}**`,
    '',
    `- **Types**: ${types}`,
    `- **Abilities**: ${abilities}`,
    `- **Height / Weight**: ${Number(pokemon.height) / 10} m / ${Number(pokemon.weight) / 10} kg`,
    genus ? `- **Genus**: ${genus}` : null,
    labels ? `- **Labels**: ${labels}` : null,
    species?.egg_groups?.length ? `- **Egg groups**: ${compactList(species.egg_groups)}` : null,
    evolutionLine ? `- **Evolution**: ${evolutionLine}` : null,
    `- **Base stats**: ${stats}`,
    artwork ? `- **Artwork**: cached locally` : null,
    description ? '' : null,
    description ? `> ${description}` : null,
  ].filter(Boolean).join('\n');

  if (!artwork) return content;

  return {
    content,
    files: [{ attachment: artwork.path, name: artwork.filename }],
    embeds: [
      {
        image: {
          url: `attachment://${artwork.filename}`,
        },
      },
    ],
  };
};

const fetchType = async (query) => fetchEndpoint(`/type/${normalizeLookup(query)}`);

const autocompleteEndpoints = {
  pokemon: '/pokemon?limit=20000',
  weakness: '/pokemon?limit=20000',
  move: '/move?limit=20000',
  ability: '/ability?limit=20000',
  type: '/type?limit=100',
};

const autocompletePokedex = async (commandName, query) => {
  const endpoint = autocompleteEndpoints[commandName];
  if (!endpoint) return [];

  const normalized = normalizeLookup(query);
  const payload = await fetchEndpoint(endpoint);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const matches = results
    .filter((entry) => !normalized || entry.name.includes(normalized))
    .slice(0, 25);

  return matches.map((entry) => ({
    name: titleCase(entry.name).slice(0, 100),
    value: normalizeLookup(entry.name).slice(0, 100),
  }));
};

const formatMultiplier = (value) => {
  if (value === 4) return 'x4';
  if (value === 2) return 'x2';
  if (value === 0.5) return 'x½';
  if (value === 0.25) return 'x¼';
  if (value === 0) return 'x0';
  return `x${value}`;
};

const formatTypeList = (entries) => entries.map(([name, value]) => `${titleCase(name)} ${formatMultiplier(value)}`).join(', ') || 'None';

const buildWeaknessMap = async (pokemon) => {
  const multipliers = Object.fromEntries(typeNames.map((name) => [name, 1]));
  const defendingTypes = await Promise.all(pokemon.types.map((entry) => fetchType(entry.type.name)));

  for (const defendingType of defendingTypes) {
    for (const type of defendingType.damage_relations.double_damage_from) multipliers[type.name] *= 2;
    for (const type of defendingType.damage_relations.half_damage_from) multipliers[type.name] *= 0.5;
    for (const type of defendingType.damage_relations.no_damage_from) multipliers[type.name] *= 0;
  }

  return Object.entries(multipliers).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
};

const formatWeaknessSummary = async (query) => {
  const pokemon = await fetchPokemon(query);
  const multipliers = await buildWeaknessMap(pokemon);
  const weaknesses = multipliers.filter((entry) => entry[1] > 1);
  const resistances = multipliers.filter((entry) => entry[1] > 0 && entry[1] < 1);
  const immunities = multipliers.filter((entry) => entry[1] === 0);

  return [
    `**🛡️ Weaknesses: ${titleCase(pokemon.name)}**`,
    '',
    `- **Weak to**: ${formatTypeList(weaknesses)}`,
    `- **Resists**: ${formatTypeList(resistances)}`,
    `- **Immune to**: ${formatTypeList(immunities)}`,
  ].join('\n');
};

const formatMoveSummary = async (query) => {
  const move = await fetchEndpoint(`/move/${normalizeLookup(query)}`);
  const effect = cleanText(
    (move.effect_entries || []).find((entry) => entry.language?.name === 'en')?.short_effect || '',
  ).replace(/\$effect_chance/g, cleanText(move.effect_chance ?? '?'));

  return [
    `**💥 Move: ${titleCase(move.name)}**`,
    '',
    `- **Type**: ${titleCase(move.type.name)}`,
    `- **Class**: ${titleCase(move.damage_class.name)}`,
    `- **Power**: ${cleanText(move.power ?? 'Status')}`,
    `- **Accuracy**: ${cleanText(move.accuracy ?? 'Never misses')}`,
    `- **PP**: ${cleanText(move.pp)}`,
    effect ? `- **Effect**: ${effect}` : null,
  ].filter(Boolean).join('\n');
};

const formatAbilitySummary = async (query) => {
  const ability = await fetchEndpoint(`/ability/${normalizeLookup(query)}`);
  const effect = cleanText(
    (ability.effect_entries || []).find((entry) => entry.language?.name === 'en')?.short_effect ||
      getEnglishEntry(ability.flavor_text_entries || ''),
  );
  const pokemon = ability.pokemon
    .slice(0, 12)
    .map((entry) => `${titleCase(entry.pokemon.name)}${entry.is_hidden ? ' (Hidden)' : ''}`)
    .join(', ');

  return [
    `**✨ Ability: ${titleCase(ability.name)}**`,
    '',
    effect ? `- **Effect**: ${effect}` : null,
    pokemon ? `- **Pokémon**: ${pokemon}${ability.pokemon.length > 12 ? `, +${ability.pokemon.length - 12} more` : ''}` : null,
  ].filter(Boolean).join('\n');
};

const formatTypeSummary = async (query) => {
  const type = await fetchType(query);
  const relationNames = (entries) => entries.map((entry) => titleCase(entry.name)).join(', ') || 'None';

  return [
    `**🧬 Type: ${titleCase(type.name)}**`,
    '',
    '**Offense**',
    `- **Super effective against**: ${relationNames(type.damage_relations.double_damage_to)}`,
    `- **Not very effective against**: ${relationNames(type.damage_relations.half_damage_to)}`,
    `- **No effect against**: ${relationNames(type.damage_relations.no_damage_to)}`,
    '',
    '**Defense**',
    `- **Weak to**: ${relationNames(type.damage_relations.double_damage_from)}`,
    `- **Resists**: ${relationNames(type.damage_relations.half_damage_from)}`,
    `- **Immune to**: ${relationNames(type.damage_relations.no_damage_from)}`,
  ].join('\n');
};

const formatRandomPokemonSummary = async () => {
  const metadata = await fetchEndpoint('/pokemon-species?limit=1');
  const randomId = Math.floor(Math.random() * metadata.count) + 1;
  return formatPokemonSummary(String(randomId));
};

module.exports = {
  autocompletePokedex,
  formatAbilitySummary,
  formatMoveSummary,
  formatPokemonSummary,
  formatRandomPokemonSummary,
  formatTypeSummary,
  formatWeaknessSummary,
  _private: {
    clearEndpointCaches,
    fetchEndpoint,
    maxAssetBytes,
    assetTargetPath,
    enforceCacheQuota,
    enforceDirectoryQuota,
    escapeDiscordMarkdown,
    maxCacheBytes,
    maxCacheFiles,
    maxJsonBytes,
    maxMemoryEntries,
    memoryCacheKeys: () => [...endpointMemoryCache.keys()],
    normalizeLookup,
    setRequestJsonForTests,
    rememberMemoryEntry,
    hasValidImageSignature,
    validateAssetUrl,
    validateApiUrl,
    validatePokemonId,
  },
};
