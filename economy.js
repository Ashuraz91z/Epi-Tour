// Économie du penthouse : les agents IA sont les employés de l'étage.
// - Leur grade (et leur taux horaire) dépend de l'abonnement de leur fournisseur : un agent Claude d'un compte Max 20x
//   est Lead, celui d'un compte gratuit est Stagiaire. La formule ChatGPT lue dans les journaux Codex fait foi.
// - Ils sont payés au temps de travail réellement observé (événements des hooks et des journaux), avec heures sup,
//   majorations de nuit et du dimanche, moral, primes de livraison et de réactivité.
// - L'ancienneté les fait monter d'échelon ; le résident gagne un titre de PDG selon ce que son équipe a gagné.
// - Les P$ se dépensent à la boutique (avantages, décor 3D), au casino ou en primes à un collègue.
// Tout se décide ici, côté serveur : le client n'envoie que des intentions, le hasard du casino vient de node:crypto.
import { randomInt } from "node:crypto";
import {
  CASINO, CHATGPT_PLANS, ECHELONS, ECHELON_BONUS, ECONOMY_BADGES, EVENTS, FREELANCE, GRADES, MAJORATIONS, MODEL_FACTORS,
  MORALE, PRIMES, PROVIDERS, SHOP, SPECIALTIES, SPORTS, TIPS, TITLES, TOOL_PROVIDER, WORK, WORKDAY,
} from "./public/economy-data.js";
import { createGame, grantXp, markActive, pushToast } from "./gamify.js";

const money = x => Math.round(x * 100) / 100;
const sum = o => Object.values(o ?? {}).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);
const TOOLS_ORDER = Object.keys(TOOL_PROVIDER);
const UPGRADE_COOLDOWN = 6 * 3600;

// Heure de Paris : la paie, les majorations et l'événement du jour suivent la journée des résidents, pas celle du serveur.
const PARIS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" });
export function paris(t) {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), sunday: p.weekday === "Sun" };
}

// Événement du jour : même tirage pour tout le penthouse, d'après la date.
export function eventOf(day) {
  let h = 2166136261;
  for (const c of "penthouse:" + day) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let pick = h % EVENTS.reduce((n, e) => n + e.weight, 0);
  for (const e of EVENTS) { if (pick < e.weight) return e; pick -= e.weight; }
  return EVENTS[0];
}

export function createEconomy() {
  return { wallet: 0, earned: 0, subs: {}, staff: {}, day: null, history: [], ledger: [], perks: {}, decor: [],
    records: { biggestWin: 0, jackpots: 0 }, counters: { tipsSent: 0 }, blackjack: null,
    workStreak: { days: 0, lastDay: null }, projects: {}, events: [], eventSeq: 0 };
}
// Étages créés avant l'économie, ou sauvegardes partielles : on complète sans rien effacer.
function economyOf(store) {
  const eco = (store.economy ??= createEconomy());
  for (const [k, v] of Object.entries(createEconomy())) eco[k] ??= v;
  return eco;
}
const newDay = date => ({ date, minutes: {}, pay: {}, primes: 0, deliveries: 0, reactivity: 0, casino: { plays: 0, wagered: 0, won: 0 }, tipsSent: 0,
  delivered: 0, workXp: 0, objectives: {}, projects: {}, tools: {}, peakParallel: 0 });
function ensureDay(eco, now) {
  const { day } = paris(now);
  if (eco.day?.date === day) {
    // Journée commencée avant une mise à jour du serveur : on complète les compteurs ajoutés depuis.
    for (const [k, v] of Object.entries(newDay(day))) eco.day[k] ??= v;
    return eco.day;
  }
  // Une journée ne recule jamais : un relevé en retard compte pour la journée en cours.
  if (eco.day && eco.day.date > day) return eco.day;
  if (eco.day) {
    eco.history.unshift({ date: eco.day.date, pay: money(sum(eco.day.pay) + eco.day.primes), minutes: money(sum(eco.day.minutes)) });
    eco.history.splice(14);
  }
  return (eco.day = newDay(day));
}

function log(eco, entry) {
  // Les salaires d'un même agent et d'un même jour sont regroupés sur une seule ligne du relevé.
  if (entry.kind === "salary") {
    const i = eco.ledger.findIndex(e => e.kind === "salary" && e.src === entry.src && e.date === entry.date);
    if (i >= 0) {
      const [old] = eco.ledger.splice(i, 1);
      entry = { ...old, t: entry.t, amount: money(old.amount + entry.amount) };
    }
  }
  eco.ledger.unshift({ ...entry, amount: money(entry.amount) });
  eco.ledger.splice(40);
}
const gameOf = store => (store.game ??= createGame());
function badge(store, id) {
  const game = gameOf(store);
  if ((game.badges ??= []).includes(id)) return;
  game.badges.push(id);
  pushToast(game, "Nouveau badge !", ECONOMY_BADGES[id] ?? id);
  workEvent(store, "badge", `🏅 ${ECONOMY_BADGES[id] ?? id}`, { badge: id });
}
// Argent gagné : salaires, primes et récompenses comptent pour le titre ; casino et virements non.
function credit(store, amount, kind, label, now, extra = {}) {
  const eco = economyOf(store);
  if (!(amount > 0)) return;
  eco.wallet = money(eco.wallet + amount);
  if (["salary", "prime", "quest"].includes(kind)) {
    const before = titleOf(eco.earned);
    eco.earned = money(eco.earned + amount);
    const after = titleOf(eco.earned);
    if (after.min > before.min) pushToast(gameOf(store), "Ton entreprise grandit !", `${after.icon} ${after.title}`);
    if (eco.earned >= 50000) badge(store, "unicorn");
  }
  if (eco.wallet >= 10000) badge(store, "rich");
  log(eco, { t: now, kind, label, amount, ...extra });
}

