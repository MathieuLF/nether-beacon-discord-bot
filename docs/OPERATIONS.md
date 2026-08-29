# Self-hosting NetherBeacon

This guide describes a generic owner-controlled installation. It intentionally omits the author's hosts, domains, secret stores, deployment paths and private operating procedures.

## Architecture

The Compose file runs two isolated services from one image:

- `nether-beacon` handles Discord commands, reconciliation, statistics and bounded integrations;
- `nether-beacon-muse` runs Muse with its own credential environment and persistent data volume.

Neither service needs a public HTTP port. Discord Gateway connections are outbound. Optional upstream integrations should be reachable only through routes explicitly controlled by the operator.

The declarative server plan includes dedicated public community channels for Palworld, Pokémon GO and Minecraft. Managed channel permissions and topics converge to that plan.

## Requirements

- Docker Engine with Compose v2;
- two Discord applications when both administration and music are enabled;
- a private mechanism for injecting the variables listed in `.env.example`;
- durable storage for Muse data and the application runtime state.

## Initial setup

```bash
cp .env.example .env
npm ci
npm run validate:config
npm test
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Use dedicated development credentials for local tests. `docker compose config` may render resolved values and must be run only in a private terminal.

## Profiles

- `minimal` is the safe default;
- `pokemon` adds public Pokédex commands;
- `full` enables managed reconciliation, statistics, events and staff actions.

Changing profile changes registered Discord commands and must be treated as a deliberate configuration update.

## Updates

1. Review the source revision and dependency changes.
2. Run `npm ci`, `npm run validate:config` and `npm test`.
3. Build the candidate image without replacing the running services.
4. Record the current image digest or ID for rollback.
5. Recreate only the two application services.
6. Wait for both health checks and verify their restart counts and logs.
7. Restore the previous image if either service fails its health check.

The repository does not prescribe a hosting panel, secret manager, path, maintenance window or automation engine. Operators should implement those controls in their private infrastructure repository.

## Backups

Back up the Muse data volume and the non-reconstructible files under `runtime/`. The peer heartbeat state and Pokédex cache are reconstructible. Test restoration into an isolated Compose project before relying on a backup.

## Security and privacy

- Store secrets outside Git and expose each credential only to the service that needs it.
- Run as a non-root user, drop Linux capabilities, use a read-only root filesystem and avoid host ports unless a feature explicitly requires one.
- Preserve the stable-ID registry; ambiguous Discord resources must fail closed.
- Never log private player identifiers, addresses, coordinates, tokens or raw administrative responses.
- Restrict staff commands by stable role and channel IDs, not names alone.

## Health and troubleshooting

```bash
docker compose ps
docker compose logs --tail=200 nether-beacon
docker compose logs --tail=200 nether-beacon-muse
npm run verify:pokedex
```

Use `/audit` before `/resync`. A resync can create missing managed resources and remove undeclared permissions from resources already under management; it is not a harmless health probe.
