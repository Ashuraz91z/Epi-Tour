// Boucle d’animation : étages affichés, agents, caméra, résolution adaptative et redimensionnement.

import * as THREE from "three";
import { spectatorStep } from "../spectator-tour.js";
import { world } from "./state.js";
import { $, ELEV, LIFT, SLOT_MOTION, clubAnimation } from "./base.js";
import { agents, camera, clock, controls, floors, labels, lendLights, renderer, scene, screens } from "./engine.js";
import { reducedMotion } from "./kit.js";
import { AD_SITE, BEACON_OFF, BEACON_ON, GROUND, USAGE_SITE, animateOutside, beacons, syncOutside, tower } from "./city.js";
import { HELD_OF_SLOT, holdProp, play, steadyProp } from "./robots.js";
import { tickWorkFloor } from "./work-fx.js";
import { ALARM_OFF, ALARM_ON, ELEV_OFF, ELEV_ON } from "./floors/shell.js";
import { drawArcade } from "./floors/resident.js";
import { tickPrestige } from "./floors/prestige.js";
import { stream, tvUrl } from "./floors/shared.js";
import { stageFloor } from "./tower.js";
import { autoTour, setFocus, updateSpectatorView } from "./navigation.js";
import { render } from "../ui/panel.js";

// ---------- animation ----------
const coveringDialogs = ["#sportDlg", "#economyDlg"].map(id => $(id));
const tourCovered = () => { for (const d of coveringDialogs) if (d?.open) return true; return false; };
const tmp = new THREE.Vector3();
let lastFrameAt = 0;
const tourTarget = new THREE.Vector3(), tourPosition = new THREE.Vector3();
const palette = ["#ff6fd8", "#7ec3f0", "#ffd36e", "#4ade80", "#a37cf0"].map(c => new THREE.Color(c));

function animate(frameTime = performance.now()) {
  requestAnimationFrame(animate);
  if (document.hidden) { clock.getDelta(); return; }
  // Les écrans 120/144 Hz gardent la fluidité à 60 images/s sans doubler le travail 3D.
  if (frameTime - lastFrameAt < 1000 / 60) return;
  lastFrameAt = frameTime - (frameTime - lastFrameAt) % (1000 / 60);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  // Mini-jeux (tennis, golf) ou dialogue Entreprise ouverts : ils couvrent la tour et ont leur propre animation. La 3D
  // s'arrête (ni calcul, ni dessin, ni étiquettes) et reprend à leur fermeture là où elle en était.
  if (tourCovered()) return;
  adaptResolution(frameTime);
  animateOutside(t);
  syncOutside();
  const focusKey = world.order[world.focus];
  let leaving = null, css3d = false;
  for (let i = 0; i < world.order.length; i++) {
    const key = world.order[i], f = floors.get(key), y = f.baseY + (i < world.focus ? LIFT : 0);
    f.group.position.y += (y - f.group.position.y) * Math.min(1, dt * 4);
    // Seul l'étage regardé est ouvert : ceux du dessus s'envolent puis disparaissent, ceux du dessous sont la tour.
    const near = i === world.focus;
    f.group.visible = near || (i < world.focus && Math.abs(y - f.group.position.y) > 0.5);
    stageFloor(f, f.group.visible);
    if (!f.group.visible) continue;
    if (!near) leaving = f;
    css3d ||= f.hasCss3d;
    animateFloor(f, key, near, dt, t);
  }
  // Les trois lampes vont d'abord à l'étage regardé, le reste à celui qui s'envole.
  lendLights(floors.get(focusKey), leaving);
  beacons.color.copy(Math.sin(t * 2.5) > 0.6 ? BEACON_ON : BEACON_OFF);
  // Le haut de la tour suit l'étage regardé.
  if (world.order.length) {
    world.towerTop += (floors.get(world.order[world.focus]).baseY - 0.5 - world.towerTop) * Math.min(1, dt * 4);
    tower.position.y = world.towerTop;
    tower.scale.y = world.towerTop - GROUND;
  }
  animateAgents(dt, t, focusKey);
  animateCamera(dt, t);
  // Le direct ne se charge que quand on regarde le Salon.
  const url = focusKey === "lounge" ? tvUrl() : "about:blank";
  if (url !== world.shownUrl) { world.shownUrl = url; stream.src = url; }
  scene.updateMatrixWorld();
  renderer.render(scene, camera);
  // Écrans HTML (télé du Salon, télé géante) : seulement si un étage affiché en porte un ; les autres sont déjà masqués.
  if (css3d) screens.render(scene, camera);
  labels.render(scene, camera);
}

