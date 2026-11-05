// Studio de mon étage : presets et choix de la salle, aperçu en direct, enregistrement du profil.

import { saveProfile } from "../penthouse-extras.js";
import { ROOM_DEFAULT, ROOM_OPTIONS, ROOM_PRESETS, cleanRoom, presetOf } from "../room-data.js";
import { world } from "../tour/state.js";
import { $, esc, myApt } from "../tour/base.js";
import { tvLinks } from "../tour/floors/resident.js";
import { syncFloors } from "../tour/tower.js";
import { setFocus } from "../tour/navigation.js";
import { render } from "./panel.js";
import { tick } from "./session.js";

// ---------- studio de mon étage ----------
// Aperçu en direct : tant que le studio est ouvert, l'étage du résident est construit avec les choix du formulaire
// (roomPreview), par-dessus l'état reçu du serveur. Fermer sans enregistrer le remet tel qu'il était. Le studio ne
// bloque pas la tour : on peut tourner autour de son étage pendant qu'on le compose.
let roomPreview = null;
function withPreview(a) {
  return roomPreview?.slug === a.slug ? { ...a, profile: { ...a.profile, ...roomPreview.profile } } : a;
}
const studioForm = $("#customizeForm"), studioDlg = $("#customizeDlg");
for (const select of studioForm.querySelectorAll("select[data-room]"))
  select.innerHTML = ROOM_OPTIONS[select.dataset.room].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
$("#roomObjects").innerHTML = ROOM_OPTIONS.objets.map(([v, l]) =>
  `<label class="object-chip"><input type="checkbox" name="objets" value="${v}"><span>${esc(l)}</span></label>`).join("");
$("#roomPresets").innerHTML = ROOM_PRESETS.map(p => `<button type="button" class="preset-card" data-preset="${p.id}" aria-pressed="false">
  <span class="preset-icon" aria-hidden="true">${p.icon}</span><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`).join("");
function studioDraft() {
  const fd = new FormData(studioForm);
  return {
    theme: fd.get("theme"), accent: fd.get("accent"),
    room: cleanRoom({ sol: fd.get("sol"), solBureau: fd.get("solBureau"), murs: fd.get("murs"), bureaux: fd.get("bureaux"), lumiere: fd.get("lumiere"), objets: fd.getAll("objets") }),
  };
}
function fillStudio(theme, room) {
  const r = cleanRoom(room);
  studioForm.theme.value = theme;
  for (const k of ["sol", "solBureau", "murs", "bureaux", "lumiere"]) studioForm[k].value = r[k];
  for (const box of studioForm.querySelectorAll('input[name="objets"]')) box.checked = r.objets.includes(box.value);
}
function markPreset() {
  const d = studioDraft(), id = presetOf(d.theme, d.room);
  for (const b of $("#roomPresets").children) b.setAttribute("aria-pressed", String(b.dataset.preset === id));
}
function previewStudio() {
  const slug = myApt()?.slug;
  if (!slug) return;
  roomPreview = { slug, profile: studioDraft() };
  markPreset();
  if (world.data) { syncFloors(world.data.apartments); render(); }
}
function showCustomize() {
  const apt = myApt();
  if (!apt) return;
  studioForm.accent.value = apt.profile?.accent ?? "#e8c27a";
  studioForm.tagline.value = apt.profile?.tagline ?? "";
  studioForm.screens.value = (apt.profile?.screens ?? []).join(" / ");
  studioForm.tv.value = apt.profile?.tv ? tvLinks(apt.profile.tv).page : "";
  fillStudio(apt.profile?.theme ?? "classique", apt.profile?.room);
  markPreset();
  $("#customizeErr").textContent = "";
  // On regarde son propre étage pendant qu'on le compose.
  const home = world.order.indexOf(`${apt.slug}:work`);
  if (home >= 0 && home !== world.focus) setFocus(home);
  studioDlg.show();
}
$("#customizeBtn").addEventListener("click", showCustomize);
// Les textes et la télé ne changent pas l'étage en direct : ils s'appliquent à l'enregistrement.
studioForm.addEventListener("change", e => { if (!e.target.closest(".studio-more")) previewStudio(); });
$("#roomPresets").addEventListener("click", e => {
  const preset = ROOM_PRESETS.find(p => p.id === e.target.closest("[data-preset]")?.dataset.preset);
  if (!preset) return;
  fillStudio(preset.theme, { ...ROOM_DEFAULT, ...preset.room });
  previewStudio();
});
$("#customizeCancel").addEventListener("click", () => studioDlg.close());
studioDlg.addEventListener("keydown", e => { if (e.key === "Escape") studioDlg.close(); });
studioDlg.addEventListener("close", () => {
  if (!roomPreview) return;
  roomPreview = null;
  if (world.data) { syncFloors(world.data.apartments); render(); }
});
studioForm.addEventListener("submit", async e => {
  e.preventDefault();
  const token = sessionStorage.getItem("penthouse.cle");
  if (!token) { $("#customizeErr").textContent = "Clé requise : ouvre Relier mes agents."; return; }
  const fields = Object.fromEntries(new FormData(e.currentTarget)), draft = studioDraft();
  $("#customizeErr").textContent = "";
  try {
    const profile = await saveProfile(token, { accent: fields.accent, tagline: fields.tagline, theme: draft.theme, room: draft.room, screens: fields.screens, tv: fields.tv });
    // L'état local prend tout de suite le profil enregistré : l'étage ne repasse pas par l'ancien décor.
    const apt = myApt();
    if (apt && profile) apt.profile = profile;
    studioDlg.close();
    await tick();
  } catch (error) { $("#customizeErr").textContent = error.message; }
});

$("#notifyBtn").addEventListener("click", async () => {
  if (typeof Notification === "undefined") { alert("Notifications non supportées par ce navigateur."); return; }
  const p = await Notification.requestPermission();
  $("#notifyBtn").textContent = p === "granted" ? "Alertes activées" : "Alertes refusées";
});

export { showCustomize, withPreview };
