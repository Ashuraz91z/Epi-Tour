// Ligue de la semaine (serveur : league.js) : carte dans le classement flottant et fenêtre « Ligue » avec le
// classement complet, le défi commun, les règles et le podium de la semaine passée. Élément de jeu : masqué en mode
// productif (le serveur continue de compter les points).
import { CURRENCY, LEAGUE } from "../economy-data.js";
import { workDuration } from "../work-ui.js";
import { world } from "../tour/state.js";
import { productive } from "../tour/mode.js";
import { $, ME, esc } from "../tour/base.js";

const MEDALS = ["🥇", "🥈", "🥉"];
const nf = new Intl.NumberFormat("fr-FR");
const pts = n => `${nf.format(Math.round(n))} pt${Math.round(n) >= 2 ? "s" : ""}`;
const hours = min => `${nf.format(Math.round(min / 6) / 10)} h`;
const me = () => { try { return JSON.parse(localStorage.getItem(ME) ?? "null")?.slug ?? null; } catch { return null; } };
const left = d => (d <= 1 ? "dernier jour" : `encore ${d} jours`);
const pct = (v, max) => Math.max(0, Math.min(100, max > 0 ? Math.round(v / max * 100) : 0));
const bar = (v, cls = "") => `<span class="work-bar ${cls}" aria-hidden="true"><i style="width:${v}%"></i></span>`;

function row(r, i, mine) {
  return `<li class="${r.slug === mine ? "me" : ""}"><span class="lg-rank">${MEDALS[i] ?? i + 1}</span>`
    + `<span class="lg-name"><b>${esc(r.name)}</b>${r.slug === mine ? " <small>(toi)</small>" : ""}</span><span class="lg-pts">${pts(r.points)}</span></li>`;
}
function challengeHtml(c, compact = false) {
  const target = c.target * 60;
  const note = c.reached ? `Réussi ! +${LEAGUE.challenge.money} ${CURRENCY} lundi pour chaque étage qui a travaillé 1 h`
    : `Toute la tour ensemble · +${LEAGUE.challenge.money} ${CURRENCY} chacun si c’est réussi`;
  return `<div class="lg-challenge${c.reached ? " done" : ""}"><span>${LEAGUE.challenge.icon} Défi commun · ${hours(c.total)} / ${nf.format(c.target)} h${c.reached ? " ✅" : ""}</span>`
    + `${bar(pct(c.total, target), c.reached ? "" : "lvl")}${compact ? "" : `<small>${note}</small>`}</div>`;
}

// Carte compacte du classement flottant : podium en direct, ma place, défi commun, champion en titre.
export function leagueCardHtml(league) {
  if (!league || productive()) return "";
  const mine = me(), top = league.standings.slice(0, 3), i = league.standings.findIndex(r => r.slug === mine);
  const champion = league.last?.champion && league.last.ranking.find(r => r.slug === league.last.champion);
  return `<section class="league-card" aria-label="Ligue de la semaine"><h4><span>🏆 Ligue · semaine ${league.number}</span><small>${league.daysLeft <= 1 ? "dernier jour" : `J-${league.daysLeft}`}</small></h4>`
    + (top.length ? `<ol class="lg-list">${top.map((r, k) => row(r, k, mine)).join("")}</ol>` : `<p class="lg-empty">Personne n’a encore de point cette semaine.</p>`)
    + (i >= 3 ? `<p class="lg-me">Toi : ${i + 1}<sup>e</sup> · ${pts(league.standings[i].points)} · ${pts(league.standings[2].points - league.standings[i].points + 1)} pour le podium</p>` : "")
    + challengeHtml(league.challenge, true)
    + (champion ? `<p class="lg-champ">Champion·ne en titre : <b>${esc(champion.name)}</b>${champion.slug === mine ? " <small>(toi)</small>" : ""}</p>` : "")
    + `<button type="button" class="ghost lg-open" data-league>Voir la ligue</button></section>`;
}

function dialogHtml(league) {
  const mine = me();
  const prizes = LEAGUE.prizes.map(p => `<li>${p.icon} ${esc(p.title)} : <b>+${p.money} ${CURRENCY}</b> · +${p.xp} XP</li>`).join("");
  const last = league.last;
  const titles = Object.entries(league.titles ?? {}).sort((a, b) => b[1] - a[1]).map(([slug, n]) => {
    const name = world.data?.apartments?.find(a => a.slug === slug)?.name ?? slug;
    return `<li>${"🏆".repeat(Math.min(n, 5))} <b>${esc(name)}</b> · ${n} titre${n >= 2 ? "s" : ""}</li>`;
  }).join("");
  return `<p class="lg-sub">Semaine ${league.number} · ${left(league.daysLeft)} (fin dimanche à minuit, heure de Paris)</p>`
    + (league.standings.length ? `<ol class="lg-list lg-full">${league.standings.map((r, k) => `${row(r, k, mine).replace("</li>", "")}`
        + `<small class="lg-detail">${workDuration(r.minutes)} de travail · ${r.delivered} tâche${r.delivered >= 2 ? "s" : ""} livrée${r.delivered >= 2 ? "s" : ""}</small></li>`).join("")}</ol>`
      : `<p class="lg-empty">Personne n’a encore de point cette semaine : le premier agent au travail prend la tête.</p>`)
    + challengeHtml(league.challenge)
    + (last ? `<h4>Semaine ${last.number}</h4><ol class="lg-list">${last.ranking.map((r, k) => row(r, k, mine)).join("")}</ol>`
      + `<p class="lg-detail">Défi commun ${last.challenge.reached ? "réussi" : "manqué"} : ${hours(last.challenge.total)} / ${nf.format(last.challenge.target)} h</p>` : "")
    + (titles ? `<h4>Palmarès</h4><ul class="lg-titles">${titles}</ul>` : "")
    + `<h4>Règles</h4><ul class="lg-rules"><li>${LEAGUE.perMinute} point par minute de travail d’un agent (deux agents en même temps comptent double), ${LEAGUE.perDelivery} points par tâche livrée.</li>`
    + `<li>Au plus ${LEAGUE.dailyMinutesCap / 60} h de travail et ${LEAGUE.dailyDeliveriesCap} tâches comptées par jour.</li>`
    + `<li>Lundi, le classement est figé : podium payé (dès ${league.minPoints} points), trophée 3D chez le ou la champion·ne toute la semaine.</li>${prizes}</ul>`;
}

let shown = "";
export function showLeague() {
  const league = world.data?.league;
  if (!league || productive()) return;
  $("#leagueBody").innerHTML = shown = dialogHtml(league);
  if (!$("#leagueDlg").open) $("#leagueDlg").showModal();
}
// Fenêtre ouverte : elle suit l'état reçu (points en direct), sans redessiner si rien n'a changé.
export function refreshLeague() {
  if (!$("#leagueDlg")?.open) return;
  if (productive() || !world.data?.league) { $("#leagueDlg").close(); return; }
  const html = dialogHtml(world.data.league);
  if (html !== shown) $("#leagueBody").innerHTML = shown = html;
}
document.addEventListener("click", e => { if (e.target.closest("[data-league]")) showLeague(); });
