# Journal commun

Chaque IA ajoute **en haut** une entrée par session de travail (modèle et règles dans `AGENTS.md`, section 3).
Le plus récent d'abord. On n'efface pas les entrées des autres.

## 2026-11-05 · Lucas · branche Lucas · Claude Code (11)
**Fait :** vue spectateur enrichie : tableau « La journée de chacun » (faits du jour en pastilles ; par résident : états des
agents, journée compacte, quotas), fiche de l'étage visité, barre de progression dans la légende, bulles et fil « En direct »
lisibles malgré le filtrage. Zoom vers la souris (`controls.zoomToCursor`) : le suivi d'étage décale cible et caméra au lieu
de ramener la cible au centre, et la cible reste dans l'emprise de l'étage.
**Fichiers :** `public/tour/navigation.js` (`updateSpectatorView`, `floorCardHtml`), `public/ui/insights.js` (`dayFacts`,
`dayFactsChipsHtml`, `dayStripHtml`), `public/tour/animate.js` (`followY`), `public/tour/engine.js`, `public/tour/tower.js`,
`public/ui/panel.js`, `public/index.html`, `public/style.css`.
**À savoir :** taille des pages du tableau spectateur : `(innerHeight - 410) / 140` dans `animateCamera`.
**Reste à faire :** —

## 2026-11-05 · Lucas · branche Lucas · Claude Code (10)
**Fait :** stats des résidents. Relevé du jour par étage (`store.daily`, `insightsOf`) : demandes, agents distincts,
actions, heures (Paris), outils, modèles, projets, pic en parallèle, début et fin. Carte « 📊 Ta journée / Sa journée »
dans le panneau, « Faits du jour » dans le classement. Le lecteur de journaux envoie aussi `prompts` et `tools` (compteurs).
**Fichiers :** `core.js` (`recordDay`, `insightsOf`), `penthouse.js` (spectateurs), `collecteurs/tour-sync`
(`count_activity`), `public/ui/insights.js` (nouveau), `public/ui/panel.js`, `public/style.css`, `test.js`, `README.md`.
**À savoir :** les machines reliées avant ce changement n'envoient pas encore le nombre de demandes ni d'outils par leurs
relevés (seuls les hooks le font) : relancer la commande de l'étage. Format d'heure : `Intl` en fr-FR écrit « 10 h », d'où
`en-GB` pour lire l'heure.
**Reste à faire :** —

## 2026-11-05 · Lucas · branche Lucas · Claude Code (9)
**Fait :** les sessions Claude Code sur le web (cloud) apparaissent sur l'étage, machine « cloud ». Hook
`collecteurs/tour-cloud-hook`, installé par `public/cloud-setup.sh` (setup script de l'environnement cloud) ; la clé vient
de la variable `PENTHOUSE_KEY` de l'environnement. Marche à suivre dans « Relier mes agents › ☁️ Claude Code sur le web ».
**Fichiers :** `collecteurs/tour-cloud-hook`, `public/cloud-setup.sh`, `penthouse.js` (`FILES`), `public/ui/panel.js`,
`public/style.css`, `test.js`, `README.md`.
**À savoir :** le domaine du site doit être autorisé dans l'accès réseau de l'environnement (bloqué par défaut). Le script de
démarrage ne lit pas les variables : seul le hook le fait. Les tests qui lancent des scripts contre le serveur de test doivent
utiliser `spawn` asynchrone (le serveur tourne dans le même processus ; `spawnSync` le bloque).
**Reste à faire :** Lucas configure son environnement cloud (réseau, variable, setup script).

## 2026-11-05 · Lucas · branche Lucas · Claude Code (8)
**Fait :** quota Claude de Lucas reçu. Cause du « sans quota » : ses sessions tournaient dans l'app Claude (journaux sous
`~/.claude/projects/-Users-…-Library-Application-Support-Claude-scratch-workspaces-…`), qui a sa propre connexion ; la
commande `claude` du Terminal, celle que lance la sonde, n'était pas connectée à l'abonnement. `claude` puis `/login` a suffi.
Texte du panneau et README précisés pour ce cas.
**Fichiers :** `public/tour/base.js` (`claudeQuotaWhy`), `README.md`.
**À savoir :** les sessions de l'app Claude sont bien suivies (mêmes journaux) ; seul le quota passe par la commande `claude`.
**Reste à faire :** —

