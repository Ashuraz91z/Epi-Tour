# Penthouse — Tour de contrôle

Le site **https://agent.ashuraz.xyz** : chacun entre avec son nom, reçoit un appartement, y relie ses agents
(Claude Code, Codex, Cursor, Grok Bot, Hermes, n8n), et tout le monde les voit travailler de pièce en pièce.
Les agents sont aussi les employés de l'étage : ils touchent un salaire selon l'abonnement de leur IA (voir « Économie »).

- `core.js` : traduit les événements des agents en sessions, quotas et compteurs.
- `gamify.js`, `wings.js`, `upgrades.js` : XP, missions du jour, badges, ailes privées et aménagement du bureau.
- `economy.js` : rôles, salaires, carrière, boutique, casino et primes entre résidents ; catalogue partagé avec l'interface dans `public/economy-data.js`.
- `penthouse.js` : appartements, entrée (nom + code), clés, API (voir plus bas).
- `db.js` / `server.js` : état dans SQLite (`$DATA_DIR/penthouse.db`, par défaut `~/.tour-de-controle/`), l'ancien `state.json` est repris une fois.
- `public/` : l'interface 3D (three.js) et `install.sh` (relie une machine à un appartement).
- `collecteurs/` : scripts installés sur les machines (lecteur de journaux, hooks Claude/Codex, Cursor, pont MCP Grok, sonde de quota Claude, relais n8n, hook Hermes).

```bash
npm test
PENTHOUSE_CODE=essai PORT=3007 npm start
```

