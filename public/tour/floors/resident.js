// Étage d’un résident : open space de 12 postes, bureau de direction, décor acheté, télé géante.
// Assemble l’ambiance (cyberpunk.js, prestige.js) et le studio de la salle (room.js).

import * as THREE from "three";
import { decorKeyOf } from "../../economy-ui.js";
import { cleanRoom } from "../../room-data.js";
import { CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { BOSS, DESKS, OPEN, P, S, esc } from "../base.js";
import {
  LightSpot, box, boxGeometry, cyl, finishFloor, floors, glow, label, mat, redBullEditions, redBullTextures,
  renderer, scene, sign,
} from "../engine.js";
import { ballGeometry, orbGeometry } from "../kit.js";
import { MODELS } from "../models.js";
import { makeRobot } from "../robots.js";
import { buildWorkBoard, confetti, endCelebration } from "../work-fx.js";
import { put, shell, walls } from "./shell.js";
import { CYBER, cyberpunk, neonScreen, screenTexts } from "./cyberpunk.js";
import { bankerLamp, prestigeBoss, prestigeCans, prestigeChandeliers, prestigeDesk, prestigeFloor, prestigeMaterials } from "./prestige.js";
import { ROOM_LIGHTS, roomFloor, roomObjects, roomWalls } from "./room.js";
import { hugoat } from "./hugoat.js";
import { streamUrl } from "./shared.js";

// ---------- étage d'un résident ----------
function removeFloor(k) {
  const f = floors.get(k);
  if (!f) return;
  disposeFloor(f);
  scene.remove(f.group);
  floors.delete(k);
}
// Étage retiré ou reconstruit : ses éléments HTML et ses maillages fusionnés (propres à lui) sont libérés.
function disposeFloor(f) {
  if (f.celebration) endCelebration(f);
  f.group.traverse(o => {
    if (o.isCSS2DObject || o.isCSS3DObject) o.element.remove();
    if (o.geometry?.userData.baked) o.geometry.dispose();
    if (o.isInstancedMesh && o !== confetti.mesh) o.dispose(); // tampons de ses instances (sa géométrie, partagée, reste)
  });
}

// Écrans du poste de direction (classique) : marchés, graphique et carnet d'ordres, décoratifs.
const MONITOR_MATERIALS = [], MONITOR_GEOMETRY = new THREE.PlaneGeometry(0.94, 0.54), DESK_SCREEN_GEOMETRY = new THREE.PlaneGeometry(0.66, 0.42);
function drawMarketScreen(ctx, k) {
  ctx.fillStyle = "#0c1520"; ctx.fillRect(0, 0, 1024, 640);
  ctx.fillStyle = "#d3e1eb"; ctx.font = "bold 34px sans-serif";
  ctx.fillText(["MARCHÉS", "XAUUSD · M5", "CARNET D’ORDRES"][k], 32, 52);
  ctx.fillStyle = "#8298aa"; ctx.font = "22px monospace"; ctx.fillText("DÉMO · DONNÉES FICTIVES", 32, 92);
  if (k === 0) {
    ctx.fillStyle = "#8298aa"; ctx.fillText("SYMBOLE       PRIX       VAR.", 36, 152);
    ["XAUUSD", "EURUSD", "GBPUSD", "BTCUSD", "ETHUSD", "NASDAQ"].forEach((name, r) => {
      const y = 210 + r * 64;
      ctx.fillStyle = r % 2 ? "#152433" : "#101e2c"; ctx.fillRect(24, y - 35, 976, 56);
      ctx.fillStyle = "#d3e1eb"; ctx.font = "bold 28px monospace"; ctx.fillText(name, 42, y);
      ctx.fillText(["2 450,50", "1,0852", "1,2714", "68 250", "3 420", "19 850"][r], 310, y);
      ctx.fillStyle = r % 3 ? "#57c9ab" : "#ec7d87";
      ctx.fillText(r % 3 ? "+0,84 %" : "−0,32 %", 660, y);
    });
  } else if (k === 1) {
    ctx.strokeStyle = "#233342"; ctx.lineWidth = 2;
    for (let r = 0; r < 6; r++) { ctx.beginPath(); ctx.moveTo(30, 145 + r * 65); ctx.lineTo(990, 145 + r * 65); ctx.stroke(); }
    for (let i = 0; i < 36; i++) {
      const x = 44 + i * 26, mid = 360 - i * 3 + Math.sin(i * 0.7) * 55;
      const up = Math.sin(i * 1.7) > -0.2;
      ctx.fillStyle = ctx.strokeStyle = up ? "#57c9ab" : "#ec7d87";
      ctx.beginPath(); ctx.moveTo(x, mid - 30); ctx.lineTo(x, mid + 42); ctx.stroke();
      ctx.fillRect(x - 7, mid - (up ? 15 : 2), 14, 22 + i % 4 * 4);
      ctx.globalAlpha = 0.5; ctx.fillRect(x - 7, 570 - (i * 17 % 65), 14, 20 + i * 17 % 65); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "#e3bf78"; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < 36; i++) { const x = 44 + i * 26, y = 385 - i * 3 + Math.sin(i * 0.23) * 18; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  } else {
    ctx.font = "25px monospace"; ctx.fillStyle = "#8298aa"; ctx.fillText("VOLUME       PRIX       VOLUME", 34, 145);
    for (let r = 0; r < 10; r++) {
      const y = 195 + r * 37;
      ctx.globalAlpha = 0.22; ctx.fillStyle = r < 5 ? "#ec7d87" : "#57c9ab";
      ctx.fillRect(40, y - 25, 200 + (r * 67 % 580), 31); ctx.globalAlpha = 1;
      ctx.fillStyle = r < 5 ? "#ec7d87" : "#57c9ab";
      ctx.fillText(`${(r + 1) * 12}          ${(2451 - r * 0.1).toFixed(2)}          ${(10 - r) * 8}`, 50, y);
    }
  }
}

function buildResident(apt, wing, officeTier) {
  officeTier = officeTier ?? { id: 1, open: "#2a3142", boss: "#3a3029", wood: "#573d2e", metal: "#b7a27b", deskScale: 2, chairScale: 1 };
  // Ambiance choisie par le résident : elle habille son aile principale.
  const cyber = (wing.id ?? "work") === "work" && apt.profile?.theme === "cyberpunk";
  const prestige = (wing.id ?? "work") === "work" && apt.profile?.theme === "prestige";
  const PM = prestige ? prestigeMaterials() : null, deskCans = [], bulbs = [], drops = [];
  // Studio de la salle : seulement sur l'aile principale ; « auto » partout ailleurs.
  const room = cleanRoom((wing.id ?? "work") === "work" ? apt.profile?.room : null);
  const accent = apt.profile?.accent ?? wing.accent ?? "#f1cd85";
  const ministre = room.bureaux === "ministre" || (room.bureaux === "auto" && prestige);
  const f = shell(cyber ? CYBER.floor : prestige ? "#17110d" : wing.floor ?? officeTier.open ?? "#232a39");
  const g = f.group;
  const wingId = wing.id ?? "work";
  Object.assign(f, {
    key: `${apt.slug}:${wingId}`, kind: "resident", residentSlug: apt.slug, wingId, wing,
    name: wingId === "work" ? apt.name : `${apt.name} · ${wing.name ?? wingId}`,
    officeTierId: officeTier.id, buildSlug: apt.slug, themeKey: themeKey(apt),
  });
  const openMat = cyber ? CYBER.open : wingId === "work" ? officeTier.open : "#2a3142";
  const bossMat = cyber ? CYBER.boss : wingId === "work" ? officeTier.boss : "#3a3029";
  const c = P(OPEN.x + OPEN.w / 2, OPEN.y + OPEN.h / 2), b = P(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2);
  if (prestige) prestigeFloor(f, g, PM, bulbs, drops, room);
  else {
    box(g, OPEN.w * S, 0.03, OPEN.h * S, room.sol !== "auto" ? roomFloor(room.sol, OPEN) : mat(openMat), c.x, 0.05, c.z);
    box(g, BOSS.w * S, 0.03, BOSS.h * S, room.solBureau !== "auto" ? roomFloor(room.solBureau, BOSS) : mat(bossMat), b.x, 0.05, b.z);
  }
  const wallStyle = roomWalls(room.murs, accent) ?? (prestige ? { m: PM.walnut, trim: PM.gold } : null);
  walls(g, OPEN, ["w", "e"], wallStyle);
  walls(g, BOSS, ["w"], wallStyle);
  f.roomTags = [label(g, "Open space", "room-tag", P(OPEN.x, 0).x + 0.25, 0.08, P(0, OPEN.y).z + 0.4),
    label(g, `Bureau de ${esc(apt.name)}`, "room-tag", P(BOSS.x, 0).x + 0.25, 0.08, P(0, BOSS.y).z + 0.4)];
  // Le nom du résident en grand sur l'aile principale ; les autres ailes affichent leur enseigne.
  if (wingId === "work") {
    f.nameOpts = { color: apt.profile?.accent ?? "#f1cd85", font: "700 130px Sora, sans-serif", w: 1024, h: 160 };
    f.nameText = apt.name.toUpperCase();
    f.nameSign = sign(g, f.nameText, 11, 1.7, f.nameOpts, 0, 3.55, -6.42);
  } else if (wing.sign) {
    sign(g, wing.sign, 5, 1.1, { color: wing.accent ?? "#9ab4ff", font: "700 90px Sora, sans-serif", w: 720, h: 140 }, 0, 3.35, -6.35);
  }
  f.accentGlow = box(g, 7, 0.06, 0.06, glow(accent, 0.75 + officeTier.id * 0.12), 0, 2.6, -6.42);
  f.profileAccent = accent;
  if (wingId === "ops") {
    for (const [cx, cy] of [[720, 120], [820, 280], [740, 440]]) {
      const p = P(cx, cy);
      box(g, 1.2, 1.8, 0.8, mat("#1a2e28"), p.x, 0.9, p.z);
      for (let r = 0; r < 3; r++) box(g, 0.08, 0.08, 0.08, glow("#2fb898", 1.2), p.x - 0.3 + r * 0.3, 1.5 + (r % 2) * 0.12, p.z + 0.35);
    }
  }
  if (wingId === "lab") {
    for (const [cx, cy] of [[140, 140], [520, 480]]) {
      const p = P(cx, cy);
      cyl(g, 0.35, 0.05, glow(wing.accent ?? "#5b7cfa", 1.5), p.x, 1.05, p.z, 14);
    }
  }
  if (wingId === "studio") {
    sign(g, "FOCUS", 2.2, 0.35, { color: "#6b9cff", font: "700 48px Sora, sans-serif", blur: 8 }, P(820, 300).x, 2.8, P(820, 300).z);
  }

  // Open space : 12 postes. L'agent s'assoit au nord du bureau, face à son écran (vers la caméra).
  f.screens = DESKS.map((d, k) => {
    if (ministre) return prestigeDesk(g, prestigeMaterials(), d, k, deskCans); // bureau de ministre, mêmes places et même assise
    const dc = P(d.cx, d.cy), ch = P(d.cx, d.cy - 52);
    const ds = wingId === "work" ? officeTier.deskScale : 2;
    const cs = wingId === "work" ? officeTier.chairScale : 1;
    put(g, "desk", dc.x, dc.z, Math.PI, ds);
    put(g, "computerScreen", dc.x - 0.15, dc.z - 0.05, Math.PI, 2, 0.76);
    if (officeTier.dualScreen && wingId === "work") put(g, "computerScreen", dc.x + 0.22, dc.z - 0.05, Math.PI, 1.85, 0.76);
    put(g, "computerKeyboard", dc.x - 0.15, dc.z - 0.35, Math.PI, 2, 0.76);
    put(g, "chairDesk", ch.x, ch.z, 0, cs);
    const screen = new THREE.Mesh(DESK_SCREEN_GEOMETRY, mat("#1d2433"));
    screen.position.set(dc.x - 0.15, 1.06, dc.z - 0.17);
    screen.rotation.y = Math.PI;
    g.add(screen);
    return screen;
  });
  if (officeTier.openRug && wingId === "work" && !prestige) put(g, "rugRound", c.x, c.z, 0, 5.5);
  const plantSpots = [[620, 40], [40, 580], [620, 580], [320, 40], [320, 580], [40, 40]];
  for (const [x, y] of plantSpots.slice(0, Math.min(plantSpots.length, 2 + officeTier.id))) put(g, "pottedPlant", P(x, y).x, P(x, y).z, 0, 2.4);
  if (officeTier.bookcase && wingId === "work") {
    put(g, "bookcaseOpen", P(40, 120).x, P(40, 120).z, Math.PI / 2, 2.8);
    put(g, "bookcaseOpen", P(600, 520).x, P(600, 520).z, -Math.PI / 2, 2.8);
  }

  // Poste de direction : plateau et finitions selon le tier XP.
  const bd = P(820, 220), leather = prestige ? PM.tuft : mat("#222c30", { roughness: 0.8 });
  const wood = prestige ? PM.mahogany : mat(officeTier.wood), metal = prestige ? PM.gold : mat(officeTier.metal, { metalness: 0.7, roughness: 0.35 });
  put(g, "rugRectangle", bd.x, bd.z + 0.1, 0, 4);
  box(g, 4.2, 0.12, 1.55, wood, bd.x, 0.9, bd.z);
  box(g, 4.24, 0.025, 1.59, metal, bd.x, 0.83, bd.z);
  // Deux caissons et un voile de façade laissent la place aux jambes au centre.
  for (const dx of [-1.65, 1.65]) {
    box(g, 0.65, 0.79, 1.3, wood, bd.x + dx, 0.435, bd.z);
    for (const y of [0.27, 0.5, 0.73]) box(g, 0.26, 0.025, 0.035, metal, bd.x + dx, y, bd.z - 0.67);
  }
  box(g, 2.65, 0.42, 0.06, wood, bd.x, 0.56, bd.z + 0.59);
  box(g, 2.2, 0.015, 0.62, prestige ? PM.blotter : leather, bd.x, 0.97, bd.z - 0.28);
  // Trois écrans incurvés vers le chef ; les tableaux affichés sont décoratifs.
  for (let k = 0; k < 3; k++) {
    const monitor = new THREE.Group();
    monitor.position.set(bd.x + (k - 1) * 1.02, 0.97, bd.z + (k === 1 ? 0.25 : 0.1));
    monitor.rotation.y = Math.PI + (k - 1) * 0.32;
    g.add(monitor);
    box(monitor, 0.32, 0.03, 0.25, mat("#171c24"), 0, 0.015, 0);
    cyl(monitor, 0.025, 0.22, metal, 0, 0.13, 0, 8);
    box(monitor, 1.02, 0.62, 0.055, mat("#111822"), 0, 0.49, 0);
    // Tableaux de marché : identiques d'un étage à l'autre, dessinés une fois et partagés ; l'ambiance cyberpunk a les siens.
    let screenMaterial = cyber ? null : MONITOR_MATERIALS[k];
    if (!screenMaterial) {
      const c = document.createElement("canvas"); c.width = 1024; c.height = 640;
      if (cyber) neonScreen(c, screenTexts(apt)[k], k); else drawMarketScreen(c.getContext("2d"), k);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      screenMaterial = new THREE.MeshBasicMaterial({ map: texture });
      if (cyber) (f.bossScreens ??= []).push({ c, texture, k }); else MONITOR_MATERIALS[k] = screenMaterial;
    }
    const screen = new THREE.Mesh(MONITOR_GEOMETRY, screenMaterial);
    screen.position.set(0, 0.49, 0.03); monitor.add(screen);
  }
  put(g, "computerKeyboard", bd.x - 0.15, bd.z - 0.38, Math.PI, 2, 0.98);
  box(g, 0.09, 0.04, 0.14, mat("#303b42"), bd.x + 0.65, 1.0, bd.z - 0.4);
  // Téléphone, porte-stylos, dossiers, mug et lampe de travail.
  box(g, 0.3, 0.06, 0.22, mat("#172029"), bd.x - 1.6, 0.99, bd.z - 0.35);
  box(g, 0.26, 0.08, 0.065, mat("#38464f"), bd.x - 1.6, 1.05, bd.z - 0.35);
  cyl(g, 0.07, 0.14, metal, bd.x + 1.65, 1.04, bd.z - 0.42, 12);
  for (let k = 0; k < 3; k++) cyl(g, 0.008, 0.23, mat("#203344"), bd.x + 1.62 + k * 0.03, 1.14, bd.z - 0.42, 5);
  for (let k = 0; k < 3; k++) box(g, 0.42, 0.025, 0.3, mat(["#36555a", "#e0cfaa", "#80514c"][k]), bd.x + 1.5, 0.98 + k * 0.03, bd.z + 0.2);
  cyl(g, 0.065, 0.13, mat("#eee2ca"), bd.x + 1.04, 1.04, bd.z - 0.42, 12);
  if (prestige) {
    // Lampe de banquier, canette et balle de golf sur le bureau présidentiel.
    bankerLamp(g, PM, bd.x - 1.7, 0.96, bd.z + 0.22);
    deskCans.push([bd.x + 1.28, 0.96, bd.z - 0.12, 2]);
    const ball = new THREE.Mesh(ballGeometry, PM.ball); ball.scale.setScalar(0.022); ball.position.set(bd.x - 1.1, 0.985, bd.z - 0.42); g.add(ball);
  } else {
    cyl(g, 0.12, 0.025, metal, bd.x - 1.75, 0.98, bd.z + 0.2);
    cyl(g, 0.015, 0.48, metal, bd.x - 1.75, 1.23, bd.z + 0.2, 8);
    box(g, 0.42, 0.05, 0.16, glow("#ffe0aa", 0.8), bd.x - 1.6, 1.48, bd.z + 0.2);
  }
  box(g, 0.9, 0.17, 0.07, leather, bd.x + 0.9, 1.05, bd.z + 0.65);
  sign(g, "DIRECTION", 0.8, 0.13, { color: "#efcf91", font: "700 64px Sora, sans-serif", blur: 1 }, bd.x + 0.9, 1.05, bd.z + 0.69);
  // Fauteuil de patron construit autour du bassin assis, sans dossier au milieu du robot.
  const chair = P(820, 165);
  cyl(g, 0.055, 0.4, metal, chair.x, 0.28, chair.z, 12);
  for (let k = 0; k < 5; k++) {
    const leg = new THREE.Group(); leg.position.set(chair.x, 0.08, chair.z); leg.rotation.y = k * Math.PI * 2 / 5; g.add(leg);
    box(leg, 0.055, 0.05, 0.43, metal, 0, 0, 0.16);
    cyl(leg, 0.055, 0.05, mat("#151b22"), 0, -0.02, 0.37, 10).rotation.z = Math.PI / 2;
  }
  box(g, 0.85, 0.13, 0.7, leather, chair.x, 0.545, chair.z);
  box(g, 0.85, 0.88, 0.14, leather, chair.x, 1.02, chair.z - 0.4);
  box(g, 0.53, 0.22, 0.17, leather, chair.x, 1.5, chair.z - 0.39);
  for (const dx of [-0.48, 0.48]) {
    box(g, 0.04, 0.32, 0.04, metal, chair.x + dx, 0.71, chair.z + 0.05);
    box(g, 0.14, 0.07, 0.46, leather, chair.x + dx, 0.89, chair.z);
  }
  if (officeTier.execChair) put(g, "loungeChairRelax", P(760, 165).x, P(760, 165).z, Math.PI / 2, 2.2);
  if (officeTier.bossLamp) put(g, "lampSquareFloor", bd.x - 1.2, bd.z + 0.55, Math.PI / 4, 2.2);
  if (officeTier.bossTv) put(g, "televisionModern", bd.x + 1.55, bd.z - 0.15, Math.PI, 2.4);
  if (officeTier.coatRack) put(g, "coatRackStanding", P(700, 80).x, P(700, 80).z, 0, 2.5);
  if (officeTier.speaker) put(g, "speaker", bd.x + 1.9, bd.z + 0.45, -Math.PI / 2, 2.2);
  f.owner = makeRobot("#e8c27a");
  // Fauteuil : coussin à 0,61 m ; bassin Sitting à 0,24 m.
  f.owner.position.copy(P(820, 175, 0.37));
  g.add(f.owner);
  f.ownerTag = label(g, `<b>${esc(apt.name)}</b>`, "owner-tag", f.owner.position.x, 2.0, f.owner.position.z);
  // Livres et rétroéclairage discret des bibliothèques du chef.
  if (!prestige) { // Prestige : une vitrine à trophées à la place (prestigeBoss)
    for (const x of [700, 760]) {
      const shelf = P(x, 34);
      put(g, "bookcaseOpen", shelf.x, shelf.z, 0, 2.6);
      for (const h of [0.36, 0.98, 1.61]) {
        for (let k = 0; k < 5; k++)
          box(g, 0.09, 0.24 + (k % 2) * 0.07, 0.18,
            mat(["#36555a", "#c9a86a", "#70433f", "#d2c4ac", "#273543"][k]),
            shelf.x - 0.27 + k * 0.13, h + 0.13, shelf.z + 0.12);
        box(g, 0.74, 0.025, 0.025, glow("#ffd8a0", 0.9), shelf.x, h + 0.4, shelf.z - 0.16);
        // Halo diffus derrière les livres, sans ajouter de lumière dynamique.
        box(g, 0.74, 0.33, 0.01, new THREE.MeshBasicMaterial({ color: "#ffd8a0", transparent: true, opacity: 0.12, depthWrite: false }),
          shelf.x, h + 0.2, shelf.z - 0.18);
      }
    }
  }
  // Console de récompenses : chaque objet repose sur un support, à la place de la télé suspendue.
  const awardSpot = P(930, 52);
  const awardMetal = mat("#c4a465", { metalness: 0.85, roughness: 0.25 });
  const awardStone = mat("#192025", { roughness: 0.25 });
  for (const dx of [-0.72, 0.72]) for (const dz of [-0.22, 0.22])
    cyl(g, 0.025, 0.18, awardMetal, awardSpot.x + dx, 0.15, awardSpot.z + dz, 10);
  box(g, 1.7, 0.62, 0.64, wood, awardSpot.x, 0.54, awardSpot.z);
  box(g, 1.76, 0.07, 0.7, awardStone, awardSpot.x, 0.885, awardSpot.z);
  for (const dx of [-0.42, 0.42]) {
    box(g, 0.8, 0.54, 0.025, wood, awardSpot.x + dx, 0.55, awardSpot.z + 0.333);
    box(g, 0.12, 0.02, 0.025, awardMetal, awardSpot.x + dx, 0.66, awardSpot.z + 0.353);
  }
  // Coupe ouverte, anses, pied et socle en pierre.
  box(g, 0.48, 0.11, 0.36, awardStone, awardSpot.x, 0.975, awardSpot.z);
  cyl(g, 0.13, 0.045, awardMetal, awardSpot.x, 1.055, awardSpot.z, 24);
  cyl(g, 0.045, 0.23, awardMetal, awardSpot.x, 1.185, awardSpot.z, 16);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.07, 0.28, 32, 1, true),
    mat("#c4a465", { metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide }));
  cup.position.set(awardSpot.x, 1.43, awardSpot.z); g.add(cup);
  for (const dx of [-0.23, 0.23]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 24), awardMetal);
    handle.position.set(awardSpot.x + dx, 1.44, awardSpot.z); g.add(handle);
  }
  sign(g, "EXCELLENCE", 0.38, 0.065, { color: "#e6ca91", font: "700 64px Sora, sans-serif", blur: 0 }, awardSpot.x, 0.98, awardSpot.z + 0.185);
  // Livres de collection et petit objet de collection sur le même plateau.
  for (let k = 0; k < 2; k++) box(g, 0.28, 0.045, 0.34, mat(k ? "#52615b" : "#b09a75"), awardSpot.x - 0.58, 0.945 + k * 0.045, awardSpot.z);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.12),
    mat("#bbd8d7", { metalness: 0.2, roughness: 0.15 }));
  crystal.position.set(awardSpot.x - 0.58, 1.13, awardSpot.z); g.add(crystal);
  cyl(g, 0.1, 0.025, awardStone, awardSpot.x + 0.58, 0.935, awardSpot.z, 20);
  cyl(g, 0.065, 0.14, mat("#eee2c8", { emissive: "#e8b56a", emissiveIntensity: 0.15 }), awardSpot.x + 0.58, 1.017, awardSpot.z, 20);
  box(g, 1.5, 0.018, 0.025, glow("#ffdda4", 0.6), awardSpot.x, 0.845, awardSpot.z + 0.34);
  // Grand frigo vitré entre la bibliothèque et le trophée, en retrait du bureau.
  const fridge = new THREE.Group(); fridge.position.copy(P(835, 55)); g.add(fridge);
  const fridgeBlue = mat("#133b86", { metalness: 0.45, roughness: 0.35 });
  const fridgeSilver = mat("#c6cfda", { metalness: 0.7, roughness: 0.3 });
  for (const x of [-0.5, 0.5]) for (const z of [-0.34, 0.34]) cyl(fridge, 0.055, 0.06, fridgeSilver, x, 0.08, z, 8);
  box(fridge, 1.24, 0.15, 0.95, fridgeBlue, 0, 0.16, 0);
  box(fridge, 1.24, 0.12, 0.95, fridgeBlue, 0, 2.62, 0);
  box(fridge, 1.12, 2.3, 0.06, mat("#d4e1ea"), 0, 1.4, -0.44);
  for (const x of [-0.59, 0.59]) box(fridge, 0.08, 2.4, 0.95, fridgeBlue, x, 1.4, 0);
  box(fridge, 1.12, 0.36, 0.08, mat("#eaf0f5"), 0, 2.4, 0.47);
  sign(fridge, "Red Bull", 1.02, 0.29, { color: "#df233e", font: "700 80px Sora, sans-serif", blur: 0 }, 0, 2.4, 0.52);
  const fridgeGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.96), new THREE.MeshBasicMaterial({ color: "#c7e8ff", transparent: true, opacity: 0.035, depthWrite: false }));
  fridgeGlass.position.set(0, 1.26, 0.49); fridge.add(fridgeGlass);
  for (const x of [-0.55, 0.55]) {
    box(fridge, 0.035, 2.05, 0.035, fridgeSilver, x, 1.26, 0.5);
    box(fridge, 0.018, 1.92, 0.018, glow("#d4edff", 1.2), x * 0.91, 1.26, 0.4);
  }
  for (const y of [0.24, 2.27]) box(fridge, 1.12, 0.035, 0.035, fridgeSilver, 0, y, 0.5);
  box(fridge, 0.035, 0.64, 0.055, fridgeSilver, 0.44, 1.24, 0.55);
  for (let k = 0; k < 7; k++) box(fridge, 0.78, 0.012, 0.02, mat("#101d36"), 0, 0.09 + k * 0.018, 0.49);
  const cans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 16), mat("#ffffff", { metalness: 0.1, roughness: 0.5 }), 40);
  const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.061, 0.061, 0.012, 16), fridgeSilver, 40);
  const canMatrix = new THREE.Matrix4();
  for (let row = 0; row < 5; row++) {
    const shelfY = 0.33 + row * 0.37, edition = redBullEditions[row];
    box(fridge, 1.03, 0.018, 0.78, mat("#536777"), 0, shelfY, 0);
    sign(fridge, edition.label, 0.87, 0.07, { color: "#d9ecff", font: "600 34px Sora, sans-serif", w: 256, h: 32, blur: 0 }, 0, shelfY - 0.025, 0.405);
    const photo = redBullTextures.get(edition.image);
    const faces = photo ? new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.305), new THREE.MeshBasicMaterial({ map: photo, transparent: true, alphaTest: 0.08, toneMapped: false }), 8) : null;
    for (let column = 0; column < 4; column++) for (let depth = 0; depth < 2; depth++) {
      const index = row * 8 + column * 2 + depth, x = -0.36 + column * 0.24, z = -0.17 + depth * 0.4;
      cans.setMatrixAt(index, canMatrix.makeTranslation(x, shelfY + 0.165, z));
      cans.setColorAt(index, new THREE.Color(edition.color));
      caps.setMatrixAt(index, canMatrix.makeTranslation(x, shelfY + 0.307, z));
      faces?.setMatrixAt(column * 2 + depth, canMatrix.makeTranslation(x, shelfY + 0.165, z + 0.061));
    }
    if (faces) fridge.add(faces);
  }
  fridge.add(cans, caps);

  // Salon privé : cuir, marbre noir et laiton ; meubles bas sur un tapis épais.
  // Prestige : à sa place, le spider sur son plateau tournant, le green et le sac de golf (prestigeBoss).
  if (prestige) prestigeBoss(f, g, PM, drops, bulbs);
  else {
    const salon = P(820, 520), cognac = mat("#70432e", { roughness: 0.55 });
    const velvet = mat("#1c3734", { roughness: 0.85 });
    const gold = mat("#bba16b", { metalness: 0.8, roughness: 0.28 });
    const plush = (parent, w, h, d, material, x, y, z, radius = 0.08) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
      mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    // Tapis ivoire et charbon à double bordure, sans éclat métallique sur le textile.
    plush(g, 5.0, 0.055, 3.05, mat("#b0a58c"), salon.x, 0.09, salon.z, 0.025);
    box(g, 4.82, 0.006, 2.87, mat("#4c4a43"), salon.x, 0.121, salon.z);
    box(g, 4.69, 0.006, 2.74, mat("#242e30"), salon.x, 0.126, salon.z);
    for (let k = 0; k < 28; k++) box(g, 4.55, 0.003, 0.008, mat("#354041"), salon.x, 0.131, salon.z - 1.25 + k * 0.092);
    const seating = (x, y, angle, wide, upholstery) => {
      const seat = new THREE.Group(); seat.position.copy(P(x, y)); seat.rotation.y = angle; g.add(seat);
      const width = wide ? 2.9 : 0.95;
      for (const dx of [-width / 2 + 0.16, width / 2 - 0.16]) for (const dz of [-0.31, 0.31])
        cyl(seat, 0.035, 0.2, gold, dx, 0.22, dz, 10);
      plush(seat, width, 0.15, 0.9, upholstery, 0, 0.35, 0);
      box(seat, width - 0.1, 0.035, 0.83, gold, 0, 0.265, 0);
      const cushions = wide ? 3 : 1, inner = width - 0.32;
      for (let k = 0; k < cushions; k++) {
        const cx = -inner / 2 + inner / cushions * (k + 0.5);
        plush(seat, inner / cushions - 0.025, 0.17, 0.69, upholstery, cx, 0.49, 0.04, 0.06);
        plush(seat, inner / cushions - 0.025, 0.47, 0.18, upholstery, cx, 0.77, -0.34, 0.065);
      }
      for (const dx of [-width / 2 + 0.07, width / 2 - 0.07])
        plush(seat, 0.18, 0.37, 0.9, upholstery, dx, 0.56, 0, 0.065);
      // Petits coussins sombres, discrets et assortis aux fauteuils.
      if (wide) for (const dx of [-0.96, 0.96]) {
        const cushion = plush(seat, 0.35, 0.3, 0.12, velvet, dx, 0.73, -0.17, 0.045);
        cushion.rotation.z = dx < 0 ? -0.18 : 0.18;
      }
    };
    seating(820, 568, Math.PI, true, cognac);
    seating(710, 510, Math.PI / 2, false, velvet);
    seating(930, 510, -Math.PI / 2, false, velvet);
    // Table monolithique à plateau de marbre veiné, pied central en laiton.
    const stone = document.createElement("canvas"); stone.width = stone.height = 512;
    const paint = stone.getContext("2d"); paint.fillStyle = "#161c20"; paint.fillRect(0, 0, 512, 512);
    for (let v = 0; v < 12; v++) {
      paint.strokeStyle = v % 3 ? "#58605f" : "#ac9b78"; paint.globalAlpha = 0.45;
      paint.lineWidth = v % 3 ? 1 : 2; paint.beginPath();
      for (let y = 0; y <= 512; y += 8) {
        const x = v * 64 - 130 + y * 0.4 + Math.sin(y * 0.023 + v * 2.7) * 30;
        y ? paint.lineTo(x, y) : paint.moveTo(x, y);
      }
      paint.stroke();
    }
    const marbleTexture = new THREE.CanvasTexture(stone); marbleTexture.colorSpace = THREE.SRGBColorSpace;
    const marble = new THREE.MeshStandardMaterial({ map: marbleTexture, roughness: 0.25, metalness: 0.08 });
    const coffee = P(820, 510);
    plush(g, 1.0, 0.4, 0.48, gold, coffee.x, 0.36, coffee.z);
    plush(g, 1.85, 0.12, 0.85, marble, coffee.x, 0.62, coffee.z, 0.055);
    // Plateau de service, tasses, livre relié et petite sculpture.
    box(g, 0.64, 0.025, 0.4, gold, coffee.x + 0.36, 0.695, coffee.z);
    for (const dx of [0.2, 0.5]) {
      cyl(g, 0.085, 0.014, mat("#d9d1bb"), coffee.x + dx, 0.72, coffee.z, 20);
      cyl(g, 0.05, 0.075, mat("#eee4ce"), coffee.x + dx, 0.765, coffee.z, 16);
    }
    box(g, 0.35, 0.055, 0.45, cognac, coffee.x - 0.48, 0.715, coffee.z, 0.12);
    box(g, 0.31, 0.025, 0.4, mat("#d8cdb2"), coffee.x - 0.48, 0.755, coffee.z, 0.12);
    // Guéridon et lampadaire cylindrique à lumière chaude.
    const lamp = P(700, 580);
    cyl(g, 0.2, 0.035, marble, lamp.x, 0.15, lamp.z);
    cyl(g, 0.025, 1.85, gold, lamp.x, 1.08, lamp.z, 12);
    cyl(g, 0.28, 0.46, mat("#c8b58d", { emissive: "#e6bf7e", emissiveIntensity: 0.3, roughness: 0.9 }), lamp.x, 1.9, lamp.z, 32);
    cyl(g, 0.29, 0.025, gold, lamp.x, 1.67, lamp.z, 32);
    const salonLight = new LightSpot("#ffd5a1", 5, 7, 2, 3);
    salonLight.position.set(salon.x, 2.3, salon.z); g.add(salonLight);
    const side = P(960, 455);
    cyl(g, 0.045, 0.58, gold, side.x, 0.43, side.z, 12);
    cyl(g, 0.28, 0.05, marble, side.x, 0.75, side.z, 32);
    put(g, "plantSmall1", side.x, side.z, 0, 1.6, 0.78);
  }
  put(g, "lampSquareFloor", P(960, 120).x, P(960, 120).z, 0, 2.2);
  put(g, "pottedPlant", P(970, 585).x, P(970, 585).z, 0, 2.3);
  f.alarm = box(g, 0.3, 0.3, 0.3, mat("#3a3f52"), P(965, 40).x, 2.2, P(965, 40).z);
  f.alarmLight = new LightSpot("#ff3b3b", 0, 10, 1.6, 1);
  f.alarmLight.position.set(bd.x, 2.4, bd.z);
  g.add(f.alarmLight);
  if (wingId === "work") { placeDecor(g, f, apt); buildWorkBoard(f, g); }
  if (wingId === "work" && apt.profile?.tv) giantTv(f, apt.profile.tv);
  if (cyber) cyberpunk(f, apt);
  roomObjects(f, g, room, accent, bulbs, drops, prestige);
  if (room.lumiere !== "auto") f.warmSpot.color.set(ROOM_LIGHTS[room.lumiere]);
  // Lustres (Prestige ou studio) et canettes des bureaux de ministre : une série d'instances chacun.
  if (bulbs.length) prestigeChandeliers(g, prestigeMaterials(), bulbs, drops);
  if (deskCans.length) prestigeCans(g, prestigeMaterials(), deskCans);
  if (wingId === "work" && apt.slug === "hugoat") hugoat(f);
  return finishFloor(f);
}