// Un étage affiché : ses décors animés, son robot de résident, ses ticks (casino, tennis, golf, cyberpunk…).
function animateFloor(f, key, near, dt, t) {
  // Les étiquettes HTML ignorent les murs : seules celles de l'étage regardé s'affichent.
  f.tag.visible = near;
  if (f.roomTags) for (const l of f.roomTags) l.visible = near;
  if (f.kind === "resident") {
    f.ownerTag.visible = near;
    if (f.celebration) f.celebration.banner.visible = near;
    f.alarmLight.intensity = f.alert ? 6 + Math.sin(t * 9) * 5 : 0;
    f.alarm.material = f.alert && Math.sin(t * 9) > 0 ? ALARM_ON : ALARM_OFF;
    play(f.owner, "Sitting");
    f.owner.userData.mixer.update(dt);
    if (near) tickWorkFloor(f, dt, t);
    if (near && f.prestige) tickPrestige(f.prestige, dt, t);
  }
  if (f.staff) for (const r of f.staff) { r.userData.mixer.update(dt); steadyProp(r, dt); }
  // Casino, tennis et golf : leurs animations (et les parties rejouées) n'avancent que sur l'étage affiché.
  f.tick?.(dt, t, reducedMotion.matches);
  f.dancers?.forEach((r, k) => {
    play(r, clubAnimation(t, k * 0.37));
    r.rotation.y = k * 1.1 + Math.sin(t * 1.2 + k * 1.7) * 0.5;
  });
  const decorTime = reducedMotion.matches ? 0 : t;
  f.records?.forEach(d => { d.rotation.y = decorTime * 1.8; });
  f.cyber?.tick(dt, near);
  if (f.tv) { f.tv.view.visible = near; const want = near ? f.tv.url : "about:blank"; if (f.tv.shown !== want) { f.tv.shown = want; f.tv.iframe.src = want; } }
  f.flames?.forEach((flame, k) => {
    flame.scale.set(1, 0.8 + Math.sin(decorTime * 5 + k * 2) * 0.3, 1);
  });
  if (f.fireGlow) f.fireGlow.intensity = 2.8 + Math.sin(decorTime * 4) * 0.3;
  if (f.windSock) { f.windSock.rotation.y = 0.25 + Math.sin(decorTime * 0.6) * 0.25; f.windSock.rotation.z = Math.sin(decorTime * 2) * 0.07; }
  f.haze?.forEach(cloud => {
    const { spread, rise, count } = cloud.userData, pos = cloud.geometry.attributes.position;
    for (let k = 0; k < count; k++) {
      const phase = (decorTime * 0.12 + k / count) % 1;
      pos.setXYZ(k, phase * spread * 1.4 + Math.sin(k * 2.4) * spread * 0.25,
        phase * rise, Math.cos(k * 2.4) * spread * 0.4 + Math.sin(decorTime * 0.4 + k) * phase * 0.2);
    }
    pos.needsUpdate = true;
  });
  f.discos?.forEach(d => { d.rotation.y += dt * 1.2; });
  // Décor acheté : poissons de l'aquarium et écran de la borne d'arcade (immobiles si les animations sont réduites).
  f.fish?.forEach(p => {
    const k = decorTime * p.speed + p.phase;
    p.fish.position.set(p.x + Math.sin(k * 1.3) * 0.04, p.y + Math.sin(k * 2.1) * 0.03, Math.sin(k) * 0.55);
    p.fish.rotation.y = Math.cos(k) >= 0 ? 0 : Math.PI;
  });
  if (f.arcade && Math.floor(decorTime * 2) !== f.arcade.frame) { f.arcade.frame = Math.floor(decorTime * 2); drawArcade(f.arcade, f.arcade.frame); }
  f.steam?.forEach(p => {
    const k = (t * 0.35 + p.userData.phase) % 1;
    p.position.set(p.userData.x + Math.sin(k * 6) * 0.03, 0.86 + k * 0.45, p.userData.z);
    p.scale.setScalar(0.6 + k * 1.4);
    p.material.opacity = 0.35 * Math.sin(k * Math.PI);
  });
  f.spots?.forEach((c, k) => { c.rotation.z = Math.sin(t * 1.3 + k * 2) * 0.4; c.rotation.x = Math.cos(t * 0.9 + k) * 0.25; });
  f.lasers?.forEach((l, k) => { l.rotation.y = Math.sin(t * (0.7 + k * 0.13) + k) * 0.9; l.rotation.x = 0.12 + Math.sin(t * 1.1 + k * 2) * 0.1; });
  f.tiles?.forEach(tile => { tile.material.emissive.copy(palette[(tile.userData.k + Math.floor(t * 2)) % palette.length]); tile.material.emissiveIntensity = 0.35 + 0.35 * Math.abs(Math.sin(t * 3 + tile.userData.k)); });
  // Mur de LED : un égaliseur qui suit un rythme à 124 BPM (redessiné à 30 images/s : la texture repart moins souvent).
  if (f.eq && Math.floor(t * 30) !== f.eq.frame) {
    f.eq.frame = Math.floor(t * 30);
    const { ctx, tex } = f.eq, beat = Math.pow(1 - ((t * 124 / 60) % 1), 3);
    ctx.fillStyle = "#07040c"; ctx.fillRect(0, 0, 128, 48);
    for (let b = 0; b < 32; b++) {
      const h = 6 + (0.5 + 0.5 * Math.sin(t * (3 + (b % 5)) + b * 1.7)) * 26 * (0.55 + 0.45 * beat);
      ctx.fillStyle = `hsl(${(b * 9 + t * 40) % 360} 90% 60%)`;
      ctx.fillRect(b * 4, 48 - h, 3, h);
    }
    tex.needsUpdate = true;
  }
  // La porte de l'ascenseur s'illumine quand quelqu'un l'emprunte
  let lift = false;
  for (const g of agents.values()) if (g.userData.floor === key && g.position.distanceTo(ELEV) < 1.2) { lift = true; break; }
  f.elevDoor.material = lift ? ELEV_ON : ELEV_OFF;
}

