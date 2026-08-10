# Operations

## Objectif

Ce projet fournit une pile Docker Desktop exploitable en continu pour:

- un bot admin Discord dedie a l audit, la creation non destructive des ressources et la convergence stricte des permissions gerees
- un bot Muse dedie a la musique
- deux services Docker Compose isoles par environnement de secrets

Nom du stack: `NetherBeacon`

## Architecture

- image base: `ghcr.io/museofficial/muse:2.11.5`
- bot admin: `bot.js`
- lanceur Muse isole: `muse-runner.js`
- healthchecks separes: `healthcheck.js` et `muse-healthcheck.js`
- config declarative serveur: `config/server-plan.json`
- dossier d exploitation unique: `C:\Projects\nether-beacon`
- volume persistant musique: `example-muse-data:/data` (nom historique conserve pour ne pas detacher les donnees existantes)
- volume runtime local: `C:\Projects\nether-beacon\runtime:/bot/runtime`
- volume d etat inter-service sans secret: `peer-state` (lecture seule dans Alpha)
- depot de production: `/srv/example/discord-bot/app`
- coffre de production DockPanel: `nether-beacon-production`
- lanceur de production root-only: `/usr/local/sbin/nether-beacon-deploy`

## Fonctions Et Possibilites

- audit non destructif du serveur cible
- creation non destructive des roles, categories et salons geres
- convergence exacte des permissions des roles et des overwrites de salons geres
- detection et signalement des conflits de nommage
- registre runtime `runtime/managed-ids.json` obligatoire pour toute decision d autorisation; un ID perime ou un nom duplique bloque la reconciliation
- anti-duplication renforcee: noms exacts, anciens noms et noms probablement equivalents sont detectes avant creation
- protection contre l ajout silencieux de `Administrator` a un role `Admin` existant
- categorie `Stats` dynamique, visible par tous, vocale, verrouillee, poussee en fin de liste, et rafraichie toutes les 5 minutes
- logs arrivees/departs
- attribution automatique du role `Noob Spawn` aux nouveaux membres humains
- message d accueil tague dans `general` pour les nouveaux membres humains
- salon public `invitations` pour les codes de lobby, realms et invitations en jeu
- salons publics dedies a Palworld et Pokémon GO dans `Communaute`
- commandes Pokédex publiques avec noms Pokémon en anglais:
  - `/pokemon`
  - `/weakness`
  - `/move`
  - `/ability`
  - `/type`
  - `/random-pokemon`
- `/pokemon` et `/random-pokemon` retournent une fiche enrichie avec artwork/sprite valide et mis en cache sous quotas, types, abilities, stats, species, labels, egg groups et evolution quand disponible
- commande publique `/metrics-palworld` via les JSON publics filtres Gaylemon, avec cooldown global de 4 minutes
- commande staff `/announce-palworld` pour publier une annonce dans Discord et la relayer en jeu via `POST /announce`
- aucune publication automatique du resume Gaylemon dans Discord; le recap reste disponible sur le site
- commande publique `/resume-hier` dans le salon Palworld
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
  - `/resume-hier`
- Muse auto-heberge avec persistance de donnees

## Profils De Commandes

Le profil de production est `BOT_PROFILE=full`. Il enregistre les 17 commandes:

- `/status`: admin seulement
- `/metrics-palworld`: public, cooldown global de quatre minutes
- `/resume-hier`: public, cooldown par utilisateur et salon Palworld autorise
- `/pokemon`, `/weakness`, `/move`, `/ability`, `/type`, `/random-pokemon`: public, cooldown par utilisateur, cooldown global et plafond de concurrence
- `/audit`, `/resync`, `/help`, `/welcome-preview`, `/stats-refresh`, `/diag`, `/cache-status`: admin seulement
- `/announce-palworld`: admin/modo, salon autorise et cooldown global

Le profil `pokemon` conserve les neuf commandes publiques/admin ci-dessus sans les huit commandes d'administration et de staff. Le profil `minimal` retire aussi les six commandes Pokédex et conserve seulement `/status`, `/metrics-palworld` et `/resume-hier`.

Le profil `full` active aussi la reconciliation geree au demarrage, les Stats et les listeners membres/vocal/presence. Les ressources manquantes sont creees sans supprimer de roles ou salons; les permissions des ressources gerees sont strictement ramenees au plan. Les commandes absentes d'un profil reduit sont refusees par le runtime et ne sont pas enregistrees dans Discord.

