# NeatherBeacon

> A self-hosted Discord stack for a private server: one admin bot, one Muse music bot, safe server reconciliation, live stats, Palworld commands, and public Pokédex commands.

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

- **NeatherBeacon - Alpha**: server audit, additive resync, logs, stats, Palworld commands, public Pokédex commands.
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
| Community channels | dedicated public spaces for Palworld and Pokémon GO conversations |
| Music | Muse in the same container, persistent Docker volume |
| Pokédex | `/pokemon`, `/weakness`, `/move`, `/ability`, `/type`, `/random-pokemon`, cached lookups and autocomplete |
| Palworld | Public `/metrics-palworld` and staff `/announce-palworld` relayed in game |
| Gaylemon daily recap | Automatic `/resume?jour=YYYY-MM-DD` link posted around 01:00 in Palworld, plus `/resume-hier` |
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

### Admin/moderator Palworld

- `/announce-palworld message:...` - publish a staff announcement in the Palworld Discord channel and relay it to the in-game server through the Palworld REST API.

### Public Palworld

- `/metrics-palworld` - show the latest Palworld REST metrics publicly. This command has a global 4-minute cooldown across the server.
- `/resume-hier` - post the Gaylemon recap link for yesterday in the configured Palworld channel.

### Public Pokédex

Use English Pokémon names.

- `/pokemon name:charizard`
- `/weakness pokemon:charizard`
- `/move name:flamethrower`
- `/ability name:intimidate`
- `/type name:fire`
- `/random-pokemon`

Pokédex JSON and artwork are cached under `runtime/pokedex-cache`.

## Palworld REST integration

When the Palworld REST API is configured, Alpha can read and publish requested game signals without exposing the API publicly.

- `/metrics-palworld` reads `GET /metrics` and posts server FPS, players, frame time, uptime, in-game days and bases.
- `/announce-palworld` calls `POST /announce` and then posts the same announcement in the Palworld Discord channel.

## Gaylemon daily recap

Alpha posts a direct link to the previous local day on the Gaylemon microsite:

```text
https://gaylemon.mathieu.pro/resume?jour=YYYY-MM-DD
```

- default schedule: `01:00` in `America/Toronto`
- default target channel: `🐾・palworld`
- manual public command: `/resume-hier`
- anti-replay state: `runtime/daily-summary-state.json`

The bot checks `/resume?jour=...` and `data/public-events-index.json` before sending, while the public Discord message stays concise: title, short recap text, and the direct link.

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
│   ├── palworld-rest.js      # Palworld REST metrics and announcements
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
- `runtime/daily-summary-state.json`

## Optional runtime tuning

Defaults are documented in `.env.example`:

- `BOT_STATS_EVENT_DEBOUNCE_MS=15000` groups noisy presence/voice events before refreshing Stats.
- `BOT_STATS_VOICE_REFRESH_INTERVAL_MS=300000` limits Stats voice-channel renames.
- `BOT_POKEAPI_CACHE_TTL_DAYS=30` controls JSON cache age.
- `BOT_POKEAPI_MAX_ASSET_BYTES=5242880` rejects oversized Pokédex artwork downloads.
- `BOT_PALWORLD_CHANNEL_NAME=🐾・palworld` controls where Palworld metrics and Discord announcements are posted.
- `BOT_PALWORLD_REST_API_URL=` enables Palworld REST features when set to the server API base URL, for example `http://host.docker.internal:8212/v1/api` when the API or SSH tunnel is exposed on the Docker Desktop host.
- `BOT_PALWORLD_REST_API_USERNAME=` and `BOT_PALWORLD_REST_API_PASSWORD=` are used for Palworld REST Basic Auth.
- `BOT_PALWORLD_REST_FETCH_TIMEOUT_MS=10000` limits Palworld REST calls.
- `BOT_PALWORLD_METRICS_COOLDOWN_MS=240000` controls the global `/metrics-palworld` cooldown.
- `GAYLEMON_PUBLIC_BASE_URL=https://gaylemon.mathieu.pro` controls the recap microsite base URL.
- `GAYLEMON_DAILY_SUMMARY_TIME_ZONE=America/Toronto` controls the local day boundary.
- `GAYLEMON_DAILY_SUMMARY_HOUR=1` and `GAYLEMON_DAILY_SUMMARY_MINUTE=0` control the automatic post time.
- `GAYLEMON_DAILY_SUMMARY_CHANNEL_NAMES=🐾・palworld` controls where the recap is posted. Prefer `GAYLEMON_DAILY_SUMMARY_CHANNEL_IDS` if names ever become ambiguous.

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

Third-party trademarks, product names, game names, character names, logos and services belong to their respective owners. NeatherBeacon has no official affiliation with Discord, Docker, GitHub, Nintendo, Creatures, GAME FREAK, The Pokémon Company, Pocketpair, Palworld, Spotify, YouTube, Muse, PokéAPI or other referenced third parties.

See [NOTICE.md](NOTICE.md) and [docs/LEGAL.md](docs/LEGAL.md).

## Security note

Never commit Discord bot tokens, YouTube API keys, Spotify secrets, runtime state or Muse data. This repository is prepared for public release, but the live `.env` and generated runtime folders must remain local/private.
