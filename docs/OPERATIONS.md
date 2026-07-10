# Operations

## Objectif

Ce projet fournit une pile Docker Desktop exploitable en continu pour:

- un bot admin Discord dedie a l audit, la resynchronisation additive et aux logs
- un bot Muse dedie a la musique
- un seul conteneur et un seul service Docker Compose

Nom du stack: `NeatherBeacon`

## Architecture

- image base: `ghcr.io/museofficial/muse:2.11.5`
- superviseur local: `supervisor.js`
- bot admin: `bot.js`
- healthcheck local: `healthcheck.js`
- config declarative serveur: `config/server-plan.json`
- dossier d exploitation unique: `C:\Projects\nether-beacon`
- volume persistant musique: `example-muse-data:/data`
- volume runtime local: `C:\Projects\nether-beacon\runtime:/bot/runtime`

## Fonctions Et Possibilites

- audit non destructif du serveur cible
- creation additive des roles, categories et salons geres
- correction des ressources gerees quand l intention est claire
- detection et signalement des conflits de nommage
- registre runtime `runtime/managed-ids.json` pour retrouver les ressources gerees par ID avant de regarder les noms
- anti-duplication renforcee: noms exacts, anciens noms et noms probablement equivalents sont detectes avant creation
- protection contre l ajout silencieux de `Administrator` a un role `Admin` existant
- categorie `Stats` dynamique, visible par tous, vocale, verrouillee, poussee en fin de liste, et rafraichie toutes les 5 minutes
- logs arrivees/departs
- attribution automatique du role `Noob Spawn` aux nouveaux membres humains
- message d accueil tague dans `general` pour les nouveaux membres humains
- salon public `invitations` pour les codes de lobby, realms et invitations en jeu
- commandes Pokédex publiques avec noms Pokémon en anglais:
  - `/pokemon`
  - `/weakness`
  - `/move`
  - `/ability`
  - `/type`
  - `/random-pokemon`
- `/pokemon` et `/random-pokemon` retournent une fiche enrichie avec artwork/sprite mis en cache, types, abilities, stats, species, labels, egg groups et evolution quand disponible
- surveillance de la page Uptime Kuma Palworld avec annonce unique des transitions actif/inactif et des maintenances/incidents publics
- commande publique `/metrics-palworld` avec cooldown global de 4 minutes
- surveillance des connexions/deconnexions Palworld via l API REST officielle, apres baseline silencieuse
- commande staff `/announce-palworld` pour publier une annonce dans Discord et la relayer en jeu via `POST /announce`
- erreurs API Palworld REST signalees seulement dans le salon securise des logs
- logs entree/sortie/deplacement vocal
- commandes slash admin:
  - `/status`
  - `/audit`
  - `/resync`
  - `/help`
  - `/welcome-preview`
  - `/stats-refresh`
  - `/diag`
  - `/cache-status`
- commandes slash admin/modo:
  - `/announce-palworld`
- commandes slash publiques Palworld:
  - `/metrics-palworld`
- Muse auto-heberge avec persistance de donnees

## Prerequis

- Windows avec Docker Desktop installe
- Docker CLI present
- Docker Desktop demarre
- deux applications Discord:
  - un bot admin
  - un bot Muse
- optionnel pour Palworld REST:
  - `RESTAPIEnabled=True` cote serveur Palworld
  - API joignable depuis le conteneur du bot, idealement sur le LAN/VPN seulement
  - identifiants Basic Auth Palworld REST

Note locale importante: sur cette machine, la CLI Docker est presente, mais le daemon Docker Desktop n etait pas lance lors de la preparation. Le `first start` commence donc par le lancement de Docker Desktop.

## Creation Des 2 Bots Discord

### Bot Admin

- scope OAuth2: `bot` + `applications.commands`
- permissions minimales:
  - `Manage Guild`
  - `Manage Roles`
  - `Manage Channels`
  - `View Channels`
  - `Send Messages`
  - `Read Message History`
- intents:
  - `Server Members Intent`
  - `Presence Intent`

### Bot Muse

- scope OAuth2: `bot`
- permissions minimales:
  - `View Channels`
  - `Send Messages`
  - `Connect`
  - `Speak`
  - `Use Voice Activity`

