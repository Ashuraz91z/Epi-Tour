// Navigation : visite spectateur, étage regardé (setFocus), clavier, clics sur les agents et les jeux.

import * as THREE from "three";
import { postGame, showCelebrations } from "../gamify-ui.js";
import { parseFloorKey } from "../wings-client.js";
import { world } from "./state.js";
import { $, ME, STATE_COLOR, claudeTracked, esc, myApt, quotaRows, stateOf } from "./base.js";
import { dayFactsChipsHtml, dayStripHtml } from "../ui/insights.js";
import { agents, camera, clock, floors, renderer } from "./engine.js";
import { floorShown, productive } from "./mode.js";
import { tvFrame, tvPageUrl } from "./floors/shared.js";
import { economyUi, render, showAgent, sportsGames } from "../ui/panel.js";
import { showCustomize } from "../ui/studio.js";

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();

// Mode écran (?ecran) : tourne doucement et change d'étage toutes les 25 s.
const autoTour = new URLSearchParams(location.search).has("ecran");
let tourPausedAt = 0, dashboardContent = "", captionContent = "", activeTourStep = null;
// États des agents d'un résident : pastilles de couleur et nombres (au travail, accord, en attente, en pause).
function statesHtml(sessions, now) {
  const by = st => sessions.filter(s => stateOf(s, now) === st).length;
  return [["travaille", "au travail"], ["autorisation", "attend un accord"], ["attend", "attend la suite"], ["fini", "en pause"]]
    .map(([st, label]) => [by(st) + (st === "fini" ? by("silencieux") : 0), label, STATE_COLOR[st]])
    .filter(([n], k) => n || k === 0)
    .map(([n, label, color]) => `<span><i class="d" style="background:${color}"></i><b>${n}</b> ${label}</span>`).join("");
}
// Quotas en ligne compacte : Claude (ou « non suivi ») et ChatGPT, 5 h et semaine.
function quotasHtml(usage, now) {
  const claude = claudeTracked(usage);
  const rows = quotaRows(usage, now).filter(q => claude || q.provider !== "claude");
  return `${claude ? "" : `<div class="quota-row claude untracked"><div><span>Claude</span><b>non suivi</b></div></div>`}${rows.map(q => `<div class="quota-row ${q.provider}"><div><span>${q.provider === "claude" ? "Claude" : "ChatGPT"} · ${q.label === "5 HEURES" ? "5 h" : "semaine"}</span><b>${q.remaining === null ? "—" : q.remaining + " %"}</b></div><div class="quota-track"><i style="width:${q.remaining ?? 0}%"></i></div><small>${esc(q.reset)}</small></div>`).join("")}`;
}
// Fiche de l'étage visité, en bas à gauche : qui, ses agents, sa journée ; pour un étage commun, qui s'y trouve.
function floorCardHtml(key) {
  const f = floors.get(key), now = world.data.now;
  if (!f) return "";
  const shown = world.order.filter(floorShown), kicker = `Étage ${shown.indexOf(key) + 1} / ${shown.length}`;
  if (f.kind === "resident") {
    const a = world.data.apartments.find(x => x.slug === f.residentSlug);
    if (!a) return "";
    const title = !productive() && a.economy?.title ? `${a.economy.title.icon ?? ""} ${a.economy.title.title ?? ""}`.trim() : "";
    return `<p class="kicker">${kicker}${f.wingId !== "work" ? " · " + esc(f.wing?.name ?? "") : ""}</p><h2>${esc(a.name)}</h2>
      ${title || a.profile?.tagline ? `<p class="sfc-sub">${esc([title, a.profile?.tagline].filter(Boolean).join(" · "))}</p>` : ""}
      <p class="sfc-states">${statesHtml(a.sessions, now)}</p>${dayStripHtml(a)}`;
  }
  const here = [...agents.values()].filter(g => g.userData.floor === key), byRes = new Map();
  for (const g of here) byRes.set(g.userData.apt.name, (byRes.get(g.userData.apt.name) ?? 0) + 1);
  return `<p class="kicker">${kicker} · ${esc(f.def.kicker)}</p><h2>${f.def.icon} ${esc(f.name)}</h2>
    <p class="sfc-states"><span><b>${here.length}</b> agent${here.length > 1 ? "s" : ""} ici</span></p>
    ${byRes.size ? `<p class="sfc-sub">${[...byRes].sort((x, y) => y[1] - x[1]).map(([n, c]) => `${esc(n)} · ${c}`).join("   ")}</p>` : `<p class="sfc-sub">Personne pour l’instant : les agents viennent ici en pause.</p>`}`;
}
let floorCardContent = "";
function updateSpectatorView(step) {
  activeTourStep = step;
  $("#spectatorDashboard").hidden = step.kind !== "dashboard";
  // Légende : l'étape, le temps restant et une barre de progression.
  const title = step.kind === "dashboard" ? `La journée de chacun · ${step.page + 1}/${step.pages}`
    : step.kind === "floor" ? floors.get(step.floor)?.name ?? "Étage" : step.kind === "agents" ? "Écran des agents" : "Écran des usages";
  const done = step.seconds ? Math.round((step.seconds - step.remaining) / step.seconds * 100) : 0;
  const caption = `<span>${esc(title)} · suite dans ${step.remaining} s</span><i class="tour-progress" style="width:${done}%"></i>`;
  if (caption !== captionContent) { $("#tourCaption").innerHTML = caption; captionContent = caption; }
  const card = step.kind === "floor" ? floorCardHtml(step.floor) : "";
  $("#spectatorFloorCard").hidden = !card;
  if (card !== floorCardContent) { $("#spectatorFloorCard").innerHTML = card; floorCardContent = card; }
  if (step.kind !== "dashboard") return;
  const now = world.data.now, all = [...world.data.apartments].sort((a, b) => a.created - b.created || a.name.localeCompare(b.name, "fr"));
  const list = all.slice(step.page * step.pageSize, (step.page + 1) * step.pageSize);
  const html = `<div class="dashboard-heading"><div><p class="kicker">Penthouse · en direct</p><h1>La journée de chacun</h1><p class="dashboard-lead">Agents, activité du jour et quotas restants, par résident</p></div><span class="dashboard-page">${step.page + 1} / ${step.pages}</span></div>
    ${dayFactsChipsHtml(all, esc)}
    <div class="usage-grid">${list.map(a => `<article class="usage-card day-card"><header><span class="resident-avatar" aria-hidden="true">${esc(a.name.slice(0, 1).toUpperCase())}</span><div><h2>${esc(a.name)}</h2><p class="sfc-states">${statesHtml(a.sessions, now)}</p></div></header>
      ${dayStripHtml(a)}<div class="card-quotas">${quotasHtml(a.usage, now)}</div></article>`).join("") || '<p>Aucun résident pour le moment.</p>'}</div>`;
  if (html === dashboardContent) return;
  dashboardContent = html;
  $("#spectatorDashboard").innerHTML = html;
}
// Deux façons de regarder, choix gardé sur l'appareil : « Visite auto » (la caméra enchaîne tableau, étages et panneaux)
// et « Explorer » (on se balade librement : liste des étages, panneau, clic sur les agents, zoom ; le tableau « La
// journée de chacun » s'ouvre alors à la demande). Reprendre la visite repart là où elle s'était arrêtée.
const TOUR_KEY = "penthouse.visite";
const savedTourMode = () => { try { return localStorage.getItem(TOUR_KEY) === "free" ? "free" : "auto"; } catch { return "auto"; } };
function applyTourMode(free) {
  if (free !== world.tourPaused) {
    if (free) tourPausedAt = clock.elapsedTime;
    else world.tourStarted += clock.elapsedTime - tourPausedAt;
  }
  world.tourPaused = free;
  for (const b of $("#tourSwitch").children) b.setAttribute("aria-pressed", String((b.dataset.tour === "free") === free));
  const spectating = !!document.body.dataset.spectating;
  document.body.classList.toggle("spectator-presentation", spectating && !free);
  $("#tourCaption").hidden = !spectating || free;
  $("#dayBoardBtn").hidden = !spectating || !free;
  $("#dayBoardBtn").setAttribute("aria-pressed", "false");
  if (free) { $("#spectatorDashboard").hidden = true; $("#spectatorFloorCard").hidden = true; }
  else captionContent = dashboardContent = "";
}
function setTourMode(mode) {
  try { localStorage.setItem(TOUR_KEY, mode); } catch { /* stockage indisponible : le choix vaut pour cet onglet */ }
  applyTourMode(mode === "free");
  if (world.data) render();
}
$("#tourSwitch").addEventListener("click", e => { const b = e.target.closest("[data-tour]"); if (b) setTourMode(b.dataset.tour); });
// En exploration : le tableau de tous les résidents, d'un seul tenant, ouvert ou fermé par le bouton.
function showDayBoard() {
  dashboardContent = "";
  updateSpectatorView({ kind: "dashboard", page: 0, pages: 1, pageSize: 99, remaining: 0, seconds: 0 });
  $("#tourCaption").hidden = true;
}
$("#dayBoardBtn").addEventListener("click", () => {
  const open = $("#spectatorDashboard").hidden;
  $("#dayBoardBtn").setAttribute("aria-pressed", String(open));
  if (open) showDayBoard(); else $("#spectatorDashboard").hidden = true;
});