function animateAgents(dt, t, focusKey) {
  for (const g of agents.values()) {
    const u = g.userData;
    u.bubble.visible = u.floor === focusKey;
    let walking = false, walkY = u.stepY ?? 0;
    // Célébration d'une tâche livrée (« Yes » ou « Jump ») : le robot s'arrête, debout, le temps du geste.
    const cheering = u.cheerUntil > t;
    if (u.wait > 0) { u.wait -= dt; g.visible = u.wait <= 0; }
    else if (u.path.length && !cheering) {
      const next = u.path[0];
      // (« toFloor » et non « floor » : les vecteurs de Three.js ont déjà une méthode floor())
      if (next.toFloor) {
        // Dans l'ascenseur : l'agent passe d'un étage à l'autre et ressort par la porte.
        const to = floors.get(next.toFloor).group;
        to.add(g);
        // Étage hors scène : personne ne mettrait sa bulle à jour, elle resterait figée à l'écran.
        if (to.parent !== scene) u.bubble.element.style.display = "none";
        g.position.copy(ELEV);
        u.floor = next.toFloor;
        u.path.shift();
        u.wait = 0.8;
        u.stepY = walkY = 0;
        g.visible = false;
      } else {
        tmp.subVectors(next, g.position);
        tmp.y = 0;
        const d = tmp.length(), step = dt * 2.6;
        if (d <= step) { g.position.x = next.x; g.position.z = next.z; u.path.shift(); if (next !== u.slot) u.stepY = next.y; }
        else { tmp.normalize(); g.position.x += tmp.x * step; g.position.z += tmp.z * step; u.dir = Math.atan2(tmp.x, tmp.z); walking = true; }
        // Les points de passage des gradins ont une hauteur : l'agent la gagne en marchant ; vers sa place, il reste au niveau du dernier.
        walkY = next === u.slot ? u.stepY ?? 0 : next.y;
      }
    }
    const settled = !walking && !u.path.length;
    // Chaque assise fournit sa hauteur ; pendant la marche, celle du sol ou de la marche de gradin.
    g.position.y += ((cheering ? u.stepY ?? 0 : settled ? u.slot.y : walkY) - g.position.y) * Math.min(1, dt * 8);
    const facing = !settled ? (u.dir ?? 0) : u.slotAnim === "Dance" ? Math.PI + Math.sin(t * 3 + u.seed * 6) * 0.6 : (u.slotFacing ?? 0);
    const turn = ((facing - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += turn * Math.min(1, dt * 8);
    // Animation selon le lieu : marche, assis au poste / au salon / aux toilettes, danse au Club, signe chez le résident.
    play(g, cheering ? u.cheer : !settled ? "Walking" : SLOT_MOTION[u.slotAnim]?.(t, u.seed) ?? u.slotAnim ?? "Idle");
    // Raquette à une place de joueur du court, putter au green, fer au practice ; rien en chemin ni ailleurs.
    holdProp(g, settled ? HELD_OF_SLOT[u.slotAnim] ?? null : null, u.seed);
    if (!g.parent?.visible) continue; // les agents des étages fermés avancent sans être animés ni dessinés
    u.mixer.update(dt); steadyProp(g, dt);
    u.orb.position.y = 1.78 + Math.sin(t * 2 + u.seed * 6) * 0.04;
    u.cup.visible = settled && u.place === "cafe";
    const smoking = settled && (u.place === "smoke" || u.place === "tabac"); // au tabac, ils goûtent une puff
    for (const p of u.puffs) {
      p.visible = smoking;
      if (!smoking) continue;
      const k = (t * 0.45 + p.userData.phase + u.seed) % 1;
      p.position.set(0.18 + k * 0.25, 1.35 + k * 1.1, 0.25);
      p.scale.setScalar(0.6 + k * 1.8);
      p.material.opacity = 0.45 * Math.sin(k * Math.PI);
    }
    u.ring.position.y = 0.03 + (u.stepY ?? 0) - g.position.y; // le repère reste au sol (ou sur la marche) quand le robot est assis
    u.ring.visible = u.state !== "autorisation" || Math.sin(t * 10) > -0.3;
  }
}

// La caméra suit l'étage choisi ; le toit coiffe le penthouse.
function animateCamera(dt, t) {
  const visiting = world.data?.viewer?.role === "spectator" && !world.tourPaused;
  if (visiting) {
    const step = spectatorStep(t - world.tourStarted, world.order, world.data.apartments.length, innerWidth < 760 ? 1 : innerWidth < 1100 ? 2 : Math.max(1, Math.min(6, Math.floor((innerHeight - 350) / 132))));
    const desiredFocus = step.kind === "floor" ? step.index : 0;
    if (world.focus !== desiredFocus) { world.focus = desiredFocus; render(); }
    const viewKey = `${step.kind}:${step.page}:${step.floor}:${step.remaining}`;
    if (viewKey !== world.lastTourViewKey || world.data !== world.lastTourData) {
      updateSpectatorView(step); world.lastTourViewKey = viewKey; world.lastTourData = world.data;
    }
    const board = step.kind === "agents" ? AD_SITE : step.kind === "usage" ? USAGE_SITE : null;
    const fy = floors.get(world.order[world.focus])?.baseY ?? 0;
    const wide = innerWidth < innerHeight ? 1.8 : 1;
    const target = board ? tourTarget.set(board.x, -5, board.z + 3.3) : tourTarget.set(0, fy + 0.6, 0);
    const position = tourPosition.copy(target);
    if (board) { position.y += 4 * wide; position.z += 30 * wide; }
    else { position.x += 14 * wide; position.y += 15 * wide; position.z += 22 * wide; }
    const smoothing = reducedMotion.matches ? 1 : Math.min(1, dt * 2);
    controls.target.lerp(target, smoothing); camera.position.lerp(position, smoothing);
  } else {
    const fy = world.order.length ? floors.get(world.order[world.focus]).baseY : 0;
    const dy = (fy + 0.6 - controls.target.y) * Math.min(1, dt * 3);
    controls.target.y += dy; camera.position.y += dy;
    if (autoTour && world.data?.viewer?.role !== "spectator" && t - world.lastMove > 25) { setFocus((world.focus + 1) % Math.max(world.order.length, 1)); world.lastMove = t; }
  }
  controls.autoRotate = autoTour && world.data?.viewer?.role !== "spectator";
  controls.autoRotateSpeed = 0.4;
  controls.update();
}

// Résolution du dessin : la pleine densité Retina (×2, voire ×3 avec le zoom) quadruple les pixels à calculer pour un
// gain à peine visible sur une scène animée. Elle est plafonnée à ×1,5, puis ajustée à la volée : si les images
// mettent durablement plus de ~20 ms à venir, on descend d'un cran (jusqu'à ×1, voire ×0,75 sur un écran simple) ;
// si tout est fluide depuis un moment, on remonte. Un cran qui a déjà ralenti n'est plus retenté avant une minute.
const PIXEL_CAP = 1.5, PIXEL_STEP = 0.25;
const pixelQuality = { scale: Infinity, avg: 16.7, last: 0, slowFor: 0, fastFor: 0, raisedAt: -1e9, ban: { level: Infinity, until: 0 } };
const pixelCeiling = () => Math.max(1, Math.min(devicePixelRatio * (visualViewport?.scale ?? 1), PIXEL_CAP));
const pixelFloor = () => Math.min(1, pixelCeiling()) * 0.75;
function applyPixelRatio(ratio) {
  const r = Math.max(pixelFloor(), Math.min(pixelCeiling(), ratio));
  pixelQuality.scale = r;
  if (Math.abs(renderer.getPixelRatio() - r) < 0.01) return;
  renderer.setPixelRatio(r);
  renderer.setSize(innerWidth, innerHeight);
}
function adaptResolution(now) {
  const q = pixelQuality, gap = q.last ? now - q.last : 16.7;
  q.last = now;
  if (gap > 250) { q.slowFor = q.fastFor = 0; return; } // onglet repris, étage reconstruit : rien à en conclure
  q.avg += (gap - q.avg) * 0.08;
  // Lent : la moyenne glissante dépasse ~20 ms, et chaque image lente compte (une image rapide décompte, pour que le
  // retard de la moyenne après une accalmie ne fasse pas descendre d'un cran de trop).
  if (q.avg > 20.5) { q.slowFor = Math.max(0, q.slowFor + (gap > 18 ? gap : -gap)); q.fastFor = 0; }
  else if (q.avg < 17.6) { q.fastFor += gap; q.slowFor = 0; }
  else { q.slowFor = Math.max(0, q.slowFor - gap); q.fastFor = 0; }
  const r = renderer.getPixelRatio();
  if (q.slowFor > 1500 && r > pixelFloor() + 0.01) {
    // Ralenti juste après une remontée : ce cran est trop lourd pour la machine, on ne le retente pas tout de suite.
    if (now - q.raisedAt < 10000) q.ban = { level: r, until: now + 60000 };
    applyPixelRatio(r - PIXEL_STEP);
    q.slowFor = 0; q.avg = 16.7;
  } else if (q.fastFor > 5000 && r < pixelCeiling() - 0.01) {
    const up = Math.min(pixelCeiling(), r + PIXEL_STEP);
    if (!(up >= q.ban.level - 0.01 && now < q.ban.until)) { applyPixelRatio(up); q.raisedAt = now; }
    q.fastFor = 0;
  }
}

let framed = false;
function resize() {
  const w = innerWidth, h = innerHeight;
  // Premier cadrage : plus de recul sur un écran en hauteur (téléphone) pour voir l'étage entier.
  if (!framed) { const k = w / h < 1 ? 1.9 : 1; camera.position.set(14 * k, 15 * k, 22 * k); framed = true; }
  // Zoom de la page pris en compte (l'image est recalculée, pas étirée), dans la limite du plafond ci-dessus ; le
  // cran choisi par l'ajustement automatique est gardé.
  renderer.setPixelRatio(Math.max(pixelFloor(), Math.min(pixelCeiling(), pixelQuality.scale)));
  pixelQuality.scale = renderer.getPixelRatio();
  renderer.setSize(w, h);
  screens.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
visualViewport?.addEventListener("resize", resize);
resize();

export { animate };