## First Start

1. Demarrer Docker Desktop.
2. Verifier que `docker info` repond.
3. Remplir [C:\Projects\nether-beacon\.env](C:/Dev/nether-beacon/.env) avec:
   - `DISCORD_GUILD_ID`
   - `DISCORD_BOT_TOKEN`
   - `MUSE_DISCORD_TOKEN`
   - `MUSE_YOUTUBE_API_KEY`
   - `MUSE_SPOTIFY_CLIENT_ID`
   - `MUSE_SPOTIFY_CLIENT_SECRET`
   - `BOT_TIMEZONE=America/Toronto`
   - `BOT_UPTIME_KUMA_STATUS_PAGE_URL=https://uptime.mathieu.pro/status/palworld` si les alertes Uptime Kuma doivent tourner
   - `BOT_PALWORLD_REST_API_URL`, `BOT_PALWORLD_REST_API_USERNAME`, `BOT_PALWORLD_REST_API_PASSWORD` si les metrics, connexions/deconnexions et annonces en jeu doivent tourner
4. Verifier la config:
   - `npm run validate:config`
   - `npm run test`
   - `npm run capture:ids`
   - `docker compose config` seulement en terminal local prive, car la commande affiche les secrets resolus depuis `.env`
5. Construire et lancer:
   - `docker compose up -d --build`
6. Suivre les logs:
   - `docker compose logs -f`
7. Inviter Muse avec l URL affichee dans ses logs si le bot musique n est pas encore dans le serveur.

## Usage Quotidien

- `docker compose ps`
- `docker compose logs -f`
- `/status`
- `/audit`
- `/resync`
- `/welcome-preview`
- `/stats-refresh`
- `/diag`
- `/cache-status`
- `/metrics-palworld`
- `/announce-palworld` dans le salon Palworld, reserve admin/modo

Le bot ne supprime pas les canaux, roles ou permissions deja presents. En cas de doublon ou d ambiguite, il signale le conflit et s arrete sur ce point au lieu de deviner.
Le fichier `runtime/managed-ids.json` est le registre local des objets Discord deja reconnus. Il est alimente par `npm run capture:ids` et par les `resync` futurs. Si un salon gere est renomme manuellement, le bot peut encore le retrouver par ID et le corriger au lieu d en creer un nouveau.
Le salon `general` est ouvert en ecriture a `@everyone`. Le salon `arrivees-et-departs` est public en lecture dans `Communaute`, avec ecriture reservee a `Admin`.
La baseline serveur vise `MembersWithoutRoles` pour le filtre de contenu explicite et `Low` pour le niveau de verification.
Si un role `Admin` existe deja sans permission `Administrator`, le bot le signale en conflit et ne le promeut pas silencieusement.
Les horodatages exposes par le bot admin sont formates pour `America/Toronto`.
La categorie `Stats` est geree au runtime par le bot admin, reste visible pour tous, impossible a rejoindre pour les membres ordinaires, est repoussee a la fin des categories, et affiche des KPI joueurs dans des salons vocaux mis a jour toutes les 5 minutes.
Les evenements de presence et de vocal sont debounces par defaut pendant 15 secondes avant de rafraichir les Stats, afin d eviter des rafales d ecritures Discord. La commande `/stats-refresh` reste immediate.
Les commandes `/diag` et `/cache-status` sont ephemeres, reservees admin, et ne publient ni secrets ni contenu de fichiers.

## Alertes Palworld Via Uptime Kuma

Quand `BOT_UPTIME_KUMA_STATUS_PAGE_URL` pointe vers une page Uptime Kuma publiee, Alpha lit l API publique de cette page et annonce les changements dans le salon configure par `BOT_UPTIME_KUMA_STATUS_CHANNEL_NAME`.

- les transitions `actif`, `inactif` et `maintenance` sont annoncees seulement quand l etat change
- les maintenances et incidents publics Uptime Kuma sont annonces une fois par revision
- la fin d une maintenance ou d un incident est annoncee une fois quand l evenement disparait de la page publique
- si Uptime Kuma lui-meme est indisponible, la panne et le retour sont annonces seulement dans le salon securise des logs
- l etat anti-spam est conserve dans `runtime/uptime-kuma-status.json`