// Décor acheté à la boutique (economy.decor), posé dans les coins libres du bureau du résident :
// mur est (borne d'arcade, trophée, aquarium, plante), côté ouest (statue au nord, piano au sud de l'allée), néon sur la vitre du fond.
function placeDecor(g, f, apt) {
  f.decorKey = decorKeyOf(apt);
  const owned = new Set(apt.economy?.decor ?? []);
  if (!owned.size) return;
  const gold = mat("#d4af37", { metalness: 0.9, roughness: 0.22 });
  const steel = mat("#9aa3ad", { metalness: 0.8, roughness: 0.3 });
  if (owned.has("plante_xl")) {
    const p = P(958, 418);
    put(g, "pottedPlant", p.x, p.z, 0.7, 3.6);
    put(g, "pottedPlant", p.x - 0.55, p.z + 0.05, 2.1, 2.2); // une plus petite au pied, pour le coin de jungle
  }
  if (owned.has("arcade")) {
    // Borne d'arcade contre le mur est, écran tourné vers la pièce.
    const a = new THREE.Group(); a.position.copy(P(956, 215)); a.rotation.y = -Math.PI / 2; g.add(a);
    const body = mat("#2a1745", { roughness: 0.5 }), dark = mat("#120a1e");
    box(a, 0.72, 1.0, 0.62, body, 0, 0.5, 0);
    box(a, 0.72, 0.8, 0.38, body, 0, 1.4, -0.12);
    box(a, 0.76, 0.28, 0.5, body, 0, 1.94, -0.06);
    sign(a, "ARCADE", 0.68, 0.22, { color: "#ffd84a", font: "900 90px Sora, sans-serif", blur: 16 }, 0, 1.94, 0.195);
    const panel = box(a, 0.72, 0.07, 0.3, dark, 0, 1.03, 0.24); panel.rotation.x = 0.2;
    cyl(a, 0.012, 0.09, steel, -0.16, 1.11, 0.25, 8);
    const knob = new THREE.Mesh(orbGeometry, glow("#ff3b6b", 1.2)); knob.scale.setScalar(0.45); knob.position.set(-0.16, 1.16, 0.25); a.add(knob);
    ["#3ee6ff", "#ffd84a", "#ff4fd8"].forEach((c, k) => cyl(a, 0.028, 0.02, glow(c, 1.3), 0.04 + k * 0.09, 1.07, 0.24, 12));
    for (const x of [-0.37, 0.37]) box(a, 0.02, 1.95, 0.02, glow(x < 0 ? "#ff4fd8" : "#3ee6ff", 1.3), x, 1.0, 0.31);
    box(a, 0.22, 0.26, 0.01, mat("#3b2a10", { metalness: 0.6 }), 0, 0.5, 0.315);
    box(a, 0.04, 0.012, 0.012, glow("#ff9a3c", 1.5), 0, 0.55, 0.322);
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 200;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.47), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(0, 1.42, 0.075); screen.rotation.x = -0.12; a.add(screen);
    f.arcade = { ctx: canvas.getContext("2d"), tex, frame: -1 };
    drawArcade(f.arcade, 0);
  }
  if (owned.has("trophee")) {
    // Trophée doré sur une colonne de pierre, plaque tournée vers la pièce.
    const t = P(958, 263), stone = mat("#1d2228", { roughness: 0.3 });
    box(g, 0.46, 0.9, 0.46, stone, t.x, 0.45, t.z);
    box(g, 0.52, 0.05, 0.52, gold, t.x, 0.925, t.z);
    cyl(g, 0.15, 0.06, gold, t.x, 0.98, t.z, 24);
    cyl(g, 0.045, 0.3, gold, t.x, 1.16, t.z, 16);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.08, 0.4, 32, 1, true), mat("#d4af37", { metalness: 0.9, roughness: 0.22, side: THREE.DoubleSide }));
    cup.position.set(t.x, 1.5, t.z); g.add(cup);
    for (const dz of [-0.29, 0.29]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 24), gold);
      handle.position.set(t.x, 1.52, t.z + dz); handle.rotation.y = Math.PI / 2; g.add(handle);
    }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), glow("#ffe9a8", 1.4));
    star.position.set(t.x, 1.82, t.z); g.add(star);
    sign(g, "N° 1", 0.3, 0.12, { color: "#e6ca91", font: "700 72px Sora, sans-serif", blur: 2 }, t.x - 0.235, 0.66, t.z, -Math.PI / 2);
  }
  if (owned.has("aquarium")) {
    // Aquarium sur son meuble, dans la longueur du mur est ; les poissons nagent d'un bout à l'autre.
    const q = new THREE.Group(); q.position.copy(P(957, 330)); g.add(q);
    box(q, 0.52, 0.72, 1.52, mat("#2b1d16", { roughness: 0.6 }), 0, 0.36, 0);
    box(q, 0.54, 0.04, 1.54, steel, 0, 0.74, 0);
    box(q, 0.44, 0.05, 1.44, mat("#d8c38f"), 0, 0.79, 0);
    for (const [x, z, r] of [[0.08, -0.45, 0.07], [-0.1, 0.2, 0.05], [0.05, 0.5, 0.06]]) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat("#6b6f78")); rock.position.set(x, 0.84, z); q.add(rock);
    }
    for (const [x, z, h] of [[-0.12, -0.55, 0.4], [0.1, -0.2, 0.3], [-0.08, 0.35, 0.45], [0.12, 0.6, 0.28]]) cyl(q, 0.015, h, glow("#3fae5a", 0.5), x, 0.82 + h / 2, z, 6);
    const water = new THREE.MeshStandardMaterial({ color: "#1d6fa5", emissive: "#0d4a7a", emissiveIntensity: 0.7, transparent: true, opacity: 0.4, depthWrite: false });
    box(q, 0.44, 0.54, 1.44, water, 0, 1.08, 0);
    const glass = new THREE.MeshPhysicalMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    box(q, 0.5, 0.64, 1.5, glass, 0, 1.08, 0);
    box(q, 0.52, 0.05, 1.52, mat("#1a1d24"), 0, 1.42, 0);
    box(q, 0.06, 0.012, 1.3, glow("#bfe9ff", 1.4), 0, 1.39, 0);
    f.fish = ["#ff8a3c", "#ffd84a", "#4fc3ff", "#ff5d8f", "#9dff7a"].map((c, k) => {
      const fish = new THREE.Group(), m = glow(c, 0.5);
      const body = new THREE.Mesh(orbGeometry, m); body.scale.set(0.35, 0.55, 1.0); fish.add(body);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), m); tail.rotation.x = Math.PI / 2; tail.position.z = -0.085; fish.add(tail);
      q.add(fish);
      return { fish, x: -0.12 + (k % 3) * 0.12, y: 0.92 + k * 0.08, phase: k * 1.7, speed: 0.35 + k * 0.07 };
    });
  }
  if (owned.has("statue")) {
    // Statue du meilleur agent : le robot en or, figé dans un salut, sur un socle de marbre.
    const s = P(694, 135);
    box(g, 0.62, 0.5, 0.62, mat("#e8e2d4", { roughness: 0.35 }), s.x, 0.25, s.z);
    box(g, 0.68, 0.05, 0.68, gold, s.x, 0.525, s.z);
    sign(g, "MEILLEUR AGENT", 0.52, 0.08, { color: "#8a6a2a", font: "700 56px Sora, sans-serif", blur: 0, w: 512, h: 80 }, s.x, 0.3, s.z + 0.315);
    if (MODELS.robot) {
      const r = makeRobot("#d4af37"), u = r.userData;
      r.traverse(o => { if (o.isMesh) o.material = gold; });
      u.mixer.stopAllAction();
      (u.actions.Wave ?? u.actions.ThumbsUp ?? u.actions.Idle)?.reset().play();
      u.mixer.update(0.9); // pose figée : ce mélangeur n'est plus jamais avancé
      r.scale.setScalar(0.85); r.position.set(s.x, 0.55, s.z); r.rotation.y = 0.35;
      g.add(r);
    }
  }
  if (owned.has("piano")) {
    // Piano à queue au sud de l'allée, clavier vers la caméra, couvercle levé côté pièce.
    const pg = new THREE.Group(); pg.position.copy(P(707, 395)); g.add(pg);
    const lacquer = mat("#0b0b0e", { roughness: 0.18, metalness: 0.3 });
    // Contour vu de dessus (x, -z) : côté gauche droit, éclisse courbe à droite, queue arrondie.
    const outline = new THREE.Shape();
    outline.moveTo(-0.6, -0.35); outline.lineTo(0.6, -0.35); outline.lineTo(0.6, -0.05);
    outline.bezierCurveTo(0.6, 0.35, 0.1, 0.3, 0.02, 0.62);
    outline.bezierCurveTo(-0.05, 0.95, -0.6, 1.05, -0.6, 0.8);
    outline.lineTo(-0.6, -0.35);
    const caseMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.3, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 24 }), lacquer);
    caseMesh.rotation.x = -Math.PI / 2; caseMesh.position.y = 0.62; pg.add(caseMesh);
    const lidPivot = new THREE.Group(); lidPivot.position.set(-0.6, 0.95, 0); lidPivot.rotation.z = 0.5; pg.add(lidPivot);
    const lid = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.02, bevelEnabled: false, curveSegments: 24 }).translate(0.6, 0, 0), lacquer);
    lid.rotation.x = -Math.PI / 2; lidPivot.add(lid);
    const prop = cyl(pg, 0.01, 0.62, steel, 0.25, 1.2, -0.25, 6); prop.rotation.z = 0.35;
    box(pg, 1.22, 0.08, 0.26, lacquer, 0, 0.8, 0.47);
    box(pg, 1.12, 0.03, 0.17, mat("#f4f1e8", { roughness: 0.4 }), 0, 0.855, 0.48);
    const blackKeys = new THREE.InstancedMesh(boxGeometry, mat("#111114"), 36), keyMatrix = new THREE.Matrix4();
    for (let k = 0, n = 0; k < 52 && n < 36; k++) if ([0, 1, 3, 4, 5].includes(k % 7)) {
      keyMatrix.makeScale(0.012, 0.02, 0.1).setPosition(-0.56 + (k + 1) * (1.12 / 52), 0.875, 0.45);
      blackKeys.setMatrixAt(n++, keyMatrix);
    }
    pg.add(blackKeys);
    const stand = box(pg, 0.9, 0.24, 0.02, lacquer, 0, 1.08, 0.3); stand.rotation.x = -0.25;
    const sheet = box(pg, 0.36, 0.2, 0.005, mat("#f4f1e8"), 0, 1.09, 0.315); sheet.rotation.x = -0.25;
    for (const [x, z] of [[-0.5, 0.25], [0.5, 0.25], [-0.35, -0.75]]) {
      cyl(pg, 0.05, 0.62, lacquer, x, 0.31, z, 12);
      cyl(pg, 0.06, 0.04, gold, x, 0.02, z, 12);
    }
    box(pg, 0.14, 0.45, 0.06, lacquer, 0, 0.3, 0.22);
    for (const x of [-0.05, 0, 0.05]) box(pg, 0.03, 0.015, 0.08, gold, x, 0.06, 0.27);
    box(pg, 0.75, 0.07, 0.34, lacquer, 0, 0.48, 0.85);
    box(pg, 0.72, 0.05, 0.31, mat("#2b1d16", { roughness: 0.8 }), 0, 0.535, 0.85);
    for (const x of [-0.32, 0.32]) for (const z of [0.72, 0.98]) box(pg, 0.04, 0.45, 0.04, lacquer, x, 0.225, z);
  }
  if (owned.has("neon")) {
    // Néon au nom du résident, à sa couleur, sur la vitre du fond au-dessus de la console des récompenses.
    const accent = apt.profile?.accent ?? "#ff6fd8", x = 8.6, y = 2.95, z = -6.36, line = glow(accent, 2.2);
    box(g, 2.5, 0.78, 0.04, mat("#0c0e16", { roughness: 0.4 }), x, y, z - 0.03);
    for (const dy of [-0.37, 0.37]) box(g, 2.46, 0.025, 0.025, line, x, y + dy, z);
    for (const dx of [-1.23, 1.23]) box(g, 0.025, 0.76, 0.025, line, x + dx, y, z);
    sign(g, apt.name, 2.3, 0.6, { color: accent, font: "italic 700 120px Sora, sans-serif", w: 768, h: 200, blur: 36 }, x, y, z + 0.01);
  }
}

