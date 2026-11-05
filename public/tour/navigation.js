// Navigation : visite spectateur, étage regardé (setFocus), clavier, clics sur les agents et les jeux.

import * as THREE from "three";
import { postGame, showCelebrations } from "../gamify-ui.js";
import { parseFloorKey } from "../wings-client.js";
import { world } from "./state.js";
import { $, ME, claudeTracked, esc, myApt, quotaRows, stateOf } from "./base.js";
import { agents, camera, clock, floors, renderer } from "./engine.js";
import { floorShown, productive } from "./mode.js";
import { tvFrame, tvPageUrl } from "./floors/shared.js";
import { economyUi, render, showAgent, sportsGames } from "../ui/panel.js";
import { showCustomize } from "../ui/studio.js";

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();

// Mode écran (?ecran) : tourne doucement et change d'étage toutes les 25 s.
const autoTour = new URLSearchParams(location.search).has("ecran");
let tourPausedAt = 0, dashboardContent = "", captionContent = "", activeTourStep = null;
function updateSpectatorView(step) {
  activeTourStep = step;
  $("#spectatorDashboard").hidden = step.kind !== "dashboard";
  const title = step.kind === "dashboard" ? `Usages de tous · ${step.page + 1}/${step.pages}`
    : step.kind === "floor" ? floors.get(step.floor)?.name ?? "Étage" : step.kind === "agents" ? "Écran des agents" : "Écran des usages";
  const caption = `${title} · suite dans ${step.remaining} s`;
  if (caption !== captionContent) { $("#tourCaption").textContent = caption; captionContent = caption; }
  if (step.kind !== "dashboard") return;
  const list = [...world.data.apartments].sort((a, b) => a.created - b.created || a.name.localeCompare(b.name, "fr")).slice(step.page * step.pageSize, (step.page + 1) * step.pageSize);
  const rows = list.map(a => ({ name: a.name, active: a.sessions.filter(s => stateOf(s, world.data.now) === "travaille").length, quotas: quotaRows(a.usage, world.data.now), claude: claudeTracked(a.usage) }));
  const content = JSON.stringify([rows, step.page, step.pages]);
  if (content === dashboardContent) return;
  dashboardContent = content;
  $("#spectatorDashboard").innerHTML = `<div class="dashboard-heading"><div><p class="kicker">Penthouse · vue d’ensemble</p><h1>Les usages de chacun</h1><p class="dashboard-lead">Quotas restants, par résident et par outil</p></div><span class="dashboard-page">${step.page + 1} / ${step.pages}</span></div>
    <div class="usage-grid">${rows.map(a => `<article class="usage-card"><header><span class="resident-avatar" aria-hidden="true">${esc(a.name.slice(0, 1).toUpperCase())}</span><div><h2>${esc(a.name)}</h2><span>${a.active} agent${a.active > 1 ? "s" : ""} au travail</span></div></header>${a.claude ? "" : `<div class="quota-row claude untracked"><div><span>Claude</span><b>non suivi</b></div><small>Mesuré après avoir relancé la commande de l’étage</small></div>`}${a.quotas.filter(q => a.claude || q.provider !== "claude").map(q => `<div class="quota-row ${q.provider}"><div><span>${q.provider === "claude" ? "Claude" : "ChatGPT"} · ${q.label === "5 HEURES" ? "5 h" : "semaine"}</span><b>${q.remaining === null ? "—" : q.remaining + " %"}</b></div><div class="quota-track"><i style="width:${q.remaining ?? 0}%"></i></div><small>${esc(q.reset)}</small></div>`).join("")}</article>`).join("") || '<p>Aucun résident pour le moment.</p>'}</div>`;
}
$("#tourPause").addEventListener("click", () => {
  world.tourPaused = !world.tourPaused;
  if (world.tourPaused) tourPausedAt = clock.elapsedTime;
  else world.tourStarted += clock.elapsedTime - tourPausedAt;
  $("#tourPause").textContent = world.tourPaused ? "Reprendre la visite" : "Pause visite";
  $("#tourPause").setAttribute("aria-pressed", String(world.tourPaused));
  document.body.classList.toggle("spectator-presentation", !world.tourPaused);
  $("#tourCaption").hidden = world.tourPaused;
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

export { activeTourStep, autoTour, keepFocusShown, setFocus, stepFocus, updateSpectatorView };
