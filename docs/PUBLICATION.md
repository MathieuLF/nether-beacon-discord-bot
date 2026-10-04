# Public repository checklist

This checklist keeps the public source useful without publishing the details of any private installation.

## Before a public change

- review `.env.example` for placeholder-only values;
- keep `.env`, `runtime/`, Muse data, logs and volume exports outside Git;
- scan screenshots, fixtures and documentation for user data, invite URLs and infrastructure details;
- keep `LICENSE`, `NOTICE.md` and `docs/LEGAL.md` aligned;
- do not imply affiliation with Discord, Muse, PokéAPI or game publishers;
- do not claim that a hosted instance is online merely because a commit or release exists.

## Public documentation boundary

The repository may describe generic self-hosting, required variables, health checks and rollback principles. It must not contain:

- private hostnames, addresses, filesystem paths or container-control endpoints;
- secret-vault names, account identifiers or platform versions;
- production resource limits, backup destinations or maintenance schedules;
- root-only deployment helpers or commands tied to the author's infrastructure;
- unfiltered Discord, Palworld or user data.

Those facts belong in the operator's private infrastructure documentation.

## Validation

```bash
npm ci
npm run check
```

`npm run check:dev` is the daily native profile. `npm run verify:pokedex` is an optional network test. Use `npm run check:release` before publication; it adds production dependency audit, candidate images, offline runtime probes and both image scanners. Portable Compose preflight uses `docker compose -f docker-compose.local.yml config --quiet`. Do not use the operator/Coolify Compose contract for local checks.

Both runtime images install the same source-built zlib APK from upstream commit `d81c2d7eb705c62294ba03299255672078e89115`. This snapshot contains the non-blocking gzip write fixes for CVE-2026-85091. The archive is checked by SHA-256 and SHA-512; the package version `1.3.2.1_git20260917-r0` describes the real upstream `1.3.2.1-motley` snapshot. Its license is retained in the images. Compiler tools and signing keys remain in the build stage. The offline Muse probe checks the loaded library, ordinary gzip compression and blocked writes in three modes. Trivy and Grype retain their existing failure thresholds.

## Static presentation

The public presentation source lives under `docs/site/`. Build a deployable directory without assuming a particular host or platform:

```bash
npm run build:site
```

Publishing the resulting directory is a separate, operator-authorized action.

Command cards are generated from `lib/commands.js`. After changing commands, run `node scripts/generate-command-docs.js`; the build refuses stale cards. The shell entrypoint delegates to the same Node assembler and requires Node.
