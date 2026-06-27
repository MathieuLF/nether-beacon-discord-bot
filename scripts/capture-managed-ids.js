const { REST, Routes } = require('discord.js');
const { config } = require('dotenv');
const { loadServerPlan } = require('../lib/config');
const {
  captureManagedIdsFromDiscordSnapshot,
  loadManagedIds,
  saveManagedIds,
} = require('../lib/managed-ids');

config();

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!token || !guildId) {
  throw new Error('Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in .env');
}

const main = async () => {
  const plan = loadServerPlan();
  const rest = new REST({ version: '10' }).setToken(token);
  const [roles, channels] = await Promise.all([
    rest.get(Routes.guildRoles(guildId)),
    rest.get(Routes.guildChannels(guildId)),
  ]);

  const { registry, report } = captureManagedIdsFromDiscordSnapshot(
    plan,
    { guildId, roles, channels },
    loadManagedIds(),
  );

  saveManagedIds(registry);

  console.log(`Managed IDs captured: roles=${report.capturedRoles} categories=${report.capturedCategories} channels=${report.capturedChannels}`);
  for (const warning of report.warnings) console.warn(`Warning: ${warning}`);
  for (const conflict of report.conflicts) console.error(`Conflict: ${conflict}`);

  if (report.conflicts.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