## Palworld Via API REST

Quand `BOT_PALWORLD_REST_API_URL`, `BOT_PALWORLD_REST_API_USERNAME` et `BOT_PALWORLD_REST_API_PASSWORD` sont renseignes, Alpha active les fonctions Palworld REST.

- `/metrics-palworld` lit `GET /metrics` et publie les derniers metrics dans Discord
- la commande est publique, visible par tous, mais limitee globalement par `BOT_PALWORLD_METRICS_COOLDOWN_MS` (4 minutes par defaut)
- Alpha lit `GET /players` selon `BOT_PALWORLD_PLAYER_POLL_INTERVAL_MS` et compare avec `runtime/palworld-players.json`
- le premier poll sert de baseline silencieuse, pour eviter de publier tous les joueurs presents au demarrage
- les entrees/sorties detectees ensuite sont publiees dans `BOT_PALWORLD_CHANNEL_NAME`
- les identifiants joueur sont hashes dans le fichier runtime; Discord ne recoit jamais les IP, player IDs, user IDs ou positions
- si l API Palworld ne repond plus, Alpha annonce la panne et le retour seulement dans le salon securise des logs
- apres une panne API, Alpha rebaseline les joueurs sans publier de faux depart ou fausse arrivee
- `/announce-palworld` doit etre utilisee dans le salon Palworld par un admin ou modo; elle publie le message dans Discord puis appelle `POST /announce` pour relayer en jeu

## Update

1. Lire les changements voulus dans le depot local.
2. Ajuster `config/server-plan.json` si la structure geree change.
3. Revalider:
   - `npm run validate:config`
   - `npm run test`
   - `docker compose config` seulement en terminal local prive, car la commande affiche les secrets resolus depuis `.env`
4. Capturer les IDs si la structure Discord a ete modifiee manuellement:
   - `npm run capture:ids`
5. Rebuild sans redemarrer le live:
   - `docker compose build`
6. Redemarrer seulement pendant une fenetre controlee:
   - `.\scripts\rebuild-restart.ps1`
7. Controler:
   - `docker compose logs --tail=200`
   - `/status`
   - `/audit`

## Tests Locaux

- `npm run validate:config`: valide le schema et la coherence du plan serveur
- `npm run test`: teste la capture des IDs et la detection de doublons probables
- `npm run capture:ids`: lit Discord via REST et met a jour `runtime/managed-ids.json` sans modifier le serveur

## Reglages Optionnels

Ces variables ont des valeurs par defaut dans `.env.example`:

- `BOT_STATS_EVENT_DEBOUNCE_MS=15000`: delai de regroupement des evenements presence/vocal avant refresh Stats
- `BOT_STATS_VOICE_REFRESH_INTERVAL_MS=300000`: intervalle minimal entre deux renommages des salons vocaux Stats
- `BOT_POKEAPI_CACHE_TTL_DAYS=30`: duree de validite des JSON PokéAPI
- `BOT_POKEAPI_MAX_ASSET_BYTES=5242880`: taille maximale d un asset Pokédex telecharge
- `BOT_UPTIME_KUMA_STATUS_PAGE_URL=`: active la surveillance d une page Uptime Kuma publiee, par exemple `https://uptime.mathieu.pro/status/palworld`
- `BOT_UPTIME_KUMA_STATUS_CHANNEL_NAME=🐾・palworld`: salon cible pour les annonces de statut Palworld
- `BOT_UPTIME_KUMA_POLL_INTERVAL_MS=60000`: frequence de lecture de l API publique de la page de statut
- `BOT_UPTIME_KUMA_FETCH_TIMEOUT_MS=10000`: delai maximal d appel HTTP vers Uptime Kuma
- `BOT_PALWORLD_CHANNEL_NAME=🐾・palworld`: salon cible pour les metrics, evenements joueurs et annonces Palworld REST
- `BOT_PALWORLD_REST_API_URL=`: URL de base de l API REST Palworld, par exemple `http://host.docker.internal:8212/v1/api` si l API ou le tunnel SSH est expose sur l hote Docker Desktop
- `BOT_PALWORLD_REST_API_USERNAME=`: utilisateur Basic Auth Palworld REST
- `BOT_PALWORLD_REST_API_PASSWORD=`: mot de passe Basic Auth Palworld REST
- `BOT_PALWORLD_REST_FETCH_TIMEOUT_MS=10000`: delai maximal d appel HTTP vers Palworld REST
- `BOT_PALWORLD_PLAYER_POLL_INTERVAL_MS=60000`: frequence de lecture de `GET /players`
- `BOT_PALWORLD_METRICS_COOLDOWN_MS=240000`: cooldown global de `/metrics-palworld`

