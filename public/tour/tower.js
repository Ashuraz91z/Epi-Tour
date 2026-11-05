// La tour : un étage par aile de résident plus les étages communs (syncFloors), placement des agents à leur
// place et mise à jour de leur bulle à chaque état reçu (update).

import { assignPauseSlots, breakVisit } from "../break-motion.js";
import { assignDeskSlots } from "../desk-slots.js";
import { homeFloor, wingsOf } from "../wings-client.js";
import { officeTierForLevel } from "../upgrades-client.js";
import { decorKeyOf, staffOf } from "../economy-ui.js";
import { world } from "./state.js";
import {
  ELEV, FLOOR_H, FLOOR_OF, P, RES_SLOTS, SHARED, SHARED_SLOTS, STATE_COLOR, TOOLS, hash, keyOf, placeOf, slotOf,
  stateOf,
} from "./base.js";
import { agents, clock, floors, glow, mat, scene } from "./engine.js";
import { enter, leave, makeAgent } from "./robots.js";
import { endCelebration } from "./work-fx.js";
import { buildResident, disposeFloor, removeFloor, themeKey } from "./floors/resident.js";
import { buildShared } from "./floors/shared.js";
import { withPreview } from "../ui/studio.js";
import { productive } from "./mode.js";

// Seuls l'étage regardé (et celui qui s'envole) sont dans la scène : les autres n'y sont plus du tout, ni parcourus
// pour les matrices, ni par les moteurs d'étiquettes et d'écrans. En sortant, leurs éléments HTML sont masqués et une
// télé géante coupe sa vidéo.
function stageFloor(f, shown) {
  if (shown === (f.group.parent === scene)) return;
  if (shown) { scene.add(f.group); return; }
  scene.remove(f.group);
  if (f.celebration) endCelebration(f);
  f.group.traverse(o => { if (o.isCSS2DObject || o.isCSS3DObject) o.element.style.display = "none"; });
  if (f.tv && f.tv.shown !== "about:blank") { f.tv.shown = "about:blank"; f.tv.iframe.src = "about:blank"; }
}

function syncFloors(list) {
  world.residents = list;
  const residentKeys = list.flatMap(a => wingsOf(a).map(w => `${a.slug}:${w.id}`));
  world.order = [...SHARED.filter(d => d.top).map(d => d.id), ...residentKeys, ...SHARED.filter(d => !d.top).map(d => d.id)];
  for (const a0 of list) {
    const a = withPreview(a0); // studio ouvert : l'étage du résident suit le formulaire
    for (const w of wingsOf(a)) {
      const k = `${a.slug}:${w.id}`;
      const tier = w.id === "work" ? officeTierForLevel(a.game?.level ?? 1) : null;
      const prev = floors.get(k);
      if (!prev) {
        floors.set(k, buildResident(a, w, tier ?? undefined));
      } else if (w.id === "work" && (prev.officeTierId !== tier.id || prev.decorKey !== decorKeyOf(a) || prev.themeKey !== themeKey(a))) {
        // Palier d'aménagement, décor acheté ou ambiance : l'étage est reconstruit, ses agents passent dans le nouveau.
        for (const [, g] of agents) if (g.userData.floor === k) prev.group.remove(g);
        removeFloor(k);
        floors.set(k, buildResident(a, w, tier));
        floors.get(k).group.position.y = prev.group.position.y; // reste en place, sans glisser depuis le haut
        for (const [, g] of agents) if (g.userData.floor === k) floors.get(k).group.add(g);
      }
    }
  }
  for (const d of SHARED) if (!floors.has(d.id)) floors.set(d.id, buildShared(d));
  for (const [k, f] of floors) if (!world.order.includes(k)) {
    disposeFloor(f);
    scene.remove(f.group);
    floors.delete(k);
  }
  world.order.forEach((k, i) => { floors.get(k).baseY = -i * FLOOR_H; });
  world.focus = Math.max(0, Math.min(world.focus, world.order.length - 1));
}

function floorLabel(i) {
  const f = floors.get(world.order[i]);
  if (f.kind === "shared") return f.def.icon;
  if (f.wingId === "work" && f.residentSlug === world.residents[0]?.slug) return "PH";
  return f.wing?.icon ?? "🏢";
}

