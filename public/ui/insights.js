// Stats des résidents (serveur : insightsOf dans core.js) : la journée de chacun dans son panneau, et les faits du jour
// du penthouse dans le classement. Des compteurs seulement : demandes tapées, agents, appels d'outils, heures, outils.
// Affichées dans les deux modes (complet et productif) : c'est du travail, pas du jeu.

const nf = new Intl.NumberFormat("fr-FR");
const hhmm = t => new Date(t * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const plural = (n, one, many) => `${nf.format(n)} ${n >= 2 ? many : one}`;
const WEEKDAY = day => new Date(day + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long" });
const TOOL_NAMES = { claude: "Claude Code", codex: "Codex", hermes: "Hermes", grok: "Grok Bot", cursor: "Cursor", n8n: "n8n" };

// Heure la plus chargée (Paris) et barres des 24 heures, la plus haute à 100 %.
function hoursHtml(hours) {
  const max = Math.max(0, ...hours);
  if (!max) return "";
  const peak = hours.indexOf(max);
  const bars = hours.map((v, h) => `<i class="${h === peak ? "peak" : ""}" style="height:${v ? Math.max(8, Math.round(v / max * 100)) : 0}%" title="${h} h : ${nf.format(v)}"></i>`).join("");
  return `<div class="ins-hours" aria-label="Activité heure par heure, pic à ${peak} h"><div class="ins-bars">${bars}</div>
    <div class="ins-axis"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div>
    <p class="ins-note">Heure de pointe : <b>${peak} h – ${peak + 1} h</b></p></div>`;
}

export function insightsPanelHtml(apartment, esc, { mine = false } = {}) {
  const t = apartment?.insights?.today, week = apartment?.insights?.week ?? [];
  const title = mine ? "📊 Ta journée" : "📊 Sa journée";
  if (!t || !(t.prompts || t.actions || t.agents))
    return `<section class="insights" aria-label="Stats du jour"><h4>${title}</h4><p class="ins-note">Rien encore aujourd’hui : les stats démarrent à la première demande.</p></section>`;
  const tiles = [
    [t.prompts, t.prompts >= 2 ? "demandes" : "demande", "💬"],
    [t.agents, t.agents >= 2 ? "agents ont bossé" : "agent a bossé", "🤖"],
    [t.actions, t.actions >= 2 ? "actions d’outils" : "action d’outil", "🛠️"],
    [t.peak, "en même temps (pic)", "⚡"],
  ].map(([v, l, icon]) => `<span class="ins-tile"><b><span aria-hidden="true">${icon}</span> ${nf.format(v ?? 0)}</b><small>${l}</small></span>`).join("");
  const facts = [];
  if (t.first && t.last) facts.push(`Actif de <b>${hhmm(t.first)}</b> à <b>${hhmm(t.last)}</b>`);
  if (t.prompts && t.actions) facts.push(`<b>${nf.format(Math.round(t.actions / t.prompts))}</b> actions par demande en moyenne`);
  if (t.tools?.[0]) facts.push(`Outil star : <b>${esc(t.tools[0][0])}</b> (${nf.format(t.tools[0][1])}×)${t.tools[1] ? `, puis ${esc(t.tools[1][0])}` : ""}`);
  if (t.sources?.length) {
    const total = t.sources.reduce((n, [, v]) => n + v, 0) || 1;
    facts.push(t.sources.map(([src, v]) => `${esc(TOOL_NAMES[src] ?? src)} ${Math.round(v / total * 100)} %`).join(" · "));
  }
  if (t.models?.[0]) facts.push(`Modèle le plus utilisé : <b>${esc(t.models[0][0])}</b>`);
  if (t.projects?.length) facts.push(`${plural(t.projectCount ?? t.projects.length, "projet", "projets")} : ${t.projects.map(([p]) => esc(p)).join(", ")}${(t.projectCount ?? 0) > t.projects.length ? "…" : ""}`);
  // Semaine : totaux et meilleur jour (par actions).
  let weekLine = "";
  if (week.length > 1) {
    const prompts = week.reduce((n, d) => n + (d.prompts ?? 0), 0), actions = week.reduce((n, d) => n + (d.actions ?? 0), 0);
    const best = week.reduce((a, b) => (b.actions ?? 0) > (a.actions ?? 0) ? b : a);
    weekLine = `<p class="ins-week">7 jours : <b>${plural(prompts, "demande", "demandes")}</b> · <b>${plural(actions, "action", "actions")}</b> · ${plural(week.filter(d => d.actions || d.prompts).length, "jour actif", "jours actifs")}${best.actions ? ` · record le ${WEEKDAY(best.day)} (${nf.format(best.actions)})` : ""}</p>`;
  }
  return `<section class="insights" aria-label="Stats du jour"><h4>${title}</h4><div class="ins-tiles">${tiles}</div>
    ${hoursHtml(t.hours ?? [])}${facts.length ? `<ul class="ins-facts">${facts.map(f => `<li>${f}</li>`).join("")}</ul>` : ""}${weekLine}</section>`;
}

// Faits du jour du penthouse : qui a le plus demandé, la plus grosse équipe, le plus gros pic, le lève-tôt, le
// couche-tard, l'outil le plus utilisé de tout le monde. Seulement ce qui a eu lieu aujourd'hui.
export function dayFactsHtml(apartments, esc, { me = null } = {}) {
  const list = (apartments ?? []).filter(a => a?.insights?.today);
  if (!list.length) return "";
  const best = (value, pick = Math.max) => {
    const rows = list.map(a => [a, value(a.insights.today)]).filter(([, v]) => Number.isFinite(v) && v > 0);
    if (!rows.length) return null;
    const target = pick(...rows.map(([, v]) => v));
    return rows.find(([, v]) => v === target);
  };
  const who = a => `<b>${esc(a.name)}</b>${a.slug === me ? " <small>(toi)</small>" : ""}`;
  const rows = [];
  const talk = best(t => t.prompts); if (talk) rows.push(["💬", "Le plus de demandes", `${who(talk[0])} · ${nf.format(talk[1])}`]);
  const team = best(t => t.agents); if (team) rows.push(["🤖", "La plus grosse équipe", `${who(team[0])} · ${plural(team[1], "agent", "agents")}`]);
  const peak = best(t => t.peak); if (peak && peak[1] >= 2) rows.push(["⚡", "Le plus en parallèle", `${who(peak[0])} · ${nf.format(peak[1])} en même temps`]);
  const early = best(t => t.first, Math.min); if (early) rows.push(["🌅", "Lève-tôt", `${who(early[0])} · dès ${hhmm(early[1])}`]);
  const late = best(t => t.last); if (late) rows.push(["🌙", "Dernier actif", `${who(late[0])} · ${hhmm(late[1])}`]);
  const tools = {};
  for (const a of list) for (const [name, n] of a.insights.today.tools ?? []) tools[name] = (tools[name] ?? 0) + n;
  const star = Object.entries(tools).sort((x, y) => y[1] - x[1])[0];
  if (star) rows.push(["🛠️", "Outil du penthouse", `<b>${esc(star[0])}</b> · ${nf.format(star[1])}×`]);
  const total = list.reduce((n, a) => n + (a.insights.today.prompts ?? 0), 0);
  if (total) rows.push(["🏢", "Tout le penthouse", `${plural(total, "demande", "demandes")} aujourd’hui`]);
  if (!rows.length) return "";
  return `<section class="day-facts" aria-label="Faits du jour"><h4>Faits du jour</h4><ul>${rows.map(([icon, title, value]) =>
    `<li><span class="fact-k"><span aria-hidden="true">${icon}</span> ${title}</span><span class="fact-v">${value}</span></li>`).join("")}</ul></section>`;
}
