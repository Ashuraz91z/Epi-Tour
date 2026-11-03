# Penthouse — Tour de contrôle

Le site **https://agent.ashuraz.xyz** : chacun entre avec son nom, reçoit un appartement, y relie ses agents
(Claude Code, Codex, Hermes, n8n), et tout le monde les voit travailler de pièce en pièce.

- `core.js` : traduit les événements des agents en sessions, quotas et compteurs.
- `penthouse.js` : appartements, entrée (nom + code), clés, API (`POST /e`, `GET /api/state`, `POST /api/join`, `POST /api/key`).
- `server.js` : démarrage et sauvegarde (`~/.tour-de-controle/state.json`).
- `public/` : l'interface et `install.sh` (relie une machine à un appartement).
- `collecteurs/` : scripts installés sur les machines (hooks Claude/Codex, sonde de quota Claude, relais n8n, hook Hermes).

```bash
npm test
PENTHOUSE_CODE=essai PORT=3007 npm start
```

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

## Performances

Ressources statiques conservées en mémoire avec gzip et ETag/revalidation 304 ; les réponses privées restent `no-store` et sont compressées au-delà de 1 Ko. SQLite lit tous les résidents en une fois ; les nettoyages nécessaires sont écrits avec comparaison de l’état original pour ne pas écraser une collecte concurrente.

Géométries simples partagées, ressources propres aux agents libérées à leur départ, rendu plafonné à 60 images/s et suspendu en onglet masqué, requêtes masquées ou déjà en cours évitées. Calcul des cartes spectateur à environ 1 Hz plutôt qu’à chaque image. Mesures Twitch concurrentes partagées par processus serveur. Résolution 3D conservée.

Benchmark reproductible, local et sans contact avec les comptes/outils réels : `node benchmark.mjs`. Maquette 20 résidents/600 sessions, 40 lectures après échauffement : ancien chemin SQLite simulé 2,59 ms/requête, nouveau 1,40 ms sur une exécution du 3 novembre 2026. JS 122 429 → 40 936 octets gzip ; état synthétique ~178 Ko → 3,3 Ko gzip. Mesures locales indicatives, pas une mesure des FPS sur les appareils des utilisateurs.

## Grok Bot

Support du produit Grok Bot (ordinateur cloud), distinct de Grok Build CLI. Dans « Relier mes agents → Grok Bot », copier les instructions pour installer le pont MCP stdio `grok-mcp.py` et `tour_http.py` sur son ordinateur cloud, sous `/workspace/penthouse/`. Config privée `grok-connection.json` (600), clé saisie via le mécanisme sécurisé de Grok Bot, jamais dans le chat ni dans la commande MCP. Commande MCP : `python3 /workspace/penthouse/grok-mcp.py`. Python 3 et curl requis.

Outil `penthouse_status` : bot, session, state (`working`, `idle`, `approval`, `error`, `finished`), nom court de projet facultatif. L’identité bot+tâche conserve le même robot. Le Bot doit appeler cet outil ; ce pont ne surveille ni les conversations cloud ni automatiquement tous les tours. Pas de quota Grok collecté. Activation réelle à tester dans le compte de l’utilisateur ; seuls protocole et transmission au serveur ont été vérifiés en tests isolés.

Sources : https://docs.x.ai/grok-bot/overview ; https://docs.x.ai/grok-bot/computer-and-apps ; https://docs.x.ai/grok-bot/skills-routines-and-automations ; protocole MCP stdio et tools 2025-06-18 sur modelcontextprotocol.io.