// Écran de la borne : des envahisseurs en pixels, redessinés deux fois par seconde.
function drawArcade(arcade, frame) {
  const { ctx, tex } = arcade;
  ctx.fillStyle = "#05030c"; ctx.fillRect(0, 0, 256, 200);
  const sprite = ["0011100", "0111110", "1101011", "1111111", "0101010", "1000001"];
  const shift = (frame % 8) - 4;
  ["#ff4fd8", "#3ee6ff", "#ffd84a"].forEach((c, row) => {
    ctx.fillStyle = c;
    for (let col = 0; col < 5; col++) sprite.forEach((line, sy) => [...line].forEach((bit, sx) => {
      if (bit === "1") ctx.fillRect(28 + col * 42 + shift * 3 + sx * 4, 22 + row * 34 + sy * 4, 4, 4);
    }));
  });
  ctx.fillStyle = "#4ade80"; ctx.fillRect(112 + Math.sin(frame) * 60, 172, 28, 10);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 14px monospace"; ctx.fillText(`SCORE ${String(1200 + frame * 10).padStart(5, "0")}`, 10, 196);
  tex.needsUpdate = true;
}

// ---------- télé géante ----------
// Liens normalisés par le serveur : identifiant YouTube ou chaîne Twitch, jamais une URL saisie.
function tvLinks(tv) {
  if (tv.kind === "youtube") return { url: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(tv.id)}?autoplay=1&mute=1&rel=0&loop=1&playlist=${encodeURIComponent(tv.id)}`, page: `https://www.youtube.com/watch?v=${encodeURIComponent(tv.id)}` };
  return { url: streamUrl(tv.channel), page: `https://www.twitch.tv/${encodeURIComponent(tv.channel)}` };
}
// Écran 16:9 de 4,9 m sur la vitre ouest, côté nord de l'ascenseur, cadre néon ; muet, un clic l'ouvre avec le son.
function giantTv(f, tv) {
  const g = f.group, w = 4.9, h = w * 9 / 16, y = 2.9, z = -3.42, x = -10.28, edge = glow("#ff2bd6", 1.8);
  const frame = box(g, 0.12, h + 0.24, w + 0.24, mat("#0b0d14", { metalness: 0.6, roughness: 0.3 }), x, y, z);
  box(g, 0.04, 0.04, w + 0.3, edge, x + 0.08, y + h / 2 + 0.14, z);
  box(g, 0.04, 0.04, w + 0.3, edge, x + 0.08, y - h / 2 - 0.14, z);
  for (const dz of [-1, 1]) box(g, 0.04, h + 0.32, 0.04, glow("#00e5ff", 1.8), x + 0.08, y, z + dz * (w / 2 + 0.14));
  sign(g, "ON AIR", 0.9, 0.22, { color: "#ff3b5c", font: "800 72px Sora, sans-serif", blur: 16 }, x + 0.1, y + h / 2 + 0.38, z, Math.PI / 2);
  const iframe = Object.assign(document.createElement("iframe"), { title: "Télé géante", allow: "autoplay; fullscreen; encrypted-media; picture-in-picture" });
  Object.assign(iframe.style, { width: "1280px", height: "720px", border: "0", background: "#000", backfaceVisibility: "hidden" });
  const view = new CSS3DObject(iframe);
  // Le lecteur laisse passer les clics vers la 3D (CSS3DObject les réactive) : c'est l'écran qui ouvre le réglage ou la vidéo.
  iframe.style.pointerEvents = "none";
  view.position.set(x + 0.07, y, z); view.rotation.y = Math.PI / 2; view.scale.setScalar(w / 1280);
  g.add(view);
  f.tv = { frame, iframe, view, shown: "", ...tvLinks(tv) };
}
const themeKey = a => JSON.stringify([a.profile?.theme ?? "classique", a.profile?.screens ?? [], a.profile?.tv ?? null, a.profile?.accent ?? null, cleanRoom(a.profile?.room)]);

export { buildResident, disposeFloor, drawArcade, removeFloor, themeKey, tvLinks };