export function titleOf(earned) {
  let current = TITLES[0];
  for (const t of TITLES) if (earned >= t.min) current = t;
  const next = TITLES.find(t => t.min > earned) ?? null;
  return { ...current, next };
}
export const echelonOf = minutes => ECHELONS.filter(m => minutes >= m).length;

// Abonnement de l'outil : la formule vérifiée (journaux Codex) passe avant la formule déclarée.
export function tierOf(store, src) {
  const provider = TOOL_PROVIDER[src];
  if (!provider) return { provider: null, tier: null, rank: FREELANCE.rank, verified: false };
  const verified = provider === "chatgpt" ? CHATGPT_PLANS[store.usage?.chatgpt?.plan] : undefined;
  const id = verified ?? economyOf(store).subs[provider]?.tier;
  const tier = PROVIDERS[provider].tiers.find(t => t.id === id) ?? null;
  return { provider, tier, rank: tier?.rank ?? 0, verified: !!tier && tier.id === verified };
}

const MODEL_RULES = MODEL_FACTORS.map(m => ({ ...m, regex: new RegExp(m.pattern, "i") }));
function modelFactor(model) {
  if (typeof model !== "string") return null;
  return MODEL_RULES.find(m => m.regex.test(model)) ?? null;
}
function moraleOf(eco, st, now, event) {
  if (event.morale || (eco.perks.cafe_premium ?? 0) > now) return 100;
  if (!st || now - (st.lastWork ?? 0) > MORALE.pauseMinutes * 60) return 100;
  return Math.round(Math.max(MORALE.floor, 100 - Math.max(0, (st.cont ?? 0) - MORALE.freshMinutes) / MORALE.perPoint));
}
const moraleFactor = morale => MORALE.minFactor + (1 - MORALE.minFactor) * morale / 100;

// Taux horaire d'un agent à un instant donné, avec le détail de chaque facteur.
export function rateFor(store, src, at) {
  const eco = economyOf(store), { hour, sunday, day } = paris(at), event = eventOf(day);
  const { rank } = tierOf(store, src), grade = GRADES[Math.min(rank, GRADES.length - 1)];
  const st = eco.staff[src];
  const factors = [];
  const add = (label, factor) => { if (factor !== 1) factors.push({ label, factor: money(factor) }); };
  const echelon = echelonOf(st?.minutes ?? 0);
  add(`Échelon ${echelon}`, 1 + ECHELON_BONUS * (echelon - 1));
  const model = modelFactor(st?.model);
  if (model) add(model.label, model.factor);
  const morale = moraleOf(eco, st, at, event);
  add(`Moral ${morale}`, moraleFactor(morale));
  if (hour >= MAJORATIONS.nightFrom || hour < MAJORATIONS.nightTo) add("Majoration de nuit", event.night ?? MAJORATIONS.night);
  if (sunday) add("Majoration du dimanche", MAJORATIONS.sunday);
  if ((eco.perks.objectifs ?? 0) > at) add("Objectifs trimestriels", 1.2);
  const team = workingNow(store, at);
  if (team > 1) add(`Prime d'équipe (${team} agents)`, 1 + Math.min(WORK.team.max, WORK.team.per * (team - 1)));
  const streak = currentWorkStreak(eco, day);
  if (streak > 0) add(`Série de travail ${streak} j`, 1 + Math.min(WORK.streak.max, WORK.streak.per * streak));
  if (event.salary) add(event.name, event.salary);
  if (event.intern && grade.rank === 0) add(event.name, event.intern);
  const rate = grade.rate * factors.reduce((p, f) => p * f.factor, 1);
  return { grade, baseRate: grade.rate, rate: money(rate), factors, morale, echelon };
}

function promote(store, src, before, now) {
  const eco = economyOf(store), after = echelonOf(eco.staff[src].minutes);
  if (after <= before) return;
  const { grade } = rateFor(store, src, now);
  pushToast(gameOf(store), "Promotion !", `${grade.icon} ${SPECIALTIES[src] ?? src} passe échelon ${after} (+${Math.round(ECHELON_BONUS * 100)} %)`);
  log(eco, { t: now, kind: "promo", label: `${SPECIALTIES[src] ?? src} (${src}) · échelon ${after}`, amount: 0 });
  badge(store, "promo");
}
const staffOf = (eco, src) => (eco.staff[src] ??= { minutes: 0, cont: 0, lastWork: 0, model: null });

