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

Self-hosted installations should inject only the variables declared in `.env.example`, use an owner-controlled secret manager and keep deployment automation in a private infrastructure repository. Do not publish root-only helpers, control-plane endpoints or secret-store identifiers here.

## Reporting

If this repository becomes public and you find a security issue, report it privately through the repository owner's preferred contact path. Do not open a public issue containing secrets, tokens, invite links or private server data.

## Operational note

The bot does not require a public HTTP endpoint in the current architecture. Discord Gateway events and slash commands are sufficient for Alpha and Bravo.
