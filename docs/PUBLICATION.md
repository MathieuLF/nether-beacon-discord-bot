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
npm run validate:config
npm test
bash scripts/build-public-site.sh
```

`npm run verify:pokedex` is an optional network test. `docker compose config --quiet` and `docker compose build` are useful private preflight checks when Docker is available.

## Static presentation

The public presentation source lives under `docs/site/`. Build a deployable directory without assuming a particular host or platform:

```bash
bash scripts/build-public-site.sh
```

Publishing the resulting directory is a separate, operator-authorized action.
