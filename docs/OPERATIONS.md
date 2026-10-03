# Self-hosting NetherBeacon

This guide describes a generic installation controlled by its owner. It contains no private deployment procedures.

## Architecture and requirements

Use Node.js 24 and npm for local validation, plus Docker Engine with Compose v2 for containers. Alpha uses Node 24; Muse uses a separately pinned Node 22 runtime with compiled application and migrations copied from the pinned upstream image. Both services run as UID/GID 10001, with a read-only root filesystem, dropped capabilities and no inbound ports.

`nether-beacon` runs Alpha. `nether-beacon-muse` is optional and enabled by the Compose profile `music`. Alpha does not wait for Muse. They have separate credential environments; only Muse process health metadata is shared read-only with Alpha.

## Start Alpha locally

1. Clone the repository and copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, `cp .env.example .env` in a POSIX shell).
2. Set `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` for a dedicated development application/server. Keep `BOT_PROFILE=minimal` initially. Muse credentials may stay blank.
3. Invite the application with the `bot` and `applications.commands` scopes. Alpha needs access to its command channels; the minimal and pokemon profiles do not require privileged member/presence intents.
4. Run:

```text
npm ci
npm run check
npm run init:local
docker compose -f docker-compose.local.yml up -d --wait nether-beacon
docker compose -f docker-compose.local.yml ps
```

`init:local` builds the selected images and uses short-lived containers to initialize the ownership of the runtime directory. It does not start either bot. It changes only the mount-root ownership, not all existing files recursively. If old runtime files have a different owner, review their ownership separately after backing them up.

`BOT_RUNTIME_DIR=./runtime` is the native Node path used by `npm start` and `capture:ids`. Compose explicitly maps the same host directory to `/bot/runtime`. Do not launch native Node and Compose simultaneously with the same token or registry.

Try `/help` in Discord. `/status` is reserved for administrators. `npm run check` is offline; it does not start a bot. `npm run verify:pokedex` is a separate, optional PokéAPI network check.

## Enable music

Fill the `MUSE_*` credentials in `.env`. Muse uses a second Discord application, invited with its own music permissions. Keep `MUSE_DATA_VOLUME` unchanged for an existing installation; its historical default is `neatherbeacon-muse-data`. Choose a distinct volume name for a separate installation. An empty/new volume does not migrate an old database.

```text
npm run init:local -- --music
docker compose -f docker-compose.local.yml --profile music up -d --wait
```

The initializer labels a new external volume with its Compose project and source directory, checks that ownership, and initializes `/data` and the peer-state directory for UID 10001. It refuses to adopt existing unlabelled/foreign volumes. A historical installation with working permissions does not need initialization: keep its volume name and start the selected service normally. Review and back up any existing volume before changing ownership. Do not run initialization against a live database during an update. `MUSE_YT_DLP_AUTO_UPDATE` is always disabled in the runner; updates arrive through a rebuilt image. `MUSE_CACHE_LIMIT` bounds the upstream music cache.

For later PowerShell restarts including music, set `$env:COMPOSE_PROFILES='music'` before running the restart script. Omitting the profile does not stop an already running Muse service; stop it explicitly by service name if that is the intended change.

## Enable managed administration

The Alpha profiles are separate from Compose profiles:

| Alpha profile | Commands and behavior |
| --- | --- |
| `minimal` | `/help`, admin `/status`, public `/metrics-palworld` and `/resume-hier` |
| `pokemon` | Minimal plus `/pokemon`, `/weakness`, `/move`, `/ability`, `/type`, `/random-pokemon` |
| `full` | All commands, server synchronization at startup, statistics, membership and voice events |

Before choosing `full`, review `config/server-plan.json`: it declares roles, categories, channels, strict permissions and server settings. Enable Server Members Intent and Presence Intent in the Discord developer portal, grant the bot the required management permissions, and place its role above the roles it manages. It does not automatically promote an existing role to Administrator.

On an existing server, stop Alpha before capturing IDs:

```text
docker compose -f docker-compose.local.yml stop nether-beacon
npm run capture:ids
```

Capture reads Discord and writes only the local registry. It refuses conflicts, wrong provenance or missing stored identities without saving partial results. Then set `BOT_PROFILE=full` and start Alpha. A fresh server without any matching managed resources can bootstrap directly. Full startup and `/resync` change declared resources and permissions; `/audit` only reports drift.

