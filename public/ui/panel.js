// Interface : panneau latéral, alertes d’accord, en-tête économie, télécommande, « Relier mes agents »,
// historique, missions, dialogues Entreprise et mini-jeux, menu « ⋯ ».

import { approvalState } from "../approval-alert.js";
import {
  activityLeaderboard, historyCsv, historyEntries, machineStatusRows, pushApprovalNotifications, quotaAlerts,
  todayBadges,
} from "../penthouse-extras.js";
import { badgesHtml, missionsHtml, postGame, showCelebrations, spaceActionsHtml, wingActionsHtml, xpBarHtml } from "../gamify-ui.js";
import { officePanelHtml } from "../upgrades-client.js";
import {
  agentRoleText, createEconomyUi, eventChipHtml, fortuneLeaders, freshTipsIn, money, residentEconomyLine,
  staffOf, walletChipHtml,
} from "../economy-ui.js";
import { createSportsGames } from "../sports-games.js";
import { workLeadersHtml, workPanelHtml } from "../work-ui.js";
import { world } from "../tour/state.js";
import { $, CASINO_FEATURED, ME, PLACE_FR, STATE_FR, TOOLS, claudeTracked, esc, hm, keyOf, myApt, placeOf, quotaRemaining, stateOf } from "../tour/base.js";
import { agents, floors } from "../tour/engine.js";
import { reducedMotion } from "../tour/kit.js";
import { updateBillboard, updateUsageBoard } from "../tour/city.js";
import { trackWorkEvents, updateWorkBoards } from "../tour/work-fx.js";
import { CHANNEL_NAMES, tvChannel, tvCustomNow } from "../tour/floors/shared.js";
import { drawJackpot, showBlackjack, spinMachine, spinRoulette } from "../tour/floors/casino.js";
import { startTennisMatch } from "../tour/floors/tennis.js";
import { puttResult } from "../tour/floors/golf.js";
import { floorLabel, syncFloors, update } from "../tour/tower.js";
import { activeTourStep, setFocus, updateSpectatorView } from "../tour/navigation.js";
import { enterWithKey, tick } from "./session.js";

function agentsOnFloor(floorKey) {
  return [...agents.values()].filter(g => g.userData.target === floorKey).length;
}
async function runGameAction(action, floor, agentsHere = 0) {
  const token = sessionStorage.getItem("penthouse.cle");
  if (!token) throw new Error("Clé requise : ouvre Relier mes agents.");
  const j = await postGame("/api/game/action", token, { action, floor, agentsHere });
  showCelebrations(j.toasts);
  const me = myApt();
  if (me && j.game) me.game = j.game;
  render();
  return j;
}
async function runGameClaim(questId) {
  const token = sessionStorage.getItem("penthouse.cle");
  if (!token) throw new Error("Clé requise.");
  const j = await postGame("/api/game/claim", token, { questId });
  showCelebrations(j.toasts);
  const me = myApt();
  if (me && j.game) me.game = j.game;
  render();
  refreshMissionsDlg();
}