## 2026-11-05 · Lucas · branche Lucas · Claude Code (7)
**Fait :** toujours « sans quota » chez Lucas avec `get_usage`. D'après le code de Claude Code 2.1, les quotas ne sont
lus que si la connexion est l'abonnement claude.ai (pas de clé d'API, pas d'`apiKeyHelper`) et si le jeton a le scope
`user:profile` (un jeton `claude setup-token` ne l'a pas). La sonde précise maintenant la cause probable (abonnement
indiqué, clé d'API ou jeton setup-token présents dans l'environnement, jamais leur valeur) et le chemin de `claude`.
**Fichiers :** `collecteurs/tour-sync` (`usage_answer`, `claude_quota`), `public/tour/base.js` (`claudeQuotaWhy`), `test.js`.
**À savoir :** si `/usage` dans Claude Code n'affiche pas les limites de l'abonnement, la sonde ne peut pas les lire non plus.
**Reste à faire :** diagnostic de Lucas (chemin de claude, connexion) en cours.

## 2026-11-05 · Lucas · branche Lucas · Claude Code (6)
**Fait :** chez Lucas, la mini-requête ne donnait aucun quota (« sans quota ») : Claude Code n'émet `rate_limit_event`
que quand le statut change. La sonde lit maintenant les données `/usage` de Claude Code via la requête de contrôle
`get_usage` (`--input-format stream-json`), sans requête au modèle : rien n'est consommé, réponse en ~1 s. L'ancienne
méthode reste en repli. Texte du diagnostic (`tour-check`) corrigé.
**Fichiers :** `collecteurs/tour-sync` (`ask_usage`, `usage_answer`, `claude_quota`), `collecteurs/tour-check`,
`public/tour/base.js`, `public/ui/panel.js`, `test.js`, `README.md`.
**À savoir :** `get_usage` est marquée « experimental, the response shape may change » dans Claude Code 2.1.x ; la forme
attendue est `response.rate_limits.{five_hour,seven_day}.{utilization 0–100, resets_at ISO}` et `rate_limits_available`.
Vérifié contre le vrai binaire (non connecté : `rate_limits_available: false`), pas encore avec un abonnement.
**Reste à faire :** Lucas relance la commande de l'étage et vérifie que les jauges Claude apparaissent.

## 2026-11-05 · Lucas · branche Lucas · Claude Code (5)
**Fait :** quota Claude toujours « non suivi » chez Lucas. Sonde plus robuste : `claude` cherché aussi dans nvm, npm global,
bun, volta et pnpm, lancé avec son dossier dans le PATH (cron et launchd ont un PATH réduit) ; réponse lue sous ses deux
formes (`unifiedWindows` groupé, ou un `rateLimitType` par événement). Chaque essai remonte son résultat au site, et le
panneau du résident dit pourquoi le quota manque (commande pas relancée, Claude Code introuvable, désactivé, erreur…).
**Fichiers :** `collecteurs/tour-sync` (`claude_binary`, `quota_windows`, `claude_quota`), `public/tour/base.js`
(`claudeQuotaWhy`), `public/ui/panel.js`, `test.js`.
**À savoir :** format exact de `rate_limit_event` non vérifié avec un vrai compte (pas de compte Claude dans
l'environnement de test) ; si le panneau affiche « format : … », ce sont les noms des champs reçus, à adapter dans
`quota_windows`.
**Reste à faire :** Lucas relance la commande de son étage et lit la raison affichée si le quota n'arrive pas.

## 2026-11-05 · Lucas · branche Lucas · Claude Code (4)
**Fait :** deux modes, choisis dans le menu « ⋯ » et gardés sur l'appareil : complet (tout) et productif (gamification
masquée : XP, P$, missions, Entreprise, activités, paliers, rôles et salaires, Fortune, toasts, célébrations ; étages Casino,
Tennis et Golf retirés de la liste, du clavier et de la visite ; « Travail du jour » réduit au temps, aux tâches et aux agents).
**Fichiers :** `public/tour/mode.js` (nouveau), `public/ui/panel.js`, `public/tour/navigation.js` (`stepFocus`,
`keepFocusShown`), `public/tour/animate.js`, `public/tour/tower.js`, `public/tour/work-fx.js`, `public/work-ui.js`,
`public/index.html`, `public/style.css`, `test.js`.
**À savoir :** rien n'est supprimé côté serveur. Tout nouvel élément de jeu doit tester `productive()` (règle ajoutée dans
`AGENTS.md`) ; un nouvel étage de jeu va dans `GAME_FLOORS`. Changer d'étage au clavier passe par `stepFocus()`.
**Reste à faire :** —

