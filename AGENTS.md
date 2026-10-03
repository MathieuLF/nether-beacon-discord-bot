# NetherBeacon agent instructions

## Setup and everyday validation

- Use Node 24.19.0 (`.nvmrc`) and npm 12.0.2 (`packageManager`). Run `npm run setup` for a frozen `npm ci`; repeat after lockfile changes.
- After setup, use `npm run check:dev` for daily work. It checks all JavaScript syntax, server-plan schema/semantics, ESLint, scoped JS types, offline unit/simulated integration tests and the static build.
- `npm run check` retains the complete existing native validation through the same profile. Neither command builds Docker images or starts Discord, Muse or a database service.
- Typecheck roots are currently three modules in `tsconfig.json`; do not describe this as whole-application type safety. Syntax and lint cover all owned JS. Expand types incrementally when useful; no architectural migration is required.
- Complete targeted tests for permissions, privacy, reconciliation or upstream behavior changes (`node --test test/<name>.test.js`). Linux skips the Windows PowerShell restart test; retain Windows CI.
- `npm run check:containers -- alpha` or `-- muse` builds and exercises disposable candidate images. The Muse smoke checks a fresh SQLite database/migrations and native audio tools without network or credentials. It requires Docker Engine, build network and disk space.
- `npm run check:release` adds production dependency audit, both container validations, Trivy and Grype. Preserve these controls. A passing development profile is not full validation, a release certification, live Discord proof or audio playback proof.

## Project map

- `bot.js`: Alpha entrypoint, lifecycle, command wiring and Discord events. `lib/interaction-router.js`: command routing. `lib/commands.js`: command definitions and profile contracts.
- `lib/reconcile.js`: managed permissions/resources; `config/server-plan.json` and its schema are the declarative authority.
- `lib/managed-ids.js`: persistent identities and concurrency safeguards. `runtime/managed-ids.json` is non-reconstructible installation state, ignored by Git.
- `lib/pokedex.js`: bounded HTTP/cache/artwork; `lib/palworld-*` and `lib/daily-summary.js`: filtered integrations. Use injected clients and synthetic data in tests.
- Muse runs compiled upstream code in a separate Node 22 image. Review `config/muse-package.json` and `config/muse-yarn.lock` together; their upstream scripts are not runnable source commands in this repository.
- `docs/site/` is the static source; `public/` is disposable ignored output. After command or site asset changes, run `node scripts/generate-command-docs.js`, then validate. Shell builds delegate to the same Node assembler.

## Boundaries and data

- Ordinary validation needs no `.env`, production credentials, services, ports or external database. See `docs/CLOUD.md` and `docs/ENVIRONMENT.md`.
- Never start a bot against an existing installation, deploy/publish, send Discord/game messages, apply `/resync`, stop/restart services, or mutate production without explicit user instruction. Local `full` startup changes declared Discord resources; even `minimal` registers commands on the selected guild.
- Use dedicated development applications/guilds for explicitly authorized live integrations. Never run native Alpha and Compose against the same token/registry simultaneously.
- Never delete/adopt an unknown registry, volume or resource by name. Stop writers before capture/repair, back up non-reconstructible data and preserve locks/provenance checks. Initialization changes mount-root ownership; do not run it on a live Muse database.
- Keep `.env`, runtime IDs, player data, Muse data, backups and operator infrastructure out of Git and logs. No unfiltered player identifiers/addresses/coordinates or private voice details in public replies.
- Production controls and topology belong to private operator documentation, not this public repository. Keep `SECURITY.md`, `docs/PUBLICATION.md`, legal notices and immutable image update rules consistent.
- Preserve unrelated local changes. Do not restore tracked files automatically to conceal validation differences. Compare Git state before/after checks; only ignored build/cache output should change.

- Local development uses `docker-compose.local.yml` explicitly. The existing root `docker-compose.yml` is an operator/Coolify contract; preserve it and do not run it during Cloud tasks.
