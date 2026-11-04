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
  MORALE, PRIMES, PROVIDERS, SHOP, SPECIALTIES, TIPS, TITLES, TOOL_PROVIDER, WORKDAY,
} from "./public/economy-data.js";
import { createGame, grantXp, pushToast } from "./gamify.js";

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
    records: { biggestWin: 0, jackpots: 0 }, counters: { tipsSent: 0 } };
}
// Étages créés avant l'économie, ou sauvegardes partielles : on complète sans rien effacer.
function economyOf(store) {
  const eco = (store.economy ??= createEconomy());
  for (const [k, v] of Object.entries(createEconomy())) eco[k] ??= v;
  return eco;
}
const newDay = date => ({ date, minutes: {}, pay: {}, primes: 0, deliveries: 0, reactivity: 0, casino: { plays: 0, wagered: 0, won: 0 }, tipsSent: 0 });
function ensureDay(eco, now) {
  const { day } = paris(now);
  if (eco.day?.date === day) return eco.day;
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
function work(store, src, minutes, at, now) {
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
}

function delivery(store, src, now) {
  const eco = economyOf(store), day = ensureDay(eco, now);
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
    if (was.state === "travaille") work(store, s.src, Math.min(s.updated - was.updated, 600) / 60, s.updated, now);
    if (was.state === "travaille" && s.state === "fini") delivery(store, s.src, now);
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

export function playCasino(store, game, betRaw, choiceRaw, now = Date.now() / 1000, rng = randomInt) {
  const eco = economyOf(store), day = ensureDay(eco, now), c = day.casino, event = eventOf(day.date);
  const bet = Math.floor(Number(betRaw)), choice = String(choiceRaw ?? "").toLowerCase();
  if (!["slots", "roulette", "race"].includes(game)) return { error: "Jeu inconnu." };
  if (!Number.isFinite(bet) || bet < CASINO.minBet || bet > CASINO.maxBet) return { error: `Mise entre ${CASINO.minBet} et ${CASINO.maxBet} P$.` };
  if (bet > eco.wallet) return { error: "Solde insuffisant pour cette mise." };
  if (c.plays >= CASINO.dailyPlays) return { error: "Assez joué pour aujourd'hui : le casino rouvre demain." };
  if (c.wagered - c.won + bet > CASINO.dailyLossLimit) return { error: "Limite de pertes du jour atteinte : le casino te raccompagne à la porte." };
  let result, multiplier = 0;
  if (game === "slots") {
    const reels = [drawSlot(rng).s, drawSlot(rng).s, drawSlot(rng).s];
    multiplier = slotsMultiplier(reels, event);
    result = { reels };
  } else if (game === "roulette") {
    const number = /^\d{1,2}$/.test(choice) ? Number(choice) : null;
    if (!ROULETTE_BETS.includes(choice) && !(number !== null && number <= 36)) return { error: "Mise sur rouge, noir, pair, impair ou un numéro de 0 à 36." };
    const n = rng(0, 37), color = n === 0 ? "vert" : CASINO.roulette.red.includes(n) ? "rouge" : "noir";
    const won = number !== null ? n === number : choice === "pair" ? n !== 0 && n % 2 === 0 : choice === "impair" ? n % 2 === 1 : choice === color;
    multiplier = won ? (number !== null ? CASINO.roulette.number : CASINO.roulette.even) : 0;
    result = { number: n, color };
  } else {
    if (!CASINO.race.runners.includes(choice)) return { error: "Choisis ton robot." };
    const order = [...CASINO.race.runners];
    for (let i = order.length - 1; i > 0; i--) { const j = rng(0, i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    multiplier = order[0] === choice ? CASINO.race.payout : 0;
    result = { order, winner: order[0] };
  }
  const win = Math.floor(bet * multiplier), net = win - bet;
  c.plays++; c.wagered += bet; c.won += win;
  eco.wallet = money(eco.wallet - bet + win);
  const names = { slots: "Machine à sous", roulette: "Roulette", race: "Course de robots" };
  log(eco, { t: now, kind: "casino", label: `${names[game]}${game === "slots" ? " " + result.reels.join("") : game === "roulette" ? ` · ${result.number} ${result.color}` : ` · ${result.winner} gagne`}`, amount: net });
  const toasts = gameOf(store);
  if (net > 0) pushToast(toasts, game === "slots" && multiplier >= 20 ? "JACKPOT !" : "Gagné !", `+${net} P$ · ${names[game]}`);
  if (net < 0 && eco.perks.assurance) {
    const refund = Math.min(500, money(-net / 2));
    delete eco.perks.assurance;
    eco.wallet = money(eco.wallet + refund);
    log(eco, { t: now, kind: "refund", label: "🛡️ Assurance casino", amount: refund });
    pushToast(toasts, "Assurance casino", `+${refund} P$ remboursés`);
  }
  if (win > eco.records.biggestWin) eco.records.biggestWin = win;
  if (game === "slots" && result.reels.every(r => r === "7️⃣")) { eco.records.jackpots++; badge(store, "jackpot"); }
  if (eco.wallet >= 10000) badge(store, "rich");
  return { ok: true, result: { ...result, win, net }, economy: publicEconomy(store, now) };
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
  pushToast(gameOf(to.store), `💌 Prime de ${from.name}`, `+${amount} P$${message ? " · " + message : ""}`);
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
  };
}

// Vue spectateur : la réussite de chacun, pas le détail de ses comptes ni de ses machines.
export function spectatorEconomy(view) {
  if (!view) return undefined;
  return { wallet: view.wallet, earned: view.earned, title: view.title, today: { pay: view.today?.pay ?? 0, minutes: view.today?.minutes ?? 0 },
    records: view.records, staff: (view.staff ?? []).map(({ src, grade, role, echelon }) => ({ src, grade, role, echelon })) };
}