Verification du catalogue:

- `npm test`: noms exacts, profils, classification public/staff/admin, permissions Discord, cooldowns et garde-fous
- `npm run verify:pokedex`: vrai appel PokéAPI des six commandes et des cinq autocompletions, sans connexion Discord
- sur la VPS: `sudo docker exec nether-beacon npm run verify:pokedex`

`/resync` peut creer des ressources et retirer des permissions ou overwrites non declares sur les ressources gerees. `/announce-palworld` publie un vrai message Discord/Palworld. Ces deux commandes ne font jamais partie d'un test automatique de production.

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

## Production VPS Et DockPanel

### Stockage Des Secrets

- coffre: `nether-beacon-production`
- proprietaire: compte administrateur DockPanel
- valeurs chiffrees et masquees dans DockPanel
- aucun `.env` persistant sous `/srv/example/discord-bot/app`
- lanceur `/usr/local/sbin/nether-beacon-deploy` en `0700 root:root`
- runtime `/srv/example/discord-bot/app/runtime` en `0700 root:root`

DockPanel `2.85.0` injecte nativement les secrets vers les sites, mais pas vers les apps Compose. Le lanceur comble cette limite sans fichier temporaire: il cree une session locale de cinq minutes en memoire, lit uniquement le coffre proprietaire, refuse toute cle hors liste blanche, construit un environnement minimal, fixe le socket Docker local et `/usr/bin/docker`, puis attend les deux healthchecks.

Le compte root et les administrateurs Docker peuvent inspecter l'environnement d'un conteneur. Le coffre protege donc le stockage au repos et l'acces DockPanel; il ne remplace pas la frontiere de confiance root/Docker.

### Deploiement

1. Valider et pousser les changements depuis le poste local.
2. Sur la VPS, mettre `/srv/example/discord-bot/app` a jour avec un fast-forward Git.
3. Verifier le coffre sans redemarrer:
   - `sudo /usr/local/sbin/nether-beacon-deploy --check`
4. Deployer:
   - `sudo /usr/local/sbin/nether-beacon-deploy`
5. Controler:
   - `sudo docker inspect --format '{{.State.Status}}|{{.State.Health.Status}}|{{.RestartCount}}' nether-beacon nether-beacon-muse`
   - `sudo docker stats --no-stream nether-beacon nether-beacon-muse`
   - `sudo docker logs --tail=200 nether-beacon`
   - `sudo docker logs --tail=200 nether-beacon-muse`

Ne jamais lancer `docker compose up` directement sur la VPS: la commande contournerait la source de configuration DockPanel. Ne jamais recreer un `.env` de production dans le depot.

### Rotation D'un Secret

1. Modifier la valeur dans le coffre DockPanel `nether-beacon-production`.
2. Lancer `sudo /usr/local/sbin/nether-beacon-deploy --check`.
3. Lancer `sudo /usr/local/sbin/nether-beacon-deploy`.
4. Verifier `healthy`, `0` redemarrage et les logs.
5. Revoquer l'ancienne valeur chez le fournisseur lorsque la nouvelle connexion est confirmee.

Une modification du coffre ne redemarre pas automatiquement le conteneur sous DockPanel `2.85.0`.

### Limites Runtime De Production

- memoire: `512 MiB` par service
- CPU: `1` par service
- aucun port hote publie
- `cap_drop: ALL`
- `no-new-privileges:true`
- `/tmp` en `tmpfs`
- volume Muse persistant `example-muse-data`
- profil de commandes `full`

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
  - `BOT_PALWORLD_REST_API_URL`, `BOT_PALWORLD_REST_API_USERNAME`, `BOT_PALWORLD_REST_API_PASSWORD` seulement si les annonces staff doivent etre relayees en jeu
4. Verifier la config:
   - `npm run validate:config`
   - `npm run test`
   - `npm run verify:pokedex` pour valider les appels PokéAPI en direct
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
- `/resume-hier` dans le salon Palworld
- `/announce-palworld` dans le salon Palworld, reserve admin/modo