// Paie d'une période de travail : 7 h normales, heures sup majorées jusqu'à 10 h, rien au-delà (repos obligatoire).
// ---------- le travail au centre du jeu ----------
// Agents qui travaillent à l'instant `at` : session au travail avec un signe de vie depuis moins de 10 minutes.
function workingNow(store, at) {
  let n = 0;
  for (const s of Object.values(store.sessions ?? {})) if (TOOL_PROVIDER[s.src] && s.state === "travaille" && s.updated <= at + 1 && at - s.updated <= 600) n++;
  return n;
}
const previousDay = date => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
// Série affichée : vivante si le dernier jour travaillé est aujourd'hui ou hier.
function currentWorkStreak(eco, date) {
  const st = eco.workStreak ?? { days: 0, lastDay: null };
  return st.lastDay === date || st.lastDay === previousDay(date) ? st.days : 0;
}
function workEvent(store, kind, label, extra = {}) {
  const eco = economyOf(store);
  eco.eventSeq = (eco.eventSeq ?? 0) + 1;
  eco.events.unshift({ id: eco.eventSeq, t: extra.t ?? Date.now() / 1000, kind, label, ...extra });
  eco.events.splice(12);
}
function workXp(store, day, amount) {
  const room = Math.max(0, WORK.dailyXpCap - (day.workXp ?? 0)), xp = Math.min(room, amount);
  if (xp <= 0) return;
  day.workXp = money((day.workXp ?? 0) + xp);
  grantXp(gameOf(store), money(xp), "Travail", { quiet: true });
}
const todayMinutes = day => sum(day.minutes);
// Objectifs du jour : vérifiés après chaque minute de travail ou livraison ; la récompense part à l'atteinte.
function checkObjectives(store, day, now) {
  const metric = { minutes: todayMinutes(day), deliveries: day.delivered ?? 0, parallel: day.peakParallel ?? 0 };
  for (const o of WORK.objectives) {
    if (day.objectives[o.id] || metric[o.metric] < o.target) continue;
    day.objectives[o.id] = now;
    credit(store, o.money, "prime", `Objectif · ${o.title}`, now);
    grantXp(gameOf(store), o.xp, `${o.icon} ${o.title}`, { quiet: true });
    pushToast(gameOf(store), `${o.icon} Objectif atteint !`, `${o.title} · +${o.money} P$ · +${o.xp} XP`);
    workEvent(store, "objective", `${o.icon} ${o.title}`, { t: now, objective: o.id });
  }
}
function trackProject(eco, day, project, minutes, delivered, now) {
  if (typeof project !== "string" || !project) return;
  const p = (eco.projects[project] ??= { minutes: 0, deliveries: 0, last: now });
  p.minutes = money(p.minutes + minutes);
  p.deliveries += delivered;
  p.last = now;
  day.projects[project] = money((day.projects[project] ?? 0) + minutes);
  const names = Object.keys(eco.projects);
  if (names.length > 40) for (const old of names.sort((a, b) => eco.projects[a].last - eco.projects[b].last).slice(0, names.length - 40)) delete eco.projects[old];
}
export const projectLevel = minutes => WORK.projectLevels.filter(m => minutes >= m).length;

function work(store, src, minutes, at, now, project = null) {
  if (!(minutes > 0)) return;
  const eco = economyOf(store), day = ensureDay(eco, now), st = staffOf(eco, src);
  if (at - minutes * 60 - (st.lastWork ?? 0) > MORALE.pauseMinutes * 60) st.cont = 0;
  const { rate, factors } = rateFor(store, src, at);
  st.cont = (st.cont ?? 0) + minutes;
  st.lastWork = Math.max(st.lastWork ?? 0, at);
  const before = day.minutes[src] ?? 0, after = before + minutes;
  const normal = Math.max(0, Math.min(after, WORKDAY.normal) - before);
  const overtime = Math.max(0, Math.min(after, WORKDAY.max) - Math.max(before, WORKDAY.normal));
  day.minutes[src] = money(after);
  const amount = money(rate * (normal + overtime * WORKDAY.overtime) / 60);
  const echelon = echelonOf(st.minutes);
  st.minutes = money(st.minutes + minutes);
  if (amount > 0) {
    day.pay[src] = money((day.pay[src] ?? 0) + amount);
    credit(store, amount, "salary", `Salaire · ${SPECIALTIES[src] ?? src} (${src})`, now, { src, date: day.date });
    badge(store, "first_pay");
    if (factors.some(f => f.label === "Majoration de nuit")) badge(store, "night_shift");
  }
  if (before < WORKDAY.max && after >= WORKDAY.max) pushToast(gameOf(store), "Repos obligatoire", `${SPECIALTIES[src] ?? src} (${src}) a fait ses 10 h : la suite n'est plus payée aujourd'hui.`);
  promote(store, src, echelon, now);
  // Le travail fait progresser tout le reste : XP, projet, série, objectifs, badges.
  day.tools[src] = true;
  day.peakParallel = Math.max(day.peakParallel ?? 0, workingNow(store, at));
  workXp(store, day, minutes * WORK.xpPerMinute);
  trackProject(eco, day, project, minutes, 0, now);
  const total = todayMinutes(day);
  if (total >= WORK.streak.minMinutes && eco.workStreak.lastDay !== day.date) {
    eco.workStreak = { days: eco.workStreak.lastDay === previousDay(day.date) ? eco.workStreak.days + 1 : 1, lastDay: day.date };
    workEvent(store, "streak", `🔥 Série de travail : ${eco.workStreak.days} jour(s)`, { t: now });
    if (eco.workStreak.days >= 7) badge(store, "stakhanov");
  }
  if (total >= 360) badge(store, "marathon");
  if ((day.peakParallel ?? 0) >= 4) badge(store, "orchestra");
  if (Object.keys(day.tools).length >= 3) badge(store, "polyglot");
  checkObjectives(store, day, now);
}

function delivery(store, src, now, project = null) {
  const eco = economyOf(store), day = ensureDay(eco, now);
  // Toutes les livraisons comptent pour les objectifs, l'XP et les projets ; la prime, elle, est plafonnée.
  day.delivered = (day.delivered ?? 0) + 1;
  workXp(store, day, WORK.xpPerDelivery);
  trackProject(eco, day, project, 0, 1, now);
  workEvent(store, "delivery", `${SPECIALTIES[src] ?? src} a livré une tâche${project ? ` · ${project}` : ""}`, { t: now, src, project: project ?? null });
  if (day.delivered >= 20) badge(store, "courier");
  checkObjectives(store, day, now);
  if (day.deliveries >= PRIMES.delivery.dailyMax) return;
  const { rank } = tierOf(store, src), event = eventOf(day.date);
  const amount = (PRIMES.delivery.base + PRIMES.delivery.perRank * rank) * (event.delivery ?? 1);
  day.deliveries++;
  day.primes = money(day.primes + amount);
  credit(store, amount, "prime", `Prime de livraison · ${src}`, now);
}
function reactivity(store, now) {
  const eco = economyOf(store), day = ensureDay(eco, now);
  if (day.reactivity >= PRIMES.reactivity.dailyMax) return;
  day.reactivity++;
  day.primes = money(day.primes + PRIMES.reactivity.amount);
  credit(store, PRIMES.reactivity.amount, "prime", "Prime de réactivité · accord donné en moins de 2 min", now);
}

