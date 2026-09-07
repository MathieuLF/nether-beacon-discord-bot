const crypto = require('crypto');
const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const POKEDEX_COMMAND_NAMES = new Set(['pokemon', 'weakness', 'move', 'ability', 'type', 'random-pokemon']);
const PUBLIC_COMMAND_NAMES = new Set([...POKEDEX_COMMAND_NAMES, 'help', 'metrics-palworld', 'resume-hier']);
const STAFF_COMMAND_NAMES = new Set(['announce-palworld']);
const ADMIN_COMMAND_NAMES = new Set([
  'status',
  'audit',
  'resync',
  'welcome-preview',
  'stats-refresh',
  'diag',
  'cache-status',
]);

const withAutocomplete = (option) => option.setRequired(true).setAutocomplete(true);

const commandPayload = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('État du conteneur, du bot admin et de Muse.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('audit')
    .setDescription("Compare la configuration voulue à l'état actuel sans rien modifier.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('resync')
    .setDescription('Applique la structure gérée et ses permissions strictes.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche les commandes du profil accessibles avec ton rôle.')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('welcome-preview')
    .setDescription("Prévisualise le message d'accueil sans attendre un nouveau membre.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('stats-refresh')
    .setDescription('Force une mise à jour immédiate des salons vocaux Stats.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('diag')
    .setDescription('Affiche un diagnostic runtime sans secrets.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('cache-status')
    .setDescription('Affiche la taille et l’âge des caches locaux sans secrets.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('announce-palworld')
    .setDescription('Publie une annonce Discord et la relaie dans le serveur Palworld.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Annonce à publier dans Discord et en jeu.')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(500),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('pokemon')
    .setDescription('Cherche un Pokémon par nom anglais ou numéro du Pokédex.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('Nom anglais ou numéro, par exemple charizard ou 6.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('weakness')
    .setDescription('Affiche les faiblesses, résistances et immunités d’un Pokémon.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('pokemon')
          .setDescription('Nom anglais ou numéro du Pokémon.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Cherche une capacité Pokémon par son nom anglais.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('Nom anglais, par exemple flamethrower ou thunderbolt.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('ability')
    .setDescription('Cherche un talent Pokémon par son nom anglais.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('Nom anglais, par exemple intimidate ou levitate.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('type')
    .setDescription('Affiche les forces et faiblesses d’un type Pokémon.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('Nom anglais, par exemple fire, water ou fairy.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('random-pokemon')
    .setDescription('Affiche un Pokémon au hasard.')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('metrics-palworld')
    .setDescription('Affiche les derniers metrics du serveur Palworld.')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('resume-hier')
    .setDescription('Renvoie le lien du résumé Gaylemon de la veille.')
    .setDMPermission(false),
].map((command) => command.toJSON());

const MINIMAL_COMMAND_NAMES = new Set(['status', 'help', 'metrics-palworld', 'resume-hier']);
const POKEMON_PROFILE_COMMAND_NAMES = new Set([
  ...MINIMAL_COMMAND_NAMES,
  ...POKEDEX_COMMAND_NAMES,
]);

const commandPayloadForProfile = (profile) => {
  if (profile === 'full') return commandPayload;
  if (profile === 'pokemon') {
    return commandPayload.filter((command) => POKEMON_PROFILE_COMMAND_NAMES.has(command.name));
  }
  if (profile === 'minimal') {
    return commandPayload.filter((command) => MINIMAL_COMMAND_NAMES.has(command.name));
  }
  throw new Error(`Unknown bot profile: ${profile}`);
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

const stableStringify = (value) => JSON.stringify(stableValue(value));

const commandPayloadHash = (payload = commandPayload) =>
  crypto.createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 12);

const commandHash = commandPayloadHash(commandPayload);

const commandNameFromRemote = (command) => command?.name || command?.toJSON?.().name || null;

const summarizeCommandDiff = (remoteCommands, localPayload = commandPayload) => {
  const remoteList = Array.isArray(remoteCommands)
    ? remoteCommands
    : [...(remoteCommands?.values?.() || [])];
  const localNames = localPayload.map((command) => command.name).filter(Boolean);
  const remoteNames = remoteList.map(commandNameFromRemote).filter(Boolean);
  const remoteNameSet = new Set(remoteNames);
  const localNameSet = new Set(localNames);

  return {
    hash: commandPayloadHash(localPayload),
    localCount: localNames.length,
    remoteCount: remoteNames.length,
    missing: localNames.filter((name) => !remoteNameSet.has(name)),
    extra: remoteNames.filter((name) => !localNameSet.has(name)),
  };
};

module.exports = {
  ADMIN_COMMAND_NAMES,
  POKEDEX_COMMAND_NAMES,
  PUBLIC_COMMAND_NAMES,
  STAFF_COMMAND_NAMES,
  commandHash,
  commandPayload,
  commandPayloadForProfile,
  commandPayloadHash,
  summarizeCommandDiff,
};
