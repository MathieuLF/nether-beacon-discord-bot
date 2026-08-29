# NetherBeacon

A self-hosted Discord stack for a private community: one administration bot, an isolated Muse music bot, safe server reconciliation, statistics, Palworld commands and public Pokédex commands.

[![Node.js](https://img.shields.io/badge/Node.js-22.x-2f6f43?logo=nodedotjs&logoColor=white)](#requirements)
[![discord.js](https://img.shields.io/badge/discord.js-14.27.0-5865F2?logo=discord.js&logoColor=white)](https://discord.js.org/)
[![License MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

This public repository contains the application and its local-development contract. It deliberately does not document a live deployment, private host, infrastructure topology, secret store or operator runbook.

## Capabilities

| Area | Capabilities |
| --- | --- |
| Server management | Audit and reconciliation of declared roles, channels, categories and managed permissions |
| Community | Dedicated public spaces for Palworld, Pokémon GO and Minecraft; arrival, departure, voice and presence events; bounded public statistics |
| Music | Isolated upstream Muse service with separate credentials and state |
| Pokédex | Cached `/pokemon`, `/weakness`, `/move`, `/ability`, `/type` and `/random-pokemon` lookups |
| Palworld | Filtered public metrics and staff-only announcements through separately configured endpoints |
| Diagnostics | Health checks, cache status and tests for permission and privacy boundaries |

Reconciliation creates missing managed resources but never guesses among ambiguous duplicates or deletes unrelated roles and channels. Managed permissions converge to the declared plan.

## Bot profiles

- `minimal` is the safe default and exposes only the smallest command set.
- `pokemon` adds the public Pokédex commands without administration events.
- `full` enables the administration, statistics and event capabilities for an explicitly managed environment.

The selected profile is deployment configuration, not an indication that a public instance is running.

## Requirements

- Node.js 22 and npm, or Docker Compose for an isolated local run.
- Discord application credentials for bot integration tests.
- Optional upstream credentials only for the features that use them.

## Local setup

```powershell
Copy-Item .env.example .env
npm ci
npm run validate:config
npm test
```

Use placeholder or dedicated development credentials. Never reuse a production token in local development.

To exercise the local Compose stack after reviewing `.env.example`:

```powershell
docker compose up -d --build
docker compose ps
```

## Validation

```powershell
npm run validate:config
npm test
npm run verify:pokedex
```

`npm test` is the default offline-oriented validation. `verify:pokedex` contacts PokéAPI and should be run only when an upstream network check is intended.

## Repository map

| Path | Purpose |
| --- | --- |
| `bot.js` | Main Discord bot and command dispatch |
| `lib/` | Reconciliation, permissions and bounded upstream integrations |
| `config/` | Declarative server plan and JSON schema |
| `tests/` | Command, access-control, cache and privacy-boundary tests |
| `docs/site/` | Static presentation source |
| `runtime/` | Generated local state, ignored by Git |

## Security and privacy

- Never commit Discord tokens, API credentials, runtime identifiers, downloaded cache data or Muse state.
- Public Palworld commands consume only a filtered public projection. Private player identifiers, addresses, coordinates and system paths must never enter Discord output or logs.
- Staff actions require configured roles/channels, cooldowns and a separately protected administrative endpoint.
- Pokédex artwork is accepted only from approved public hosts after URL, address, path, type and size validation.
- `.env`, `runtime/`, `muse-data/` and `node_modules/` remain outside Git.

Report vulnerabilities through the repository's private security-reporting channel rather than a public issue containing credentials or personal data.

## Lifecycle and support

NetherBeacon is an independently maintained, self-hosted side project. A commit, release or passing health check does not assert the state of any installation. Operators are responsible for their own configuration, backups, Discord permissions and upstream terms of service.

## License and notices

NetherBeacon is released under the MIT License. See [LICENSE](LICENSE).

Third-party trademarks, product names, game names, characters, logos and services belong to their respective owners. NetherBeacon is not affiliated with Discord, Nintendo, Creatures, GAME FREAK, The Pokémon Company, Pocketpair, Palworld, Spotify, YouTube, Muse or PokéAPI. See [NOTICE.md](NOTICE.md) and [docs/LEGAL.md](docs/LEGAL.md).