Le bot ne supprime pas les canaux, roles ou permissions deja presents. En cas de doublon ou d ambiguite, il signale le conflit et s arrete sur ce point au lieu de deviner.
Le fichier `runtime/managed-ids.json` est le registre local des objets Discord deja reconnus. Il est alimente par `npm run capture:ids` et par les `resync` futurs. Si un salon gere est renomme manuellement, le bot peut encore le retrouver par ID et le corriger au lieu d en creer un nouveau.
Le salon `general` est ouvert en ecriture a `@everyone`. Les salons `palworld` et `pokemon-go` sont publics pour les conversations de communaute. Le salon `arrivees-et-departs` est public en lecture dans `Communaute`, avec ecriture reservee a `Admin`.
La baseline serveur vise `MembersWithoutRoles` pour le filtre de contenu explicite et `Low` pour le niveau de verification.
Si un role `Admin` existe deja sans permission `Administrator`, le bot le signale en conflit et ne le promeut pas silencieusement.
Les horodatages exposes par le bot admin sont formates pour `America/Toronto`.
La categorie `Stats` est geree au runtime par le bot admin, reste visible pour tous, impossible a rejoindre pour les membres ordinaires, est repoussee a la fin des categories, et affiche des KPI joueurs dans des salons vocaux mis a jour toutes les 5 minutes.
Les evenements de presence et de vocal sont debounces par defaut pendant 15 secondes avant de rafraichir les Stats, afin d eviter des rafales d ecritures Discord. La commande `/stats-refresh` reste immediate.
Les commandes `/diag` et `/cache-status` sont ephemeres, reservees admin, et ne publient ni secrets ni contenu de fichiers.

## Palworld Public Et API REST Admin

La commande publique `/metrics-palworld` lit les JSON filtres du microsite Gaylemon:

- `https://gaylemon.mathieu.pro/data/public-availability.json`
- `https://gaylemon.mathieu.pro/data/public-metrics.json`

Elle ne depend pas de l API REST admin locale. Elle affiche seulement les noms publics valides deja exposes par ces JSON, jamais `accountName`, `playerId`, `userId`, Steam ID, IP, coordonnees ou chemin systeme.

Quand `BOT_PALWORLD_REST_API_URL`, `BOT_PALWORLD_REST_API_USERNAME` et `BOT_PALWORLD_REST_API_PASSWORD` sont renseignes, Alpha active uniquement les actions staff Palworld REST.

- `/announce-palworld` doit etre utilisee dans un salon autorise par un admin ou modo; elle publie le message dans Discord puis appelle `POST /announce` pour relayer en jeu
- les appels admin REST ont un timeout court, un retry unique sur erreur reseau transitoire, un circuit breaker court et un cooldown global
- si le tunnel local est ferme, la commande echoue proprement sans detail technique dans Discord
- Alpha n effectue aucune surveillance automatique de l API REST admin

## Resume Quotidien Gaylemon

Alpha ne publie plus le resume quotidien automatiquement. Les membres peuvent consulter directement le site Gaylemon ou utiliser `/resume-hier` pour obtenir, a la demande, le lien de la veille:

```text
https://gaylemon.mathieu.pro/resume?jour=YYYY-MM-DD
```

Comportement:

- aucune notification Discord planifiee
- fuseau utilise pour calculer la veille: `America/Toronto`
- commande publique: `/resume-hier`
- salon autorise pour la commande: `🐾・palworld`

Variables:

- `GAYLEMON_PUBLIC_BASE_URL=https://gaylemon.mathieu.pro`
- `GAYLEMON_DAILY_SUMMARY_TIME_ZONE=America/Toronto`
- `GAYLEMON_DAILY_SUMMARY_FETCH_TIMEOUT_MS=5000`
- `GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_NAMES=🐾・palworld`
- `GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS=` est preferable si les noms deviennent ambigus.

Lors de l utilisation de `/resume-hier`, le bot sonde `/resume?jour=...` et `data/public-events-index.json` avant de repondre. Le message public reste volontairement court: titre, phrase de recap et lien direct.

## Update

Cette section concerne le poste Windows local. Pour la VPS, utiliser exclusivement la procedure DockPanel ci-dessus.

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
- `npm run test`: teste aussi les 17 commandes, leurs profils, permissions, cooldowns et integrations isolees
- `npm run verify:pokedex`: teste en direct les six commandes Pokédex et les cinq autocompletions
- `npm run capture:ids`: lit Discord via REST et met a jour `runtime/managed-ids.json` sans modifier le serveur

