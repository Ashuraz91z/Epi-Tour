// Outils communs (sélecteur, échappement HTML, heure), outils et états des agents, étages communs, plan des étages
// (unités, open space, bureau, places de chaque pièce) et choix de la place d’un agent. Aucune 3D ici.

import * as THREE from "three";
import { breakVisit } from "../break-motion.js";
import { world } from "./state.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
const hm = t => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const ME = "penthouse.moi";
// Clé de l'étage : dans l'onglet (sessionStorage) et, si le résident l'a demandé, retenue sur l'appareil (localStorage).
const KEY = "penthouse.cle";
try { if (!sessionStorage.getItem(KEY) && localStorage.getItem(KEY)) sessionStorage.setItem(KEY, localStorage.getItem(KEY)); } catch { /* stockage indisponible */ }
function rememberKey(key, remember) {
  try {
    if (key) sessionStorage.setItem(KEY, key);
    if (key && remember) localStorage.setItem(KEY, key);
    else if (!remember) localStorage.removeItem(KEY);
  } catch { /* navigation privée stricte : la clé reste dans l'onglet */ }
}

function myApt() {
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  return world.data?.apartments.find(a => a.slug === me?.slug);
}

const TOOLS = {
  claude: { name: "Claude Code", color: "#e0814f", acc: "#ffc29e" },
  codex: { name: "Codex", color: "#2fb898", acc: "#9ff5df" },
  hermes: { name: "Hermes", color: "#9a6cf0", acc: "#e2d4ff" },
  grok: { name: "Grok Bot", color: "#789bb2", acc: "#c9e8fb" },
  cursor: { name: "Cursor", color: "#6b9cff", acc: "#c5d8ff" },
  n8n: { name: "n8n", color: "#ff6f9e", acc: "#ffd0e0" },
};
const STATE_FR = { travaille: "au travail", autorisation: "attend ton accord", attend: "attend la suite", fini: "en pause", erreur: "en erreur", silencieux: "silencieux" };
const STATE_COLOR = { travaille: "#4ade80", autorisation: "#ff4d4d", attend: "#fbbf24", fini: "#8b93a7", erreur: "#ff4d4d", silencieux: "#5b6275" };

// Étages communs : le toit au-dessus des résidents, le Salon, le Club et le Casino en dessous.
const SHARED = [
  { id: "roof", name: "Terrasse fumeurs", kicker: "Toit-terrasse", icon: "🚬", floor: "#262a33", top: true },
  { id: "lounge", name: "Salon", kicker: "Café · repos · tabac · toilettes", icon: "☕", floor: "#22202a" },
  { id: "club", name: "Club", kicker: "Étage commun", icon: "🪩", floor: "#160c22" },
  { id: "casino", name: "Casino", kicker: "Jeux · bar · détente", icon: "🎰", floor: "#2d1810" },
  { id: "tennis", name: "Tennis", kicker: "Court central · tribunes", icon: "🎾", floor: "#23302a" },
  { id: "golf", name: "Golf", kicker: "Putting green · practice", icon: "⛳", floor: "#1d2a1f" },
];
const FLOOR_OF = { smoke: "roof", cafe: "lounge", rest: "lounge", tabac: "lounge", wc: "lounge", club: "club", casino: "casino", tennis: "tennis", golf: "golf" };
const PLACE_FR = { open: "Open space", boss: "Bureau du résident", smoke: "Terrasse fumeurs", cafe: "Café", rest: "Salle de repos",
  tabac: "Bureau de tabac", wc: "Toilettes", club: "Club", casino: "Casino", tennis: "Court de tennis", golf: "Green de golf" };

// ---------- géométrie (plan de 1000 × 620 unités, 1 unité = 2 cm) ----------
const S = 0.02, FLOOR_H = 5.2, LIFT = 22;
const P = (x, y, h = 0) => new THREE.Vector3(x * S - 10, h, y * S - 6.2);
const LANE = 310;               // l'allée centrale (y du plan) relie l'ascenseur à toutes les portes
const ELEV = P(8, LANE);         // porte de l'ascenseur, sur la façade ouest

