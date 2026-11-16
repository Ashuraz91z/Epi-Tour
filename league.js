// Ligue de la semaine : classement des étages sur le travail réel de leurs agents, du lundi au dimanche (heure de Paris).
// Les points s'accumulent dans chaque étage (economy.js, recordLeague). Ici, la partie commune à toute la tour :
// - l'objectif du défi commun, fixé une fois par semaine d'après la semaine passée ;
// - la clôture, la première fois que le serveur tourne après lundi 0 h : classement figé, podium et défi récompensés.
// Plusieurs copies du serveur peuvent tourner : la clôture est une transaction, et chaque prime n'est versée qu'une
// fois par étage (identifiant gardé dans l'étage), même si le serveur s'arrête au milieu des versements.
import { LEAGUE } from "./public/economy-data.js";
import { leaguePrize, leagueScore, paris, weekDay, weekOf } from "./economy.js";

const KEY = "league";
const round = x => Math.round(x);

export function weekInfo(now) {
  const { day } = paris(now);
  return { week: weekOf(day), daysLeft: 7 - weekDay(day) };
}

// Objectif du défi commun (heures) : la semaine passée + 10 %, arrondi aux 5 h, entre 20 h et 300 h.
export function challengeTarget(lastTotalMinutes) {
  const c = LEAGUE.challenge;
  if (!(lastTotalMinutes > 0)) return c.min;
  return Math.max(c.min, Math.min(c.max, Math.ceil(lastTotalMinutes / 60 * c.growth / c.step) * c.step));
}

const byScore = (x, y) => y.points - x.points || y.minutes - x.minutes || y.delivered - x.delivered || x.name.localeCompare(y.name);

// Classement figé d'une semaine terminée, avec les primes à verser.
export function settleWeek(apartments, week, target) {
  const rows = apartments.map(a => ({ slug: a.slug, name: a.name, ...leagueScore(a.store, week) }))
    .filter(r => r.points > 0).sort(byScore);
  const total = rows.reduce((n, r) => n + r.minutes, 0), reached = total >= target * 60;
  const awards = [];
  rows.filter(r => r.points >= LEAGUE.minPoints).slice(0, LEAGUE.prizes.length).forEach((r, i) => {
    const p = LEAGUE.prizes[i];
    awards.push({ id: `${week}:podium`, slug: r.slug, kind: "podium", rank: p.rank, icon: p.icon, title: p.title, money: p.money, xp: p.xp });
  });
  if (reached) for (const r of rows.filter(r => r.minutes >= LEAGUE.challenge.minMinutes)) {
    const c = LEAGUE.challenge;
    awards.push({ id: `${week}:challenge`, slug: r.slug, kind: "challenge", icon: c.icon, title: c.title, money: c.money, xp: c.xp });
  }
  return { week, target, total: round(total), reached,
    ranking: rows.slice(0, 10).map(r => ({ slug: r.slug, name: r.name, points: round(r.points), minutes: round(r.minutes), delivered: r.delivered })),
    champion: awards.find(a => a.kind === "podium" && a.rank === 1)?.slug ?? null, awards };
}

// Appelé avant chaque état envoyé (toutes les 2 s au plus) : une lecture de réglage, sauf le lundi et s'il reste à payer.
export function leagueTick(db, now = Date.now() / 1000) {
  const { week } = weekInfo(now);
  let state = db.setting(KEY);
  if (state?.current?.week !== week) {
    state = db.updateSetting(KEY, cur => {
      cur = { current: null, history: [], ...(cur ?? {}) };
      if (cur.current?.week === week) return cur; // une autre copie du serveur vient de clôturer
      const old = cur.current;
      if (old?.week && old.week < week && !cur.history.some(h => h.week === old.week)) {
        cur.history.unshift(settleWeek(db.all(), old.week, old.target));
        cur.history.splice(12);
      }
      cur.current = { week, target: challengeTarget(cur.history[0]?.total), since: now };
      return cur;
    });
  }
  const pending = (state.history ?? []).flatMap(h => (h.awards ?? []).filter(a => !a.paid).map(a => ({ ...a, week: h.week })));
  if (!pending.length) return state;
  for (const a of pending) db.change(a.slug, store => leaguePrize(store, a, now)); // étage supprimé depuis : rien
  return db.updateSetting(KEY, cur => {
    for (const h of cur.history ?? []) for (const a of h.awards ?? []) if (pending.some(p => p.id === a.id && p.slug === a.slug)) a.paid = true;
    return cur;
  });
}

// Ce que voient résidents et spectateurs : classement en direct, défi commun, podium et champion de la semaine passée.
export function publicLeague(state, apartments, now = Date.now() / 1000) {
  const { week, daysLeft } = weekInfo(now);
  const target = state?.current?.week === week ? state.current.target : challengeTarget(state?.history?.[0]?.total);
  const standings = apartments.map(a => ({ slug: a.slug, name: a.name, points: round(a.economy?.league?.week === week ? a.economy.league.points : 0),
    minutes: round(a.economy?.league?.week === week ? a.economy.league.minutes : 0), delivered: a.economy?.league?.week === week ? a.economy.league.delivered : 0 }))
    .filter(r => r.points > 0).sort(byScore);
  const total = standings.reduce((n, r) => n + r.minutes, 0);
  const last = state?.history?.[0] ?? null;
  // Titres de champion gagnés sur les 12 dernières semaines, par étage.
  const titles = {};
  for (const h of state?.history ?? []) if (h.champion) titles[h.champion] = (titles[h.champion] ?? 0) + 1;
  return {
    week, number: Number(week.split("-W")[1]), daysLeft, minPoints: LEAGUE.minPoints,
    challenge: { target, total, reached: total >= target * 60 },
    standings,
    last: last && { week: last.week, number: Number(last.week.split("-W")[1]), champion: last.champion, ranking: last.ranking.slice(0, 3),
      challenge: { target: last.target, total: last.total, reached: last.reached } },
    titles,
  };
}
