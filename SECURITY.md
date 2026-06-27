# Security

## Supported deployment

NeatherBeacon is designed for a local Docker Desktop deployment controlled by the server owner.

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

## Reporting

If this repository becomes public and you find a security issue, report it privately through the repository owner's preferred contact path. Do not open a public issue containing secrets, tokens, invite links or private server data.

## Operational note

The bot does not require a public HTTP endpoint in the current architecture. Discord Gateway events and slash commands are sufficient for Alpha and Bravo.