// ---------- interface ----------
function meter(label, w, color, now) {
  if (!w) return "";
  const pct = quotaRemaining(w, now);
  const c = pct !== null && pct <= 10 ? "var(--auth)" : pct !== null && pct <= 30 ? "var(--wait)" : color;
  const reset = w.resets_at && now >= w.resets_at ? "Nouvelle mesure attendue" : w.resets_at ? "Reset " + new Date(w.resets_at * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "Reset inconnu";
  return `<div class="meter"><div class="l"><span>${label}</span><b>${pct === null ? "—" : pct + " % restants"}</b></div><div class="bar" style="--c:${c}"><i style="width:${pct ?? 0}%"></i></div><div class="r">${reset}</div></div>`;
}

let previousApprovals = new Map(), lastApprovalPulse = 0;
function updateApprovalAlerts(slug) {
  const { pending, current, fresh } = approvalState(world.data.apartments, previousApprovals, slug);
  previousApprovals = current;
  if (slug) pushApprovalNotifications(fresh, TOOLS);
  world.activeApproval = fresh[0] ?? pending[0] ?? null;
  $("#permissionBanner").hidden = !pending.length;
  $("#permissionGlow").hidden = !pending.length;
  if (!world.activeApproval) { $("#permissionFlash").getAnimations().forEach(animation => animation.cancel()); return; }
  const { session } = world.activeApproval;
  const message = `${TOOLS[session.src]?.name ?? session.src}${session.project ? " · " + session.project : ""}${pending.length > 1 ? " · " + pending.length + " demandes en attente" : " attend ton accord"}`;
  if ($("#permissionMessage").textContent !== message) $("#permissionMessage").textContent = message;
  // Les demandes simultanées sont regroupées : une seule impulsion lente, au plus toutes les 5 secondes.
  if (fresh.length && !reducedMotion.matches && Date.now() - lastApprovalPulse >= 5000) {
    lastApprovalPulse = Date.now();
    $("#permissionFlash").animate([{ opacity: 0.48 }, { opacity: 0 }], { duration: 1600, easing: "ease-out" });
  }
}
$("#showPermission").addEventListener("click", () => {
  if (!world.activeApproval) return;
  const { apartment, session } = world.activeApproval;
  setFocus(world.order.indexOf(`${apartment.slug}:work`) >= 0 ? world.order.indexOf(`${apartment.slug}:work`) : world.order.findIndex(k => k.startsWith(apartment.slug + ":"))); showAgent(apartment, session);
});

// Panneau latéral : pas de redessin sous les doigts de quelqu'un qui saisit (lien perso de la télé).
// Le HTML n'est réécrit que s'il a changé : un bouton n'est pas remplacé sous le pointeur toutes les deux secondes.
let panelHtml = "";
// Le rendu tourne à chaque état reçu (toutes les deux secondes) : un bloc n'est réécrit que si son HTML a changé,
// sans recalcul de mise en page ni bouton remplacé sous le pointeur.
const writtenHtml = new WeakMap();
function setHtml(el, html) {
  if (!el || writtenHtml.get(el) === html) return;
  writtenHtml.set(el, html);
  el.innerHTML = html;
}
const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
function setPanel(html) {
  const panel = $("#aptPanel"), typing = panel.contains(document.activeElement) && document.activeElement.matches("input, textarea");
  if (typing || html === panelHtml) return;
  panel.innerHTML = html;
  panelHtml = html;
}

// En-tête : portefeuille, titre et événement du jour ; bouton Entreprise ; primes reçues d'un autre résident.
let ecoHeaderHtml = "", tipWatch = { slug: null, seen: null };
function renderEconomyHeader(mine, spectator) {
  const eco = spectator ? null : mine?.economy;
  const html = eco ? walletChipHtml(eco, esc, economyUi.shownWallet(eco)) + eventChipHtml(eco.event, esc) : "";
  // Comparé avant d'écrire : l'infobulle de l'événement reste ouverte sous la souris ou le focus.
  if (html !== ecoHeaderHtml) { $("#ecoHost").innerHTML = html; ecoHeaderHtml = html; }
  $("#ecoBtn").hidden = !eco;
  if (!eco) return;
  if (tipWatch.slug !== mine.slug) tipWatch = { slug: mine.slug, seen: null };
  const { fresh, seen } = freshTipsIn(eco, tipWatch.seen);
  tipWatch.seen = seen;
  if (fresh.length) showCelebrations(fresh.map(e => ({ title: `💌 ${e.label}`, body: `+${money(e.amount)} sur ton compte` })));
  economyUi.refresh();
}

function render() {
  updateBillboard(world.data.apartments, world.data.now);
  updateUsageBoard(world.data.apartments, world.data.now);
  const now = world.data.now, spectator = world.data.viewer?.role === "spectator", me = spectator ? null : JSON.parse(localStorage.getItem(ME) ?? "null")?.slug;
  updateApprovalAlerts(me);
  // Le premier résident occupe le penthouse, sous le toit ; les suivants descendent d'un étage chacun ; le Salon et le Club suivent.
  const list = [...world.data.apartments].sort((x, y) => x.created - y.created);
  const first = !world.order.length;
  syncFloors(list);
  updateCasinoState(world.data);
  if (first) world.focus = me && world.order.includes(`${me}:work`) ? world.order.indexOf(`${me}:work`) : Math.min(1, world.order.length - 1);
  update(now);
  // Le travail en 3D : nouveaux exploits fêtés sur l'étage regardé, tableaux de bord redessinés s'ils ont changé.
  trackWorkEvents(list, now);
  updateWorkBoards(list);
  world.order.forEach((key, i) => {
    const f = floors.get(key), apt = list.find(x => x.slug === f.residentSlug);
    const lvl = apt?.game?.level && f.residentSlug === me && f.wingId === "work" ? `<span class="lvl-game">· ${apt.game.level}</span>` : "";
    setHtml(f.tag.element, `<span>${floorLabel(i)}${lvl}</span> ${esc(f.name)}`);
  });

  let xpHost = $("#xpHost");
  if (!xpHost) {
    xpHost = document.createElement("div");
    xpHost.id = "xpHost";
    $(".brandline").appendChild(xpHost);
  }
  const mine = me ? list.find(x => x.slug === me) : null;
  setHtml(xpHost, mine?.game && !spectator ? xpBarHtml(mine.game, esc) : "");
  renderEconomyHeader(mine, spectator);

  const by = (ss, st) => ss.filter(s => stateOf(s, now) === st).length;
  const present = key => [...agents.values()].filter(g => g.userData.target === key);
  setHtml($("#floorNav"), world.order.map((key, i) => {
    const f = floors.get(key), a = f.residentSlug ? list.find(x => x.slug === f.residentSlug) : null, here = present(key);
    const busy = a ? by(a.sessions, "travaille") : here.length, alert = a && by(a.sessions, "autorisation");
    const isMe = f.residentSlug === me;
    return `<button type="button" data-floor="${i}" class="${i === world.focus ? "on" : ""}${isMe ? " me" : ""}${f.kind === "shared" ? " shared" : ""}${f.wingId && f.wingId !== "work" ? " wing-extra" : ""}" aria-current="${i === world.focus}">
      <span class="lvl">${floorLabel(i)}</span><span class="nm">${esc(f.name)}</span><span class="ct">${alert && f.wingId === "work" ? '<i class="d auth"></i>' : ""}${busy}</span></button>`;
  }).join(""));

  const f = floors.get(world.order[world.focus]);
  if (f?.kind === "resident") {
    const a = list.find(x => x.slug === f.residentSlug), u = a.usage ?? {}, svcs = a.health?.services ?? [];
    const machines = Object.entries(a.seen ?? {}).filter(([m]) => m !== "?").map(([m, v]) => `${esc(m)} ${now - v.t < 900 ? "●" : "○"}`);
    const mine = a.slug === me;
    const alerts = mine ? quotaAlerts(u, now, quotaRemaining) : [];
    $("#quotaBanner").hidden = !alerts.length;
    setText($("#quotaBanner"), alerts.length ? "Quota bas · " + alerts.join(" · ") : "");
    const tagline = a.profile?.tagline ? `<p class="tagline-line">${esc(a.profile.tagline)}</p>` : "";
    const machineBlock = mine && f.wingId === "work" ? `<div class="machine-block"><h4>Machines reliées</h4>${machineStatusRows(a, now, TOOLS, esc, hm)}</div>` : "";
    const todayLine = mine && todayBadges(a.today) ? `<p class="extras-muted">Aujourd’hui · ${esc(todayBadges(a.today))}</p>` : "";
    const wingLine = `<p class="kicker">${esc(f.wing?.icon ?? "")} ${esc(f.wing?.name ?? "Aile")}${f.wing?.minLevel ? ` · dès nv. ${f.wing.minLevel}` : ""}</p>`;
    const wingPlay = mine && a.game ? wingActionsHtml(a.game, f.key, esc) : "";
    const wingHint = mine && (a.game?.wings?.length ?? 1) < 4 ? `<p class="extras-muted">Monte de niveau pour débloquer Labo (4), Ops (7), Studio (12).</p>` : "";
    const officeBlock = f.wingId === "work" && a.game?.office ? officePanelHtml(a.game.office, esc) : "";
    const ecoLine = residentEconomyLine(a.economy, esc);
    const workBlock = f.wingId === "work" ? workPanelHtml(a, now, esc, { mine }) : "";
    setPanel(`${wingLine}<p class="kicker">${a.slug === list[0].slug && f.wingId === "work" ? "Penthouse" : esc(f.name)}${mine ? " · chez toi" : ""}</p><h2>${esc(a.name)}</h2>${tagline}${ecoLine}${workBlock}${officeBlock}${wingHint}${wingPlay}
      <div class="apt-c"><span><i class="d" style="background:var(--work)"></i><b>${by(a.sessions, "travaille")}</b> au travail</span>
      <span><i class="d" style="background:var(--auth)"></i><b>${by(a.sessions, "autorisation")}</b> ${spectator ? "attend un accord" : "attend ton accord"}</span>
      <span><i class="d" style="background:var(--wait)"></i><b>${by(a.sessions, "attend")}</b> sur le toit, attend la suite</span>
      <span><i class="d" style="background:var(--pause)"></i><b>${by(a.sessions, "fini") + by(a.sessions, "silencieux")}</b> en pause dans les étages communs</span></div>
      <div class="meters">${claudeTracked(u) ? meter("Claude 5 h", u.claude?.five_hour, "var(--claude)", now) + meter("Claude semaine", u.claude?.seven_day, "var(--claude)", now) : `<p class="quota-untracked">Claude · quota non suivi</p>`}
      ${meter("ChatGPT 5 h", u.chatgpt?.five_hour, "var(--codex)", now)}${meter("ChatGPT semaine", u.chatgpt?.seven_day, "var(--codex)", now)}</div>
      <div class="svcs">${svcs.length ? `Services <b style="color:${svcs.every(s => s.ok) ? "var(--work)" : "var(--auth)"}">${svcs.filter(s => s.ok).length}/${svcs.length}</b>` : ""}
      ${svcs.filter(s => !s.ok).map(s => `<span style="color:var(--auth)">${esc(s.label)} arrêté</span>`).join("")}
      ${machines.length ? `<span>Machines : ${machines.join(" · ")}</span>` : ""}</div>
      ${todayLine}${machineBlock}
      ${a.sessions.length ? "" : '<p class="none">Aucun agent relié pour l\'instant.</p>'}`);
  } else if (f?.kind === "shared") {
    const here = present(f.key), byRes = new Map();
    for (const g of here) { const n = g.userData.apt.name; byRes.set(n, [...(byRes.get(n) ?? []), g.userData]); }
    const myGame = myApt();
    const myAgentsHere = here.filter(g => g.userData.apt.slug === me).length;
    const spacePlay = me && myGame?.game && !spectator ? spaceActionsHtml(myGame.game, f.key, myAgentsHere, esc) : "";
    // Casino : les vrais jeux (en P$) s'ouvrent dans le dialogue Entreprise.
    const jackpot = Number(world.data.casino?.jackpot);
    const casinoPlay = f.key === "casino" && !spectator && myGame?.economy
      ? `<div class="space-actions"><h4>Tables de jeu</h4><button type="button" class="space-act eco-casino-btn" data-eco-open="casino"><strong>🎰 Jouer</strong><span>Machine à sous, roulette, blackjack, course de robots · solde ${esc(money(economyUi.shownWallet(myGame.economy)))}${Number.isFinite(jackpot) ? ` · jackpot ${esc(money(jackpot))}` : ""}</span></button></div>` : "";
    // Tennis et golf : on joue pour de vrai (mini-jeu, sports-games.js) ; les paris sur un set ou un putt restent dans
    // l'onglet Sport du dialogue Entreprise.
    const sport = {
      tennis: ["Court central", "🎮 Jouer au tennis", "Un vrai match contre le robot du club", "Un set contre le pro : attaque, jeu équilibré ou défense"],
      golf: ["Putting green", "🎮 Jouer au golf", "Mini-golf en trois trous : vise et dose ta force", "Putt de 1 m, 4 m ou 12 m"],
    }[f.key];
    const sportBet = sport && myGame?.economy
      ? `<button type="button" class="space-act" data-eco-open="sport"><strong>🎲 Parier</strong><span>${sport[3]} · solde ${esc(money(economyUi.shownWallet(myGame.economy)))}</span></button>` : "";
    const sportPlay = sport && !spectator && myGame
      ? `<div class="space-actions"><h4>${sport[0]}</h4><div class="space-grid"><button type="button" class="space-act eco-casino-btn" data-sport-open="${f.key}"><strong>${sport[1]}</strong><span>${sport[2]}</span></button>${sportBet}</div></div>` : "";
    setPanel(`<p class="kicker">${esc(f.def.kicker)}</p><h2>${f.def.icon} ${esc(f.name)}</h2>
      ${f.key === "lounge" ? remote() : ""}${casinoPlay}${sportPlay}
      <div class="apt-c"><span><b>${here.length}</b> agent(s) ici, de <b>${byRes.size}</b> résident(s)</span></div>
      ${spacePlay}
      ${[...byRes].map(([n, ss]) => `<div class="who-row"><b>${esc(n)}</b><span>${ss.map(u => `${esc(TOOLS[u.s.src]?.name ?? u.s.src)} · ${f.key === "lounge" ? esc(PLACE_FR[u.place]) : esc(u.s.project ?? "")}`).join("<br>")}</span></div>`).join("")
        || '<p class="none">Personne pour l\'instant.</p>'}`);
  }

  const all = list.flatMap(x => x.sessions);
  const board = activityLeaderboard(list);
  const lb = $("#leaderboardDlg"), rich = fortuneLeaders(list), workers = spectator ? "" : workLeadersHtml(list, esc, { me });
  if ((board.length || rich.length || workers) && !spectator) {
    lb.hidden = false;
    setHtml(lb, workers + (board.length ? `<h4>Activité du jour</h4><ol>${board.map((r, i) => `<li><b>${esc(r.name)}</b> · ${r.actions} act. / ${r.sessions} sess.</li>`).join("")}</ol>` : "")
      + (rich.length ? `<h4>Fortune</h4><ol>${rich.map(a => `<li><b>${esc(a.name)}</b> · ${esc(a.economy.title?.icon ?? "")} ${esc(money(a.slug === me ? economyUi.shownWallet(a.economy) : a.economy.wallet))}</li>`).join("")}</ol>` : ""));
  } else lb.hidden = true;
  // Libellés masquables : sur un écran moyen, l'en-tête ne garde que les pastilles et les nombres.
  setHtml($("#totals"), `<span title="Résidents"><span aria-hidden="true" class="ico">🏢</span><b>${list.length}</b><span class="lbl"> résident(s)</span></span><span title="Au travail"><i class="d" style="background:var(--work)"></i><b>${by(all, "travaille")}</b><span class="lbl"> au travail</span></span>`
    + `<span title="Attendent un accord"><i class="d" style="background:var(--auth)"></i><b>${by(all, "autorisation")}</b><span class="lbl"> attendent un accord</span></span>`);
  const feed = list.flatMap(x => x.feed.map(e => ({ ...e, who: x.name }))).sort((x, y) => y.t - x.t).slice(0, 14);
  setHtml($("#ticker"), feed.map(e => `<span>${hm(e.t)} <b>${esc(e.who)}</b> · ${esc(TOOLS[e.src]?.name ?? e.src)}${e.project ? " · " + esc(e.project) : ""} — ${esc(e.action)}</span>`).join("")
    || "<span>En attente d'activité…</span>");
  const waiting = by(all, "autorisation"), title = (waiting ? `(${waiting} !) ` : "") + "Penthouse";
  if (document.title !== title) document.title = title;
  if (spectator && world.tourPaused && activeTourStep?.kind === "dashboard") updateSpectatorView(activeTourStep);
}
function remote() {
  const now = tvChannel(), name = c => esc(CHANNEL_NAMES[c] ?? c), spectator = world.data?.viewer?.role === "spectator", custom = tvCustomNow();
  const showing = custom ? (custom.kind === "youtube" ? "Lien perso · vidéo YouTube" : `Lien perso · Twitch ${esc(custom.channel)}`)
    : `${name(now)}${world.liveNow[now] === false ? " · hors ligne" : ""}`;
  const form = world.tvLinkOpen && !spectator ? `<form class="tv-link" id="tvLinkForm" autocomplete="off">
      <label>Lien YouTube (vidéo ou live) ou chaîne Twitch<input name="url" type="url" inputmode="url" required maxlength="500" placeholder="https://www.youtube.com/watch?v=…" value="${esc(world.tvLinkDraft)}"></label>
      <button type="submit">Mettre à l’écran</button><p class="err" role="alert">${esc(world.tvLinkError)}</p></form>` : "";
  return `<p class="kicker tv-k">Télé du salon</p><div class="tv">${["auto", ...Object.keys(world.liveNow)].map(c => `<button type="button" ${spectator ? "disabled" : ""} data-tv="${esc(c)}" class="${c === world.tvChoice ? "on" : ""}">${
    c === "auto" ? "Auto" : `<i class="d" style="background:${world.liveNow[c] ? "var(--auth)" : "#3a3f52"}"></i>${name(c)}`}</button>`).join("")}<button type="button" ${spectator ? "disabled" : ""} data-tv-link aria-expanded="${world.tvLinkOpen && !spectator}" aria-controls="tvLinkForm" class="${world.tvChoice === "custom" ? "on" : ""}">🔗 Lien perso</button></div>${form}
    <p class="tv-now">À l'écran : <b>${showing}</b>${world.tvBy ? ` · choisi par ${esc(world.tvBy)}` : ""}</p>`;
}
// Choix de la télé : la clé de l'étage accompagne la demande quand elle est connue (le nom affiché vient alors du serveur).
async function postTv(body) {
  const token = sessionStorage.getItem("penthouse.cle");
  const r = await fetch("/api/tv", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-Tour-Token": token } : {}) }, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch { /* réponse vide */ }
  if (!r.ok) throw new Error(j.error ?? "Choix refusé.");
  return j;
}
$("#aptPanel").addEventListener("click", e => {
  if (world.data?.viewer?.role === "spectator") return;
  const act = e.target.closest(".space-act[data-action], .wing-act[data-action]"); // le bouton « Jouer » du casino ouvre le dialogue
  if (act && !act.disabled) {
    runGameAction(act.dataset.action, act.dataset.floor, Number(act.dataset.agents)).catch(err => alert(err.message));
    return;
  }
  if (e.target.closest("[data-tv-link]")) {
    world.tvLinkOpen = !world.tvLinkOpen; world.tvLinkError = "";
    render();
    if (world.tvLinkOpen) $("#tvLinkForm input")?.focus();
    return;
  }
  const b = e.target.closest("[data-tv]");
  if (!b) return;
  world.tvChoice = b.dataset.tv;
  world.tvMine = Date.now() + 3000;
  world.tvBy = JSON.parse(localStorage.getItem(ME) ?? "null")?.name ?? "";
  render();
  postTv({ channel: world.tvChoice, by: world.tvBy }).catch(() => {});
  if (world.order[world.focus] === "lounge") runGameAction("lounge_tv", "lounge", 0).catch(() => {});
});
$("#aptPanel").addEventListener("input", e => { if (e.target.closest("#tvLinkForm")) world.tvLinkDraft = e.target.value; });
$("#aptPanel").addEventListener("submit", async e => {
  const form = e.target.closest("#tvLinkForm");
  if (!form || world.data?.viewer?.role === "spectator") return;
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const tv = await postTv({ channel: "custom", url: form.url.value.trim(), by: JSON.parse(localStorage.getItem(ME) ?? "null")?.name ?? "" });
    world.tvChoice = "custom"; world.tvCustom = tv.custom ?? null; world.tvBy = tv.by ?? ""; world.tvMine = Date.now() + 3000;
    world.tvLinkOpen = false; world.tvLinkDraft = ""; world.tvLinkError = "";
    form.url.blur();
    if (world.order[world.focus] === "lounge") runGameAction("lounge_tv", "lounge", 0).catch(() => {});
  } catch (error) {
    world.tvLinkError = error.message;
    form.querySelector(".err").textContent = error.message; // affichée tout de suite, même champ actif
  } finally { button.disabled = false; }
  render();
});
$("#floorNav").addEventListener("click", e => { const b = e.target.closest("[data-floor]"); if (b) setFocus(Number(b.dataset.floor)); });

function showAgent(a, s) {
  const T = TOOLS[s.src] ?? { name: s.src, color: "#888" }, now = world.data.now;
  const currentPlace = agents.get(keyOf(a.slug, s))?.userData.place ?? placeOf(s, now);
  const row = (l, v, mono) => v ? `<dt>${l}</dt><dd${mono ? ' class="m"' : ""}>${esc(v)}</dd>` : "";
  $("#agentBody").innerHTML = `<div class="who"><i class="d" style="width:12px;height:12px;background:${T.color}"></i>${esc(T.name)}</div>
    <dl>${row("Résident", a.name)}${row("Rôle", agentRoleText(staffOf(a, s.src), world.data.viewer?.role === "spectator"))}${row("Machine", world.data.viewer?.role === "spectator" ? null : s.host)}${row("Projet", s.project)}${row("Modèle", s.model, true)}
    ${row("État", `${STATE_FR[stateOf(s, now)] ?? s.state} · ${PLACE_FR[currentPlace]}`)}${row("Demande", world.data.viewer?.role === "spectator" ? null : s.task || "(pas de demande connue)")}
    ${row("Action", s.action, true)}${row("Arrivé à", hm(s.started))}${row("Dernier signe", hm(s.updated))}</dl>`;
  $("#agentDlg").showModal();
}

// « Relier mes agents » : une commande selon le système, qui relie la machine ET installe l'app (Mac, Windows).
// Partager le texte de ses demandes : un choix par machine, ajouté à la commande quand la case est cochée.
let sharePrompts = false;
function installCommands(token) {
  // TLS 1.2 forcé : Windows PowerShell 5.1 ne l'active pas toujours, et irm échouerait en HTTPS. Aucun $ : la commande
  // se colle telle quelle dans PowerShell, cmd ou Win+R.
  return {
    unix: `curl -fsSL ${location.origin}/install.sh | sh -s -- ${token}${sharePrompts ? " --partager-demandes" : ""}`,
    win: `powershell -ExecutionPolicy Bypass -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor 3072; & ([scriptblock]::Create((irm '${location.origin}/install.ps1'))) -Key '${token}'${sharePrompts ? " -PartagerDemandes" : ""}"`,
  };
}
function installBlock(token) {
  const { unix, win } = installCommands(token);
  const isWindows = /Windows/i.test(navigator.userAgent);
  const block = (title, cmd, kind, where, open) => `<details class="os-install"${open ? " open" : ""}><summary>${title}</summary>
    <p>${where}</p><div class="code" data-command="${kind}"><span>${esc(cmd)}</span><button type="button" data-copy="${esc(cmd)}">Copier</button></div></details>`;
  return `<p class="connect-intro"><strong>Une commande par machine, et c’est connecté.</strong> Ta clé est déjà dedans.</p>
    <label class="share-prompts"><input type="checkbox" id="sharePrompts" data-token="${esc(token)}"${sharePrompts ? " checked" : ""}>
      <span><b>Partager le texte de mes demandes</b> avec les autres résidents (sinon, ils voient que tes agents travaillent et sur quel projet, pas ce que tu leur demandes). Pour arrêter : relance la commande avec <code>--sans-demandes</code> (Windows : <code>-SansDemandes</code>).</span></label>
    ${block("🍎 Mac", unix, "unix", "Ouvre l’app Terminal, colle, Entrée. L’app Penthouse s’installe avec : coche les outils à lancer à chaque ouverture de session.", !isWindows)}
    ${block("🪟 Windows", win, "win", "Ouvre PowerShell (menu Démarrer › « PowerShell »), colle, Entrée. L’app Penthouse s’installe avec : coche les outils à lancer à chaque ouverture de session. Python 3 est nécessaire : la commande t’explique comment l’installer s’il manque.", isWindows)}
    ${block("🐧 Linux", unix, "unix", "Dans un terminal : suivi chaque minute via cron.", false)}
    <p>Ensuite, donne une tâche à Claude Code ou Codex : ton robot s’assoit à ton bureau dans les 15 secondes. Même commande sur une autre machine pour la relier au même étage.</p>
    <p class="extras-muted">Applis à télécharger à la main si tu préfères : <a href="/Penthouse.zip" download>Penthouse pour Mac</a> · <a href="/Penthouse-Windows.zip" download>Penthouse pour Windows</a>.</p>
    <details><summary>Diagnostic et clé</summary><p>Pour revérifier la connexion (Mac/Linux) :</p><div class="code"><span>python3 "$HOME/.config/tour/tour-check"</span><button type="button" data-copy='python3 "$HOME/.config/tour/tour-check"'>Copier</button></div>
    <p>La clé reste dans cet onglet (ou sur cet appareil si tu as coché « se souvenir de moi ») et dans <code>~/.config/tour/secret</code> sur tes machines. Garde-la privée : elle suffit pour entrer chez toi (« J’ai déjà ma clé d’étage » à l’accueil).</p>
    <p>Le suivi lit les journaux locaux de Claude Code et Codex (nom du projet, modèle, état). Le texte de tes demandes ne part que si tu as coché la case ci-dessus ; les réponses des agents et le contenu des outils, jamais. Le quota Claude est mesuré toutes les 15 min au plus par une mini-requête (Haiku), seulement quand tu as utilisé Claude Code depuis la dernière fenêtre ; pour s’en passer, crée le fichier <code>~/.config/tour/sans-quota-claude</code>. Les hooks existants restent compatibles.</p></details>`;
}
// La case change les commandes affichées (et copiées) sans redessiner la fenêtre.
document.addEventListener("change", e => {
  if (e.target.id !== "sharePrompts") return;
  sharePrompts = e.target.checked;
  const commands = installCommands(e.target.dataset.token);
  for (const box of document.querySelectorAll("[data-command]")) {
    const cmd = commands[box.dataset.command];
    box.querySelector("span").textContent = cmd;
    box.querySelector("[data-copy]").dataset.copy = cmd;
  }
});
// Onglet sans clé (navigation privée, autre navigateur, entrée avec le nom) : la clé fait apparaître les commandes.
function keyNeededBlock() {
  const mac = `cat ~/.config/tour/secret`, win = `Get-Content "$HOME\\.config\\tour\\secret"`;
  const copy = cmd => `<div class="code"><span>${esc(cmd)}</span><button type="button" data-copy="${esc(cmd)}">Copier</button></div>`;
  return `<div class="key-needed"><p class="connect-intro"><strong>Colle ta clé d’étage pour afficher la commande à lancer sur ta machine.</strong>
    Cet onglet ne l’a pas (navigation privée, autre navigateur ou entrée avec ton nom). Ce n’est pas le code du penthouse.</p>
    <form class="reuse-key"><label>Clé de ton étage<input name="token" type="password" required autocomplete="off" placeholder="ex. 3f9a…"></label>
    <label class="remember"><input type="checkbox" name="remember" checked> Se souvenir de moi sur cet appareil</label>
    <button type="submit">Afficher mes commandes</button><p class="err" role="alert"></p></form>
    <details class="os-install"><summary>Où trouver ma clé ?</summary>
    <p><b>Mac ou Linux déjà relié</b> : ouvre Terminal, colle, Entrée, puis copie la ligne affichée.</p>${copy(mac)}
    <p><b>Windows déjà relié</b> : dans PowerShell.</p>${copy(win)}
    <p>Sinon, elle était dans la fenêtre « Relier mes agents » le jour où tu as créé ton étage (ou dans ton gestionnaire de mots de passe). Perdue partout ? Demande à l’admin du penthouse une nouvelle clé.</p></details></div>`;
}
function refreshConnectionStatus() {
  const target = $("#connectionStatus");
  if (!target) return;
  const me = JSON.parse(localStorage.getItem(ME) ?? "null"), apt = world.data?.apartments.find(a => a.slug === me?.slug);
  const seen = Object.entries(apt?.seen ?? {});
  const tools = Object.entries(TOOLS).map(([src, tool]) => {
    const received = seen.filter(([, machine]) => machine.events?.[src]);
    // Les anciens collecteurs n'avaient pas de diagnostic ; leurs sessions sont aussi une preuve de réception.
    const sessions = (apt?.sessions ?? []).filter(s => s.src === src);
    const last = Math.max(0, ...received.map(([, m]) => m.events[src]), ...sessions.map(s => s.updated));
    const installed = seen.filter(([, m]) => m.readers?.[src] || m.tools?.[src]);
    const state = last ? `Événement reçu à ${hm(last)}` : installed.length ? "Suivi prêt · aucun événement reçu" : "Aucun événement reçu";
    return `<div class="connect-row"><b>${esc(tool.name)}</b><span class="${last ? "received" : ""}">${state}</span></div>`;
  }).join("");
  const machines = seen.map(([name, m]) => `<span>${esc(name)} · reçu à ${hm(m.t)}</span>`).join("");
  const quotas = ["claude", "chatgpt"].map(provider => {
    const u = apt?.usage?.[provider];
    return `${provider === "claude" ? "Claude" : "ChatGPT"} : ${u?.ts && [u.five_hour?.pct, u.seven_day?.pct].some(Number.isFinite) ? "mesure reçue à " + hm(u.ts) : provider === "claude" ? "pas suivi (relance la commande pour l’activer)" : "aucune mesure reçue"}`;
  }).join(" · ");
  setHtml(target, `<h4>Réception des outils</h4>${tools}<div class="connect-machines">${machines || "Aucune machine reçue pour le moment."}</div><p><b>Quotas</b> · ${quotas}</p><p>Ces horaires indiquent la dernière réception, pas une connexion permanente. Les quotas sont séparés de l’activité des agents. Une session sans journal récent peut ne pas apparaître.</p>`);
}
function grokSetupPrompt() {
  return `Connecte Grok Bot à mon penthouse (${location.origin}). Sur ton ordinateur cloud, crée /workspace/penthouse et télécharge ${location.origin}/grok-mcp.py et ${location.origin}/tour_http.py dans ce dossier. Python 3 et curl sont nécessaires.
Demande ma clé d’étage via la saisie sécurisée pour secrets, jamais dans un message normal (ce n’est pas le code d’entrée de la salle). Enregistre-la dans /workspace/penthouse/grok-connection.json avec les permissions 600 : {"site":"${location.origin}","key":"LA_CLE_SAISIE_EN_SECURISÉ"}. Ne l’affiche pas.
Ajoute un serveur MCP par commande : python3 /workspace/penthouse/grok-mcp.py. Le pont expose penthouse_status(bot, session, state, project facultatif). Donne un nom stable à chaque Bot et un identifiant stable à chaque tâche. États : working au début, idle en attente, approval si mon accord est requis, error en cas d’échec, finished à la fin. Garde le même identifiant jusqu’à la fin de la tâche. Ne transmets aucun contenu de conversation ni secret.
Teste l’envoi avec une tâche de vérification clairement identifiée, puis signale sa fin avec le même identifiant. Annonce la connexion seulement si le serveur confirme la réception. Enregistre ces étapes comme compétence réutilisable pour les tâches que je te confie. Ce suivi repose sur tes appels explicites : ne promets pas une surveillance automatique ni des quotas que tu ne peux pas mesurer.`;
}

function showLink() {
  if (world.data?.viewer?.role === "spectator") return;
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  const fresh = sessionStorage.getItem("penthouse.cle");
  $("#linkBody").innerHTML = `<p class="connect-intro">Ton étage : <b>${esc(me?.name ?? "")}</b>. Une commande par machine suffit. La réception s’affiche ci-dessous.</p>` +
    (fresh ? installBlock(fresh) : keyNeededBlock())
    + `<section id="connectionStatus" aria-live="polite"></section>
    <details><summary>Grok Bot</summary><p>Grok Bot travaille sur son ordinateur cloud. Copie ces instructions dans Grok Bot pour ajouter le connecteur MCP ; il te demandera la clé de ton étage dans une saisie sécurisée.</p>
    <div class="code"><span>Instructions de connexion pour Grok Bot</span><button type="button" data-copy="${esc(grokSetupPrompt())}">Copier</button></div>
    <p>Suivi déclaré par le Bot : début, attente, autorisation, erreur, fin. Ce n’est pas une détection automatique depuis ton Mac. Les quotas Grok ne sont pas remontés par ce connecteur.</p></details>
    <details><summary>Cursor (Composer / Agent)</summary><p>Signale manuellement ou via un hook local l’état de tes sessions Cursor, sans envoyer le contenu du chat.</p>
    <div class="code"><span>python3 "$HOME/.config/tour/cursor-notify.py" working --session demo --project MonProjet</span><button type="button" data-copy='python3 "$HOME/.config/tour/cursor-notify.py" working --session demo --project MonProjet'>Copier</button></div>
    <p>Télécharge le script depuis <a href="/cursor-notify.py" download="cursor-notify.py">cursor-notify.py</a> dans <code>~/.config/tour/</code> après <code>install.sh</code>. États : <code>working</code>, <code>idle</code>, <code>finished</code>, <code>approval</code>, <code>error</code>.</p></details>
    <details><summary>Webhook générique</summary><p>POST JSON sur <code>${esc(location.origin)}/e?src=custom&amp;host=mon-service</code> avec l’en-tête <code>X-Tour-Token</code>. Corps minimal :</p>
    <div class="code"><span>{"hook_event_name":"cursor:working","session_id":"tache-1","cwd":"mon-projet"}</span><button type="button" data-copy='{"hook_event_name":"cursor:working","session_id":"tache-1","cwd":"mon-projet"}'>Copier</button></div>
    <p>Remplace <code>src=custom</code> par un nom court (20 caractères max). Mappe tes événements vers les états connus (<code>cursor:*</code>, <code>n8n:*</code>, <code>grok:*</code>) ou les hooks Claude/Codex.</p></details>
    <details><summary>Hermes et n8n</summary><p>La commande ci-dessus suit les journaux de Claude Code et Codex. Hermes et n8n se relient sur la machine ou le serveur qui les exécute ; ils ne sont pas installés automatiquement.</p>
    <p><b>Hermes</b> : si tes agents passent déjà par une tour locale, conserve ce pont. Pour une nouvelle installation de passerelle, récupère le <a href="/hermes-handler.py" download="handler.py">handler</a> et son <a href="/hermes-hook.yaml" download="HOOK.yaml">manifeste</a>, puis active ce hook dans Hermes. Le handler lit l’adresse et la clé dans <code>~/.config/tour/</code>.</p>
    <p><b>n8n</b> : ajoute un nœud HTTP Request aux étapes début, réussite et erreur. Méthode POST ; URL <code>${esc(location.origin)}/e?src=n8n&amp;host=n8n</code> ; en-tête <code>X-Tour-Token</code> avec la clé de ton étage dans un credential n8n.</p>
    <p>Corps JSON : <code>{"hook_event_name":"n8n:running","session_id":"ID de l’exécution","workflow":"Nom du workflow"}</code>. Utilise <code>n8n:success</code> ou <code>n8n:error</code> à la fin avec le même ID.</p></details>
    <details><summary>Pourquoi un quota peut manquer ?</summary><p>ChatGPT remonte automatiquement depuis les journaux Codex, si une mesure y est disponible. La commande n’installe pas la sonde Claude historique : elle lance une requête de modèle et doit être configurée séparément. Aucun quota n’est inventé et aucun appel payant n’est ajouté.</p></details>
    <details><summary>Remplacer une clé compromise</summary><p class="warn">Cette action déconnecte toutes les machines de cet étage, y compris un éventuel pont Hermes. Pour ajouter une machine, réutilise plutôt la clé actuelle.</p>
    <form class="key"><label>Ton nom<input name="name" value="${esc(me?.name ?? "")}" required></label>
    <label>Code du penthouse<input name="code" type="password" required></label>
    <label>Clé actuelle<input name="token" type="password" required autocomplete="off"></label><button>Remplacer la clé de toutes mes machines</button><p class="err" role="alert"></p></form></details>`;
  $("#linkBody .reuse-key")?.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.currentTarget, token = new FormData(form).get("token").trim();
    try {
      // La clé fait foi : un onglet resté sur un ancien nom (« Paul ») passe sur l'étage de la clé.
      await enterWithKey(token, !!form.remember?.checked);
      showLink();
      await tick();
    } catch (error) { form.querySelector(".err").textContent = error.message; }
  });
  $("#linkBody .key").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.currentTarget, fields = Object.fromEntries(new FormData(form));
    try {
      const r = await fetch("/api/key", { method: "POST", headers: { "X-Tour-Token": fields.token }, body: JSON.stringify({ name: fields.name, code: fields.code }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Remplacement refusé.");
      localStorage.setItem(ME, JSON.stringify({ slug: j.slug, name: j.name }));
      sessionStorage.setItem("penthouse.cle", j.token); showLink();
    } catch (error) { form.querySelector(".err").textContent = error.message; }
  });
  refreshConnectionStatus();
  if (!$("#linkDlg").open) $("#linkDlg").showModal();
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-spectate]")) { $("#spectatorDlg").showModal(); return; }
  const b = e.target.closest("[data-copy]");
  if (b) {
    if (!navigator.clipboard) { b.textContent = "Copie manuelle"; return; }
    navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = "Copié"; }).catch(() => { b.textContent = "Copie manuelle"; });
  }
});
$("#linkBtn").addEventListener("click", showLink);

