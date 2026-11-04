// Progression, quêtes quotidiennes et activités des espaces communs.
import { SHARED_EXTRAS, WING_ACTIVITIES, WING_DEFS, wingsForLevel, parseFloorKey } from "./wings.js";
import { officePublic, officeTierForLevel } from "./upgrades.js";
const DAY = t => new Date(t * 1000).toLocaleDateString("sv-SE");

export const SPACE_ACTIONS = {
  roof_breathe: { floor: "roof", title: "Respirer sur la terrasse", blurb: "Pause air frais au-dessus de la ville.", xp: 30, cooldown: 3600 },
  roof_bonfire: { floor: "roof", title: "Feu de camp", blurb: "Chauffer les mains près du brasero.", xp: 45, daily: true },
  lounge_coffee: { floor: "lounge", title: "Pause café", blurb: "Un espresso entre deux prompts.", xp: 25, cooldown: 2400 },
  lounge_tv: { floor: "lounge", title: "Régler la télé", blurb: "Tu choisis ce qui passe au salon.", xp: 20, daily: true },
  lounge_tabac: { floor: "lounge", title: "Bureau de tabac", blurb: "Passage discret côté allée.", xp: 18, cooldown: 7200 },
  club_dance: { floor: "club", title: "Session dancefloor", blurb: "Tes agents en pause viennent bouger.", xp: 35, cooldown: 3600 },
  club_vibe: { floor: "club", title: "Ambiance fumée", blurb: "Lumières basses, enceintes max.", xp: 28, daily: true },
  tennis_rally: { floor: "tennis", title: "Échange au fond du court", blurb: "Vingt coups droits sans faute.", xp: 30, cooldown: 3600 },
  tennis_tournoi: { floor: "tennis", title: "Tournoi du penthouse", blurb: "Un set contre les agents des voisins.", xp: 55, daily: true },
  golf_putt: { floor: "golf", title: "Séance de putting", blurb: "Trois balles, trois trous.", xp: 25, cooldown: 2400 },
  golf_parcours: { floor: "golf", title: "Neuf trous", blurb: "Le parcours complet, voiturette comprise.", xp: 50, daily: true },
  ...SHARED_EXTRAS,
};

export const DAILY_QUESTS = [
  { id: "sessions", title: "Open space actif", desc: "Ouvrir 3 sessions différentes aujourd'hui.", target: 3, xp: 80 },
  { id: "actions", title: "Mains dans le code", desc: "10 actions outil (hooks ou sync).", target: 10, xp: 100 },
  { id: "tools", title: "Orchestre", desc: "2 familles d'outils actives aujourd'hui.", target: 2, xp: 90 },
  { id: "approval", title: "Chef d'étage", desc: "Résoudre une demande d'autorisation.", target: 1, xp: 120 },
  { id: "quota", title: "Compteur", desc: "Recevoir une mesure Claude ou ChatGPT.", target: 1, xp: 60 },
  { id: "spaces", title: "Tour des communs", desc: "3 activités dans les espaces partagés.", target: 3, xp: 110 },
  { id: "club_crowd", title: "Soirée club", desc: "Avoir 2 agents en pause au club.", target: 2, xp: 85 },
  { id: "wings", title: "Explorateur", desc: "Visiter 2 ailes privées différentes.", target: 2, xp: 95 },
  { id: "payday", title: "Jour de paie", desc: "Tes agents touchent 100 P$ de salaires aujourd'hui.", target: 100, xp: 90 },
];

export const BADGES = [
  { id: "rookie", title: "Rookie", desc: "Premier niveau atteint.", minLevel: 2 },
  { id: "regular", title: "Résident", desc: "Niveau 5.", minLevel: 5 },
  { id: "veteran", title: "Vétéran", desc: "Niveau 10.", minLevel: 10 },
  { id: "streak3", title: "Régulier", desc: "3 jours d'affilée.", minStreak: 3 },
  { id: "streak7", title: "Pilier", desc: "7 jours d'affilée.", minStreak: 7 },
  { id: "social", title: "Social", desc: "10 activités communes.", minSpace: 10 },
  { id: "night", title: "Noctambule", desc: "Action club après 22 h.", flag: "nightClub" },
  { id: "architect", title: "Architecte", desc: "4 ailes débloquées.", minLevel: 12 },
];

