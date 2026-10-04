# Environment contract

No application variable or secret is required by setup or offline checks. Copy `.env.example` only for a connected development installation. `DISCORD_GUILD_ID` and `DISCORD_BOT_TOKEN` are placeholders that must be replaced before startup. Use dedicated development credentials; no variable is inherently production-only.

| Feature | Variables | Requirement |
| --- | --- | --- |
| Alpha connection | `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN` | Both required for connected startup; token is secret |
| Profile/time/paths | `BOT_PROFILE`, `BOT_TIMEZONE`, `BOT_RUNTIME_DIR`, `BOT_PEER_STATE_DIR`, `TZ` | Optional; minimal profile and local runtime by default; Compose fixes container paths |
| Statistics | `BOT_STATS_EVENT_DEBOUNCE_MS`, `BOT_STATS_VOICE_REFRESH_INTERVAL_MS` | Optional bounded settings |
| Pokédex | `BOT_POKEAPI_CACHE_TTL_DAYS`, `BOT_POKEAPI_MAX_ASSET_BYTES`, `BOT_POKEAPI_MAX_JSON_BYTES`, `BOT_POKEAPI_MAX_MEMORY_ENTRIES`, `BOT_POKEAPI_MAX_CACHE_BYTES`, `BOT_POKEAPI_MAX_CACHE_FILES`, `BOT_POKEAPI_MAX_CONCURRENT_REQUESTS`, `BOT_POKEAPI_GLOBAL_COOLDOWN_MS` | Optional bounded settings |
| Palworld public | `BOT_PALWORLD_CHANNEL_NAME`, `BOT_PALWORLD_PUBLIC_FETCH_TIMEOUT_MS`, `BOT_PALWORLD_PUBLIC_CACHE_TTL_MS`, `BOT_PALWORLD_METRICS_COOLDOWN_MS` | Optional; public projection has no credentials |
| Palworld staff | `BOT_PALWORLD_REST_API_URL`, `BOT_PALWORLD_REST_API_USERNAME`, `BOT_PALWORLD_REST_API_PASSWORD` | All three together if enabled; password is secret, username may be sensitive |
| Staff limits/channels | `BOT_PALWORLD_REST_FETCH_TIMEOUT_MS`, `BOT_PALWORLD_REST_CIRCUIT_BREAKER_MS`, `BOT_PALWORLD_ADMIN_COOLDOWN_MS`, `BOT_PALWORLD_ADMIN_CHANNEL_IDS`, `BOT_PALWORLD_ADMIN_CHANNEL_NAMES` | Optional; IDs take precedence over names |
| Public projection/summary | `GAYLEMON_PUBLIC_BASE_URL`, `GAYLEMON_DAILY_SUMMARY_TIME_ZONE`, `GAYLEMON_DAILY_SUMMARY_FETCH_TIMEOUT_MS`, `GAYLEMON_DAILY_SUMMARY_MAX_JSON_BYTES`, `GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS`, `GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_NAMES` | Optional defaults; default public destination is not a local fixture |
| Legacy public URL | `BOT_GAYLEMON_PUBLIC_BASE_URL` | Accepted by native code when canonical URL absent; prefer `GAYLEMON_PUBLIC_BASE_URL`, which Compose forwards |
| Muse connection | `MUSE_DISCORD_TOKEN` | Required by music runner; separate secret |
| Muse providers | `MUSE_YOUTUBE_API_KEY`, `MUSE_SPOTIFY_CLIENT_ID`, `MUSE_SPOTIFY_CLIENT_SECRET` | Provider credentials for music features; API key/client secret are secrets; upstream may enforce them at startup |
| Muse behavior | `MUSE_CACHE_LIMIT`, `MUSE_ENABLE_SPONSORBLOCK`, `MUSE_BOT_STATUS`, `MUSE_BOT_ACTIVITY_TYPE`, `MUSE_BOT_ACTIVITY` | Optional defaults |
| Compose runtime mount | `BOT_RUNTIME_HOST_PATH` | Required by the root Compose contract; supply the installation's runtime directory |
| Compose volumes | `MUSE_DATA_VOLUME`, `BOT_PEER_STATE_VOLUME` | Required by the root Compose contract; preserve existing volume names during upgrades |
| Immutable update policy | `MUSE_YT_DLP_AUTO_UPDATE` | Compatibility setting only; runner always forces false |

The Muse runner constructs upstream `DATA_DIR`, `DISCORD_TOKEN`, `YOUTUBE_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `CACHE_LIMIT`, `YT_DLP_AUTO_UPDATE`, `ENABLE_SPONSORBLOCK`, `BOT_STATUS`, `BOT_ACTIVITY_TYPE`, `BOT_ACTIVITY` and `ENV_FILE`; do not inject Alpha secrets into Muse. The image defines `MUSE_BUNDLED_YT_DLP_PATH`; the offline smoke defines temporary `DATABASE_URL`. Muse also passes through standard `PATH`, `HOME`, `LANG`, `LC_ALL`, `TZ`, `TMPDIR`, `TMP`, `TEMP`, `NODE_ENV`, `SSL_CERT_FILE`, `SSL_CERT_DIR` and `NODE_EXTRA_CA_CERTS` when supplied. Do not disable TLS verification.

`.env`, runtime IDs, caches, databases and volume backups remain ignored. Never print expanded Compose configuration containing credentials. Restore a corrupt managed registry from an approved backup; do not delete it or adopt resources by name. No database server/seed or automatic secret provisioning is needed for offline Alpha validation.