// Étage d'un résident : open space de 12 postes (à gauche) et son bureau (à droite).
const OPEN = { x: 20, y: 20, w: 620, h: 580 }, BOSS = { x: 660, y: 20, w: 320, h: 580 };
const DESKS = [100, 215, 400, 515].flatMap(r => [90, 260, 430].map(c => ({ cx: c + 75, cy: r + 28 })));
// Places : [x, y, orientation, animation, approche] (orientation 0 = face à la caméra, π = vers le fond). L'approche liste
// les points de passage depuis l'allée centrale, pour contourner les meubles au lieu de marcher dessus.
const RES_SLOTS = {
  open: DESKS.map(d => [d.cx, d.cy - 52, 0, "Sitting", [[d.cx - 85, d.cy - 52]]]), // par l'allée à gauche du poste
  boss: [[760, 300], [820, 310], [880, 300], [780, 360], [860, 360], [820, 405]].map(([x, y]) => [x, y, Math.PI, "Wave"]),
};
const around = (cx, cy, r, n, start = 0, anim = "Idle") => [...Array(n)].map((_, k) => {
  const a = start + (k / n) * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
  return [x, y, Math.atan2(cx - x, cy - y), anim];
});
// Salon : café à gauche, salle de repos au centre, bureau de tabac (au fond) et toilettes (devant) à droite.
const CAFE_TABLES = [[110, 200], [290, 200], [110, 440], [290, 440]];
const REST_GROUPS = [[560, 170], [560, 440]];
const STALLS = [790, 865, 940];
// Toit : une terrasse en bois plus petite que le toit, quatre cendriers.
const DECK = { x: 300, y: 230, w: 440, h: 370 };
const ASHTRAYS = [[390, 300], [610, 300], [430, 470], [650, 470]];
// Répartition fixe mais irrégulière : ne change pas au rafraîchissement et laisse les vrais agents s’installer.
const CLUB_NPCS = [[335, 215], [470, 245], [650, 210], [375, 345], [530, 365], [675, 345]];
const CLUB_EMOTES = ["Wave", "ThumbsUp", "Yes", "Jump"];
const clubAnimation = (t, seed) => {
  const phase = t + seed * 17;
  return phase % 12 < 2 ? CLUB_EMOTES[Math.floor(phase / 12) % CLUB_EMOTES.length] : "Dance";
};
// Tennis : un coup (Punch dure 0,83 s), la position d'attente, puis un petit déplacement. Golf : un swing, l'attente, parfois un « oui ».
const tennisAnimation = (t, seed) => {
  const phase = (t + seed * 13) % 4.2;
  return phase < 0.83 ? "Punch" : phase > 3.3 ? "Running" : "Idle";
};
const golfAnimation = (t, seed, swing = "Punch") => {
  const phase = t + seed * 11, k = phase % 7;
  return k < 0.83 ? swing : k > 5.3 && Math.floor(phase / 7) % 3 === 1 ? "Yes" : "Idle";
};
// Green : swing court (« Putt », au putter) ; practice : swing entier, au fer (voir HELD_OF_SLOT).
const SLOT_MOTION = { Dance: clubAnimation, Tennis: tennisAnimation, Golf: (t, seed) => golfAnimation(t, seed, "Putt"), Practice: golfAnimation };
// Casino : tables (roulette, blackjack, poker) au fond à gauche, bar au fond à droite, deux rangées de machines à sous
// devant, carré VIP devant à droite. Mêmes positions que les meubles dessinés par buildCasino ; l'allée (y = 310) reste libre.
const CASINO_TABLES = { roulette: [170, 165], blackjack: [400, 160], poker: [600, 165] };
const CASINO_MACHINES = [400, 520].flatMap(y => [90, 190, 290, 390, 490, 590].map(x => [x, y]));
const CASINO_FEATURED = 3; // la machine « JACKPOT », au centre du premier rang : elle rejoue les tirages du dialogue
const BLACKJACK_SEATS = [25, 62, 90, 118, 155].map(d => [400 + 70 * Math.cos(d * Math.PI / 180), 160 + 70 * Math.sin(d * Math.PI / 180)]);
const VIP = { x0: 765, y0: 385, gap: [460, 540], table: [870, 500], seats: [820, 870, 920] };
const CASINO_SLOTS = [
  // Machines (places 0 à 11, dans l'ordre des machines) : le joueur se tient devant l'écran et arrive par le passage entre deux machines.
  ...CASINO_MACHINES.map(([x, y]) => [x, y + 38, Math.PI, "Idle", [[x + 50, y + 38]]]),
  // Roulette : trois places devant, une au bout ; blackjack : en arc autour de la table ; poker : trois places.
  ...[[130, 220, Math.PI], [180, 220, Math.PI], [230, 220, Math.PI], [257, 165, -Math.PI / 2]].map(([x, y, r]) => [x, y, r, "Idle"]),
  ...BLACKJACK_SEATS.map(([x, y]) => [x, y, Math.atan2(400 - x, 160 - y), "Idle"]),
  ...[[545, 212], [600, 227], [655, 212]].map(([x, y]) => [x, y, Math.atan2(600 - x, 165 - y), "Idle"]),
  // Bar : debout au comptoir.
  ...[750, 800, 850, 900, 950].map(x => [x, 150, Math.PI, "Idle"]),
  // Carré VIP : entrée par l'ouverture du cordon, puis entre la table basse et la banquette.
  ...VIP.seats.flatMap(x => [
    [x, 445, 0, "Sitting", [[730, 500], [790, 500], [790, 470], [x, 470]], 0.21],
    [x, 555, Math.PI, "Sitting", [[730, 500], [790, 500], [790, 530], [x, 530]], 0.21],
  ]),
];
// Places assises : la 6e valeur est la hauteur de la racine du robot (assise − 0,24 m de bassin), la racine étant
// 10 unités (0,20 m) devant le bassin. Un point de passage peut porter une hauteur : l'agent monte les gradins en marchant.
// Tennis : court en terre battue devant (filet en x = 500), tribunes à trois rangs au fond, allée centrale libre entre les deux.
const TENNIS_COURT = { x0: 200, x1: 800, y0: 380, y1: 590 };
const TENNIS_ROWS = [{ bench: 240, floor: 0 }, { bench: 190, floor: 0.35 }, { bench: 140, floor: 0.7 }];
const TENNIS_SEATS = [220, 290, 360, 430, 570, 640, 710, 780];
const tennisAisle = x => x < 330 ? 165 : x > 670 ? 835 : 500; // escaliers : aux deux bouts et entre les deux sections
const TENNIS_NPCS = [[215, 485], [785, 485]];
const TENNIS_SLOTS = [
  // Joueurs : de chaque côté du filet, tournés vers lui ; ils arrivent tout droit depuis l'allée (rien sur le chemin).
  ...[[300, 420], [300, 550], [410, 440], [410, 530]].flatMap(([x, y]) => [[x, y, Math.PI / 2, "Tennis"], [1000 - x, y, -Math.PI / 2, "Tennis"]]),
  // Spectateurs : on monte par l'escalier le plus proche, on longe son rang devant les bancs, puis on s'assoit.
  ...TENNIS_ROWS.flatMap(({ bench, floor }, k) => TENNIS_SEATS.map(sx => {
    const a = tennisAisle(sx), steps = TENNIS_ROWS.slice(1, k + 1).map(r => [a, r.bench + 25, r.floor]);
    return [sx, bench + 10, 0, "Sitting", [[a, 265, 0], ...steps, [sx, bench + 25, floor]], floor + 0.21];
  })),
];
// Golf : putting green devant (trois trous), practice et son filet au fond à gauche, étang au centre, club-house à droite.
const GOLF_GREEN = { cx: 520, cy: 470, rx: 270, ry: 115 };
const GOLF_HOLES = [[370, 420], [560, 520], [700, 410]]; // le deuxième sert aux putts joués au dialogue (ligne y = 520)
const GOLF_MATS = [130, 210, 290, 370, 450]; // tapis de practice ; le dernier est au golfeur du club
const GOLF_POND = { cx: 590, cy: 200, rx: 95, ry: 55 }, GOLF_BUNKER = { cx: 150, cy: 530, rx: 90, ry: 55 };
const GOLF_TABLES = [[800, 230], [920, 230]]; // chaises à ±45, racine des assis à ±35
// Un golfeur se tient de profil, la cible à sa gauche ; sa balle (la tête du club, bras au repos) est 52 unités devant
// lui et 6 vers la cible. Au practice, il est à gauche du tapis, face à +x, sa balle sur le tee à droite du tapis.
const sideOn = (x, y, [hx, hy]) => Math.atan2(y - hy, hx - x);
const GOLF_STANCE = { ahead: 52, side: 6 }, GOLF_TEE = { dx: 25, y: 94 };
const GOLF_SLOTS = [
  // Putts autour des trous : ni sur la ligne du golfeur du club (y = 468, balle sur y = 520), ni dans l'élan d'un voisin.
  ...[[345, 395, 0], [445, 415, 0], [575, 425, 1], [610, 510, 1], [550, 570, 1], [650, 560, 1], [625, 380, 2], [660, 450, 2], [735, 485, 2]]
    .map(([x, y, h]) => [x, y, sideOn(x, y, GOLF_HOLES[h]), "Golf"]),
  // Practice : de profil, le filet du fond à gauche.
  ...GOLF_MATS.slice(0, 4).map(x => [x + GOLF_TEE.dx - GOLF_STANCE.ahead, GOLF_TEE.y + GOLF_STANCE.side, Math.PI / 2, "Practice"]),
  // Club-house : au comptoir (par derrière les tables), puis assis aux deux tables (chaises à coussin : assise 0,48 m).
  ...[770, 840, 910].map(x => [x, 120, Math.PI, "Idle", [[710, 170], [x, 170]]]),
  ...GOLF_TABLES.flatMap(([tx, ty]) => [[tx - 35, ty, Math.PI / 2, "Sitting", [], 0.24], [tx + 35, ty, -Math.PI / 2, "Sitting", [], 0.24]]),
  // Bancs au bord du green, côté club-house : on les contourne par l'avant.
  ...[385, 415, 465, 495].map(y => [920, y, -Math.PI / 2, "Sitting", [[880, y]], 0.21]),
];
const SHARED_SLOTS = {
  // Café : les chaises du côté opposé à l'allée se rejoignent par l'allée entre les tables.
  cafe: [...CAFE_TABLES.flatMap(([cx, cy]) => around(cx, cy, 52, 4, Math.PI / 4, "Sitting").map(c =>
      (cy < LANE) === (c[1] < cy) ? [...c, [[c[0] < cx ? cx - 90 : cx + 90, c[1]]]] : c)),
    ...[100, 180, 260, 340].map(x => [x, 135, Math.PI, "Idle", [[200, 135]]])], // comptoir : par l'allée entre les tables
  // Repos : on passe à gauche du salon, puis entre la table basse et le canapé.
  rest: REST_GROUPS.flatMap(([x, y]) => [
    ...[x - 25, x + 25].map(sx => [sx, y + 50, Math.PI, "Sitting", [[x - 125, y + 40], [sx, y + 40]]]),
    // Fauteuil : par devant, entre la table basse et lui (le salon du fond contourne d'abord son canapé)
    [x + 100, y, -Math.PI / 2, "Sitting", y < LANE ? [[x - 125, y + 40], [x + 50, y + 40], [x + 50, y]] : [[x + 50, y]]]]),
  tabac: [[790, 190], [850, 200], [910, 190], [820, 250], [880, 250]].map(([x, y]) => [x, y, Math.PI]),
  wc: [...STALLS.map(x => [x, 540, Math.PI, "Sitting"]), [790, 430, Math.PI / 2], [850, 420, Math.PI / 2], [790, 380, Math.PI / 2]],
  // Les places des agents évitent les PNJ, répartis sur toute la piste.
  club: [0, 1, 2, 3].flatMap(r => [0, 1, 2, 3, 4, 5, 6].map(c => [325 + c * 55, 200 + r * 60, Math.PI, "Dance"]))
    .filter(([x, y]) => CLUB_NPCS.every(([nx, ny]) => Math.hypot(nx - x, ny - y) >= 48)),
  smoke: [...ASHTRAYS.flatMap(([x, y]) => around(x, y, 42, 3, Math.PI / 6)), ...[440, 600].map(x => [x, 560, 0])],
  // Casino : tables de jeu (blackjack, roulette), bar, zone d'entrée
  casino: CASINO_SLOTS,
  tennis: TENNIS_SLOTS,
  golf: GOLF_SLOTS,
};
function slotOf(list, k) {
  if (list[k]) return list[k];
  const j = k - list.length; // au-delà des places prévues : debout, en rangées sur le devant
  return [80 + (j * 61) % 840, 590 - Math.floor((j * 61) / 840) * 40, 0, "Idle"];
}