Stats from older versions must be captured once before updating their names/permissions. Capture accepts only a unique category/channel with the existing public, read-only Stats policy. If it refuses, inspect the resources and correct the intended registry mapping or policy explicitly; do not delete the entire registry. The former `Stats serveur` name is supported. Legacy time and stats-live channels are never automatically deleted.

Stable IDs survive renames and partial synchronization failures. A missing/wrong-type stored ID stops its reconciliation; a matching name does not replace it. A valid stored channel/category ID remains authoritative if a separate duplicate name exists. A corrupted registry stops reconciliation and must be restored from backup or repaired. Keep only one Alpha process per registry. Bot mutations are queued, and registry saves use a short filesystem lock plus a revision check so a stale capture cannot overwrite newer IDs. A concurrent change fails explicitly: reload and retry after stopping the other writer. If a process crashes while saving, a `managed-ids.json.lock` file may remain; stop all writers, inspect its PID/time, back up the registry, and remove only that stale lock before retrying.

Wholly private categories inherit a private policy from the common child access groups. Mixed/public categories remain neutral, and every managed child receives its own exact policy at creation and when moved. Existing custom topics are preserved and reported, while obsolete managed topics are updated.

## Command behavior

- `/help` lists only enabled commands appropriate to the caller's role. Pokédex keys and upstream card data use English names.
- `/metrics-palworld` is public and has a global cooldown (four minutes by default). Missing, old or failed source data is marked incomplete; absent measurements do not become zero.
- `/resume-hier` is public in the configured Palworld channel(s). It distinguishes an accessible page from confirmed index data and unavailable content.
- `/announce-palworld` requires a managed Admin/Mod role ID or Discord Administrator, an allowed channel, a cooldown and separately configured REST credentials. Explicit channel IDs take precedence over names; ambiguous names authorize no channel. A lost POST response is not retried automatically: verify in game before sending it again.
- Private voice channel names and hidden sides of transitions never enter public event logs.
- `/stats-refresh` reports failed writes. A `~` before member counts means the cache is incomplete. Presence remains Discord's observable status, not proof that a person is physically online.

## Updates and rollback

Back up `runtime/managed-ids.json` and Muse data first. Record current image IDs/digests for rollback. Validate with `npm ci` and `npm run check`, then build candidates before replacing the selected services.

The local PowerShell helper `.\scripts\rebuild-restart.ps1` checks Compose project and source-directory ownership, builds, rechecks ownership, sends a maintenance notice when a log channel is known, and recreates only the selected services. It refuses unknown/foreign containers and never stops or removes them. Choose the correct Docker context/project instead of deleting a conflicting instance. It does not implement deployment backups or rollback; those belong in the operator's private controls.

Container names are now generated by Compose; service names are unchanged. When upgrading from fixed names, verify existing project/source labels before recreating the same services. Update any private monitor that addressed the old fixed container name. The historical Muse volume and `./runtime` binding are preserved in the local Compose file.

All runtime and source images are pinned by digest. Alpha upgrades its Alpine packages, installs only production dependencies, and removes package managers plus Muse-only manifests from its final filesystem. Muse copies the immutable 2.11.7 compiled application from upstream into a clean Node 22 Alpine runtime, rebuilds only the production dependency graph, generates its Prisma client for musl, keeps the matching Prisma CLI required for migrations, and uses pinned static FFmpeg 9.0.1 plus yt-dlp 2026.08.19. TypeScript, esbuild and patching tools remain build-only. `config/muse-package.json` and `config/muse-yarn.lock` remain the dependency authority; review and regenerate them together with every Muse update. Retain built image digests for exact rollback.

## Health and troubleshooting

Container CI uses both Trivy and Grype and rejects any High/Critical image finding. Its offline Muse smoke restores a fresh SQLite schema, performs a write/read/delete, exercises native Opus and FFmpeg, verifies the absence of runtime package installers, and imports the compiled application. Run the same smoke against a rebuilt candidate before production; these checks require no live credentials.

```text
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs --tail=200 nether-beacon
docker compose -f docker-compose.local.yml --profile music logs --tail=200 nether-beacon-muse
```

Alpha health requires initialization, a ready Discord Gateway and a recent heartbeat. Command errors remain in diagnostics but do not permanently poison connection health. Bravo's check proves only a recent running process; verify its Discord presence and audio playback separately. A process heartbeat does not establish that a music session works.

Back up non-reconstructible runtime identifiers and Muse data; peer heartbeats and Pokédex caches are reconstructible. Test restores in an isolated project. Keep secrets, player identifiers and operational topology out of Git and public logs.