// Après chaque événement reçu : temps de travail entre deux signes de vie (10 min au plus), livraisons, accords rapides.
export function onIngestEconomy(store, prevSessions, now = Date.now() / 1000) {
  const eco = economyOf(store);
  ensureDay(eco, now);
  for (const [key, s] of Object.entries(store.sessions ?? {})) {
    const was = prevSessions?.[key];
    if (!TOOL_PROVIDER[s.src]) continue;
    if (typeof s.model === "string" && s.model) staffOf(eco, s.src).model = s.model;
    if (!was || !(s.updated > was.updated)) continue;
    if (was.state === "travaille") work(store, s.src, Math.min(s.updated - was.updated, 600) / 60, s.updated, now, s.project ?? null);
    if (was.state === "travaille" && s.state === "fini") delivery(store, s.src, now, s.project ?? null);
    if (was.state === "autorisation" && s.state === "travaille" && s.updated - was.updated <= PRIMES.reactivity.within) reactivity(store, now);
  }
}

// ---------- actions du résident ----------

export function setSubscription(store, provider, tierId, now = Date.now() / 1000) {
  const eco = economyOf(store), def = PROVIDERS[provider];
  if (!def) return { error: "Fournisseur inconnu." };
  const tier = tierId ? def.tiers.find(t => t.id === tierId) : null;
  if (tierId && !tier) return { error: "Formule inconnue." };
  const current = eco.subs[provider], currentRank = def.tiers.find(t => t.id === current?.tier)?.rank ?? -1;
  if ((current?.tier ?? null) !== (tier?.id ?? null)) {
    // Monter en gamme : une fois toutes les 6 h. Descendre : toujours possible.
    if (tier && tier.rank > currentRank && current?.upAt && now - current.upAt < UPGRADE_COOLDOWN)
      return { error: `Nouvelle montée en gamme possible dans ${Math.ceil((UPGRADE_COOLDOWN - (now - current.upAt)) / 3600)} h.` };
    eco.subs[provider] = { tier: tier?.id ?? null, at: now, upAt: tier && tier.rank > currentRank ? now : current?.upAt ?? null };
    const grade = GRADES[tier?.rank ?? 0];
    pushToast(gameOf(store), `Abonnement ${def.name} : ${tier?.name ?? "retiré"}`, `Tes agents ${def.name} deviennent ${grade.icon} ${grade.title} · ${grade.rate} ${"P$"}/h de base`);
  }
  return { ok: true, economy: publicEconomy(store, now) };
}

export function buyItem(store, itemId, target, now = Date.now() / 1000) {
  const eco = economyOf(store), day = ensureDay(eco, now), item = SHOP.find(i => i.id === itemId);
  if (!item) return { error: "Article inconnu." };
  const price = Math.round(item.price * (eventOf(day.date).shop ?? 1));
  if (item.kind === "decor" && eco.decor.includes(item.id)) return { error: "Déjà dans ton bureau." };
  if (item.id === "assurance" && eco.perks.assurance) return { error: "Ton assurance casino est déjà active." };
  if (item.target && !TOOL_PROVIDER[target]) return { error: "Choisis l'agent à former." };
  if (eco.wallet < price) return { error: `Solde insuffisant : il te faut ${price} P$.` };
  eco.wallet = money(eco.wallet - price);
  log(eco, { t: now, kind: "buy", label: `${item.icon} ${item.name}${item.target ? ` · ${target}` : ""}`, amount: -price });
  if (item.hours) eco.perks[item.id] = Math.max(now, eco.perks[item.id] ?? 0) + item.hours * 3600;
  if (item.id === "assurance") eco.perks.assurance = true;
  if (item.xp) grantXp(gameOf(store), item.xp, item.name);
  if (item.minutes) {
    const st = staffOf(eco, target), before = echelonOf(st.minutes);
    st.minutes = money(st.minutes + item.minutes);
    promote(store, target, before, now);
  }
  if (item.kind === "decor") {
    eco.decor.push(item.id);
    if (eco.decor.length >= 3) badge(store, "decorator");
  }
  pushToast(gameOf(store), "Achat", `${item.icon} ${item.name} · −${price} P$`);
  return { ok: true, economy: publicEconomy(store, now) };
}

function drawSlot(rng) {
  const total = CASINO.slots.symbols.reduce((n, s) => n + s.w, 0);
  let pick = rng(0, total);
  for (const s of CASINO.slots.symbols) { if (pick < s.w) return s; pick -= s.w; }
  return CASINO.slots.symbols[0];
}
// Multiplicateur de la machine à sous (mise comprise) pour trois rouleaux.
export function slotsMultiplier(reels, event = {}) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    const symbol = CASINO.slots.symbols.find(s => s.s === a);
    return a === "7️⃣" && event.jackpot ? event.jackpot : symbol.pay3;
  }
  return a === b || b === c || a === c ? CASINO.slots.pair : 0;
}
const ROULETTE_BETS = ["rouge", "noir", "pair", "impair"];
const GAME_NAMES = { slots: "Machine à sous", roulette: "Roulette", race: "Course de robots", blackjack: "Blackjack", tennis: "Match de tennis", golf: "Putt de golf" };

