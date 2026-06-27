# Legal Notes

This document is a practical publication note, not legal advice.

NeatherBeacon is a self-hosted side project for a private Discord server.

## License

NeatherBeacon is distributed under the MIT License.

See:

- [`../LICENSE`](../LICENSE)
- [`../NOTICE.md`](../NOTICE.md)

## Non-affiliation

NeatherBeacon is an independent project. It has no official affiliation with Discord, Docker, GitHub, Nintendo, Creatures, GAME FREAK, The Pokémon Company, Spotify, YouTube, Muse, PokéAPI, or any other third-party brand mentioned in the project.

## Trademarks and brands

All third-party names, trademarks, logos, game names, character names, and service names belong to their respective owners.

Brand names are used only to identify integrations and interoperability targets.

## Pokémon data and artwork

Pokédex commands use PokéAPI at runtime.

The project does not own Pokémon names, sprites, official artwork, descriptions, game data, or related intellectual property.

The bot caches fetched data and artwork locally under:

```text
runtime/pokedex-cache
```

That folder is ignored and must not be published unless the publisher has separately confirmed the right to distribute its contents.

## Public repository boundary

Safe to publish:

- source code
- documentation
- `.env.example`
- schema/config templates
- static GitHub Pages site

Do not publish:

- `.env`
- bot tokens
- API keys
- Spotify secrets
- runtime state
- downloaded PokéAPI assets
- Muse data volume exports
- private Discord server data
