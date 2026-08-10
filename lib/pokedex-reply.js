const normalizeDiscordReplyPayload = (result) => {
  if (typeof result === 'string') {
    return { content: result.slice(0, 1990), allowedMentions: { parse: [] } };
  }
  return {
    ...result,
    content: result.content?.slice(0, 1990) || '',
    allowedMentions: { parse: [] },
  };
};

const normalizePokedexFallbackPayload = (result) => {
  const content = typeof result === 'string' ? result : result?.content || '';
  return {
    content: [
      content.slice(0, 1750),
      '',
      '_Image non jointe cette fois-ci : Discord a refusé l’envoi de l’attachement._',
    ].join('\n').slice(0, 1990),
    allowedMentions: { parse: [] },
  };
};

module.exports = {
  normalizeDiscordReplyPayload,
  normalizePokedexFallbackPayload,
};