export function createGame() {
  return {
    xp: 0,
    streak: 0,
    lastDay: null,
    day: null,
    counters: { approvals: 0, quota: 0, spaceActions: 0, nightClub: 0, wingsVisited: 0 },
    quests: {},
    spaceAt: {},
    spaceDaily: {},
    wingDaily: {},
    badges: [],
    toast: [],
    _authPending: 0,
  };
}

export function levelFromXp(xp) {
  return Math.min(99, Math.max(1, Math.floor(1 + Math.sqrt(Math.max(0, xp) / 75))));
}

export function xpToNextLevel(xp) {
  const level = levelFromXp(xp);
  const next = level + 1;
  const need = Math.ceil(((next - 1) ** 2) * 75);
  const prev = Math.ceil(((level - 1) ** 2) * 75);
  return { level, next, current: xp - prev, need: need - prev };
}

function ensureDay(game, now) {
  const day = DAY(now);
  if (game.day === day) return;
  game.day = day;
  game.quests = {};
  game.spaceDaily = {};
  game.counters = { approvals: 0, quota: 0, spaceActions: 0, nightClub: game.counters?.nightClub ?? 0, wingsVisited: 0 };
  game.wingDaily = {};
}

// Série de jours : ne compte que les jours où le résident ou ses agents ont réellement fait quelque chose
// (et pas les jours où quelqu'un a simplement regardé le site).
const yesterdayOf = now => { const d = new Date(now * 1000); d.setDate(d.getDate() - 1); return DAY(d.getTime() / 1000); };
export function markActive(game, now) {
  const day = DAY(now);
  if (game.lastDay === day) return;
  game.streak = game.lastDay === yesterdayOf(now) ? (game.streak ?? 0) + 1 : 1;
  game.lastDay = day;
}
// Série affichée : retombe à 0 dès qu'une journée entière est passée sans activité.
const currentStreak = (game, now) => [DAY(now), yesterdayOf(now)].includes(game.lastDay) ? game.streak ?? 0 : 0;

export function pushToast(game, title, body, xp = 0) {
  game.toast.push({ id: `${Date.now()}-${Math.random()}`, title, body, xp, at: Date.now() / 1000 });
  if (game.toast.length > 8) game.toast.splice(0, game.toast.length - 8);
}

export function grantXp(game, amount, reason) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const beforeLevel = levelFromXp(game.xp);
  const beforeOffice = officeTierForLevel(beforeLevel);
  game.xp += amount;
  const afterLevel = levelFromXp(game.xp);
  const afterOffice = officeTierForLevel(afterLevel);
  pushToast(game, reason, `+${amount} XP`, amount);
  if (afterLevel > beforeLevel) pushToast(game, "Niveau supérieur !", `Tu es niveau ${afterLevel}`, 0);
  if (afterOffice.id > beforeOffice.id) pushToast(game, "Aménagement amélioré !", `${afterOffice.name} · ${afterOffice.perks.join(", ")}`, 0);
  unlockBadges(game);
}

function unlockBadges(game) {
  const have = new Set(game.badges ?? []);
  for (const badge of BADGES) {
    if (have.has(badge.id)) continue;
    if (badge.minLevel && levelFromXp(game.xp) >= badge.minLevel) have.add(badge.id);
    if (badge.minStreak && (game.streak ?? 0) >= badge.minStreak) have.add(badge.id);
    if (badge.minSpace && (game.counters?.spaceActions ?? 0) >= badge.minSpace) have.add(badge.id);
    if (badge.flag && (game.counters?.[badge.flag] ?? 0) > 0) have.add(badge.id);
  }
  game.badges = [...have];
}

