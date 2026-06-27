const fs = require('fs');
const https = require('https');
const path = require('path');
const { paths } = require('./config');

const API_BASE_URL = 'https://pokeapi.co/api/v2';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cacheDir = path.join(paths.runtimeDir, 'pokedex-cache');
const assetCacheDir = path.join(cacheDir, 'assets');

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

const titleCase = (value) =>
  value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const cleanText = (value = '') => value.replace(/\f/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

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

const readCache = (endpoint) => {
  const cachePath = cachePathFor(endpoint);
  try {
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const writeCache = (endpoint, payload) => {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePathFor(endpoint), JSON.stringify(payload), 'utf8');
};

const requestJson = (url) =>
  new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NeatherBeacon Alpha Discord bot',
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          requestJson(response.headers.location).then(resolve, reject);
          return;
        }

        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          if (response.statusCode === 404) {
            reject(new Error('No matching PokéAPI entry found.'));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`PokéAPI returned HTTP ${response.statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error('PokéAPI returned invalid JSON.'));
          }
        });
      },
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error('PokéAPI request timed out.'));
    });
    request.on('error', reject);
  });

const fetchEndpoint = async (endpoint) => {
  const cached = readCache(endpoint);
  if (cached) return cached;

  const payload = await requestJson(`${API_BASE_URL}${endpoint}`);
  writeCache(endpoint, payload);
  return payload;
};

const getEnglishEntry = (entries = [], field = 'flavor_text') => {
  const entry = [...entries].reverse().find((item) => item.language?.name === 'en' && item[field]);
  return cleanText(entry?.[field] || '');
};

const extractIdFromUrl = (url) => url.match(/\/(\d+)\/?$/)?.[1] || null;

const endpointFromUrl = (url) => {
  try {
    const parsed = new URL(url);
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

const downloadFile = (url, targetPath) =>
  new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    const request = https.get(
      url,
      {
        headers: {
          Accept: 'image/*',
          'User-Agent': 'NeatherBeacon Alpha Discord bot',
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          downloadFile(response.headers.location, targetPath).then(resolve, reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`asset download returned HTTP ${response.statusCode}`));
          return;
        }

        const tempPath = `${targetPath}.tmp`;
        const output = fs.createWriteStream(tempPath);
        response.pipe(output);
        output.on('finish', () => {
          output.close(() => {
            fs.renameSync(tempPath, targetPath);
            resolve();
          });
        });
        output.on('error', reject);
      },
    );

    request.setTimeout(15000, () => request.destroy(new Error('asset download timed out')));
    request.on('error', reject);
  });

const cacheAsset = async (url, key) => {
  if (!url) return null;

  const extension = assetExtension(url);
  const filename = `${key}${extension}`;
  const targetPath = path.join(assetCacheDir, filename);

  if (!fs.existsSync(targetPath)) {
    await downloadFile(url, targetPath);
  }

  return {
    filename,
    path: targetPath,
  };
};

const fetchPokemon = async (query) => fetchEndpoint(`/pokemon/${normalizeLookup(query)}`);

const fetchPokemonSpecies = async (pokemon) => {
  const speciesId = extractIdFromUrl(pokemon.species?.url || '');
  return fetchEndpoint(`/pokemon-species/${speciesId || pokemon.species?.name || pokemon.id}`);
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

const compactList = (items = []) => items.map((item) => titleCase(item.name)).join(', ') || 'None';

const formatPokemonSummary = async (query) => {
  const pokemon = await fetchPokemon(query);
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
  const genus = species?.genera?.find((entry) => entry.language?.name === 'en')?.genus || '';
  const artworkUrl = pokemonArtworkUrl(pokemon);
  const artwork = await cacheAsset(artworkUrl, `pokemon-${pokemon.id}`).catch(() => null);
  const evolutionLine = evolution ? flattenEvolutionChain(evolution.chain).join(' → ') : '';
  const labels = [
    species?.generation?.name ? `Generation: ${titleCase(species.generation.name)}` : null,
    species?.is_legendary ? 'Legendary' : null,
    species?.is_mythical ? 'Mythical' : null,
    species?.habitat?.name ? `Habitat: ${titleCase(species.habitat.name)}` : null,
  ].filter(Boolean).join(' | ');

  const content = [
    `**🔎 Pokédex: ${titleCase(pokemon.name)} #${String(pokemon.id).padStart(4, '0')}**`,
    '',
    `- **Types**: ${types}`,
    `- **Abilities**: ${abilities}`,
    `- **Height / Weight**: ${pokemon.height / 10} m / ${pokemon.weight / 10} kg`,
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
  ).replace(/\$effect_chance/g, move.effect_chance ?? '?');

  return [
    `**💥 Move: ${titleCase(move.name)}**`,
    '',
    `- **Type**: ${titleCase(move.type.name)}`,
    `- **Class**: ${titleCase(move.damage_class.name)}`,
    `- **Power**: ${move.power ?? 'Status'}`,
    `- **Accuracy**: ${move.accuracy ?? 'Never misses'}`,
    `- **PP**: ${move.pp}`,
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
  formatAbilitySummary,
  formatMoveSummary,
  formatPokemonSummary,
  formatRandomPokemonSummary,
  formatTypeSummary,
  formatWeaknessSummary,
};
