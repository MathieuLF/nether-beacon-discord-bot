# Security

## Supported deployment

NetherBeacon is designed for an owner-controlled Docker Compose deployment. Alpha and Muse run as separate services with separate credential environments; neither service publishes an HTTP port.

## Secrets

Never publish:

- Discord bot tokens
- YouTube API keys
- Spotify client secrets
- `.env`
- `runtime/`
- `muse-data/`
- Docker volume backups

Use `.env.example` as the public template.

The root-only DockPanel deploy helper accepts only the application keys declared in its static allowlist, pins the local Docker socket and invokes `/usr/bin/docker` through a minimal environment.

## Reporting

If this repository becomes public and you find a security issue, report it privately through the repository owner's preferred contact path. Do not open a public issue containing secrets, tokens, invite links or private server data.

## Operational note

The bot does not require a public HTTP endpoint in the current architecture. Discord Gateway events and slash commands are sufficient for Alpha and Bravo.
