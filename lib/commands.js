const crypto = require('crypto');
const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const PUBLIC_COMMAND_NAMES = new Set(['pokemon', 'weakness', 'move', 'ability', 'type', 'random-pokemon']);
const ADMIN_COMMAND_NAMES = new Set([
  'status',
  'audit',
  'resync',
  'help',
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
    .setDescription('Applique la configuration additive gérée par le bot.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Résume les fonctions, prérequis et limites du bot.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
    .setName('pokemon')
    .setDescription('Look up a Pokémon by English name or National Pokédex number.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('English Pokémon name or ID, for example charizard or 6.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('weakness')
    .setDescription('Show type weaknesses, resistances and immunities for a Pokémon.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('pokemon')
          .setDescription('English Pokémon name or ID.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Look up a Pokémon move.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('Move name, for example flamethrower or thunderbolt.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('ability')
    .setDescription('Look up a Pokémon ability.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('Ability name, for example intimidate or levitate.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('type')
    .setDescription('Show offensive and defensive matchups for a Pokémon type.')
    .addStringOption((option) =>
      withAutocomplete(
        option
          .setName('name')
          .setDescription('Type name, for example fire, water or fairy.'),
      ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('random-pokemon')
    .setDescription('Pull a random Pokémon from the Pokédex.')
    .setDMPermission(false),
].map((command) => command.toJSON());

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
  PUBLIC_COMMAND_NAMES,
  commandHash,
  commandPayload,
  commandPayloadHash,
  summarizeCommandDiff,
};
