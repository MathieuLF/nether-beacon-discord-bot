const { POKEDEX_COMMAND_NAMES, STAFF_COMMAND_NAMES } = require('./commands');
const { SUMMARY_COMMAND_NAME } = require('./daily-summary');
const { autocompletePokedex } = require('./pokedex');
const { normalizeDiscordReplyPayload, normalizePokedexFallbackPayload } = require('./pokedex-reply');
const { acknowledgeInteraction, replyToInteraction } = require('./interaction-response');
const { buildHelpText } = require('./help');
const { formatDiagnostics, formatCacheStatus } = require('./diagnostics');
const { formatReportForChat } = require('./reconcile');
const { sanitizePalworldText } = require('./palworld-safety');
const { paths } = require('./config');
const pkg = require('../package.json');

const createInteractionHandler = ({
  GUILD_ID,
  enabledCommandNames,
  BOT_PROFILE,
  hasAdminAccess,
  hasStaffAccess,
  getPublicCommandCooldown,
  pokedexGlobalCooldown,
  runPokedexCommand,
  formatPokedexLookupError,
  runPalworldMetricsCommand,
  handleDailySummaryCommand,
  state,
  updateRuntimeFiles,
  runPalworldAnnouncementCommand,
  knownSecretValues,
  refreshGuild,
  summarizeStatus,
  buildWelcomeMessage,
  readServiceState,
  client,
  commandHash,
  commandPayload,
  BOT_TIMEZONE,
  runAudit,
  sendLog,
  runSync,
  refreshStatsDisplaySafe,
  formatBotMessage,
  formatLine,
  lookupAutocomplete = autocompletePokedex,
  autocompleteTimeoutMs = 1800,
}) => async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (
      interaction.guildId !== GUILD_ID
      || !enabledCommandNames.has(interaction.commandName)
      || !POKEDEX_COMMAND_NAMES.has(interaction.commandName)
    ) {
      await interaction.respond([]).catch(() => undefined);
      return;
    }

    let autocompleteTimer;
    try {
      const focused = interaction.options.getFocused(true);
      // Discord autocomplete cannot be deferred. Return empty choices before its
      // deadline while a slow first lookup may still warm the bounded cache.
      const choices = await Promise.race([
        lookupAutocomplete(interaction.commandName, focused.value),
        new Promise((resolve) => { autocompleteTimer = setTimeout(() => resolve([]), autocompleteTimeoutMs); }),
      ]);
      await interaction.respond(choices);
    } catch (error) {
      console.error(`[autocomplete:${interaction.commandName}] failed`, error);
      await interaction.respond([]).catch(() => undefined);
    } finally {
      clearTimeout(autocompleteTimer);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== GUILD_ID) {
    await replyToInteraction(interaction, {
      content: formatBotMessage('⛔ Mauvais serveur', ["Ce bot ne gère qu'un seul serveur cible."]),
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  if (!enabledCommandNames.has(interaction.commandName)) {
    await replyToInteraction(interaction, {
      content: formatBotMessage('🔒 Commande désactivée', ['Cette commande ne fait pas partie du profil actif.']),
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  if (interaction.commandName === 'help') {
    await replyToInteraction(interaction, { content: buildHelpText({ profile: BOT_PROFILE, admin: hasAdminAccess(interaction), staff: hasStaffAccess(interaction) }), ephemeral: true }).catch(() => undefined);
    return;
  }

  if (POKEDEX_COMMAND_NAMES.has(interaction.commandName)) {
    const cooldownSeconds = getPublicCommandCooldown(interaction.user.id);
    if (cooldownSeconds > 0) {
      await replyToInteraction(interaction, {
        content: formatBotMessage('⏳ Doucement', [
          `Attends encore ${cooldownSeconds}s avant une autre commande publique.`,
        ]),
        ephemeral: true,
      }).catch(() => undefined);
      return;
    }

    const globalCooldownSeconds = pokedexGlobalCooldown.reserve('pokedex-global');
    if (globalCooldownSeconds > 0) {
      await replyToInteraction(interaction, {
        content: formatBotMessage('⏳ Pokédex occupé', [
          `Réessaie dans ${globalCooldownSeconds}s.`,
        ]),
        ephemeral: true,
      }).catch(() => undefined);
      return;
    }

    try {
      await acknowledgeInteraction(interaction, { ephemeral: false });
      const result = await runPokedexCommand(interaction);
      try {
        await interaction.editReply(normalizeDiscordReplyPayload(result));
      } catch (sendError) {
        console.error(`[pokedex:${interaction.commandName}] reply failed`, sendError);
        await interaction.editReply(normalizePokedexFallbackPayload(result));
      }
    } catch (error) {
      console.error(`[pokedex:${interaction.commandName}] lookup failed`, error);
      const content = formatPokedexLookupError(error);
      const payload = { content, allowedMentions: { parse: [] } };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await replyToInteraction(interaction, { ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
    return;
  }

  if (interaction.commandName === 'metrics-palworld') {
    await runPalworldMetricsCommand(interaction);
    return;
  }

  if (interaction.commandName === SUMMARY_COMMAND_NAME) {
    const cooldownSeconds = getPublicCommandCooldown(interaction.user.id);
    if (cooldownSeconds > 0) {
      await replyToInteraction(interaction, {
        content: formatBotMessage('⏳ Doucement', [
          `Attends encore ${cooldownSeconds}s avant une autre commande publique.`,
        ]),
        ephemeral: true,
      }).catch(() => undefined);
      return;
    }

    try {
      const guild = interaction.guild;
      await handleDailySummaryCommand(interaction, guild);
    } catch (error) {
      state.lastError = 'daily-summary-command: indisponible';
      updateRuntimeFiles();
      const payload = {
        content: formatBotMessage('⚠️ Résumé Gaylemon indisponible', [
          'Le résumé public ne peut pas être préparé pour le moment.',
        ]),
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await replyToInteraction(interaction, payload).catch(() => undefined);
      }
    }
    return;
  }

  if (STAFF_COMMAND_NAMES.has(interaction.commandName)) {
    if (!hasStaffAccess(interaction)) {
      await replyToInteraction(interaction, {
        content: formatBotMessage('🔒 Accès refusé', ['Commande réservée aux administrateurs et modérateurs.']),
        ephemeral: true,
      }).catch(() => undefined);
      return;
    }

    try {
      const guild = interaction.guild;
      state.guildName = guild.name;
      updateRuntimeFiles();

      if (interaction.commandName === 'announce-palworld') {
        await runPalworldAnnouncementCommand(interaction, guild);
        return;
      }
    } catch (error) {
      state.lastError = sanitizePalworldText(error?.message || 'staff command failed', knownSecretValues());
      state.healthy = false;
      updateRuntimeFiles();
      const payload = {
        content: formatBotMessage('⚠️ Erreur Alpha', [
          'La commande staff ne peut pas être terminée pour le moment.',
        ]),
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await replyToInteraction(interaction, payload).catch(() => undefined);
      }
      return;
    }
  }

  if (!hasAdminAccess(interaction)) {
    await replyToInteraction(interaction, {
      content: formatBotMessage('🔒 Accès refusé', ['Commande réservée aux administrateurs.']),
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  try {
    await acknowledgeInteraction(interaction);
    const guild = await refreshGuild();
    state.guildName = guild.name;
    updateRuntimeFiles();

    if (interaction.commandName === 'status') {
      await replyToInteraction(interaction, { content: summarizeStatus(guild), ephemeral: true });
      return;
    }

    if (interaction.commandName === 'welcome-preview') {
      await replyToInteraction(interaction, {
        content: formatBotMessage("👀 Prévisualisation de l'accueil", [
          buildWelcomeMessage(interaction.member),
        ]),
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'diag') {
      const services = readServiceState();
      await replyToInteraction(interaction, {
        content: formatDiagnostics({
          state,
          guild,
          services,
          pingMs: client.ws.ping,
          commandHash,
          commandCount: commandPayload.length,
          dependencies: {
            discordJs: pkg.dependencies['discord.js'],
            dotenv: pkg.dependencies.dotenv,
          },
          timeZone: BOT_TIMEZONE,
          secrets: knownSecretValues(),
        }),
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'cache-status') {
      await replyToInteraction(interaction, {
        content: formatCacheStatus({
          runtimeDir: paths.runtimeDir,
          timeZone: BOT_TIMEZONE,
        }),
        ephemeral: true,
      });
      return;
    }

    await acknowledgeInteraction(interaction);

    if (interaction.commandName === 'audit') {
      const report = await runAudit(guild, 'slash');
      const message = formatReportForChat(report);
      await interaction.editReply({ content: message });
      await sendLog(guild, formatBotMessage('🔎 Audit admin', [
        formatLine('Résumé', report.summary),
      ]));
      return;
    }

    if (interaction.commandName === 'resync') {
      const report = await runSync(guild, 'slash');
      const statsResult = await refreshStatsDisplaySafe(guild, 'slash-resync');
      if (statsResult.status === 'failed') report.warnings.push('Stats non mises à jour; consulte les diagnostics.');
      const message = formatReportForChat(report);
      await interaction.editReply({ content: message });
      await sendLog(guild, formatBotMessage('🔁 Resync admin', [
        formatLine('Résumé', report.summary),
      ]));
      return;
    }

    if (interaction.commandName === 'stats-refresh') {
      const statsResult = await refreshStatsDisplaySafe(guild, 'slash-stats-refresh');
      if (statsResult.status === 'failed') throw statsResult.error;
      await interaction.editReply({
        content: formatBotMessage('📊 Stats rafraîchies', [
          statsResult.complete ? 'Les salons vocaux de statistiques ont été mis à jour.' : 'Salons mis à jour avec un cache de membres incomplet : les comptes précédés de ~ sont approximatifs.',
        ]),
      });
      await sendLog(guild, formatBotMessage('📊 Stats forcées', [
        formatLine('Action', 'commande admin `/stats-refresh`'),
      ]));
    }
  } catch (error) {
    const safeMessage = sanitizePalworldText(error?.message || 'admin command failed', knownSecretValues());
    state.lastError = safeMessage;
    state.healthy = false;
    updateRuntimeFiles();
    const payload = {
      content: formatBotMessage('⚠️ Erreur Alpha', [
        formatLine('Message', safeMessage),
      ]),
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => undefined);
    } else {
      await replyToInteraction(interaction, payload).catch(() => undefined);
    }
  }
};

module.exports = { createInteractionHandler };