## 2026-11-05 · Lucas · branche Lucas · Claude Code (3)
**Fait :** « Relier mes agents » demande si la machine a déjà été reliée (autre clé ou autre étage) ; « oui » ajoute
`--replace` (Windows : `-Replace`) à la commande, avec sauvegarde de l'ancienne configuration.
**Fichiers :** `public/ui/panel.js` (`installCommands`), `public/style.css`, `test.js` (refus sans `--replace`, puis remplacement).
**À savoir :** les options de la commande se combinent dans n'importe quel ordre après la clé ; une option inconnue est refusée.
**Reste à faire :** —

## 2026-11-05 · Lucas · branche Lucas · Claude Code (2)
**Fait :** quota Claude mesuré automatiquement par `tour-sync` (mini-requête Haiku au plus toutes les 15 min, seulement si
Claude Code a servi) : plus rien à installer à part la commande de l'étage. Sans mesure, les écrans d'usages (panneau
des quotas, dashboard spectateur, panneau latéral) disent « Claude · quota non suivi ». Option « Partager le texte de mes
demandes » dans « Relier mes agents » (`--partager-demandes` / `-PartagerDemandes`, arrêt : `--sans-demandes`).
**Fichiers :** `collecteurs/tour-sync`, `public/install.sh`, `public/install.ps1`, `core.js` (`prompt` des relevés),
`public/ui/panel.js`, `public/tour/city.js`, `public/tour/navigation.js`, `public/tour/base.js` (`claudeTracked`).
**À savoir :** le partage est un fichier `~/.config/tour/partage-demandes` par machine ; les apps Mac/Windows relancent la
commande sans option, donc gardent le choix. Les tests utilisent un faux `claude` dans le PATH : ne jamais laisser un test
lancer `tour-sync` avec des journaux Claude récents sans ce faux binaire (sinon il appelle le vrai Claude Code).
**Reste à faire :** chaque résident doit relancer une fois la commande de son étage (cocher la case s'il veut partager).

## 2026-11-05 · Lucas · branche Lucas · Claude Code
**Fait :** `public/app.js` (6 000 lignes) découpé en modules : `public/tour/` (moteur, ville, robots, tour, animation,
navigation), `public/tour/floors/` (un fichier par étage ou ambiance) et `public/ui/` (panneau, studio, session).
Le code n'a pas changé : mêmes lignes, avec les imports et exports en plus. Ajout de `AGENTS.md` (consignes), `CLAUDE.md`
et de ce journal.
**Fichiers :** `public/app.js`, `public/tour/**`, `public/ui/**`, `penthouse.js` (sert tout `tour/` et `ui/`, et la page
annonce ses modules en `modulepreload` pour qu'ils arrivent en parallèle), `test.js`, `benchmark.mjs` (compte tous les modules).
**À savoir :** l'état partagé modifiable est dans `world` (`public/tour/state.js`) : `world.data`, `world.focus`,
`world.order`… Les tests qui lisent le code du client passent par `clientSource()` (tous les modules bout à bout).
Une branche qui modifie encore l'ancien `app.js` (par exemple `Hugo`) aura des conflits : il faut reporter ses
changements dans le module concerné, par exemple un étage dans `public/tour/floors/`.
**Reste à faire :** —

## 2026-11-05 · Lucas · PR #2 (fusionnée) · Claude Code
**Fait :** ville allégée (plus de voitures, de parcs ni de lampadaires ; immeubles éclairés par sommet et dessinés
après les étages : images/s ×1,5 à ×4). Studio de « Mon étage » : sols, cloisons, bureaux, lumière, objets, huit
presets dont Prestige pour tous ; aperçu en direct.
**Fichiers :** `public/room-data.js`, `core.js` (`profile.room`), studio 3D (`tour/floors/room.js`), dialogue (`ui/studio.js`).
**À savoir :** `profile.room` n'accepte que les valeurs de `room-data.js`. Changer l'accent reconstruit l'étage.
**Reste à faire :** —

## Avant le journal (d'après l'historique git)
- **2026-11-03 · Lucas** : import initial du penthouse et des collecteurs.
- **2026-11-03 · Quentin** : salle casino et télé personnalisée ; **2026-11-04** : casino, ergonomie et corrections.
- **2026-11-03 · Paul-Adrien** : gamification, ailes, aménagement par XP. **2026-11-04, sessions Claude sur la branche
  Paul-Adrien** : économie (salaires, boutique, casino, blackjack, jackpot), tennis et golf jouables, travail au centre
  du jeu, ambiance Prestige, apps Mac et Windows, administration et migrations.
- **2026-11-04 · pAsuuu (Dany)** : ambiance cyberpunk vivante (BYTE, Pixel, colis, écrans) et télé géante d'étage.
- **2026-11-04 · Hugo** (branche `Hugo`, pas encore dans `main`) : étage de luxe réservé à « hugoat ».
