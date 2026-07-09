const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');
const { _private } = require('../lib/reconcile');

const makeOverwriteCache = (entries) => ({
  size: entries.length,
  get: (id) => entries.find((entry) => entry.id === id) || null,
  map: (callback) => entries.map(callback),
});

test('ensureManagedOverwrites skips Discord writes when permissions already match', async () => {
  const defaultTextBits = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
  let writes = 0;
  const channel = {
    permissionOverwrites: {
      cache: makeOverwriteCache([
        {
          id: 'everyone',
          allow: { bitfield: defaultTextBits },
          deny: { bitfield: 0n },
          type: 0,
        },
      ]),
      set: async () => {
        writes += 1;
      },
    },
  };

  const changed = await _private.ensureManagedOverwrites(
    channel,
    { '@everyone': { id: 'everyone' } },
    {
      preset: 'defaultText',
      everyonePreset: 'defaultText',
      groups: [],
    },
  );

  assert.equal(changed, false);
  assert.equal(writes, 0);
});