const stateOf = (s, now) => s.state === "travaille" && now - s.updated > 600 ? "silencieux" : s.state;
const keyOf = (slug, s) => `${slug}:${s.src}:${s.host}:${s.sid}`;
// Où va l'agent : son poste quand il travaille, le bureau du résident pour une autorisation, la terrasse quand
// il attend la suite, le café quand il vient de finir, puis le Club et les pauses variées.
function placeOf(s, now) {
  const st = stateOf(s, now);
  if (st === "autorisation") return "boss";
  if (st === "travaille" || st === "erreur") return "open";
  if (st === "attend") return "smoke";
  return breakVisit(hash(`${s.src}:${s.host}:${s.sid}`), now - s.updated, st === "silencieux").place;
}
function quotaRemaining(window, now) {
  if (!window || !Number.isFinite(window.pct) || (window.resets_at && now >= window.resets_at)) return null;
  return Math.round(100 - Math.max(0, Math.min(100, window.pct)));
}
// Quota Claude reçu au moins une fois (sonde du suivi) : sinon les écrans le disent non suivi, sans cases vides.
const claudeTracked = usage => ["five_hour", "seven_day"].some(k => Number.isFinite(usage?.claude?.[k]?.pct));
// Pourquoi le quota Claude d'un résident manque : dernier essai de la sonde (tour-sync) parmi ses machines, ou
// aucun essai reçu (machine reliée avant la sonde : relancer la commande de l'étage). Texte court, en français.
function claudeQuotaWhy(apartment) {
  const tries = Object.entries(apartment?.seen ?? {}).filter(([, m]) => typeof m?.claude_quota === "string")
    .sort((a, b) => (b[1].claude_quota_at ?? 0) - (a[1].claude_quota_at ?? 0));
  if (!tries.length) return "pas encore mesuré : relance la commande de l’étage (« Relier mes agents ») sur la machine où tu utilises Claude Code";
  const [machine, { claude_quota: status }] = tries[0];
  if (status === "ok") return `mesure reçue de ${machine}, affichage au prochain état`;
  if (status === "introuvable") return `Claude Code introuvable sur ${machine} (ni dans le PATH ni aux emplacements habituels)`;
  if (status === "désactivé") return `mesure désactivée sur ${machine} (fichier sans-quota-claude)`;
  if (status.startsWith("sans quota")) return `Claude Code ne donne pas de quota sur ${machine}${status.slice(10)} : il le lit seulement connecté par ton abonnement (lance « claude » puis /login), sans clé d’API ni jeton setup-token`;
  return `mesure impossible sur ${machine} · ${status}`;
}
// Quatre lignes : Claude 5 h, Claude semaine, ChatGPT 5 h, ChatGPT semaine (provider indique l'outil).
function quotaRows(usage, now) {
  return ["claude", "chatgpt"].flatMap(provider =>
    [["five_hour", "5 HEURES"], ["seven_day", "SEMAINE"]].map(([key, label]) => {
      const q = usage?.[provider]?.[key];
      if (!q || !Number.isFinite(q.pct)) return { provider, label, remaining: null, reset: "Données non reçues" };
      if (q.resets_at && now >= q.resets_at) return { provider, label, remaining: null, reset: "Nouvelle mesure attendue" };
      const remaining = quotaRemaining(q, now);
      const reset = q.resets_at ? "Reset " + new Date(q.resets_at * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "Reset inconnu";
      return { provider, label, remaining, reset };
    }));
}

export {
  $, ASHTRAYS, BOSS, CAFE_TABLES, CASINO_FEATURED, CASINO_MACHINES, CASINO_TABLES, CLUB_NPCS, DECK, DESKS, ELEV,
  FLOOR_H, FLOOR_OF, GOLF_BUNKER, GOLF_GREEN, GOLF_HOLES, GOLF_MATS, GOLF_POND, GOLF_STANCE, GOLF_TABLES,
  GOLF_TEE, KEY, LANE, LIFT, ME, OPEN, P, PLACE_FR, REST_GROUPS, RES_SLOTS, S, SHARED, SHARED_SLOTS, SLOT_MOTION,
  STALLS, STATE_COLOR, STATE_FR, TENNIS_COURT, TENNIS_NPCS, TENNIS_ROWS, TENNIS_SEATS, TOOLS, VIP, around,
  claudeQuotaWhy, claudeTracked, clubAnimation, esc, hash, hm, keyOf, myApt, placeOf, quotaRemaining, quotaRows, rememberKey, slotOf, stateOf,
};
