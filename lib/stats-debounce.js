const createStatsRefreshDebouncer = (delayMs, runner) => {
  let timer = null;
  let queuedGuild = null;
  const origins = new Set();

  const flush = async () => {
    const guild = queuedGuild;
    const originLabel = [...origins].join('+') || 'event';

    queuedGuild = null;
    origins.clear();

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (guild) {
      await runner(guild, `debounced:${originLabel}`);
    }
  };

  const schedule = (guild, origin) => {
    queuedGuild = guild;
    origins.add(origin);

    if (timer) return false;

    timer = setTimeout(() => {
      flush().catch((error) => {
        console.error(`[stats-debounce] ${error.message}`);
      });
    }, delayMs);

    timer.unref?.();
    return true;
  };

  return {
    flush,
    isPending: () => Boolean(timer),
    schedule,
  };
};

module.exports = {
  createStatsRefreshDebouncer,
};
