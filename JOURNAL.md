# Journal commun

Chaque IA ajoute **en haut** une entrée par session de travail (modèle et règles dans `AGENTS.md`, section 3).
Le plus récent d'abord. On n'efface pas les entrées des autres.

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