function setFocus(i) {
  world.focus = Math.max(0, Math.min(world.order.length - 1, i));
  world.lastMove = clock.elapsedTime;
  const key = world.order[world.focus];
  const me = JSON.parse(localStorage.getItem(ME) ?? "null")?.slug;
  const { slug, wing } = parseFloorKey(key);
  const token = sessionStorage.getItem("penthouse.cle");
  if (token && me && slug === me && wing && wing !== "work") {
    postGame("/api/game/visit", token, { floor: key }).then(j => {
      if (!productive()) showCelebrations(j.toasts);
      const apt = myApt();
      if (apt && j.game) apt.game = j.game;
      if (world.data) render();
    }).catch(() => {});
  }
  if (world.data) render();
}
// Étage suivant (dir = 1) ou précédent (-1) parmi ceux affichés : le mode productif saute les étages de jeu.
// loop : repart du haut après le dernier (mode écran).
function stepFocus(dir, loop = false) {
  const n = world.order.length;
  for (let k = 1; k <= n; k++) {
    let i = world.focus + dir * k;
    if (loop) i = ((i % n) + n) % n;
    else if (i < 0 || i >= n) return;
    if (floorShown(world.order[i])) return setFocus(i);
  }
}
// Étage regardé masqué (passage en mode productif) : on revient chez soi, sinon au premier étage affiché.
function keepFocusShown() {
  if (!world.order.length || floorShown(world.order[world.focus])) return;
  const me = JSON.parse(localStorage.getItem(ME) ?? "null")?.slug, home = world.order.indexOf(`${me}:work`);
  setFocus(home >= 0 ? home : Math.max(0, world.order.findIndex(floorShown)));
}
addEventListener("keydown", e => {
  if (e.target.closest?.("input, dialog")) return;
  if (e.key === "ArrowDown") { e.preventDefault(); stepFocus(1); }
  if (e.key === "ArrowUp") { e.preventDefault(); stepFocus(-1); }
});

