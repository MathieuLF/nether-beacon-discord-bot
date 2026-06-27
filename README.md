# NeatherBeacon

> A small personal Discord experiment built for fun: one admin bot, one Muse music bot, safe server reconciliation, live stats, and public Pokédex commands.

<!--
Public repository setup:
Replace OWNER/REPO with the final GitHub repository path before publishing.
Example: mathieulf/neatherbeacon
-->

[![Node.js](https://img.shields.io/badge/Node.js-22.x-2f6f43?logo=nodedotjs&logoColor=white)](#)
[![Docker Desktop](https://img.shields.io/badge/Docker%20Desktop-ready-2496ED?logo=docker&logoColor=white)](#quick-start)
[![discord.js](https://img.shields.io/badge/discord.js-14.26.4-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![Muse](https://img.shields.io/badge/Muse-2.11.5-ff5f8f)](https://github.com/museofficial/muse)
[![PokéAPI](https://img.shields.io/badge/Pok%C3%A9API-cached%20locally-EF5350)](https://pokeapi.co/)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-site%20ready-222?logo=githubpages&logoColor=white)](docs/index.html)
[![Tokei](https://tokei.rs/b1/github/OWNER/REPO?category=code)](https://github.com/OWNER/REPO)

## What it does

NeatherBeacon runs a single Docker container with two Discord bot accounts:

- **NeatherBeacon - Alpha**: server audit, additive resync, logs, stats, public Pokédex commands.
- **NeatherBeacon - Bravo**: music playback through upstream Muse.

The project is designed to be **safe by default**:

- no destructive deletion of existing Discord roles or channels;
- Discord resources are reused by ID when known;
- ambiguous duplicates are reported instead of guessed;
- runtime state and secrets are kept out of Git.

This is a personal project built for fun, not an official integration.

## Feature map

| Area | Features |
| --- | --- |
| Server management | `/audit`, `/resync`, managed roles/channels/categories, ID registry |
| Logs | admin logs, public arrivals/departures, voice join/leave/move tracking |
| Stats | locked public voice channels updated every 5 minutes |
| Music | Muse in the same container, persistent Docker volume |
| Pokédex | `/pokemon`, `/weakness`, `/move`, `/ability`, `/type`, `/random-pokemon` |
| Operations | Docker Desktop, local healthcheck, restart notice script |
| Website | static microsite ready for GitHub Pages in `docs/` |

## Discord commands

### Admin-only

- `/status` - Alpha, Bravo, runtime and cache status.
- `/audit` - compare the desired Discord structure with the current server.
- `/resync` - apply additive managed changes.
- `/help` - compact help.
- `/welcome-preview` - preview the welcome message.
- `/stats-refresh` - force Stats voice channels to refresh now.

### Public Pokédex

Use English Pokémon names.

- `/pokemon name:charizard`
- `/weakness pokemon:charizard`
- `/move name:flamethrower`
- `/ability name:intimidate`
- `/type name:fire`
- `/random-pokemon`

Pokédex JSON and artwork are cached under `runtime/pokedex-cache`.

## Repository layout

```text
.
├── bot.js                    # Alpha admin/public command bot
├── supervisor.js             # runs Alpha and Muse together
├── healthcheck.js            # local container healthcheck
├── docker-compose.yml        # one service, one container
├── Dockerfile
├── config/
│   ├── server-plan.json      # desired Discord structure
│   └── server-plan.schema.json
├── lib/
│   ├── reconcile.js          # additive Discord reconciliation
│   ├── managed-ids.js        # runtime ID registry support
│   └── pokedex.js            # cached PokéAPI integration
├── scripts/
│   ├── capture-managed-ids.js
│   └── rebuild-restart.ps1   # Discord orange notice + rebuild
├── docs/
│   ├── index.html            # GitHub Pages microsite
│   ├── OPERATIONS.md
│   ├── PUBLICATION.md
│   └── ASSETS.md
└── runtime/                  # ignored, generated locally
```

## Quick start

1. Start Docker Desktop.
2. Copy `.env.example` to `.env`.
3. Fill the Discord, YouTube and Spotify values in `.env`.
4. Capture existing managed Discord IDs:

```powershell
npm run capture:ids
```

5. Build and start with a Discord restart notice:

```powershell
.\scripts\rebuild-restart.ps1
```

For the first ever launch, `docker compose up -d --build` is also valid if Alpha is not running yet and cannot post a restart notice.

## Runtime storage

Ignored from Git:

- `.env`
- `runtime/`
- `muse-data/`
- `node_modules/`

Persistent Docker volume:

- `example-muse-data` mounted at `/data`

Recreatable runtime caches:

- `runtime/pokedex-cache`
- `runtime/admin-state.json`
- `runtime/managed-ids.json`

## Public GitHub readiness

Before publishing:

- replace `OWNER/REPO` in README badges;
- review `.env.example` for placeholder-only values;
- keep `.env`, `runtime/`, `muse-data/` and Docker volumes private;
- review the MIT license holder line in `LICENSE`;
- review trademark and non-affiliation notices in `NOTICE.md`;
- enable GitHub Pages from the `docs/` folder.

Detailed checklist: [docs/PUBLICATION.md](docs/PUBLICATION.md).

## Documentation

- [Operations](docs/OPERATIONS.md)
- [Publication checklist](docs/PUBLICATION.md)
- [Legal notes](docs/LEGAL.md)
- [Assets](docs/ASSETS.md)
- [Microsite](docs/index.html)

## License, notices and trademarks

NeatherBeacon is released under the MIT License. See [LICENSE](LICENSE).

Third-party trademarks, product names, game names, character names, logos and services belong to their respective owners. NeatherBeacon is not affiliated with, endorsed by, sponsored by or officially connected to Discord, Docker, GitHub, Nintendo, Creatures, GAME FREAK, The Pokémon Company, Spotify, YouTube, Muse, PokéAPI or other referenced third parties.

See [NOTICE.md](NOTICE.md) and [docs/LEGAL.md](docs/LEGAL.md).

## Security note

Never commit Discord bot tokens, YouTube API keys, Spotify secrets, runtime state or Muse data. This repository is prepared for public release, but the live `.env` and generated runtime folders must remain local/private.
