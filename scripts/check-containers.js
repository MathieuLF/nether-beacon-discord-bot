const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.some((arg) => !['--scan', 'alpha', 'muse'].includes(arg))) throw new Error('Usage: check:containers -- [alpha|muse] [--scan]');
const targets = args.filter((arg) => ['alpha', 'muse'].includes(arg));
if (!targets.length) targets.push('alpha', 'muse');
const docker = (parameters) => execFileSync('docker', parameters, { cwd: root, stdio: 'inherit' });
const scanners = [
  ['aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969', 'image', '--scanners', 'vuln', '--exit-code', '1', '--severity', 'HIGH,CRITICAL'],
  ['anchore/grype:v0.118.0@sha256:8a93fc48da96bd6ec5981279d099b69de11541dc68fdf222fb9161f8ff284af7'],
];
const imagePrefix = `nether-beacon-validation-${process.pid}`;
for (const target of targets) {
  const image = `${imagePrefix}:${target}`;
  docker(['build', '--target', target, '-t', image, '.']);
  const isolated = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true'];
  docker([...isolated, '--entrypoint', 'node', image, '-e', "if(process.getuid()!==10001)process.exit(1);require('/bot/lib/service-health');console.log(process.version)"]);
  if (target === 'muse') {
    docker([...isolated, '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--mount', `type=bind,source=${path.join(root, 'scripts', 'verify-muse-runtime.js')},target=/tmp/verify-muse-runtime.js,readonly`, '--entrypoint', 'node', image, '/tmp/verify-muse-runtime.js']);
  }
  if (args.includes('--scan')) {
    for (const scanner of scanners) {
      const grype = scanner[0].startsWith('anchore/');
      const cache = path.join(root, 'tmp', 'container-scan-cache', grype ? 'grype' : 'trivy');
      fs.mkdirSync(cache, { recursive: true });
      docker(['run', '--rm', '-v', '/var/run/docker.sock:/var/run/docker.sock', '--mount', `type=bind,source=${cache},target=/cache`, '-e', grype ? 'GRYPE_DB_CACHE_DIR=/cache' : 'TRIVY_CACHE_DIR=/cache', ...scanner, image, ...(grype ? ['--fail-on', 'high'] : [])]);
    }
  }
  // Disposable images only. Never inspect, stop or replace application services.
  docker(['image', 'rm', image]);
}
console.log('Container validation passed. No Compose services or persistent application volumes started.');