Variables : `PENTHOUSE_CODE` (obligatoire), `PORT`, `DATA_DIR`, `TRUST_PROXY=0` si le serveur est exposé sans proxy
(la limite d'essais du code ne se fie alors plus à `X-Forwarded-For`).

### API

| Route | Accès | Rôle |
|---|---|---|
| `POST /e?src=…&host=…` | clé `X-Tour-Token` | événement d'un collecteur ; types vérifiés, objets libres bornés |
| `GET /api/state`, `GET /api/stream` | cookie résident ou spectateur | état complet (filtré pour les spectateurs), SSE toutes les 2 s |
| `POST /api/join`, `/api/key`, `/api/leave` | code / clé | entrée, renouvellement ou suppression de l'étage |
| `POST /api/profile`, `/api/game/{action,claim,visit}` | cookie + clé | profil, activités, missions, visites d'ailes |
| `POST /api/economy/{subscription,buy,casino,tip}` | cookie + clé | abonnements, boutique, casino, primes entre résidents |
| `POST /api/tv` | cookie résident | chaîne du Salon, ou lien perso YouTube/Twitch normalisé côté serveur |
| `GET /api/live`, `/api/connection`, `/spectateur` | — | directs Twitch, vérification de clé, lien spectateur |

Suivi du projet dans Obsidian, dossier `Tour de contrôle/`.

## Rejoindre et connecter ses outils

Entrer avec nom et code, puis copier la commande depuis « Relier mes agents ». Une commande par machine Mac/Linux : elle vérifie la clé, sauvegarde la configuration du relais, lit les sessions Claude/Codex de la dernière heure et les envoie immédiatement. Elle ne modifie plus les fichiers de configuration des outils et ne demande ni `/hooks` ni redémarrage.

`collecteurs/tour-sync` lit uniquement les métadonnées utiles des journaux : identifiant, état estimé d’après les événements, nom du projet, modèle et quota ChatGPT s’il existe. Il ne transmet ni conversation ni arguments/résultats des outils. Maximum 12 journaux récents par outil, 300 Ko par journal. Les relevés anciens ne remplacent pas les hooks plus récents. Aucun modèle n’est lancé. Les quotas Claude restent dépendants d’une sonde distincte ; les absences sont explicites.

`install-sync.py` active le suivi toutes les 15 s via launchd sur Mac, chaque minute via cron sur Linux. Le premier envoi est synchrone ; si la planification échoue, la commande le signale et échoue. Réinstallations idempotentes ; diagnostic via `python3 "$HOME/.config/tour/tour-check"`. Les tâches planifiées conservent la connexion après reconnexion à la session Mac ou redémarrage de cron. Windows natif non pris en charge.

La clé peut être réutilisée pour plusieurs machines et est vérifiée par `GET /api/connection`. Elle reste dans la session de l’onglet et dans `~/.config/tour/secret` (600). Remplacer la clé invalide les machines précédentes ; cette action reste séparée. Un relais différent n’est pas écrasé sans `--replace`. Sauvegardes privées : `~/.config/tour.backup-*`. Les hooks déjà installés restent compatibles et apportent les autorisations précises ; la lecture de journaux ne remplace pas cette précision.

Sur Mac, arrêt du suivi : `launchctl bootout gui/$(id -u)/xyz.ashuraz.penthouse.sync` puis retirer son fichier dans `~/Library/LaunchAgents/`. Linux : retirer uniquement la ligne marquée `# penthouse-log-sync` dans `crontab -e`.

Hermes/n8n se branchent sur leur serveur, avec les procédures du panneau ; ils ne sont pas installés automatiquement par cette commande. Conserver les ponts existants. Aucun outil réellement installé sur les machines de Lucas pendant les tests : HOME et planificateurs isolés.

## Mode spectateur

À l’entrée, « Regarder en spectateur », ou « Mode spectateur » depuis la tour : entrer **Penthouse**. Nom seul, sans code ni appartement créé. Le spectateur parcourt les résidents et les étages communs, voit les agents et leur état ; conversations, commandes, projets, modèles, machines et état des services sont filtrés côté serveur. Les pourcentages de quotas et dates de reset Claude/ChatGPT sont visibles en lecture seule. Cookie spectateur signé distinct du cookie résident ; `/api/tv`, les clés, les événements et la suppression restent protégés. « Quitter le mode spectateur » efface ce cookie. Revenir comme résident nécessite le code habituel. Une seule salle : le penthouse actuel.

### Présentation en boucle

Le mode spectateur démarre automatiquement : dashboard des quotas de tous les résidents (pages de 14 s, adaptées à l’écran), chaque étage pendant 12 s, panneau des agents pendant 10 s, puis panneau des usages assez longtemps pour parcourir chaque résident. Retour au dashboard à la fin. Caméra cadrée sur chaque panneau. Bouton Pause/Reprendre ; navigation manuelle pendant la pause. Les transitions caméra sont instantanées si le navigateur demande une réduction des animations. Les quotas absents ou expirés sont affichés explicitement, sans estimation.

## App Mac (Penthouse.dmg)

`python3 mac/build-dmg.py` fabrique `mac/Penthouse.dmg` (sur un Mac avec hdiutil ; ailleurs avec `pip install pycdlib`).
L'app relie le Mac au penthouse avec la clé de l'étage (comme « Relier mes agents »), fait cocher les outils trouvés sur ce
Mac (Claude, Claude Code et Codex dans le Terminal, ChatGPT, Cursor, Windsurf, Grok, le site du penthouse), puis les lance à
chaque ouverture de session et relance le suivi. Rouvrir l'app : lancer maintenant, changer les outils, vérifier la
connexion, arrêter le lancement automatique (`~/Library/LaunchAgents/xyz.ashuraz.penthouse.login.plist`).
L'app n'est pas signée par Apple : la première fois, clic droit > Ouvrir, ou Réglages Système > Confidentialité et
sécurité > « Ouvrir quand même ». Claude Code et Codex apparaissent dans la tour dès qu'ils travaillent ; Cursor et Grok
sont seulement ouverts (leur suivi passe par leurs ponts décrits dans « Relier mes agents »).

## Administration

Sur le serveur, avec le même `DATA_DIR` que `server.js` (le serveur peut tourner pendant ce temps) :

```bash
npm run admin -- list
npm run admin -- merge "Linnix" "Arthur"        # même personne, deux étages : tout est additionné dans Arthur
npm run admin -- rename "Paul-Arien" "Paul-Adrien"
npm run admin -- remove "Ancien" --oui
```

Une fusion additionne P$, XP, ancienneté des agents, journées, décor et sessions, garde le profil de l'étage de destination et
la position la plus ancienne dans la tour. La clé de l'étage fusionné continue de relier ses machines à l'étage gardé, jusqu'au
prochain « Remplacer la clé ». Un renommage garde la clé ; le résident rentre ensuite sur le site avec le nouveau nom.

## Économie

Chaque outil relié est un employé de l'étage. Tout est calculé par le serveur ; le client n'envoie que des intentions.

- **Rôle** : le rang de l'abonnement déclaré pour son IA (« 💼 Entreprise ») donne le grade — Stagiaire 15 P$/h, Junior 30,
  Confirmé·e 50, Senior 80, Lead 120, Directeur·rice 160 — et l'outil son métier (Claude/Codex : Ingé logiciel, Cursor :
  Dev studio, Hermes : Chercheur·se IA, Grok : Analyste, n8n : Automaticien·ne). La formule ChatGPT lue dans les journaux Codex
  (`plan_type`) remplace la déclaration et est marquée vérifiée. Monter en gamme : une fois toutes les 6 h ; descendre : libre.
