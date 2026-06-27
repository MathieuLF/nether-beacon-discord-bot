const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const { PermissionFlagsBits } = require('discord.js');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config', 'server-plan.json');
const schemaPath = path.join(rootDir, 'config', 'server-plan.schema.json');
const runtimeDir = process.env.BOT_RUNTIME_DIR || path.join(rootDir, 'runtime');

const paths = {
  rootDir,
  configPath,
  schemaPath,
  runtimeDir,
  adminStatePath: path.join(runtimeDir, 'admin-state.json'),
  adminHeartbeatPath: path.join(runtimeDir, 'admin-heartbeat.json'),
  managedIdsPath: path.join(runtimeDir, 'managed-ids.json'),
  supervisorStatePath: path.join(runtimeDir, 'supervisor-state.json'),
};

const ajv = new Ajv2020({ allErrors: true });

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

const ensurePermissionNames = (permissionNames, label) => {
  for (const name of permissionNames) {
    if (!(name in PermissionFlagsBits)) {
      throw new Error(`Unknown Discord permission "${name}" in ${label}`);
    }
  }
};

const ensureUnique = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
};

const validateSemantics = (plan) => {
  ensureUnique(plan.roles.map((role) => role.name), 'role name');
  ensureUnique(plan.sections.map((section) => section.category), 'category name');

  for (const [presetName, permissionNames] of Object.entries(plan.presets)) {
    ensurePermissionNames(permissionNames, `preset ${presetName}`);
  }

  for (const role of plan.roles) {
    ensurePermissionNames(role.permissions, `role ${role.name}`);
  }

  const roleNames = new Set(plan.roles.map((role) => role.name));
  for (const [groupName, members] of Object.entries(plan.groups)) {
    ensureUnique(members, `group member in ${groupName}`);
    for (const roleName of members) {
      if (!roleNames.has(roleName)) {
        throw new Error(`Group ${groupName} references unknown role ${roleName}`);
      }
    }
  }

  const presetNames = new Set(Object.keys(plan.presets));
  const groupNames = new Set(Object.keys(plan.groups));
  const managedTextChannelNames = [];

  for (const section of plan.sections) {
    ensureUnique([section.category, ...(section.legacyNames || [])], `category aliases for ${section.category}`);
    ensureUnique(
      section.channels.map((channel) => `${channel.type}:${channel.name}`),
      `channel name in category ${section.category}`,
    );

    for (const channel of section.channels) {
      if (channel.type === 'GuildText') {
        managedTextChannelNames.push(channel.name);
      }

      ensureUnique(
        [`${channel.type}:${channel.name}`, ...((channel.legacyNames || []).map((name) => `${channel.type}:${name}`))],
        `channel aliases for ${channel.name}`,
      );

      if (!presetNames.has(channel.preset)) {
        throw new Error(`Channel ${channel.name} references unknown preset ${channel.preset}`);
      }

      if (channel.everyonePreset && !presetNames.has(channel.everyonePreset)) {
        throw new Error(`Channel ${channel.name} references unknown everyonePreset ${channel.everyonePreset}`);
      }

      if (channel.readPreset && !presetNames.has(channel.readPreset)) {
        throw new Error(`Channel ${channel.name} references unknown readPreset ${channel.readPreset}`);
      }

      for (const groupName of channel.groups) {
        if (!groupNames.has(groupName)) {
          throw new Error(`Channel ${channel.name} references unknown group ${groupName}`);
        }
      }

      for (const groupName of channel.readGroups || []) {
        if (!groupNames.has(groupName)) {
          throw new Error(`Channel ${channel.name} references unknown readGroup ${groupName}`);
        }
      }
    }
  }

  if (plan.logChannelName === plan.eventChannelName) {
    throw new Error('logChannelName and eventChannelName must be different');
  }

  const managedTextChannelSet = new Set(managedTextChannelNames);
  if (!roleNames.has(plan.defaultMemberRoleName)) {
    throw new Error(`defaultMemberRoleName references unknown role ${plan.defaultMemberRoleName}`);
  }
  if (!managedTextChannelSet.has(plan.logChannelName)) {
    throw new Error(`logChannelName references unknown managed text channel ${plan.logChannelName}`);
  }
  if (!managedTextChannelSet.has(plan.eventChannelName)) {
    throw new Error(`eventChannelName references unknown managed text channel ${plan.eventChannelName}`);
  }
  if (!managedTextChannelSet.has(plan.welcomeChannelName)) {
    throw new Error(`welcomeChannelName references unknown managed text channel ${plan.welcomeChannelName}`);
  }
};

const loadServerPlan = () => {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (!validate(raw)) {
    const details = (validate.errors || [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
      .join('; ');
    throw new Error(`Invalid server-plan.json: ${details}`);
  }

  validateSemantics(raw);
  return raw;
};

module.exports = {
  loadServerPlan,
  paths,
};
