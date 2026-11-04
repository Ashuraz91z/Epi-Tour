// Administration du penthouse, à lancer sur le serveur (même base SQLite que server.js, même DATA_DIR) :
//   node admin.js list                         liste les étages
//   node admin.js merge <de> <vers>            fusionne l'étage <de> dans <vers> (même personne, deux étages)
//   node admin.js rename <étage> "<nom>"        renomme un étage en gardant sa clé
//   node admin.js remove <étage> --oui          supprime un étage
// <étage> : le nom ou son identifiant (« Paul-Arien » ou « paul-arien »). Le serveur peut tourner pendant ce temps :
// chaque opération est une transaction. Les machines de l'étage fusionné restent reliées (sa clé suit l'étage).
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "./db.js";
import { slugify } from "./penthouse.js";

const money = x => Math.round(x * 100) / 100;
const sumMaps = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = money((out[k] ?? 0) + (Number(v) || 0));
  return out;
};
const newer = (a, b, key = "t") => ((b?.[key] ?? 0) > (a?.[key] ?? 0) ? b : a);

function mergeGame(into = {}, from = {}) {
  const game = { ...into };
  game.xp = (into.xp ?? 0) + (from.xp ?? 0);
  game.streak = Math.max(into.streak ?? 0, from.streak ?? 0);
  game.lastDay = [into.lastDay, from.lastDay].filter(Boolean).sort().at(-1) ?? null;
  game.badges = [...new Set([...(into.badges ?? []), ...(from.badges ?? [])])];
  game.toast = [];
  return game;
}

function mergeEconomy(into, from) {
  if (!from) return into;
  if (!into) return from;
  const eco = { ...into };
  eco.wallet = money((into.wallet ?? 0) + (from.wallet ?? 0));
  eco.earned = money((into.earned ?? 0) + (from.earned ?? 0));
  eco.subs = { ...(from.subs ?? {}), ...(into.subs ?? {}) };
  eco.staff = { ...(into.staff ?? {}) };
  for (const [src, st] of Object.entries(from.staff ?? {})) {
    const mine = eco.staff[src];
    eco.staff[src] = mine ? { ...mine, minutes: money((mine.minutes ?? 0) + (st.minutes ?? 0)), lastWork: Math.max(mine.lastWork ?? 0, st.lastWork ?? 0),
      model: (st.lastWork ?? 0) > (mine.lastWork ?? 0) ? st.model ?? mine.model : mine.model ?? st.model } : st;
  }
  // Même journée : salaires, minutes, primes et casino additionnés ; sinon la journée la plus récente.
  if (into.day && from.day && into.day.date === from.day.date) {
    const a = into.day, b = from.day;
    eco.day = { ...a, minutes: sumMaps(a.minutes, b.minutes), pay: sumMaps(a.pay, b.pay), primes: money((a.primes ?? 0) + (b.primes ?? 0)),
      deliveries: (a.deliveries ?? 0) + (b.deliveries ?? 0), reactivity: (a.reactivity ?? 0) + (b.reactivity ?? 0),
      casino: sumMaps(a.casino, b.casino), tipsSent: (a.tipsSent ?? 0) + (b.tipsSent ?? 0) };
  } else eco.day = (from.day?.date ?? "") > (into.day?.date ?? "") ? from.day : into.day;
  const days = new Map();
  for (const d of [...(into.history ?? []), ...(from.history ?? [])]) {
    const prev = days.get(d.date);
    days.set(d.date, prev ? { date: d.date, pay: money(prev.pay + d.pay), minutes: money(prev.minutes + d.minutes) } : d);
  }
  eco.history = [...days.values()].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 14);
  eco.ledger = [...(into.ledger ?? []), ...(from.ledger ?? [])].sort((x, y) => y.t - x.t).slice(0, 40);
  eco.perks = { ...(from.perks ?? {}) };
  for (const [k, v] of Object.entries(into.perks ?? {})) eco.perks[k] = typeof v === "number" ? Math.max(v, eco.perks[k] ?? 0) : v || eco.perks[k];
  eco.decor = [...new Set([...(into.decor ?? []), ...(from.decor ?? [])])];
  eco.records = { biggestWin: Math.max(into.records?.biggestWin ?? 0, from.records?.biggestWin ?? 0),
    jackpots: (into.records?.jackpots ?? 0) + (from.records?.jackpots ?? 0) };
  eco.counters = sumMaps(into.counters, from.counters);
  eco.blackjack = into.blackjack ?? from.blackjack ?? null;
  return eco;
}