function questProgress(store, game, quest, now) {
  const today = store.stats?.[DAY(now)] ?? store.today ?? {};
  const sessions = Object.values(store.sessions ?? {});
  switch (quest.id) {
    case "sessions":
      return Object.values(today).reduce((n, d) => n + (d.sessions ?? 0), 0);
    case "actions":
      return Object.values(today).reduce((n, d) => n + (d.actions ?? 0), 0);
    case "tools": {
      const src = new Set(Object.keys(today).filter(k => (today[k].sessions ?? 0) + (today[k].actions ?? 0) > 0));
      for (const s of sessions) if (s.updated >= now - 86400) src.add(s.src);
      return src.size;
    }
    case "approval":
      return game.counters?.approvals ?? 0;
    case "quota":
      return game.counters?.quota ?? 0;
    case "spaces":
      return game.counters?.spaceActions ?? 0;
    case "club_crowd":
      return Math.min(2, pausedAgents(store, now));
    case "wings":
      return game.counters?.wingsVisited ?? 0;
    case "payday":
      return Math.floor(Object.values(store.economy?.day?.pay ?? {}).reduce((n, v) => n + v, 0));
    default:
      return 0;
  }
}

// Agents en pause : tour fini, ou silencieux depuis plus de 10 minutes.
export function pausedAgents(store, now) {
  return Object.values(store.sessions ?? {}).filter(s => s.state === "fini" || (s.state === "travaille" && now - s.updated > 600)).length;
}

function refreshQuests(store, game, now) {
  ensureDay(game, now);
  for (const quest of DAILY_QUESTS) {
    const row = (game.quests[quest.id] ??= { progress: 0, done: false, claimed: false });
    row.progress = Math.min(quest.target, questProgress(store, game, quest, now));
    if (!row.claimed && row.progress >= quest.target) row.done = true;
  }
}

export function onIngestGame(store, prevSessions, p, now = Date.now() / 1000) {
  const game = (store.game ??= createGame());
  ensureDay(game, now);
  if (p.usage && typeof p.usage === "object") {
    for (const provider of ["claude", "chatgpt"]) {
      if (p.usage[provider]) {
        game.counters.quota = 1;
        break;
      }
    }
  }
  let active = false;
  for (const [key, s] of Object.entries(store.sessions ?? {})) {
    const was = prevSessions?.[key];
    if (was?.state === "autorisation" && s.state !== "autorisation")
      game.counters.approvals = (game.counters.approvals ?? 0) + 1;
    if (s.updated !== was?.updated) active = true;
  }
  if (active) markActive(game, now);
  refreshQuests(store, game, now);
  unlockBadges(game);
}

// Visite d'une aile de son propre étage, une fois par jour et par aile réellement débloquée.
export function visitWing(store, floorKey, now = Date.now() / 1000, slug = null) {
  const { slug: owner, wing } = parseFloorKey(floorKey);
  const game = (store.game ??= createGame());
  const unlocked = wingsForLevel(levelFromXp(game.xp)).some(w => w.id === wing);
  if (!wing || wing === "work" || !unlocked || (slug && owner !== slug)) return { ok: true, game: publicGame(store, now), skipped: true };
  ensureDay(game, now);
  game.wingDaily ??= {};
  if (game.wingDaily[wing]) return { ok: true, game: publicGame(store, now), skipped: true };
  game.wingDaily[wing] = true;
  game.counters.wingsVisited = (game.counters.wingsVisited ?? 0) + 1;
  markActive(game, now);
  grantXp(game, 12, `Aile · ${WING_DEFS.find(w => w.id === wing)?.name ?? wing}`);
  refreshQuests(store, game, now);
  unlockBadges(game);
  return { ok: true, game: publicGame(store, now) };
}

function actionDef(id) {
  return SPACE_ACTIONS[id] ?? WING_ACTIVITIES[id];
}