## Reglages Optionnels

Ces variables ont des valeurs par defaut dans `.env.example`:

- `BOT_STATS_EVENT_DEBOUNCE_MS=15000`: delai de regroupement des evenements presence/vocal avant refresh Stats
- `BOT_STATS_VOICE_REFRESH_INTERVAL_MS=300000`: intervalle minimal entre deux renommages des salons vocaux Stats
- `BOT_POKEAPI_CACHE_TTL_DAYS=30`: duree de validite des JSON PokéAPI
- `BOT_POKEAPI_MAX_ASSET_BYTES=5242880`: taille maximale d un asset Pokédex telecharge
- `BOT_PALWORLD_CHANNEL_NAME=🐾・palworld`: salon cible pour les metrics publics et annonces Palworld
- `BOT_PALWORLD_PUBLIC_FETCH_TIMEOUT_MS=5000`: delai maximal de lecture des JSON publics Gaylemon
- `BOT_PALWORLD_PUBLIC_CACHE_TTL_MS=15000`: cache court des JSON publics status/joueurs
- `BOT_PALWORLD_REST_API_URL=`: URL de base de l API REST admin Palworld, par exemple `http://127.0.0.1:8212/v1/api` ou une URL de tunnel local exposee au conteneur
- `BOT_PALWORLD_REST_API_USERNAME=`: utilisateur Basic Auth Palworld REST
- `BOT_PALWORLD_REST_API_PASSWORD=`: mot de passe Basic Auth Palworld REST
- `BOT_PALWORLD_REST_FETCH_TIMEOUT_MS=5000`: delai maximal d appel HTTP vers Palworld REST admin
- `BOT_PALWORLD_REST_CIRCUIT_BREAKER_MS=30000`: pause courte apres panne de l API REST admin
- `BOT_PALWORLD_METRICS_COOLDOWN_MS=240000`: cooldown global de `/metrics-palworld`
- `BOT_PALWORLD_ADMIN_COOLDOWN_MS=30000`: cooldown global des commandes admin Palworld
- `BOT_PALWORLD_ADMIN_CHANNEL_NAMES=🐾・palworld`: salons autorises pour les commandes admin Palworld
- `GAYLEMON_PUBLIC_BASE_URL=https://gaylemon.mathieu.pro`: base publique du microsite Gaylemon
- `GAYLEMON_DAILY_SUMMARY_TIME_ZONE=America/Toronto`: fuseau du calcul de la veille pour `/resume-hier`
- `GAYLEMON_DAILY_SUMMARY_FETCH_TIMEOUT_MS=5000`: delai maximal de verification du recap demande
- `GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_NAMES=🐾・palworld`: salons autorises pour `/resume-hier`

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
- verifier `C:\Projects\nether-beacon\runtime\admin-heartbeat.json` et les deux healthchecks Compose
- verifier `C:\Projects\nether-beacon\runtime\managed-ids.json` apres gros changement manuel de structure
- `C:\Projects\nether-beacon\runtime\pokedex-cache` est un cache PokéAPI recreable, borne et evince par anciennete pour les JSON, evolutions et images
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
- si `/metrics-palworld` est indisponible:
  - verifier `GAYLEMON_PUBLIC_BASE_URL`
  - verifier l acces a `/data/public-availability.json`
  - verifier l acces a `/data/public-metrics.json`
- si `/announce-palworld` echoue:
  - verifier le tunnel local vers l API REST admin
  - verifier `BOT_PALWORLD_REST_API_URL`
  - verifier `BOT_PALWORLD_REST_API_USERNAME`
  - verifier que le mot de passe REST est configure localement
- si une commande Pokédex echoue:
  - confirmer que le profil Discord actif est `pokemon` ou `full`; en `minimal`, elle est volontairement absente
  - lancer `npm run verify:pokedex` pour separer un probleme PokéAPI d'un probleme Discord
  - verifier les droits d'ecriture de `runtime/pokedex-cache`
- si le deploiement VPS ne voit pas une nouvelle valeur DockPanel:
  - lancer `sudo /usr/local/sbin/nether-beacon-deploy --check`
  - verifier que la valeur est dans `nether-beacon-production`
  - redeployer explicitement; l'injection Compose n'est pas automatique

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
