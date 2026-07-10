# NeatherBeacon

> A self-hosted Discord stack for a private server: one admin bot, one Muse music bot, safe server reconciliation, live stats, and public Pokédex commands.

<!-- Public repository slug: MathieuLF/neather-beacon-discord-bot -->

[![Node.js](https://img.shields.io/badge/Node.js-22.x-2f6f43?logo=nodedotjs&logoColor=white)](#)
[![Docker Desktop](https://img.shields.io/badge/Docker%20Desktop-ready-2496ED?logo=docker&logoColor=white)](#quick-start)
[![discord.js](https://img.shields.io/badge/discord.js-14.26.4-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![Muse](https://img.shields.io/badge/Muse-2.11.5-ff5f8f)](https://github.com/museofficial/muse)
[![PokéAPI](https://img.shields.io/badge/Pok%C3%A9API-cached%20locally-EF5350)](https://pokeapi.co/)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-222?logo=githubpages&logoColor=white)](https://mathieulf.github.io/neather-beacon-discord-bot/)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20server-5865F2?logo=discord&logoColor=white)](https://discord.gg/2ghwj8B7Vd)

Official Discord server: [Join the community](https://discord.gg/2ghwj8B7Vd).

## What it does

NeatherBeacon runs a single Docker container with two Discord bot accounts:

- **NeatherBeacon - Alpha**: server audit, additive resync, logs, stats, public Pokédex commands.
- **NeatherBeacon - Bravo**: music playback through upstream Muse.

The project is designed to be **safe by default**:

- no destructive deletion of existing Discord roles or channels;
- Discord resources are reused by ID when known;
- ambiguous duplicates are reported instead of guessed;
- runtime state and secrets are kept out of Git.

This is a self-hosted side project for a private Discord server.

## Feature map

| Area | Features |
| --- | --- |
| Server management | `/audit`, `/resync`, managed roles/channels/categories, ID registry |
| Logs | admin logs, public arrivals/departures, voice join/leave/move tracking |
| Stats | locked public voice channels updated every 5 minutes, with event debounce |
| Music | Muse in the same container, persistent Docker volume |
| Pokédex | `/pokemon`, `/weakness`, `/move`, `/ability`, `/type`, `/random-pokemon`, cached lookups and autocomplete |
| Palworld status | Uptime Kuma status-page polling, one-shot up/down messages and maintenance/incident notices |
| Operations | Docker Desktop, local healthcheck, restart notice script |
| Website | static microsite in `docs/` |

## Discord commands

### Admin-only

- `/status` - Alpha, Bravo, runtime and cache status.
- `/audit` - compare the desired Discord structure with the current server.
- `/resync` - apply additive managed changes.
- `/help` - compact help.
- `/welcome-preview` - preview the welcome message.
- `/stats-refresh` - force Stats voice channels to refresh now.
- `/diag` - safe runtime diagnostic for Alpha, Bravo, command hash and recent stats.
- `/cache-status` - local runtime/Pokédex cache sizes and ages without file contents or secrets.

### Public Pokédex

Use English Pokémon names.

- `/pokemon name:charizard`
- `/weakness pokemon:charizard`
- `/move name:flamethrower`
- `/ability name:intimidate`
- `/type name:fire`
- `/random-pokemon`

Pokédex JSON and artwork are cached under `runtime/pokedex-cache`.

## Palworld status alerts

When `BOT_UPTIME_KUMA_STATUS_PAGE_URL` points to a published Uptime Kuma status page, Alpha polls the public status-page API and posts updates in the configured Palworld channel.

- `up`, `down` and `maintenance` states are announced only when the status changes.
- Uptime Kuma maintenances and incidents are announced once per public revision.
- Completed maintenances and incidents are announced once when they disappear from the public page.
- Anti-spam state is stored in `runtime/uptime-kuma-status.json`, so bot restarts do not replay the same notice.

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
│   ├── site/
│   │   ├── index.html        # GitHub Pages microsite
│   │   └── assets/           # Microsite styles/scripts
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
- `runtime/uptime-kuma-status.json`

## Optional runtime tuning

Defaults are documented in `.env.example`:

- `BOT_STATS_EVENT_DEBOUNCE_MS=15000` groups noisy presence/voice events before refreshing Stats.
- `BOT_STATS_VOICE_REFRESH_INTERVAL_MS=300000` limits Stats voice-channel renames.
- `BOT_POKEAPI_CACHE_TTL_DAYS=30` controls JSON cache age.
- `BOT_POKEAPI_MAX_ASSET_BYTES=5242880` rejects oversized Pokédex artwork downloads.
- `BOT_UPTIME_KUMA_STATUS_PAGE_URL=` enables Palworld status polling when set to a published Uptime Kuma status page.
- `BOT_UPTIME_KUMA_STATUS_CHANNEL_NAME=🐾・palworld` controls where up/down and maintenance notices are posted.
- `BOT_UPTIME_KUMA_POLL_INTERVAL_MS=60000` controls how often Alpha checks the public status page API.
- `BOT_UPTIME_KUMA_FETCH_TIMEOUT_MS=10000` limits each Uptime Kuma HTTP request.

## Public GitHub readiness

Before publishing:

- review `.env.example` for placeholder-only values;
- keep `.env`, `runtime/`, `muse-data/` and Docker volumes private;
- review the MIT license holder line in `LICENSE`;
- review trademark and non-affiliation notices in `NOTICE.md`;
- enable GitHub Pages from the `docs/` folder and keep the site entrypoint in `docs/site/`.

Detailed checklist: [docs/PUBLICATION.md](docs/PUBLICATION.md).

## Documentation

- [Operations](docs/OPERATIONS.md)
- [Publication checklist](docs/PUBLICATION.md)
- [Legal notes](docs/LEGAL.md)
- [Assets](docs/ASSETS.md)
- [Live site](https://mathieulf.github.io/neather-beacon-discord-bot/)
- [Microsite source](docs/site/index.html)

## License, notices and trademarks

NeatherBeacon is released under the MIT License. See [LICENSE](LICENSE).

Third-party trademarks, product names, game names, character names, logos and services belong to their respective owners. NeatherBeacon has no official affiliation with Discord, Docker, GitHub, Nintendo, Creatures, GAME FREAK, The Pokémon Company, Spotify, YouTube, Muse, PokéAPI or other referenced third parties.

See [NOTICE.md](NOTICE.md) and [docs/LEGAL.md](docs/LEGAL.md).

## Security note

Never commit Discord bot tokens, YouTube API keys, Spotify secrets, runtime state or Muse data. This repository is prepared for public release, but the live `.env` and generated runtime folders must remain local/private.