// Clic sur un agent : sa fiche.
const onFocus = () => [...agents.values()].filter(g => g.userData.floor === world.order[world.focus] && g.visible).map(g => g.userData.hit);
const onGiantTv = () => { const t = floors.get(world.order[world.focus])?.tv; return t && ray.intersectObject(t.frame).length ? t : null; };
const onByte = () => { const c = floors.get(world.order[world.focus])?.cyber; return c && ray.intersectObject(c.hit, true).length ? c : null; };
const onTv = () => world.order[world.focus] === "lounge" && tvFrame && ray.intersectObject(tvFrame).length > 0;
// Machines et tables : un clic ouvre le dialogue Entreprise sur le bon onglet ; court et green, le mini-jeu (résidents seulement).
const onPlayTarget = () => {
  if (world.data?.viewer?.role === "spectator" || !myApt()?.economy) return null;
  const targets = floors.get(world.order[world.focus])?.playTargets;
  return targets ? ray.intersectObjects(targets, false)[0]?.object.userData.tab ?? null : null;
};
// Le pincement du pavé tactile ne zoome jamais la page entière (seulement la caméra, sur la 3D).
addEventListener("wheel", e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
addEventListener("gesturestart", e => e.preventDefault());
renderer.domElement.addEventListener("pointerdown", e => { renderer.domElement.dataset.down = `${e.clientX},${e.clientY}`; });
renderer.domElement.addEventListener("pointerup", e => {
  const [x, y] = (renderer.domElement.dataset.down ?? "").split(",").map(Number);
  if (Math.hypot(e.clientX - x, e.clientY - y) > 6) return; // c'était un glisser, pas un clic
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);

  let o = ray.intersectObjects(onFocus(), false)[0]?.object;
  while (o && !o.userData.key) o = o.parent;
  if (o) return showAgent(o.userData.apt, o.userData.s);
  const byte = onByte(), giant = onGiantTv();
  // Sa propre télé : le clic ouvre le réglage du lien ; celle d'un autre résident s'ouvre avec le son.
  if (giant && floors.get(world.order[world.focus])?.residentSlug === JSON.parse(localStorage.getItem(ME) ?? "null")?.slug) {
    showCustomize();
    return $("#customizeForm").tv.select();
  }
  if (giant) return open(giant.page, "_blank", "noopener");
  if (byte) return byte.poke();
  if (onTv()) return void open(tvPageUrl(), "_blank", "noopener");
  // Court et green : le mini-jeu ; machines, roulette, blackjack : l'onglet Casino d'« Entreprise ».
  const tab = onPlayTarget();
  if (tab === "tennis" || tab === "golf") sportsGames.open(tab);
  else if (tab) economyUi.open(tab);
});
renderer.domElement.addEventListener("pointermove", e => {
  if (e.buttons) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  renderer.domElement.style.cursor = ray.intersectObjects(onFocus(), false).length || onTv() || onByte() || onGiantTv() || onPlayTarget() ? "pointer" : "";
});

export { activeTourStep, applyTourMode, autoTour, keepFocusShown, savedTourMode, setFocus, showDayBoard, stepFocus, updateSpectatorView };
