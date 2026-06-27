const { loadServerPlan, paths } = require('../lib/config');

try {
  const plan = loadServerPlan();
  console.log(`Config OK: ${paths.configPath}`);
  console.log(`Roles: ${plan.roles.length}`);
  console.log(`Categories: ${plan.sections.length}`);
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
