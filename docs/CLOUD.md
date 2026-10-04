# Development and validation profiles

## Reproducible setup

Use Ubuntu with Node **24.19.0** and npm **12.0.2**. Alpha's native checks require no Docker, database server, browser, `.env` or credentials.

```bash
git clone <repository-url>
cd nether-beacon
nvm install
nvm use
npm install --global npm@12.0.2
npm run setup
npm run check:dev
```

`nvm` is an optional runtime selector, not an application dependency. For a remote development environment, select the same Node version or prepare it using the available runtime manager. Use `npm run setup` as the install command; it fails on mismatched tools and uses `npm ci --no-fund --no-audit`. Re-run setup when package-lock.json changes. Installation needs public npm registry access. No secret is required.

The daily command reuses dependencies. It runs syntax, JSON configuration validation, lint, scoped typecheck, offline tests and one site build. It writes ignored `public/` output and temporary test fixtures, but must not change tracked files. `npm run check` remains available with the same native checks. No application endpoint exists: Alpha connects outbound to Discord and its healthcheck reads a local heartbeat.

Compare `git status --porcelain=v1` and tracked diff hashes before/after setup and validation. Existing dirty files may remain dirty; compare their contents as well as status. Never automatically restore files after a check. The generated site command deletes/recreates `public/` only and rejects a symbolic-link output.

## Development and targeted integrations

```bash
node --test test/access-control.test.js test/reconcile-overwrites.test.js test/managed-lifecycle.test.js
node --test test/palworld-public.test.js test/palworld-rest.test.js test/data-reliability.test.js
node --test test/pokedex-cache.test.js test/security-boundaries.test.js
```

These tests use synthetic resources/HTTP responses. All are already included in the daily suite. No live guild or music playback is exercised. The PowerShell restart-ownership scenario runs only on Windows; Windows CI remains necessary.

For explicitly requested live Alpha work, follow OPERATIONS.md: create a dedicated Discord application/guild, configure `.env`, invite it, keep `BOT_PROFILE=minimal`, and run `npm run dev` (Node watch) or `npm start`. Even minimal startup registers guild commands. Verify `/help` and `npm run healthcheck`; the latter requires a recent initialized Gateway heartbeat. Use `node --env-file=.env ...` when a standalone script needs dotenv settings it does not load itself.

`npm run verify:pokedex` is optional, contacts PokéAPI/artwork hosts and writes a local cache. This is a data-integration check, not real Discord interaction proof. A cached response alone does not establish fresh upstream availability.

Allow only destinations required for the task: npm for installation; `pokeapi.co` and `raw.githubusercontent.com` for live Pokédex; configured public/REST endpoints for Palworld; Discord API/Gateway for connected Alpha. Validate Gateway transport and development credential delivery separately before relying on a network proxy. Use credentials dedicated to the development installation. Music also requires provider and voice transport access; it is not part of daily validation.

## Containers and publication validation

```bash
npm run check:containers -- alpha
npm run check:containers -- muse
npm run check:release
```

The container runner uses unique disposable image tags, no Compose services, no application volumes and `--network none` for runtime probes. Muse's smoke uses disposable `/tmp` SQLite, migration deployment, write/read/delete, Opus, FFmpeg, yt-dlp and compiled imports. The release command also scans both images with the pinned Trivy and Grype versions used in CI, failing at High/Critical, plus `npm audit --omit=dev --audit-level=high`. Scanners need Docker's socket and network for vulnerability catalogues; builds need registries, Alpine/Python/npm/Prisma downloads. A failure stops the command; it does not trigger deployment or rollback. A failed candidate may remain under its unique validation tag for diagnosis.

Image inputs are pinned by digest, but `apk upgrade/add` and transitive Python packages depend on repository contents at build time. Preserve resulting image digests for exact rollback rather than claiming byte-identical rebuilds.

For self-hosting only, `npm run init:local` prepares Alpha mount ownership; `-- --music` also prepares the external Muse volume. Start with the Compose commands in OPERATIONS.md. Stop selected services with `docker compose -f docker-compose.local.yml stop nether-beacon` and `docker compose -f docker-compose.local.yml --profile music stop nether-beacon-muse`. Do not delete volumes to troubleshoot. Alpha persists JSON, not SQL. Muse migrations/schema come from the pinned upstream image and are applied by its startup runner; no remote SQL server or seed is required. Real music playback still requires a dedicated Discord voice session.

GitHub CI runs native checks on Ubuntu/Windows, candidate builds and runtime checks, and production dependency/image audits. No workflow deploys the application. Required branch checks are configured separately in GitHub. Development success does not constitute full/release certification.

## Local and operator Compose boundaries

`docker-compose.local.yml` is the portable developer stack with the optional music profile, checkout-relative runtime and managed local peer volume. Every local initializer/restart command selects this file explicitly. `docker-compose.yml` is the existing operator/Coolify contract, including host-specific mounts and external volumes; do not use it for Cloud setup or change it without explicit infrastructure scope. Local Compose is deliberately separate from that existing configuration.
