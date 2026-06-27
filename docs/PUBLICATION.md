# Public GitHub Publication Checklist

This repository is being prepared for a public GitHub release, but the live deployment still contains local secrets and runtime state that must stay private.

## Before creating the public repository

- Confirm the final repository slug, for example `OWNER/REPO`.
- Replace `OWNER/REPO` in `README.md` badges.
- Review `LICENSE` and confirm the copyright holder line.
- Review `NOTICE.md` and `docs/LEGAL.md`.
- Review screenshots or assets before publishing them.
- Keep `.env` local only.
- Keep Docker volume data local only.

## Must never be committed

- `.env`
- Discord bot tokens
- YouTube API keys
- Spotify client secrets
- `runtime/`
- `muse-data/`
- Docker volume exports
- logs containing bot tokens, guild secrets, invite URLs or private user data

## Safe to commit

- `.env.example`
- source files
- schema/config templates
- documentation
- `LICENSE`
- `NOTICE.md`
- static GitHub Pages files under `docs/site/`
- public-facing images in `assets/` after manual review

## Legal review before public launch

- Confirm that MIT is the intended license.
- Confirm the copyright holder shown in `LICENSE`.
- Keep the no-affiliation wording in `NOTICE.md`.
- Keep the Pokémon/PokéAPI runtime-cache boundary clear.
- Do not publish downloaded Pokémon artwork from `runtime/pokedex-cache`.
- Do not imply endorsement by Discord, Muse, PokéAPI, Nintendo, Creatures, GAME FREAK, The Pokémon Company, YouTube, Spotify, Docker, GitHub or Node.js.

## README badges

The README includes a Tokei badge with a placeholder:

```md
[![Tokei](https://tokei.rs/b1/github/OWNER/REPO?category=code)](https://github.com/OWNER/REPO)
```

After the public repository exists, replace `OWNER/REPO` with the final GitHub path.

## GitHub Pages setup

Recommended settings:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

The microsite entry point is:

- `docs/site/index.html`

The file `docs/.nojekyll` is included so GitHub Pages serves static files directly.

## Pre-publication local checks

Run these from `C:\Projects\nether-beacon`:

```powershell
npm run validate:config
npm test
```

Optional manual checks:

```powershell
docker compose config
docker compose build
```

`docker compose config` can print environment-derived values. Only run it locally in a private terminal.

## Deployment reminder

For live rebuilds, prefer:

```powershell
.\scripts\rebuild-restart.ps1
```

This posts an orange restart notice in the Discord admin logs channel before rebuilding and restarting the container.
