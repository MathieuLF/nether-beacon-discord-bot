const { commandPayloadForProfile, ADMIN_COMMAND_NAMES, STAFF_COMMAND_NAMES } = require('./commands');

const buildHelpText = ({ profile, admin = false, staff = false }) => {
  const commands = commandPayloadForProfile(profile).filter((command) => {
    if (ADMIN_COMMAND_NAMES.has(command.name)) return admin;
    if (STAFF_COMMAND_NAMES.has(command.name)) return staff || admin;
    return true;
  });
  return [
    '**🧭 NetherBeacon — aide**',
    `Profil actif : **${profile}**. Voici les commandes disponibles pour ton accès.`,
    '',
    ...commands.map((command) => `\`/${command.name}\` — ${command.description}`),
    '',
    profile !== 'minimal' ? 'Pokédex : saisis un nom anglais ou un numéro et utilise les suggestions. Les fiches PokéAPI sont en anglais.' : null,
    'Palworld : le statut public peut être ancien ou incomplet; le message le précise.',
    'Bravo est un service Muse distinct et facultatif. Ses commandes sont celles de Muse.',
  ].filter(Boolean).join('\n').slice(0, 1990);
};

module.exports = { buildHelpText };