// Contrôles communs avant toute mise : bornes, solde, limites du jour.
function betError(eco, day, bet) {
  const c = day.casino;
  if (!Number.isFinite(bet) || bet < CASINO.minBet || bet > CASINO.maxBet) return `Mise entre ${CASINO.minBet} et ${CASINO.maxBet} P$.`;
  if (bet > eco.wallet) return "Solde insuffisant pour cette mise.";
  if (c.plays >= CASINO.dailyPlays) return "Assez joué pour aujourd'hui : le casino rouvre demain.";
  if (c.wagered - c.won + bet > CASINO.dailyLossLimit) return "Limite de pertes du jour atteinte : le casino te raccompagne à la porte.";
  return null;
}
function stake(eco, day, bet, newPlay = true) {
  if (newPlay) day.casino.plays++;
  day.casino.wagered += bet;
  eco.wallet = money(eco.wallet - bet);
}
// Règlement d'une partie : gain, relevé, toasts, assurance, records.
function settle(store, game, bet, win, label, now, big = false) {
  const eco = economyOf(store), day = ensureDay(eco, now), net = win - bet, toasts = gameOf(store);
  day.casino.won += win;
  eco.wallet = money(eco.wallet + win);
  log(eco, { t: now, kind: "casino", label: `${GAME_NAMES[game]} · ${label}`, amount: net });
  if (net > 0) pushToast(toasts, big ? "JACKPOT !" : "Gagné !", `+${net} P$ · ${GAME_NAMES[game]}`);
  if (net < 0 && eco.perks.assurance) {
    const refund = Math.min(500, money(-net / 2));
    delete eco.perks.assurance;
    eco.wallet = money(eco.wallet + refund);
    log(eco, { t: now, kind: "refund", label: "🛡️ Assurance casino", amount: refund });
    pushToast(toasts, "Assurance casino", `+${refund} P$ remboursés`);
  }
  if (win > eco.records.biggestWin) eco.records.biggestWin = win;
  if (eco.wallet >= 10000) badge(store, "rich");
  return { win, net };
}
const shuffle = (list, rng) => {
  for (let i = list.length - 1; i > 0; i--) { const j = rng(0, i + 1); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
};
const chance = (p, rng) => rng(0, 10000) < Math.round(p * 10000);

// ---------- blackjack : une main à la fois, le sabot reste côté serveur ----------
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"], SUITS = ["♠", "♥", "♦", "♣"];
export function handTotal(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    const rank = card.slice(0, -1);
    if (rank === "A") { aces++; total += 11; } else total += ["J", "Q", "K"].includes(rank) ? 10 : Number(rank);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}
function handView(hand, status) {
  const reveal = status !== "playing";
  return { player: [...hand.player], dealer: reveal ? [...hand.dealer] : [hand.dealer[0], "??"], playerTotal: handTotal(hand.player),
    dealerTotal: reveal ? handTotal(hand.dealer) : handTotal([hand.dealer[0]]), status, bet: hand.bet };
}
function finishHand(store, hand, status, now) {
  const eco = economyOf(store);
  eco.blackjack = null;
  const win = status === "blackjack" ? Math.floor(hand.bet * CASINO.blackjack.natural) : status === "win" ? hand.bet * CASINO.blackjack.payout : status === "push" ? hand.bet : 0;
  const view = handView(hand, status);
  const { net } = settle(store, "blackjack", hand.bet, win, `${view.playerTotal} contre ${view.dealerTotal}${status === "blackjack" ? " (blackjack)" : ""}`, now);
  return { hand: view, win, net };
}
function dealerPlays(store, hand, now) {
  while (handTotal(hand.dealer) < CASINO.blackjack.dealerStands) hand.dealer.push(hand.deck.pop());
  const me = handTotal(hand.player), bank = handTotal(hand.dealer);
  return finishHand(store, hand, bank > 21 || me > bank ? "win" : me === bank ? "push" : "lose", now);
}
function playBlackjack(store, action, betRaw, now, rng) {
  const eco = economyOf(store), day = ensureDay(eco, now), hand = eco.blackjack;
  if (action === "deal") {
    if (hand) return { error: "Termine d'abord ta main en cours." };
    const bet = Math.floor(Number(betRaw)), error = betError(eco, day, bet);
    if (error) return { error };
    const deck = shuffle(SUITS.flatMap(s => RANKS.map(r => r + s)), rng);
    const fresh = { bet, deck, player: [deck.pop()], dealer: [deck.pop()] };
    fresh.player.push(deck.pop()); fresh.dealer.push(deck.pop());
    stake(eco, day, bet);
    const mine = handTotal(fresh.player) === 21, bank = handTotal(fresh.dealer) === 21;
    if (mine || bank) return { ok: true, result: finishHand(store, fresh, mine && bank ? "push" : mine ? "blackjack" : "lose", now) };
    eco.blackjack = fresh;
    return { ok: true, result: { hand: handView(fresh, "playing"), win: 0, net: 0 } };
  }
  if (!hand) return { error: "Aucune main en cours : distribue d'abord." };
  if (action === "hit") {
    hand.player.push(hand.deck.pop());
    const total = handTotal(hand.player);
    if (total > 21) return { ok: true, result: finishHand(store, hand, "bust", now) };
    if (total === 21) return { ok: true, result: dealerPlays(store, hand, now) };
    return { ok: true, result: { hand: handView(hand, "playing"), win: 0, net: 0 } };
  }
  if (action === "stand") return { ok: true, result: dealerPlays(store, hand, now) };
  if (action === "double") {
    if (hand.player.length !== 2) return { error: "On ne double qu'avec ses deux premières cartes." };
    if (hand.bet > eco.wallet) return { error: "Solde insuffisant pour doubler." };
    if (day.casino.wagered - day.casino.won + hand.bet > CASINO.dailyLossLimit) return { error: "Limite de pertes du jour atteinte : impossible de doubler." };
    stake(eco, day, hand.bet, false);
    hand.bet *= 2;
    hand.player.push(hand.deck.pop());
    if (handTotal(hand.player) > 21) return { ok: true, result: finishHand(store, hand, "bust", now) };
    return { ok: true, result: dealerPlays(store, hand, now) };
  }
  return { error: "Action inconnue : deal, hit, stand ou double." };
}

// Score d'un set gagné par `winner` : 6-0 à 6-4, ou 7-5 ; le gagnant marque le dernier jeu.
function tennisSet(won, rng) {
  const loserGames = rng(0, 6), winnerGames = loserGames === 5 ? 7 : 6;
  const [w, l] = won ? ["toi", "pro"] : ["pro", "toi"];
  const games = loserGames === 5
    ? [...shuffle([...Array(5).fill(w), ...Array(5).fill(l)], rng), w, w]
    : [...shuffle([...Array(winnerGames - 1).fill(w), ...Array(loserGames).fill(l)], rng), w];
  return { games, score: won ? [winnerGames, loserGames] : [loserGames, winnerGames] };
}

// opts.pool : jackpot commun du penthouse au moment de la partie (lu par le serveur HTTP).
// Le résultat peut contenir `jackpot` : { add } (part de la mise qui l'alimente) ou { won } (gagné, à remettre à zéro).
export function playCasino(store, game, betRaw, choiceRaw, now = Date.now() / 1000, rng = randomInt, opts = {}) {
  const eco = economyOf(store), day = ensureDay(eco, now), event = eventOf(day.date);
  const choice = String(choiceRaw ?? "").toLowerCase();
  if (game === "blackjack") {
    const r = playBlackjack(store, String(opts.action ?? "deal"), betRaw, now, rng);
    return r.error ? r : { ...r, economy: publicEconomy(store, now) };
  }
  if (!["slots", "roulette", "race", "tennis", "golf"].includes(game)) return { error: "Jeu inconnu." };
  const bet = Math.floor(Number(betRaw)), error = betError(eco, day, bet);
  if (error) return { error };
  let result, multiplier = 0, label = "";
  if (game === "slots") {
    const reels = [drawSlot(rng).s, drawSlot(rng).s, drawSlot(rng).s];
    multiplier = slotsMultiplier(reels, event);
    result = { reels };
    label = reels.join("");
  } else if (game === "roulette") {
    const number = /^\d{1,2}$/.test(choice) ? Number(choice) : null;
    if (!ROULETTE_BETS.includes(choice) && !(number !== null && number <= 36)) return { error: "Mise sur rouge, noir, pair, impair ou un numéro de 0 à 36." };
    const n = rng(0, 37), color = n === 0 ? "vert" : CASINO.roulette.red.includes(n) ? "rouge" : "noir";
    const won = number !== null ? n === number : choice === "pair" ? n !== 0 && n % 2 === 0 : choice === "impair" ? n % 2 === 1 : choice === color;
    multiplier = won ? (number !== null ? CASINO.roulette.number : CASINO.roulette.even) : 0;
    result = { number: n, color };
    label = `${n} ${color}`;
  } else if (game === "race") {
    if (!CASINO.race.runners.includes(choice)) return { error: "Choisis ton robot." };
    const order = shuffle([...CASINO.race.runners], rng);
    multiplier = order[0] === choice ? CASINO.race.payout : 0;
    result = { order, winner: order[0] };
    label = `${order[0]} gagne`;
  } else if (game === "tennis") {
    const style = CASINO.tennis.styles.find(s => s.id === choice);
    if (!style) return { error: "Choisis ton style de jeu." };
    const won = chance(style.chance, rng);
    multiplier = won ? style.payout : 0;
    result = { style: style.id, won, ...tennisSet(won, rng) };
    label = `${result.score.join("-")} ${won ? "victoire" : "défaite"}`;
  } else {
    const shot = CASINO.golf.shots.find(s => s.id === choice);
    if (!shot) return { error: "Choisis ton putt." };
    const holed = chance(shot.chance, rng);
    multiplier = holed ? shot.payout : 0;
    result = { shot: shot.id, holed, miss: holed ? null : ["trop court", "trop long", "à gauche", "à droite"][rng(0, 4)] };
    label = `${shot.name} ${holed ? "dans le trou" : result.miss}`;
  }
  stake(eco, day, bet);
  const jackpot777 = game === "slots" && result.reels.every(r => r === "7️⃣");
  const { win, net } = settle(store, game, bet, Math.floor(bet * multiplier), label, now, game === "slots" && multiplier >= 20);
  const out = { ok: true, result: { ...result, win, net } };
  if (game === "slots") {
    const pool = Math.floor(Number(opts.pool) || 0);
    if (jackpot777) {
      eco.records.jackpots++;
      badge(store, "jackpot");
      if (pool > 0) {
        eco.wallet = money(eco.wallet + pool);
        log(eco, { t: now, kind: "casino", label: "💰 Jackpot commun du penthouse", amount: pool });
        pushToast(gameOf(store), "JACKPOT COMMUN !", `+${pool} P$ pour toi`);
        if (pool > eco.records.biggestWin) eco.records.biggestWin = pool;
        out.result.progressive = pool;
        out.jackpot = { won: pool };
      }
    }
    out.jackpot ??= { add: money(bet * CASINO.jackpot.share) };
  }
  out.economy = publicEconomy(store, now);
  return out;
}

// ---------- mini-jeux d'adresse (tennis, golf) ----------
// Joués dans le navigateur : le score vient du joueur. On vérifie qu'il est possible (bornes, durée minimale) et on plafonne
// les parties récompensées par jour ; au-delà, la partie compte pour le plaisir et l'activité, sans gain.
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
export function playSport(store, sport, input, now = Date.now() / 1000) {
  const eco = economyOf(store), day = ensureDay(eco, now), game = gameOf(store);
  const duration = Number(input?.duration);
  let money = 0, xp = 0, label = "", toast = "";
  if (sport === "tennis") {
    const rules = SPORTS.tennis, level = rules.levels.find(l => l.id === input?.level), games = input?.games;
    if (!level) return { error: "Niveau inconnu." };
    if (!Array.isArray(games) || games.length !== 2 || !games.every(g => isInt(g, 0, rules.gamesToWin))
      || games.filter(g => g === rules.gamesToWin).length !== 1) return { error: "Score de match impossible." };
    const won = games[0] === rules.gamesToWin;
    if (input?.won !== won) return { error: "Score de match incohérent." };
    if (!(duration >= (games[0] + games[1]) * rules.minSecondsPerGame && duration <= 3600)) return { error: "Durée de match impossible." };
    [money, xp] = won ? [level.money, level.xp] : [0, rules.lossXp];
    label = `Tennis · ${won ? "victoire" : "défaite"} ${games.join("-")} contre ${level.name}`;
    toast = won ? `🎾 Victoire ${games.join("-")} contre ${level.name}` : `🎾 Défaite ${games.join("-")}, revanche ?`;
    if (won && level.id === "legende") badge(store, "champion");
  } else if (sport === "golf") {
    const rules = SPORTS.golf, strokes = input?.strokes;
    if (!Array.isArray(strokes) || strokes.length !== rules.par.length || !strokes.every(n => isInt(n, 1, rules.maxStrokes)))
      return { error: "Carte de score impossible." };
    if (!(duration >= rules.par.length * rules.minSecondsPerHole && duration <= 3600)) return { error: "Durée de parcours impossible." };
    const total = strokes.reduce((a, b) => a + b, 0), par = rules.par.reduce((a, b) => a + b, 0), diff = total - par;
    const aces = strokes.filter(n => n === 1).length;
    if (diff < 0) [money, xp] = [rules.par0.money + rules.underPar.money * -diff, rules.par0.xp + rules.underPar.xp * -diff];
    else if (diff === 0) [money, xp] = [rules.par0.money, rules.par0.xp];
    else xp = rules.overXp;
    money += aces * rules.ace;
    if (aces) badge(store, "ace");
    const vsPar = diff === 0 ? "au par" : diff < 0 ? `${diff} sous le par` : `+${diff}`;
    label = `Golf · ${total} coups (${vsPar})${aces ? ` · ${aces} trou(s) en un` : ""}`;
    toast = `⛳ ${total} coups, ${vsPar}${aces ? ` · trou en un !` : ""}`;
  } else return { error: "Sport inconnu." };
  markActive(game, now);
  day.sports ??= {};
  const played = day.sports[sport] ?? 0;
  day.sports[sport] = played + 1;
  const capped = played >= SPORTS.dailyRewards;
  if (capped) [money, xp] = [0, 0];
  if (money > 0) credit(store, money, "prime", label, now);
  if (xp > 0) grantXp(game, xp, label);
  pushToast(game, toast, capped ? "Limite du jour atteinte : partie pour le plaisir." : `${money ? `+${money} P$` : ""}${money && xp ? " · " : ""}${xp ? `+${xp} XP` : ""}`);
  return { ok: true, reward: { money, xp, capped, left: Math.max(0, SPORTS.dailyRewards - played - 1) }, economy: publicEconomy(store, now) };
}

// Prime de collègue : d'un étage à un autre, dans la même transaction de base.
export function tip(from, to, amountRaw, messageRaw, now = Date.now() / 1000) {
  if (!to) return { error: "Résident introuvable." };
  if (from.slug === to.slug) return { error: "Une prime à soi-même ? Bien essayé." };
  const eco = economyOf(from.store), day = ensureDay(eco, now), amount = Math.floor(Number(amountRaw));
  if (!Number.isFinite(amount) || amount < TIPS.min) return { error: `Prime minimum : ${TIPS.min} P$.` };
  if (day.tipsSent + amount > TIPS.dailyMax) return { error: `Plafond des primes du jour : encore ${TIPS.dailyMax - day.tipsSent} P$.` };
  if (amount > eco.wallet) return { error: "Solde insuffisant." };
  const message = String(messageRaw ?? "").replace(/\s+/g, " ").trim().slice(0, TIPS.message);
  const target = economyOf(to.store);
  ensureDay(target, now);
  eco.wallet = money(eco.wallet - amount);
  day.tipsSent += amount;
  eco.counters.tipsSent = (eco.counters.tipsSent ?? 0) + 1;
  log(eco, { t: now, kind: "tip_out", label: `Prime à ${to.name}${message ? " · " + message : ""}`, amount: -amount });
  target.wallet = money(target.wallet + amount);
  log(target, { t: now, kind: "tip_in", label: `Prime de ${from.name}${message ? " · " + message : ""}`, amount });
  // Le destinataire est prévenu par son interface, qui repère la nouvelle ligne « tip_in » de son relevé.
  pushToast(gameOf(from.store), "Prime envoyée", `${amount} P$ à ${to.name}`);
  if (eco.counters.tipsSent >= 3) badge(from.store, "generous");
  if (target.wallet >= 10000) badge(to.store, "rich");
  return { ok: true, economy: publicEconomy(from.store, now) };
}

// Récompense en P$ d'une mission du jour.
export function questReward(store, amount, title, now = Date.now() / 1000) {
  credit(store, amount, "quest", `Mission · ${title}`, now);
}
// Salaires du jour, pour la mission « Jour de paie ».
export const todayPay = (store, now) => {
  const day = store.economy?.day;
  return day && day.date === paris(now).day ? sum(day.pay) : 0;
};

// ---------- vues ----------

function staffView(store, src, now) {
  const eco = economyOf(store), day = ensureDay(eco, now), st = eco.staff[src] ?? { minutes: 0 };
  const { provider, tier, verified } = tierOf(store, src);
  const { grade, baseRate, rate, factors, morale, echelon } = rateFor(store, src, now);
  const specialty = SPECIALTIES[src] ?? FREELANCE.specialty, todayMinutes = day.minutes[src] ?? 0;
  const sessions = Object.values(store.sessions ?? {}).filter(s => s.src === src);
  return {
    src, provider, providerName: PROVIDERS[provider]?.name ?? null, tier: tier && { id: tier.id, name: tier.name }, verified,
    grade: { id: grade.id, title: grade.title, icon: grade.icon, rank: grade.rank }, specialty, role: `${grade.icon} ${grade.title} · ${specialty}`,
    baseRate, rate, factors, echelon, nextEchelon: echelon < ECHELONS.length ? money(ECHELONS[echelon] - st.minutes) : null,
    minutes: money(st.minutes), todayMinutes: money(todayMinutes), todayPay: money(day.pay[src] ?? 0),
    overtime: todayMinutes > WORKDAY.normal, resting: todayMinutes >= WORKDAY.max, morale,
    active: sessions.filter(s => s.state === "travaille" && now - s.updated <= 600).length, model: st.model ?? null,
  };
}

export function publicEconomy(store, now = Date.now() / 1000) {
  const eco = economyOf(store), day = ensureDay(eco, now), event = eventOf(day.date);
  // Employés : outils déjà vus ou payés, et ceux dont le résident a déclaré l'abonnement.
  const seen = new Set([...Object.keys(eco.staff), ...Object.values(store.sessions ?? {}).map(s => s.src)]);
  for (const [provider, sub] of Object.entries(eco.subs)) if (sub?.tier) for (const t of PROVIDERS[provider]?.tools ?? []) seen.add(t);
  const staff = TOOLS_ORDER.filter(src => seen.has(src)).map(src => staffView(store, src, now));
  const perks = Object.fromEntries(Object.entries(eco.perks).filter(([k, v]) => k === "assurance" ? v : v > now));
  return {
    wallet: eco.wallet, earned: eco.earned, title: titleOf(eco.earned),
    event: { id: event.id, name: event.name, icon: event.icon, desc: event.desc },
    today: { date: day.date, pay: money(sum(day.pay)), minutes: money(sum(day.minutes)), deliveries: day.deliveries, reactivity: day.reactivity,
      primes: day.primes, casinoNet: day.casino.won - day.casino.wagered, tipsSent: day.tipsSent, tipsLeft: TIPS.dailyMax - day.tipsSent },
    staff,
    subs: Object.fromEntries(Object.entries(eco.subs).filter(([, s]) => s?.tier).map(([p, s]) => [p, s.tier])),
    perks, decor: [...eco.decor],
    ledger: eco.ledger.slice(0, 15).map(({ t, kind, label, amount }) => ({ t, kind, label, amount })),
    history: eco.history.slice(0, 7),
    records: { ...eco.records },
    casino: { plays: day.casino.plays, wagered: day.casino.wagered, won: day.casino.won,
      lossLeft: Math.max(0, CASINO.dailyLossLimit - (day.casino.wagered - day.casino.won)), playsLeft: Math.max(0, CASINO.dailyPlays - day.casino.plays) },
    shopFactor: event.shop ?? 1,
    work: workView(store, eco, day, now),
    // Main de blackjack en cours (carte cachée de la banque masquée), pour la reprendre après un rechargement.
    blackjack: eco.blackjack ? handView(eco.blackjack, "playing") : null,
  };
}

// Le travail du jour : objectifs, prime d'équipe, série, projets et derniers exploits.
function workView(store, eco, day, now) {
  const minutes = todayMinutes(day), team = workingNow(store, now);
  const teamBonus = team > 1 ? Math.min(WORK.team.max, WORK.team.per * (team - 1)) : 0;
  const streakDays = currentWorkStreak(eco, day.date);
  const metric = { minutes, deliveries: day.delivered ?? 0, parallel: day.peakParallel ?? 0 };
  const projects = Object.entries(eco.projects ?? {}).map(([name, p]) => {
    const level = projectLevel(p.minutes);
    return { name, todayMinutes: money(day.projects?.[name] ?? 0), minutes: money(p.minutes), deliveries: p.deliveries, level,
      nextLevelIn: level < WORK.projectLevels.length ? money(WORK.projectLevels[level] - p.minutes) : null };
  }).sort((a, b) => b.todayMinutes - a.todayMinutes || b.minutes - a.minutes).slice(0, 5);
  return {
    today: { minutes: money(minutes), deliveries: day.delivered ?? 0, tools: Object.keys(day.tools ?? {}).length, peakParallel: day.peakParallel ?? 0 },
    team: { active: team, bonus: money(teamBonus),
      label: team > 1 ? `Prime d'équipe +${Math.round(teamBonus * 100)} % (${team} agents)` : team === 1 ? "1 agent au travail" : "Personne au travail" },
    streak: { days: streakDays, bonus: money(streakDays ? Math.min(WORK.streak.max, WORK.streak.per * streakDays) : 0), today: eco.workStreak?.lastDay === day.date },
    objectives: WORK.objectives.map(o => ({ id: o.id, title: o.title, icon: o.icon, metric: o.metric, target: o.target,
      progress: Math.min(o.target, money(metric[o.metric])), money: o.money, xp: o.xp, done: !!day.objectives?.[o.id] })),
    projects, xpToday: money(day.workXp ?? 0), xpCap: WORK.dailyXpCap,
    events: (eco.events ?? []).slice(0, 12),
  };
}

// Vue spectateur : la réussite de chacun, pas le détail de ses comptes ni de ses machines.
export function spectatorEconomy(view) {
  if (!view) return undefined;
  return { wallet: view.wallet, earned: view.earned, title: view.title, today: { pay: view.today?.pay ?? 0, minutes: view.today?.minutes ?? 0 },
    records: view.records, decor: [...(view.decor ?? [])], // le décor se voit dans la tour, aussi en spectateur
    work: view.work ? { today: { minutes: view.work.today.minutes, deliveries: view.work.today.deliveries }, team: { active: view.work.team.active },
      streak: { days: view.work.streak.days } } : undefined,
    staff: (view.staff ?? []).map(({ src, grade, role, echelon }) => ({ src, grade, role, echelon })) };
}
