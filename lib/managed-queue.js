// Reconciliation and statistics share one registry. Serialize their mutations.
let pending = Promise.resolve();
const withManagedWrite = (runner) => {
  const result = pending.then(runner);
  pending = result.catch(() => undefined);
  return result;
};
module.exports = { withManagedWrite };
