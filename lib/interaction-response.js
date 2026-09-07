const acknowledgeInteraction = async (interaction, { ephemeral = true } = {}) => {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral });
  }
};

const replyToInteraction = (interaction, payload) => {
  if (interaction.deferred || interaction.replied) {
    const { ephemeral: _ephemeral, ...reply } = payload;
    return interaction.editReply(reply);
  }
  return interaction.reply(payload);
};

module.exports = { acknowledgeInteraction, replyToInteraction };
