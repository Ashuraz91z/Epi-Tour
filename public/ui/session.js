// Session : entrée (nom et code, clé, spectateur), flux temps réel, vérification d’identité, état reçu (tick).

import { applyKioskFromUrl, startStateStream } from "../penthouse-extras.js";
import { world } from "../tour/state.js";
import { $, KEY, ME, rememberKey } from "../tour/base.js";
import { clock } from "../tour/engine.js";
import { previousApprovals, refreshConnectionStatus, render, setText, showLink } from "./panel.js";
import { applyTourMode, savedTourMode } from "../tour/navigation.js";

applyKioskFromUrl();
// Flux temps réel : ouvert une fois l'entrée acceptée et les modèles 3D chargés (sinon les étages se construiraient
// sans robot) ; rouvert après un changement de rôle (entrée résident, mode spectateur).
let stateStream = null;
function ensureStream(restart = false) {
  if (!world.modelsReady) return;
  if (!stateStream) stateStream = startStateStream(payload => { lastStreamAt = Date.now(); world.data = payload; applyLoadedState(); });
  else if (restart) stateStream.restart();
}

$("#spectate").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget, button = form.querySelector("button");
  button.disabled = true; $("#spectateErr").textContent = "";
  try {
    const r = await fetch("/api/spectate", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }), j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Salle inaccessible.");
    sessionStorage.removeItem("penthouse.cle"); world.order = [];
    $("#spectatorDlg").close();
    lastStreamAt = 0;
    await tick();
    ensureStream(true);
  } catch (error) { $("#spectateErr").textContent = error.message; }
  finally { button.disabled = false; }
});
$("#exitSpectator").addEventListener("click", async () => {
  try {
    const r = await fetch("/api/exit-spectator", { method: "POST", body: "{}" });
    if (!r.ok) return;
    location.reload();
  } catch { $("#exitSpectator").textContent = "Réessayer de quitter"; }
});

$("#join").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget, button = form.querySelector("button");
  button.disabled = true; $("#joinErr").textContent = "";
  try {
    const r = await fetch("/api/join", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Entrée impossible.");
    localStorage.setItem(ME, JSON.stringify({ slug: j.slug, name: j.name }));
    const remember = !!form.remember?.checked;
    // Étage existant : la clé de l'appareil reste valable si c'est bien la sienne (vérifiée juste après).
    if (j.token) rememberKey(j.token, remember);
    else if (localStorage.getItem(KEY)) sessionStorage.setItem(KEY, localStorage.getItem(KEY));
    else sessionStorage.removeItem(KEY);
    identityChecked = false;
    world.order = [];
    lastStreamAt = 0;
    await tick();
    ensureStream(true);
    if (j.token) showLink();
  } catch (error) { $("#joinErr").textContent = error.message || "Serveur injoignable. Réessaie."; }
  finally { button.disabled = false; }
});