function showHistory() {
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  const apt = world.data?.apartments.find(a => a.slug === me?.slug);
  if (!apt) return;
  const { sessionRows, feedRows } = historyEntries(apt, TOOLS, esc, hm);
  $("#historyBody").innerHTML = `<h4>Sessions</h4><table class="history-table"><thead><tr><th>Heure</th><th>Outil</th><th>Projet</th><th>État</th><th>Action</th></tr></thead><tbody>${sessionRows || "<tr><td colspan='5'>Rien pour l'instant.</td></tr>"}</tbody></table>
    <h4>Fil récent</h4><table class="history-table"><thead><tr><th>Heure</th><th>Outil</th><th>Projet</th><th colspan="2">Action</th></tr></thead><tbody>${feedRows || "<tr><td colspan='5'>Rien pour l'instant.</td></tr>"}</tbody></table>`;
  $("#historyDlg").showModal();
  $("#historyCsvBtn").onclick = () => {
    const blob = new Blob([historyCsv(apt)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `penthouse-${apt.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
}
function refreshMissionsDlg() {
  const apt = myApt();
  if (!apt?.game) return;
  $("#missionsXp").innerHTML = xpBarHtml(apt.game, esc);
  $("#missionsBadges").innerHTML = badgesHtml(apt.game, esc);
  const wings = (apt.game.wings ?? []).map(w => `<span class="badge">${esc(w.icon)} ${esc(w.name)}</span>`).join("");
  $("#missionsBody").innerHTML = (wings ? `<p class="extras-muted">Ailes débloquées</p><div class="badge-row">${wings}</div>` : "") + missionsHtml(apt.game, esc);
}
function showMissions() {
  refreshMissionsDlg();
  $("#missionsDlg").showModal();
}
$("#missionsBtn").addEventListener("click", showMissions);
$("#missionsBody").addEventListener("click", e => {
  const b = e.target.closest(".quest-claim");
  if (!b) return;
  runGameClaim(b.dataset.quest).catch(err => alert(err.message));
});

$("#historyBtn").addEventListener("click", showHistory);

// Entreprise : équipe et paie, boutique, casino, classements, banque (economy-ui.js).
const economyUi = createEconomyUi({
  dialog: $("#economyDlg"), body: $("#economyBody"), esc, tools: TOOLS,
  getData: () => world.data, getMine: () => myApt(), getToken: () => sessionStorage.getItem("penthouse.cle"),
  onEconomy: eco => { const me = myApt(); if (me && eco) me.economy = eco; if (world.data) render(); },
  celebrate: showCelebrations,
});
$("#ecoBtn").addEventListener("click", () => economyUi.open());
// Tennis et golf joués pour de vrai (sports-games.js) : le serveur renvoie la partie et l'économie à jour.
const sportsGames = createSportsGames({ dialog: $("#sportDlg"), body: $("#sportBody"), esc, getToken: () => sessionStorage.getItem("penthouse.cle"), onResult: j => { const me = myApt(); if (me) { if (j.game) me.game = j.game; if (j.economy) me.economy = j.economy; } if (world.data) render(); }, celebrate: showCelebrations });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-eco-open]");
  if (b && world.data?.viewer?.role !== "spectator") economyUi.open(b.dataset.ecoOpen);
  const s = e.target.closest("[data-sport-open]");
  if (s && world.data?.viewer?.role !== "spectator") sportsGames.open(s.dataset.sportOpen);
});

// Parties jouées dans le dialogue Entreprise (economy-ui.js émet « penthouse:play » après chaque réponse du serveur) :
// la 3D rejoue le résultat, purement pour le décor. Hors de l'étage regardé, ou avec moins d'animations, le résultat
// s'affiche directement ; un détail inattendu est ignoré sans rien casser.
const animatesOn = key => world.order[world.focus] === key && !reducedMotion.matches && !document.hidden;
function replayPlay(game, r) {
  const c = floors.get("casino")?.casino;
  if (game === "slots" && c && Array.isArray(r.reels)) {
    const m = c.machines[CASINO_FEATURED], live = animatesOn("casino");
    const jackpot = Number(r.progressive) > 0 || (r.reels.length === 3 && r.reels.every(x => x === "7️⃣"));
    spinMachine(m, r.reels, live);
    m.onDone = live ? () => { if (jackpot) c.party = 6.5; else if (Number(r.win) > 0) m.flash = 2.5; } : null;
  } else if (game === "roulette" && c && Number.isInteger(r.number) && r.number >= 0 && r.number <= 36) {
    spinRoulette(c.roulette, r.number, animatesOn("casino"));
  } else if (game === "blackjack" && c && r.hand && typeof r.hand === "object") {
    showBlackjack(c, r.hand, animatesOn("casino"));
  } else if (game === "tennis") {
    const tn = floors.get("tennis")?.tennis;
    if (tn) startTennisMatch(tn, r, animatesOn("tennis"));
  } else if (game === "golf") {
    const gf = floors.get("golf")?.golf;
    if (gf) puttResult(gf, r, animatesOn("golf"));
  }
}
addEventListener("penthouse:play", e => {
  const { game, result } = e.detail ?? {};
  if (!result || typeof result !== "object") return;
  try { replayPlay(game, result); } catch (error) { console.warn("3D : partie non rejouée", error); }
});
function updateCasinoState(state) {
  const c = floors.get("casino")?.casino;
  if (!c) return;
  drawJackpot(c, state.casino, state.now);
  const winAt = state.casino?.lastWinner?.at ?? null;
  if (c.lastWinAt !== undefined && winAt && winAt !== c.lastWinAt && animatesOn("casino")) c.party = 6.5;
  c.lastWinAt = winAt;
}

// Menu « ⋯ » de l'en-tête : les actions moins fréquentes, pour un en-tête sur une ligne.
function setMoreMenu(open) {
  $("#moreMenu").hidden = !open;
  $("#moreBtn").setAttribute("aria-expanded", String(open));
}
$("#moreBtn").addEventListener("click", () => {
  setMoreMenu($("#moreMenu").hidden);
  if (!$("#moreMenu").hidden) [...$("#moreMenu").children].find(b => !b.hidden)?.focus();
});
$("#moreMenu").addEventListener("click", e => { if (e.target.closest("button")) setMoreMenu(false); });
document.addEventListener("click", e => { if (!e.target.closest("#moreWrap")) setMoreMenu(false); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || $("#moreMenu").hidden) return;
  setMoreMenu(false); $("#moreBtn").focus();
});
$("#moreWrap").addEventListener("focusout", e => { if (!$("#moreWrap").contains(e.relatedTarget)) setMoreMenu(false); });
// Hauteur réelle de l'en-tête (une ou deux lignes) : les panneaux se placent juste dessous.
new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", `${$("#topBar").offsetHeight}px`)).observe($("#topBar"));

export { economyUi, previousApprovals, refreshConnectionStatus, render, setText, showAgent, showLink, sportsGames };
