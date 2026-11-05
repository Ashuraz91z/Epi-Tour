# Consignes pour les IA qui codent sur le Penthouse

Ce dépôt est modifié par les IA de plusieurs résidents (Claude Code, Codex, Cursor…), chacune pour son humain.
Les humains se parlent peu du code : **c'est ce fichier et `JOURNAL.md` qui font le lien**. Lis-les en entier avant
de commencer, et respecte-les même si ton humain ne les mentionne pas.

## 1. Avant de commencer

1. Lis `JOURNAL.md` (au moins les entrées des 7 derniers jours) : qui a changé quoi, ce qui est en cours, les pièges.
2. Mets ta branche à jour avec `main` : `git fetch origin && git merge origin/main`.
3. Lance `npm test` : si un test échoue déjà, note-le dans ton entrée de journal au lieu de le contourner.

## 2. Branches : une par résident, à son prénom

- Chaque résident travaille sur **sa** branche, à son nom : `Lucas`, `Paul-Adrien`, `Quentin`, `Hugo`…
  Pas de branche au nom généré (`claude/…`, `codex/…`, `feature-123`). Si la branche du résident n'existe pas,
  crée-la depuis `main` avec son prénom.
- On ne pousse jamais sur la branche d'un autre résident, ni directement sur `main`.
- Quand c'est prêt : PR de la branche du résident vers `main`. On fusionne quand l'humain le demande.
- Petits commits, message en français : `feat(3d): …`, `fix(serveur): …`, `perf(ui): …`, `docs: …`.

## 3. Après avoir travaillé : le journal

Avant chaque push, ajoute **en haut** de `JOURNAL.md` une entrée sur ce modèle (5 à 15 lignes, pas un roman) :

```md
## 2026-11-05 · Lucas · branche Lucas · Claude Code
**Fait :** ce qui a changé, du point de vue d'un résident (ce qu'on voit sur le site).
**Fichiers :** les fichiers ou dossiers principaux touchés.
**À savoir :** ce qu'une autre IA doit savoir avant de toucher au même endroit (piège, règle, choix fait exprès).
**Reste à faire :** ce qui n'est pas fini ou pas vérifié (rien = « — »).
```

- Une entrée par session de travail, même petite. Ne réécris pas les entrées des autres.
- Si tu annules ou changes ce qu'une autre IA a fait, dis-le dans ton entrée, avec la raison.
- Ne mets dans le journal ni clé, ni code d'entrée, ni nom de machine, ni contenu de conversation.

## 4. Où est quoi

Serveur (Node 24, aucune dépendance) :

| Fichier | Rôle |
|---|---|
| `server.js` | démarrage (SQLite, migrations, port) |
| `penthouse.js` | routes HTTP/API, entrée, clés, fichiers servis (`FILES`) |
| `core.js` | événements des agents → sessions, quotas ; profil (`sanitizeProfile`) |
| `gamify.js`, `wings.js`, `upgrades.js` | XP, missions, badges, ailes, paliers d'aménagement |
| `economy.js` | salaires, boutique, casino, sport, travail ; catalogue partagé `public/economy-data.js` |
| `db.js`, `migrations.js`, `admin.js` | stockage SQLite, ménages au démarrage, commandes d'administration |
| `test.js` | tous les tests (`npm test`) |

Interface (`public/`, modules ES chargés tels quels, three.js 0.170 par le CDN) :

| Fichier | Rôle |
|---|---|
| `app.js` | point d'entrée : charge les modules dans l'ordre et démarre |
| `tour/state.js` | `world` : le seul état partagé modifiable (étage regardé, état reçu, ordre des étages…) |
| `tour/base.js` | outils, constantes, plan des étages et places des agents (pas de 3D) |
| `tour/engine.js` | rendu, scène, caméra, matériaux `mat()`/`glow()`, briques `box`/`cyl`/`sign`/`label`, fusion `bakeStatic` |
| `tour/kit.js` | géométries et textures partagées par les étages |
| `tour/models.js` | modèles glTF chargés au démarrage |
| `tour/city.js` | la ville, les panneaux des immeubles voisins, la tour |
| `tour/robots.js` | robots des agents, objets tenus, chemins |
| `tour/work-fx.js` | célébrations du travail, confettis, tableau de bord |
| `tour/floors/*.js` | un fichier par étage ou ambiance : `resident`, `cyberpunk`, `prestige`, `room` (studio), `shared` (toit, Salon, Club), `casino`, `tennis`, `golf`, `shell` (coque commune) |
| `tour/tower.js` | construit la tour (`syncFloors`) et place les agents (`update`) |
| `tour/animate.js` | boucle d'animation, caméra, résolution |
| `tour/navigation.js` | étage regardé, visite spectateur, clics |
| `ui/panel.js` | panneau, alertes, télécommande, dialogues |
| `ui/studio.js` | « Mon étage » : presets et studio de la salle |
| `ui/session.js` | entrée, flux temps réel, `tick()` |
| `room-data.js`, `economy-data.js` | catalogues partagés avec le serveur |

## 5. Règles du code

- **Un nouvel étage ou une nouvelle ambiance = un nouveau fichier** dans `public/tour/floors/`. N'ajoute pas de code
  dans un fichier d'un autre résident (par exemple `prestige.js`, étage de Paul-Adrien) sauf si ton humain le demande.
  Les fichiers `.js` de `public/tour/`, `public/tour/floors/` et `public/ui/` sont servis automatiquement. Ailleurs dans
  `public/`, ajoute le fichier à `FILES` dans `penthouse.js`, sinon la page reste vide.
- **Ordre de chargement** : un module de bas niveau (`state`, `base`, `engine`, `kit`) n'importe jamais un module de plus
  haut niveau. Au chargement (hors fonctions), un module n'utilise que ce qui vient de modules plus bas. Ailleurs, les
  imports croisés ne posent pas de problème, tant qu'ils ne servent que dans des fonctions.
- **État partagé** : une variable écrite par plusieurs modules va dans `world` (`tour/state.js`), sinon elle reste un
  `let` dans son module. Un module ne peut pas réassigner une variable importée.
- **3D et performances** (voir « Performances » dans le README) : réutilise `mat()`, `glow()`, `box()`, les géométries de
  `kit.js` ; pas de nouvelle lumière dynamique (prête `LightSpot` à l'étage) ; tout objet animé après la construction
  d'un étage doit être rangé dans un champ `f.*` de l'étage ou passé à `live(...)`, sinon `bakeStatic` le fusionne et il
  reste figé. Rien ne tourne sur un étage qu'on ne regarde pas. Ne change pas la résolution, l'antialiasing ni les
  réglages de rendu pour gagner des images/s.
- **Serveur** : le client n'envoie que des intentions ; tout ce qui touche aux P$, à l'XP et au profil est vérifié côté
  serveur, avec une liste de valeurs connues.
- **Tests** : `npm test` doit passer avant chaque push. Ajoute un test pour toute règle serveur nouvelle. Les tests ne
  contactent jamais le vrai site ni les vrais outils (HOME et planificateurs isolés).
- **Version** : change `VERSION` dans `penthouse.js` (`AAAA-MM-JJ.n`) quand le site change, pour qu'on puisse vérifier
  dans le menu « ⋯ » que la mise en ligne a bien pris.
- Interface, commentaires et messages de commit **en français**.
- Ne mets jamais de clé, de code d'entrée ou de donnée personnelle dans le code, les tests ou le journal.