// Entrer avec sa clé d'étage : pas besoin du code ni du nom, on arrive chez soi avec tout (robots, jeux, thème).
async function enterWithKey(key, remember) {
  const r = await fetch("/api/enter-key", { method: "POST", body: JSON.stringify({ key }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Clé refusée.");
  localStorage.setItem(ME, JSON.stringify({ slug: j.slug, name: j.name }));
  rememberKey(key, remember);
  identityChecked = true;
  world.order = [];
  lastStreamAt = 0;
  return j;
}
$("#enterKey").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget, button = form.querySelector("button");
  button.disabled = true; $("#keyErr").textContent = "";
  try {
    await enterWithKey(String(form.key.value).trim(), form.remember.checked);
    await tick();
    ensureStream(true);
  } catch (error) { $("#keyErr").textContent = error.message || "Serveur injoignable. Réessaie."; }
  finally { button.disabled = false; }
});
$("#forgetBtn").addEventListener("click", () => {
  try { localStorage.removeItem(KEY); } catch { /* rien à oublier */ }
  $("#forgetBtn").hidden = true;
});
// L'étage affiché comme « chez toi » est celui de la clé : un ancien nom, un étage fusionné ou renommé, ou une entrée
// sous un autre nom ne doivent pas cacher tes robots.
let identityChecked = false, autoEnterTried = false;
async function checkIdentity() {
  const key = sessionStorage.getItem(KEY);
  if (identityChecked || !key) return;
  identityChecked = true;
  try {
    const r = await fetch("/api/connection", { headers: { "X-Tour-Token": key } });
    if (!r.ok) return;
    const j = await r.json(), me = JSON.parse(localStorage.getItem(ME) ?? "null");
    if (me?.slug !== j.slug) {
      localStorage.setItem(ME, JSON.stringify({ slug: j.slug, name: j.name }));
      world.order = [];
      if (world.data) applyLoadedState();
    }
  } catch { /* nouvel essai au prochain chargement */ }
}
// Sans clé dans l'onglet : un nom d'étage fusionné ou renommé depuis (« Paul ») est remplacé par l'étage actuel.
let staleNameChecked = "";
async function fixStaleName() {
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  if (!me?.slug || staleNameChecked === me.slug || world.data?.apartments.some(a => a.slug === me.slug)) return;
  staleNameChecked = me.slug;
  try {
    const r = await fetch("/api/resolve?slug=" + encodeURIComponent(me.slug));
    if (!r.ok) return;
    const j = await r.json();
    localStorage.setItem(ME, JSON.stringify({ slug: j.slug, name: j.name }));
    world.order = [];
    if (world.data) applyLoadedState();
  } catch { /* nouvel essai au prochain chargement */ }
}

let tickPending = false, lastStreamAt = 0;
function applyLoadedState() {
  if (!world.data) return;
  const spectator = world.data.viewer?.role === "spectator";
  if (!spectator) { checkIdentity(); fixStaleName(); }
  // Version du site, pour vérifier qu'il a bien repris la dernière mise à jour ; bouton pour oublier la clé retenue.
  const versionText = world.data.version ? `Version ${world.data.version}` : "";
  if ($("#versionLine").textContent !== versionText) $("#versionLine").textContent = versionText;
  let remembered = false;
  try { remembered = !!localStorage.getItem(KEY); } catch { /* stockage indisponible */ }
  $("#forgetBtn").hidden = spectator || !remembered;
  if (spectator && !document.body.dataset.spectating) {
    world.tourStarted = clock.elapsedTime; world.tourPaused = false;
    document.body.dataset.spectating = "true";
    applyTourMode(savedTourMode() === "free"); // la façon de regarder choisie la dernière fois sur cet appareil
  }
  if (!spectator) delete document.body.dataset.spectating;
  $("#tourSwitch").hidden = !spectator;
  if (!spectator) $("#dayBoardBtn").hidden = true;
  $("#tourCaption").hidden = !spectator || world.tourPaused;
  document.body.classList.toggle("spectator-presentation", spectator && !world.tourPaused);
  if (!spectator) $("#spectatorDashboard").hidden = true;
  $("#viewerBadge").hidden = !spectator;
  $("#exitSpectator").hidden = !spectator;
  const resident = !spectator;
  $("#linkBtn").hidden = spectator;
  $("#spectatorBtn").hidden = spectator;
  $("#historyBtn").hidden = !resident;
  $("#customizeBtn").hidden = !resident;
  $("#notifyBtn").hidden = !resident;
  $("#missionsBtn").hidden = !resident;
  $("#moreWrap").hidden = [...$("#moreMenu").children].every(b => b.hidden);
  if (spectator && $("#linkDlg").open) $("#linkDlg").close();
  if (Date.now() > world.tvMine) ({ channel: world.tvChoice = "auto", by: world.tvBy = "", custom: world.tvCustom = null } = world.data.tv ?? {});
  $("#lobby").hidden = true;
  $("#app").hidden = false;
  render();
  refreshConnectionStatus();
}
async function tick() {
  if (document.hidden || tickPending) return;
  if (lastStreamAt && Date.now() - lastStreamAt < 4500) return;
  tickPending = true;
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.status === 401 && !autoEnterTried && localStorage.getItem(KEY)) {
      autoEnterTried = true;
      try { await enterWithKey(localStorage.getItem(KEY), true); tickPending = false; return tick(); } catch { /* clé périmée : accueil normal */ }
    }
    if (r.status === 401) {
      stateStream?.close(); stateStream = null; lastStreamAt = 0;
      $("#lobby").hidden = false; $("#app").hidden = true;
      $("#permissionBanner").hidden = true; $("#permissionGlow").hidden = true;
      previousApprovals.clear(); world.activeApproval = null;
      $("#permissionFlash").getAnimations().forEach(animation => animation.cancel());
      return;
    }
    if (!r.ok) throw new Error("État indisponible (HTTP " + r.status + ").");
    world.data = await r.json();
    applyLoadedState();
    ensureStream();
  } catch (e) { console.warn("tour : nouvel essai au prochain tour", e); }
  finally { tickPending = false; }
}
document.addEventListener("visibilitychange", () => { if (world.modelsReady && !document.hidden) { tick(); refreshLive(); } });
setInterval(() => { if (document.hidden) return; setText($("#clock"), new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })); }, 1000);
async function refreshLive() {
  if (document.hidden) return;
  try { const r = await fetch("/api/live"); if (r.ok) { world.liveNow = await r.json(); if (world.data) render(); } } catch { /* nouvel essai dans une minute */ }
}

export { enterWithKey, refreshLive, tick };