export function performSpaceAction(store, actionId, now = Date.now() / 1000, opts = {}) {
  const def = actionDef(actionId);
  if (!def) return { error: "Activité inconnue." };
  const game = (store.game ??= createGame());
  ensureDay(game, now);
  const floor = String(opts.floor ?? "");
  if (def.wing) {
    const { slug, wing } = parseFloorKey(floor);
    if (wing !== def.wing || (opts.slug && slug !== opts.slug)) return { error: "Ouvre d'abord la bonne aile de ton étage." };
    if (!wingsForLevel(levelFromXp(game.xp)).some(w => w.id === def.wing)) return { error: "Cette aile n'est pas encore débloquée." };
  } else if (floor !== def.floor) return { error: "Va d'abord à cet étage commun." };
  // Agents en pause, comptés par le serveur (ils descendent dans les étages communs) : le client ne décide pas.
  const agents = pausedAgents(store, now);
  if (def.floor === "club" && actionId === "club_dance" && agents < 1)
    return { error: "Amène au moins un agent en pause au club." };
  if (def.daily && game.spaceDaily[actionId]) return { error: "Déjà fait aujourd'hui." };
  const last = game.spaceAt[actionId] ?? 0;
  if (!def.daily && def.cooldown && now - last < def.cooldown)
    return { error: `Reviens dans ${Math.ceil((def.cooldown - (now - last)) / 60)} min.` };
  const limit = def.wing ? 16 : 28;
  const countKey = def.wing ? "wingActions" : "spaceActions";
  if ((game.counters[countKey] ?? 0) >= limit) return { error: "Limite d'activités pour aujourd'hui." };
  game.counters[countKey] = (game.counters[countKey] ?? 0) + 1;

  game.spaceAt[actionId] = now;
  if (def.daily) game.spaceDaily[actionId] = true;
  markActive(game, now);
  if (def.floor === "club" && new Date(now * 1000).getHours() >= 22) game.counters.nightClub = 1;

  grantXp(game, def.xp, def.title);
  refreshQuests(store, game, now);
  unlockBadges(game);
  return { ok: true, game: publicGame(store, now) };
}

export function claimQuest(store, questId, now = Date.now() / 1000) {
  const game = (store.game ??= createGame());
  ensureDay(game, now);
  refreshQuests(store, game, now);
  const quest = DAILY_QUESTS.find(q => q.id === questId);
  const row = game.quests[questId];
  if (!quest || !row?.done || row.claimed) return { error: "Récompense indisponible." };
  row.claimed = true;
  grantXp(game, quest.xp, quest.title);
  return { ok: true, game: publicGame(store, now) };
}

export function pullToasts(store) {
  const game = store.game ?? createGame();
  const batch = game.toast.splice(0, game.toast.length);
  return batch;
}

export function publicGame(store, now = Date.now() / 1000) {
  const game = store.game ?? createGame();
  refreshQuests(store, game, now);
  const progress = xpToNextLevel(game.xp);
  return {
    xp: game.xp,
    level: progress.level,
    streak: currentStreak(game, now),
    xpBar: { current: progress.current, need: progress.need, next: progress.next },
    badges: [...(game.badges ?? [])],
    quests: DAILY_QUESTS.map(q => {
      const row = game.quests[q.id] ?? { progress: 0, done: false, claimed: false };
      return { ...q, progress: row.progress, done: row.done, claimed: row.claimed };
    }),
    spaces: Object.entries({ ...SPACE_ACTIONS, ...WING_ACTIVITIES }).map(([id, def]) => ({
      id, ...def,
      ready: !def.daily || !game.spaceDaily[id],
      cooldownSec: def.daily ? 0 : Math.max(0, (def.cooldown ?? 0) - (now - (game.spaceAt[id] ?? 0))),
    })),
    wings: wingsForLevel(progress.level).map(w => ({
      id: w.id, name: w.name, icon: w.icon, minLevel: w.minLevel, floor: w.floor, sign: w.sign, accent: w.accent,
    })),
    office: officePublic(progress.level),
    counters: { ...game.counters },
  };
}

export function spectatorGame(store, now) {
  const g = publicGame(store, now);
  return { level: g.level, xp: g.xp, streak: g.streak, badges: g.badges };
}
