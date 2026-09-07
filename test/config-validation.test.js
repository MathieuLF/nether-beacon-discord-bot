const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServerPlan, validateServerPlan } = require('../lib/config');

test('group-only channels cannot silently inherit public visibility', () => {
  const plan = loadServerPlan();
  const channel = plan.sections[0].channels[0];
  delete channel.private;
  delete channel.everyonePreset;
  assert.throws(() => validateServerPlan(plan), /visibility mode/);
  channel.private = true;
  assert.doesNotThrow(() => validateServerPlan(plan));
  channel.everyonePreset = 'defaultText';
  assert.throws(() => validateServerPlan(plan), /visibility mode/);
});

test('invalid Discord names, topics, role colors and admin role references fail before any API write', () => {
  const invalidChanges = [
    (plan) => { plan.roles[0].color = 0x1000000; },
    (plan) => { plan.roles[0].name = 'x'.repeat(101); },
    (plan) => { plan.sections[0].channels[0].topic = 'x'.repeat(1025); },
    (plan) => { plan.adminRoleName = 'missing-role'; },
  ];
  for (const change of invalidChanges) {
    const plan = loadServerPlan();
    change(plan);
    assert.throws(() => validateServerPlan(plan));
  }
});