// Deux étages d'une même personne : tout ce qui se cumule est additionné, le reste garde la version la plus récente.
export function mergeStores(into, from) {
  const store = { ...into };
  store.sessions = { ...(from.sessions ?? {}), ...(into.sessions ?? {}) };
  store.feed = [...(into.feed ?? []), ...(from.feed ?? [])].sort((a, b) => a.t - b.t).slice(-150);
  store.usage = { ...(into.usage ?? {}) };
  for (const [provider, u] of Object.entries(from.usage ?? {})) store.usage[provider] = newer(store.usage[provider], u, "ts");
  store.seen = { ...(into.seen ?? {}) };
  for (const [machine, m] of Object.entries(from.seen ?? {})) store.seen[machine] = newer(store.seen[machine], m);
  store.stats = { ...(into.stats ?? {}) };
  for (const [day, bySrc] of Object.entries(from.stats ?? {})) {
    const target = { ...(store.stats[day] ?? {}) };
    for (const [src, d] of Object.entries(bySrc)) target[src] = { sessions: (target[src]?.sessions ?? 0) + (d.sessions ?? 0), actions: (target[src]?.actions ?? 0) + (d.actions ?? 0) };
    store.stats[day] = target;
  }
  store.health = newer(into.health, from.health);
  store.profile = into.profile ?? from.profile;
  store.game = mergeGame(into.game, from.game);
  store.economy = mergeEconomy(into.economy, from.economy);
  return store;
}

// ---------- ligne de commande ----------

export function runAdmin(db, args, print = console.log) {
  const [command, ...rest] = args;
  const find = name => {
    const slug = slugify(String(name ?? ""));
    return db.get(slug) ? slug : null;
  };
  if (command === "list") {
    for (const a of db.all()) {
      const s = a.store;
      print([a.slug.padEnd(24), a.name.padEnd(26), new Date(a.created * 1000).toISOString().slice(0, 16),
        `${Object.keys(s.sessions ?? {}).length} session(s)`, `${Object.keys(s.seen ?? {}).length} machine(s)`,
        `${money(s.economy?.wallet ?? 0)} P$`, `${s.game?.xp ?? 0} XP`].join("  "));
    }
    return 0;
  }
  if (command === "merge") {
    const from = find(rest[0]), into = find(rest[1]);
    if (!from || !into) { print(`Étage introuvable : ${!from ? rest[0] : rest[1]}`); return 1; }
    if (from === into) { print("Un étage ne se fusionne pas avec lui-même."); return 1; }
    const done = db.merge(from, into, mergeStores);
    print(done ? `« ${done.from} » fusionné dans « ${done.into} ». Ses machines restent reliées à « ${done.into} ».` : "Fusion impossible.");
    return done ? 0 : 1;
  }
  if (command === "rename") {
    const slug = find(rest[0]), name = String(rest[1] ?? "").trim().slice(0, 32), newSlug = slugify(name);
    if (!slug) { print(`Étage introuvable : ${rest[0]}`); return 1; }
    if (!newSlug || ["roof", "lounge", "club", "casino", "tennis", "golf"].includes(newSlug)) { print("Nom invalide ou réservé."); return 1; }
    if (!db.rename(slug, newSlug, name)) { print(`Le nom « ${name} » est déjà pris : fusionne d'abord les deux étages.`); return 1; }
    print(`« ${slug} » s'appelle maintenant « ${name} ». Sa clé ne change pas ; pour le site, rentrer avec le nouveau nom.`);
    return 0;
  }
  if (command === "remove") {
    const slug = find(rest[0]);
    if (!slug) { print(`Étage introuvable : ${rest[0]}`); return 1; }
    if (!rest.includes("--oui")) { print(`Ajoute --oui pour supprimer définitivement « ${slug} » (ses machines seront déconnectées).`); return 1; }
    db.remove(slug);
    print(`« ${slug} » supprimé.`);
    return 0;
  }
  print("Commandes : list · merge <de> <vers> · rename <étage> \"<nom>\" · remove <étage> --oui");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dataDir = process.env.DATA_DIR ?? join(homedir(), ".tour-de-controle");
  process.exitCode = runAdmin(openDb(join(dataDir, "penthouse.db")), process.argv.slice(2));
}