- **Salaire** : temps entre deux événements d'une session au travail (10 min au plus par écart). 7 h normales, heures sup
  +25 % jusqu'à 10 h, puis repos obligatoire. Majorations nuit (22 h–6 h, Paris) +25 % et dimanche +50 %. Moral : baisse après
  2 h sans pause (jusqu'à −18 %). Gros modèles +15 %, petits −10 %. Primes de livraison (tour terminé) et de réactivité
  (accord donné en moins de 2 min), plafonnées par jour.
- **Carrière** : 10 échelons à l'ancienneté (+6 % chacun). Titre du résident selon le cumul gagné, d'Auto-entrepreneur·e à Empire.
- **Dépenses** : boutique (café premium, objectifs, formation, séminaire, assurance casino ; décor visible dans le bureau 3D),
  casino (machine à sous ~94 % de retour, roulette européenne, course de robots ; mises 10–500 P$, 2 000 P$ de pertes et
  200 parties par jour au plus), primes à un autre résident (1 000 P$ par jour).
- **Casino** (étage de Quentin) : en plus de la machine à sous, de la roulette et de la course, un blackjack joué par le serveur
  (sabot de 52 cartes par main, tirer / rester / doubler, blackjack × 2,5) et un **jackpot commun** à tout le penthouse,
  alimenté par 2 % des mises à la machine à sous et remporté au 7️⃣7️⃣7️⃣.
- **Tennis et Golf** : deux étages communs où les agents vont aussi en pause ; activités XP gratuites (échanges, tournoi,
  putting, neuf trous) et paris sportifs dans « Entreprise → Sport » (un set contre le pro du club, putts de 1 à 12 m).
- **Événement du jour**, commun à tous et tiré d'après la date : double paie, Black Friday, nuit blanche, jackpot progressif…
- Les missions du jour rapportent aussi des P$ ; la mission « Jour de paie » demande 100 P$ de salaires.
- Les spectateurs voient fortune, titre, paie du jour et rôles, jamais le relevé ni les abonnements.

Les P$ n'ont aucune valeur réelle. Ils viennent d'événements envoyés avec la clé de l'étage : c'est un jeu entre résidents
de confiance, pas une comptabilité.

## Performances

Ressources statiques conservées en mémoire avec gzip et ETag/revalidation 304 ; les réponses privées restent `no-store` et sont compressées au-delà de 1 Ko. SQLite lit tous les résidents en une fois ; les nettoyages nécessaires sont écrits avec comparaison de l’état original pour ne pas écraser une collecte concurrente.

Géométries simples partagées, ressources propres aux agents libérées à leur départ, rendu plafonné à 60 images/s et suspendu en onglet masqué, requêtes masquées ou déjà en cours évitées. Calcul des cartes spectateur à environ 1 Hz plutôt qu’à chaque image. Mesures Twitch concurrentes partagées par processus serveur. Résolution 3D conservée.

Le flux SSE calcule l'état une seule fois toutes les 2 s pour tous les onglets ouverts (résidents et spectateurs).

Benchmark reproductible, local et sans contact avec les comptes/outils réels : `node benchmark.mjs`. Maquette 20 résidents/600 sessions, 40 lectures après échauffement. Le 3 novembre 2026 : ancien chemin SQLite simulé 2,59 ms/requête, nouveau 1,40 ms ; JS 40 936 octets gzip ; état 3,3 Ko gzip. Le 4 novembre 2026, sur une autre machine (environ 5 fois plus lente sur l'ancien chemin), avec la gamification et l'économie : 14,1 ms contre 11,5 ms ; état 8,4 Ko gzip ; app.js 60 Ko gzip (plus economy-ui.js, chargé à part). Mesures locales indicatives, pas une mesure des FPS sur les appareils des utilisateurs.

## Grok Bot

Support du produit Grok Bot (ordinateur cloud), distinct de Grok Build CLI. Dans « Relier mes agents → Grok Bot », copier les instructions pour installer le pont MCP stdio `grok-mcp.py` et `tour_http.py` sur son ordinateur cloud, sous `/workspace/penthouse/`. Config privée `grok-connection.json` (600), clé saisie via le mécanisme sécurisé de Grok Bot, jamais dans le chat ni dans la commande MCP. Commande MCP : `python3 /workspace/penthouse/grok-mcp.py`. Python 3 et curl requis.

Outil `penthouse_status` : bot, session, state (`working`, `idle`, `approval`, `error`, `finished`), nom court de projet facultatif. L’identité bot+tâche conserve le même robot. Le Bot doit appeler cet outil ; ce pont ne surveille ni les conversations cloud ni automatiquement tous les tours. Pas de quota Grok collecté. Activation réelle à tester dans le compte de l’utilisateur ; seuls protocole et transmission au serveur ont été vérifiés en tests isolés.

Sources : https://docs.x.ai/grok-bot/overview ; https://docs.x.ai/grok-bot/computer-and-apps ; https://docs.x.ai/grok-bot/skills-routines-and-automations ; protocole MCP stdio et tools 2025-06-18 sur modelcontextprotocol.io.