function update(now) {
  // Placement : chaque (étage, pièce) remplit ses places dans l'ordre d'arrivée des agents, tous résidents confondus.
  const want = new Map(), groups = new Map();
  for (const a of world.residents) for (const s of a.sessions) {
    const key = keyOf(a.slug, s), u = agents.get(key)?.userData, state = stateOf(s, now);
    const paused = ["fini", "fermé", "silencieux"].includes(state), seed = hash(key);
    let place = placeOf(s, now), visit = paused ? breakVisit(hash(`${s.src}:${s.host}:${s.sid}`), now - s.updated, state === "silencieux").visit : null;
    // Un agent termine son trajet de pause avant de choisir une autre destination.
    if (paused && u?.path.length && u.state === state && u.s.updated === s.updated) { place = u.place; visit = u.pauseVisit; }
    const floor = homeFloor(a, s, place, FLOOR_OF);
    const k = floor + "/" + place;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ a, s, key, floor, place, paused, seed, visit });
  }
  for (const list of groups.values()) {
    list.sort((x, y) => x.s.started - y.s.started);
    const deskSlots = list[0]?.place === "open" ? assignDeskSlots(list.map(w => w.key),
      new Map(list.flatMap(w => {
        const u = agents.get(w.key)?.userData;
        return u?.place === "open" && u.target === w.floor ? [[w.key, u.index]] : [];
      }))) : null;
    const pauseSlots = list[0]?.paused ? assignPauseSlots(list.map(w => ({ key: w.key, seed: w.seed, visit: w.visit, moving: !!agents.get(w.key)?.userData.path.length })),
      new Map(list.flatMap(w => {
        const u = agents.get(w.key)?.userData;
        return u?.place === w.place && u.target === w.floor ? [[w.key, { index: u.index, visit: u.pauseVisit }]] : [];
      })), SHARED_SLOTS[list[0].place].length) : null;
    list.forEach((w, position) => {
      const k = deskSlots?.get(w.key) ?? pauseSlots?.get(w.key) ?? position;
      const [x, y, facing, anim, way = [], seat] = slotOf(RES_SLOTS[w.place] ?? SHARED_SLOTS[w.place], k);
      const slot = P(x, y, seat ?? (w.place === "rest" && k % 3 < 2 ? 0.36 : 0));
      if (w.place === "open" && anim === "Sitting") {
        // Chaise de bureau ×2 : coussin à 0,47 m ; bassin Sitting à 0,24 m.
        slot.y = 0.23;
        slot.z += 0.20;
      }
      if (w.place === "cafe" && anim === "Sitting") {
        // Coussin à 0,48 m, bassin Sitting à 0,24 m ; la racine est 0,20 m devant le bassin.
        slot.y = 0.24;
        slot.x += Math.sin(facing) * 0.20;
        slot.z += Math.cos(facing) * 0.20;
      }
      want.set(w.key, { ...w, slot, facing, anim, way: way.map(([wx, wy, wh = 0]) => P(wx, wy, wh)), index: k });
    });
  }

  for (const [key, w] of want) {
    let g = agents.get(key);
    const u0 = g?.userData;
    if (!g) {
      // Un nouvel agent sort de l'ascenseur de son étage.
      g = makeAgent(key, w.s);
      floors.get(w.floor).group.add(g);
      g.position.copy(ELEV);
      Object.assign(g.userData, { floor: w.floor, path: enter(w.slot, w.way) });
      agents.set(key, g);
    } else if (u0.target !== w.floor || u0.place !== w.place || !u0.slot.equals(w.slot)) {
      // Même étage : il marche jusqu'à sa nouvelle place. Sinon : ascenseur, changement d'étage, puis sa place.
      u0.path = u0.floor === w.floor ? [...leave(g.position, u0.way), ...enter(w.slot, w.way)]
        : [...leave(g.position, u0.way), ELEV.clone(), { toFloor: w.floor }, ...enter(w.slot, w.way)];
    }
    const u = g.userData, st = stateOf(w.s, now);
    Object.assign(u, { s: w.s, apt: w.a, state: st, place: w.place, pauseVisit: w.visit, slot: w.slot, slotFacing: w.facing, slotAnim: w.anim, way: w.way, index: w.index, target: w.floor });
    u.ring.material.color.set(STATE_COLOR[st] ?? "#8b93a7");
    // Bulle : l'action au poste, la demande d'accord chez le résident, sinon à qui appartient l'agent.
    // Au repos, l'icône du grade de l'employé (économie du résident) précède son nom.
    const T = TOOLS[w.s.src] ?? { name: w.s.src }, grade = productive() ? null : staffOf(w.a, w.s.src)?.grade?.icon;
    // Spectateur : les actions sont filtrées par le serveur ; la bulle dit alors qui travaille et avec quel outil.
    const text = st === "travaille" ? w.s.action || `${T.name} · au travail` : st === "autorisation" ? "Autorise-moi ?" : st === "erreur" ? "Erreur"
      : `${grade ? grade + " " : ""}${w.a.name} · ${T.name}`;
    // Tâche livrée : le texte de la célébration reste affiché quelques secondes au-dessus du robot.
    if (u.cheerTextUntil > clock.elapsedTime && st !== "autorisation") continue;
    const cls = "bubble3d" + (st === "autorisation" ? " auth" : "") + (st === "travaille" || st === "autorisation" || st === "erreur" ? "" : " who");
    if (u.bubble.element.textContent !== text) u.bubble.element.textContent = text;
    if (u.bubble.element.className !== cls) u.bubble.element.className = cls;
  }
  for (const [key, g] of agents) if (!want.has(key)) {
    const u = g.userData, materials = new Set([u.ring.material, ...u.puffs.map(p => p.material)]), skeletons = new Set();
    g.traverse(o => { if (o.userData.tourMaterial) materials.add(o.material); if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    for (const material of materials) material.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    u.mixer.stopAllAction(); u.mixer.uncacheRoot(g.children[0]);
    u.bubble.element.remove(); g.remove(u.bubble);
    g.parent?.remove(g);
    agents.delete(key);
  }

  // Écrans allumés aux postes occupés, alarme chez le résident quand un agent attend son accord
  for (const a of world.residents) {
    for (const w of wingsOf(a)) {
      const fk = `${a.slug}:${w.id}`;
      const f = floors.get(fk);
      if (!f?.screens) continue;
      const busy = new Set();
      for (const row of groups.get(`${fk}/open`) ?? []) {
        const wnt = want.get(row.key);
        if (wnt) busy.add(wnt.index);
      }
      f.screens.forEach((sc, k) => { sc.material = busy.has(k) ? f.busyScreen ?? glow("#4fb6ff", 1.4) : f.idleScreen ?? mat("#1d2433"); });
    }
    const fw = floors.get(`${a.slug}:work`);
    if (fw) fw.alert = (groups.get(`${a.slug}:work/boss`) ?? []).length > 0;
  }

}

export { floorLabel, stageFloor, syncFloors, update };
