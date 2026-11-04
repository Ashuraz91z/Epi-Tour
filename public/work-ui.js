// Le travail au centre du jeu : ce que font vraiment les agents du résident (heures, tâches livrées, agents en parallèle,
// projets) fait avancer objectifs, prime d'équipe, série et niveaux de projet. Le serveur calcule tout (economy.work) ;
// ce module ne fait que l'afficher. Fonctions pures : du HTML (ou du texte brut pour workEventText).
// Tout texte venu du serveur ou d'un autre résident passe par esc.
import { CURRENCY, ECONOMY_BADGES, WORK } from "./economy-data.js";

// ---------- formats ----------
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pctOf = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
const plural = (n, one, many) => `${nf.format(n)} ${n >= 2 ? many : one}`;
const secs = t => (num(t) > 1e12 ? num(t) / 1000 : num(t));
export function workDuration(min) {
  const m = Math.max(0, Math.round(num(min)));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
// Espace insécable avant « % » : « +20 % » ne se coupe pas en fin de ligne.
export const bonusText = b => `+${Math.round(num(b) * 100)}\u00a0%`;
const rewardText = o => [num(o.money) ? `+${nf.format(num(o.money))} ${CURRENCY}` : "", num(o.xp) ? `+${nf.format(num(o.xp))} XP` : ""].filter(Boolean).join(" · ");
export function agoText(t, now) {
  const s = Math.max(0, num(now) - secs(t));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}
const bar = (value, cls = "") => `<span class="work-bar ${cls}" aria-hidden="true"><i style="width:${value}%"></i></span>`;

// Les données du travail d'un étage, ou null. Une vue complète (le résident lui-même, ou un autre résident) a des objectifs ;
// celle d'un spectateur se limite à today.minutes, today.deliveries, team.active et streak.days.
const workOf = apt => apt?.economy?.work ?? null;
const isFull = w => Array.isArray(w?.objectives);

// ---------- objectifs et projets ----------
// Avancement d'un objectif, dans son unité : « 2 h 10 / 3 h », « 3 / 5 tâches », « 2 / 3 agents ».
export function objectiveProgressText(o) {
  const target = num(o.target), p = Math.min(num(o.progress), target);
  if (o.metric === "minutes") return `${workDuration(p)} / ${workDuration(target)}`;
  if (o.metric === "deliveries") return `${nf.format(p)} / ${plural(target, "tâche", "tâches")}`;
  if (o.metric === "parallel") return `${nf.format(p)} / ${plural(target, "agent", "agents")}`;
  return `${nf.format(p)} / ${nf.format(target)}`;
}
export const objectivePct = o => (o.done ? 100 : pctOf(num(o.progress), num(o.target)));
// Objectif en cours : celui qui n'est pas atteint et dont on est le plus près (à égalité, l'ordre du catalogue).
export function currentObjective(objectives) {
  let best = null;
  for (const o of objectives ?? []) if (!o.done && (!best || objectivePct(o) > objectivePct(best))) best = o;
  return best;
}
// Barre d'un projet vers son prochain niveau (paliers de minutes cumulées de WORK.projectLevels).
export function projectPct(p) {
  if (p.nextLevelIn == null) return 100;
  const m = num(p.minutes), start = WORK.projectLevels.filter(x => x <= m).pop() ?? 0, end = m + num(p.nextLevelIn);
  return end > start ? pctOf(m - start, end - start) : 100;
}
export const projectNextText = p => (p.nextLevelIn == null ? "niveau max" : `nv. ${num(p.level) + 1} dans ${workDuration(p.nextLevelIn)}`);

// ---------- événements ----------
const TOOL_NAMES = { claude: "Claude Code", codex: "Codex", hermes: "Hermes", grok: "Grok Bot", cursor: "Cursor", n8n: "n8n" };
const KIND_ICON = { delivery: "📦", objective: "🎯", badge: "🏅", streak: "🔥" };
// Texte court d'un événement du travail (texte brut : à passer par esc avant de l'insérer en HTML).
// tool: false retire le nom de l'outil (bulle au-dessus de l'agent 3D, qui est déjà cet outil).
export function workEventText(event, { tool = true, tools = TOOL_NAMES } = {}) {
  const e = event ?? {}, label = typeof e.label === "string" ? e.label.trim() : "";
  const project = typeof e.project === "string" && e.project ? e.project : "";
  switch (e.kind) {
    case "delivery": {
      const name = e.src ? tools[e.src]?.name ?? tools[e.src] ?? TOOL_NAMES[e.src] ?? e.src : "";
      if (tool && name) return `📦 ${name} a livré une tâche${project ? ` · ${project}` : ""}`;
      return `📦 Tâche livrée${project ? ` · ${project}` : ""}`;
    }
    case "objective": {
      const o = WORK.objectives.find(x => x.id === e.objective);
      return `🎯 Objectif atteint${o ? ` : ${o.icon} ${o.title}` : label ? ` : ${label}` : ""}`;
    }
    case "badge": {
      const name = ECONOMY_BADGES[e.badge];
      return name ? `🏅 Badge : ${name}` : label || "🏅 Nouveau badge";
    }
    case "streak": return label || "🔥 Série de travail prolongée";
    default: return label || `${KIND_ICON[e.kind] ?? "•"} ${String(e.kind ?? "Exploit")}`;
  }
}

// ---------- panneau latéral d'un étage de résident ----------
// Bloc compact (~300 px) : chiffres du jour, équipe et prime, objectif en cours, objectifs atteints, top 3 des projets.
// mine : l'étage du résident qui regarde (conseils « fais ceci pour… » ; ailleurs, ces conseils ne s'affichent pas).
export function workPanelHtml(apartment, now, esc, { mine = false } = {}) {
  const w = workOf(apartment);
  if (!w) return "";
  const today = w.today ?? {}, team = w.team ?? {}, streak = w.streak ?? {}, full = isFull(w);
  const minutes = num(today.minutes), deliveries = num(today.deliveries), active = num(team.active), days = num(streak.days);
  const streakOn = !!streak.today || (!full && days > 0);
  const stats = `<div class="work-stats">
      <span class="work-stat"><b>${workDuration(minutes)}</b><small>de travail</small></span>
      <span class="work-stat"><b>${nf.format(deliveries)}</b><small>${deliveries >= 2 ? "tâches livrées" : "tâche livrée"}</small></span>
      <span class="work-stat streak${streakOn ? " on" : ""}${days ? "" : " off"}" title="Série : jours de suite avec au moins ${workDuration(WORK.streak.minMinutes)} de travail"><b><span aria-hidden="true">🔥</span> ${days} j</b><small>série</small></span>
    </div>`;
  // Équipe : agents au travail ; à partir de deux, la prime d'équipe majore les salaires.
  const bonus = num(team.bonus);
  const teamHint = !full ? "" : bonus > 0 ? `<b class="work-bonus">Prime d'équipe ${bonusText(bonus)}</b>`
    : mine ? `<small>${active ? "un 2e agent en parallèle" : "deux agents en parallèle"} : salaires ${bonusText(WORK.team.per)}</small>` : "";
  const teamLine = `<p class="work-team${active ? " on" : ""}"><i class="d" aria-hidden="true"></i><span><b>${active}</b> ${active >= 2 ? "agents au travail" : "agent au travail"}</span>${teamHint ? `<span class="work-team-hint">${teamHint}</span>` : ""}</p>`;
  if (!full) return `<section class="work-panel lite" aria-label="Travail du jour"><h4 class="work-title">Travail du jour</h4>${stats}${teamLine}</section>`;

  const objectives = w.objectives, done = objectives.filter(o => o.done), goal = currentObjective(objectives);
  const xpToday = num(w.xpToday), xpCap = num(w.xpCap) || WORK.dailyXpCap;
  const head = `<div class="work-head"><h4 class="work-title">Travail du jour</h4>
      <span class="work-xp${xpToday >= xpCap ? " max" : ""}" title="XP gagnée par le travail aujourd'hui (plafond ${nf.format(xpCap)})">+${nf.format(Math.floor(xpToday))} / ${nf.format(xpCap)} XP</span></div>`;
  // Série pas encore comptée aujourd'hui : il manque tant de minutes pour la prolonger (ou la lancer).
  const missing = WORK.streak.minMinutes - minutes;
  const streakTip = mine && !streak.today && missing > 0
    ? `<p class="work-tip"><span aria-hidden="true">🔥</span> Encore <b>${workDuration(missing)}</b> de travail aujourd'hui pour ${days ? `prolonger ta série (${days} j)` : "lancer une série"} : ${bonusText(WORK.streak.per)} de salaire par jour.</p>` : "";
  const goalHtml = goal ? `<div class="work-goal">
      <div class="work-goal-top"><span class="work-goal-title"><span aria-hidden="true">${esc(goal.icon)}</span> ${esc(goal.title)}</span><b>${esc(objectiveProgressText(goal))}</b></div>
      ${bar(objectivePct(goal))}<small>Objectif en cours · ${esc(rewardText(goal))} à l'arrivée</small></div>`
    : `<p class="work-goal all"><span aria-hidden="true">🏆</span> Tous les objectifs du jour sont atteints\u00a0!</p>`;
  // Pastilles des objectifs atteints : nom court (« Bronze », « 5 tâches livrées ») ; au-delà de quatre, l'icône seule.
  const compact = done.length > 4;
  const doneHtml = done.length ? `<ul class="work-done${compact ? " compact" : ""}" aria-label="Objectifs atteints aujourd'hui : ${done.length} sur ${objectives.length}">${done.map(o =>
      `<li title="${esc(o.title)}"><span aria-hidden="true">${esc(o.icon)}</span>${compact ? `<span class="sr-only">${esc(o.title)}</span>` : ` ${esc(String(o.title ?? "").split(" · ")[0])}`}</li>`).join("")}<li class="work-count" aria-hidden="true">${done.length}/${objectives.length}</li></ul>` : "";
  const projects = (w.projects ?? []).slice(0, 3);
  const projectsHtml = projects.length ? `<p class="work-sub">Projets</p><ol class="work-projects" aria-label="Projets les plus actifs">${projects.map(p => `<li>
      <span class="work-pname" title="${esc(p.name)}">${esc(p.name)}</span><span class="work-plvl">Nv. ${num(p.level)}</span>
      ${bar(projectPct(p), "lvl")}<small>${num(p.todayMinutes) ? `${workDuration(p.todayMinutes)} aujourd'hui` : `${workDuration(p.minutes)} au total`} · ${esc(projectNextText(p))}</small></li>`).join("")}</ol>` : "";
  const last = (w.events ?? [])[0];
  const lastHtml = last ? `<p class="work-last"><span>${esc(agoText(last.t, now))}</span> ${esc(workEventText(last))}</p>` : "";
  return `<section class="work-panel" aria-label="Travail du jour">${head}${stats}${teamLine}${streakTip}${goalHtml}${doneHtml}${projectsHtml}${lastHtml}</section>`;
}

// ---------- classement flottant ----------
// « Employé du jour » (le plus de minutes de travail) et « Meilleur livreur » (le plus de tâches livrées).
const minutesOf = a => num(a.economy?.work?.today?.minutes ?? a.economy?.today?.minutes);
const deliveriesOf = a => num(a.economy?.work?.today?.deliveries);
function leaderOf(apartments, value) {
  let best = null;
  for (const a of apartments) {
    const v = value(a);
    if (v > 0 && (!best || v > best.v || (v === best.v && String(a.name).localeCompare(String(best.a.name), "fr") < 0))) best = { a, v };
  }
  return best;
}
export function workLeadersHtml(apartments, esc, { me = null } = {}) {
  const list = (apartments ?? []).filter(a => a?.economy);
  const rows = [
    ["⏱️", "Employé du jour", leaderOf(list, minutesOf), v => workDuration(v)],
    ["📦", "Meilleur livreur", leaderOf(list, deliveriesOf), v => plural(v, "tâche", "tâches")],
  ].filter(r => r[2]);
  if (!rows.length) return "";
  return `<section class="work-leaders" aria-label="Travail du jour"><h4>Travail du jour</h4><ul>${rows.map(([icon, title, { a, v }, fmt]) =>
    `<li class="${a.slug && a.slug === me ? "me" : ""}"><span class="work-leader-k"><span aria-hidden="true">${icon}</span> ${title}</span>
      <span class="work-leader-v"><b>${esc(a.name)}</b>${a.slug && a.slug === me ? " <small>(toi)</small>" : ""} · ${esc(fmt(v))}</span></li>`).join("")}</ul></section>`;
}