## Build Sans Redemarrage

Quand le serveur est live, privilegier:

- `docker compose build`

Cette commande prepare l image mais ne remplace pas le conteneur actif. Les changements de code ne sont appliques qu au prochain `docker compose up -d` ou redemarrage du conteneur.

## Rebuild Avec Préavis Discord

Utiliser:

- `.\scripts\rebuild-restart.ps1`

Le script envoie d abord un message orange dans le canal logs admin, puis lance `docker compose up -d --build`. Au retour du bot, Alpha publie son message vert de démarrage.

## Maintenance

- verifier les logs Docker
- verifier le volume Docker `example-muse-data`
- verifier `C:\Projects\nether-beacon\runtime\admin-heartbeat.json` et `C:\Projects\nether-beacon\runtime\supervisor-state.json`
- verifier `C:\Projects\nether-beacon\runtime\managed-ids.json` apres gros changement manuel de structure
- verifier `C:\Projects\nether-beacon\runtime\uptime-kuma-status.json` si les annonces Palworld se repetent ou ne partent pas
- verifier `C:\Projects\nether-beacon\runtime\palworld-players.json` si les connexions/deconnexions Palworld semblent decalees
- `C:\Projects\nether-beacon\runtime\pokedex-cache` est un cache PokéAPI recréable pour les JSON, evolutions et images
- garder les tokens Discord valides
- relancer `/audit` apres tout gros changement manuel du serveur

## Depannage

- si `docker compose` ne repond pas: Docker Desktop n est pas demarre
- si `/status` n apparait pas: re-inviter le bot admin avec le scope `applications.commands`
- si Muse demarre mais ne joue rien:
  - verifier `MUSE_YOUTUBE_API_KEY`
  - verifier les permissions vocales
  - lire les logs Muse
- si le bot admin ne cree rien:
  - verifier `DISCORD_GUILD_ID`
  - verifier la hierarchie de roles du bot admin
  - verifier `Manage Guild`, `Manage Roles`, `Manage Channels`
- si le bot refuse de creer un salon avec un conflit probable:
  - verifier les noms proches sans accents ou avec emoji different
  - lancer `npm run capture:ids` si ce salon est bien celui qui doit etre gere
- si `/metrics-palworld` repond que REST est desactive:
  - verifier `BOT_PALWORLD_REST_API_URL`
  - verifier `BOT_PALWORLD_REST_API_USERNAME`
  - verifier `BOT_PALWORLD_REST_API_PASSWORD`
- si les connexions/deconnexions Palworld ne sortent pas:
  - verifier que l API Palworld est joignable depuis le conteneur
  - verifier que le salon configure par `BOT_PALWORLD_CHANNEL_NAME` existe
  - lire les logs securises pour les erreurs API

## Assets

Les images, icones et bannieres locales sont referencees dans [C:\Projects\nether-beacon\docs\ASSETS.md](C:/Dev/nether-beacon/docs/ASSETS.md).
Le bot ne les applique pas automatiquement en v1.

## Sauvegarde Et Restauration

- sauvegarde: exporter le volume Docker `example-muse-data`
- restauration: restaurer le volume Docker `example-muse-data` avant `docker compose up -d`

## Adresse Publique Et Cloudflare Tunnel

Aucune adresse publique n est necessaire en v1.

Raison:

- le bot admin fonctionne via la gateway Discord
- les slash commands sont gerees sans endpoint HTTP public
- Muse n expose pas d interface web necessaire au fonctionnement courant

Cloudflare Tunnel deviendrait utile seulement si tu ajoutes:

- un dashboard web
- une API d administration distante
- des webhooks entrants Discord ou tiers
