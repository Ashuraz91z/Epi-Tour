// Casino : tables, machines à sous, roulette, blackjack et jackpot commun, rejoués d’après le serveur.

import * as THREE from "three";
import { money } from "../../economy-ui.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CASINO_FEATURED, CASINO_MACHINES, CASINO_TABLES, VIP } from "../base.js";
import { agents, box, cyl, glow, mat, sign } from "../engine.js";
import { agoText, ballGeometry, canvasPanel, discGeometry, drawnTexture, easeOut, mod1, playTarget } from "../kit.js";
import { put } from "./shell.js";
import {
  BULB_DIM, BULB_ON, POCKET, REST_R, ROTOR_R, ROULETTE_WHEEL, SLOT_SYMBOLS, TRACK_R, cardGeometry, cardTexture,
  reelGeometry, reelOffset, reelShadeTexture, rouletteColor, slotStripTexture,
} from "./shared.js";

// ---------- Casino ----------
// Tables au fond à gauche (roulette, blackjack, poker), bar au fond à droite, jackpot commun sur la vitre du fond,
// deux rangées de machines à sous devant, carré VIP devant à droite, lustre au-dessus de l'allée.
const MACHINE_THEMES = [["LUCKY 7", "#ffd23f"], ["DIAMANT", "#5ce1ff"], ["CERISE", "#ff4d6d"], ["JACKPOT", "#ffb000"], ["CLOCHE", "#ff9a3c"], ["ÉTOILE", "#b18cff"],
  ["PHARAON", "#e8c45a"], ["DRAGON", "#ff5a36"], ["COSMOS", "#6b8cff"], ["JOKER", "#4ade80"], ["TRÉSOR", "#f2c14e"], ["MÉGA", "#ff6fd8"]];
const BJ_SHOE = { x: 0.62, y: 0.9, z: 0.14 };
const BJ_STATUS = { playing: "À toi de jouer", blackjack: "BLACKJACK !", win: "Gagné !", lose: "Perdu", push: "Égalité", bust: "Sauté" };
function buildCasino(f, g, { at, zone, tag, staff, back }) {
  const c = f.casino = { machines: [], neons: [], party: 0, partyTime: 0, hue: 0, bulbStep: -1, dummy: new THREE.Object3D() };
  const m4 = new THREE.Matrix4(), tint = new THREE.Color();
  const brass = mat("#c9a24a", { metalness: 0.85, roughness: 0.3 }), wood = mat("#3b2116", { roughness: 0.5 });
  const leather = mat("#24120e", { roughness: 0.45 }), felt = mat("#0f5a33", { roughness: 0.95 });

  // Moquette de casino : un motif dessiné une fois et répété ; tapis bordé d'or sur l'allée de l'ascenseur.
  const carpetMap = drawnTexture(256, 256, x => {
    x.fillStyle = "#3a0d1c"; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "#6e2236"; x.lineWidth = 4;
    for (const [cx, cy] of [[64, 64], [192, 192], [64, 192], [192, 64]]) { x.beginPath(); x.arc(cx, cy, 36, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = "#b8903c";
    for (const [cx, cy] of [[64, 64], [192, 192]]) { x.beginPath(); x.moveTo(cx, cy - 18); x.lineTo(cx + 18, cy); x.lineTo(cx, cy + 18); x.lineTo(cx - 18, cy); x.fill(); }
    x.fillStyle = "#1d5c5c";
    for (const [cx, cy] of [[64, 192], [192, 64]]) { x.beginPath(); x.arc(cx, cy, 12, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = "#5a1428";
    for (let i = 0; i <= 256; i += 128) for (let j = 0; j <= 256; j += 128) { x.beginPath(); x.arc(i, j, 8, 0, Math.PI * 2); x.fill(); }
  });
  carpetMap.wrapS = carpetMap.wrapT = THREE.RepeatWrapping;
  carpetMap.repeat.set(10, 6.2);
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(20.3, 12.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: carpetMap, roughness: 0.95 }));
  carpet.position.y = 0.045;
  g.add(carpet);
  zone(20, 288, 990, 332, "#1a0810");
  for (const y of [288, 332]) box(g, 19.4, 0.008, 0.04, brass, at(505, y).x, 0.068, at(505, y).z);
  f.roomTags = [tag("Tables de jeu", 40, 40), tag("Bar", 720, 40), tag("Machines à sous", 50, 350), tag("Carré VIP", VIP.x0, VIP.y0)];

  // Roulette : table en longueur, roue à gauche (37 cases, rotor, bille), tapis des mises à droite, tableau des derniers numéros.
  const rt = at(...CASINO_TABLES.roulette);
  box(g, 2.4, 0.76, 1.1, wood, rt.x, 0.38, rt.z);
  box(g, 2.62, 0.012, 1.3, brass, rt.x, 0.765, rt.z);
  box(g, 2.6, 0.05, 1.28, leather, rt.x, 0.79, rt.z);
  box(g, 2.42, 0.03, 1.12, felt, rt.x, 0.82, rt.z);
  for (const dz of [-0.6, 0.6]) box(g, 2.6, 0.06, 0.08, leather, rt.x, 0.86, rt.z + dz);
  for (const dx of [-1.26, 1.26]) box(g, 0.08, 0.06, 1.28, leather, rt.x + dx, 0.86, rt.z);
  const layout = drawnTexture(512, 320, (x, w, h) => {
    x.fillStyle = "#0f5a33"; x.fillRect(0, 0, w, h);
    x.strokeStyle = "#f4efe2"; x.lineWidth = 3; x.textAlign = "center"; x.textBaseline = "middle";
    const cw = 34, ch = 62, ox = 50, oy = 24;
    x.fillStyle = rouletteColor(0);
    x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox, oy + 3 * ch); x.lineTo(ox - 36, oy + 1.5 * ch); x.closePath(); x.fill(); x.stroke();
    x.font = "700 22px Sora, sans-serif"; x.fillStyle = "#ffffff"; x.fillText("0", ox - 13, oy + 1.5 * ch);
    for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
      const n = col * 3 + 3 - row, px = ox + col * cw, py = oy + row * ch;
      x.fillStyle = rouletteColor(n); x.fillRect(px, py, cw, ch); x.strokeRect(px, py, cw, ch);
      x.save(); x.translate(px + cw / 2, py + ch / 2); x.rotate(-Math.PI / 2); x.fillStyle = "#ffffff"; x.fillText(String(n), 0, 0); x.restore();
    }
    const by = oy + 3 * ch;
    x.font = "700 17px Sora, sans-serif";
    ["1re douzaine", "2e douzaine", "3e douzaine"].forEach((t, k) => { x.strokeRect(ox + k * 4 * cw, by, 4 * cw, 40); x.fillStyle = "#f4efe2"; x.fillText(t, ox + (k * 4 + 2) * cw, by + 20); });
    ["MANQUE", "PAIR", "", "", "IMPAIR", "PASSE"].forEach((t, k) => {
      const px = ox + k * 2 * cw;
      x.strokeRect(px, by + 40, 2 * cw, 40);
      if (t) { x.fillStyle = "#f4efe2"; x.font = "700 14px Sora, sans-serif"; x.fillText(t, px + cw, by + 60); return; }
      x.fillStyle = k === 2 ? "#b3243a" : "#17181e";
      x.beginPath(); x.moveTo(px + cw, by + 46); x.lineTo(px + cw + 20, by + 60); x.lineTo(px + cw, by + 74); x.lineTo(px + cw - 20, by + 60); x.closePath(); x.fill();
    });
  });
  const layoutMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: layout, roughness: 0.95 }));
  layoutMesh.position.set(rt.x + 0.47, 0.837, rt.z);
  g.add(layoutMesh);
  for (let k = 0; k < 6; k++) cyl(g, 0.035, 0.03 + (k % 3) * 0.02, mat(["#c0392b", "#f4efe2", "#2980b9"][k % 3]), rt.x + 0.1 + k * 0.17, 0.85, rt.z + 0.25 - (k % 2) * 0.42, 14);
  const wheelTexture = drawnTexture(512, 512, x => {
    const o = 256;
    x.fillStyle = "#3a2214"; x.beginPath(); x.arc(o, o, 256, 0, Math.PI * 2); x.fill();
    x.textAlign = "center"; x.textBaseline = "middle"; x.font = "700 26px Sora, sans-serif";
    ROULETTE_WHEEL.forEach((n, i) => {
      const a0 = i * POCKET, a1 = a0 + POCKET;
      x.fillStyle = rouletteColor(n);
      x.beginPath(); x.arc(o, o, 252, a0, a1); x.arc(o, o, 185, a1, a0, true); x.closePath(); x.fill();
      x.globalAlpha = 0.7; x.beginPath(); x.arc(o, o, 185, a0, a1); x.arc(o, o, 140, a1, a0, true); x.closePath(); x.fill(); x.globalAlpha = 1;
      x.strokeStyle = "#d8b45a"; x.lineWidth = 3;
      x.beginPath(); x.moveTo(o + Math.cos(a0) * 140, o + Math.sin(a0) * 140); x.lineTo(o + Math.cos(a0) * 252, o + Math.sin(a0) * 252); x.stroke();
      x.save(); x.translate(o, o); x.rotate(a0 + POCKET / 2); x.translate(219, 0); x.rotate(Math.PI / 2);
      x.fillStyle = "#ffffff"; x.fillText(String(n), 0, 0); x.restore();
    });
    x.strokeStyle = "#d8b45a"; x.lineWidth = 4;
    for (const r of [140, 185, 252]) { x.beginPath(); x.arc(o, o, r, 0, Math.PI * 2); x.stroke(); }
    const gr = x.createRadialGradient(o, o, 10, o, o, 140);
    gr.addColorStop(0, "#d4ae55"); gr.addColorStop(0.35, "#6b3f22"); gr.addColorStop(1, "#3a2214");
    x.fillStyle = gr; x.beginPath(); x.arc(o, o, 138, 0, Math.PI * 2); x.fill();
    x.lineWidth = 3;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; x.beginPath(); x.moveTo(o + Math.cos(a) * 30, o + Math.sin(a) * 30); x.lineTo(o + Math.cos(a) * 128, o + Math.sin(a) * 128); x.stroke(); }
  });
  const wheel = new THREE.Group();
  wheel.position.set(rt.x - 0.72, 0, rt.z);
  g.add(wheel);
  cyl(wheel, 0.47, 0.12, wood, 0, 0.84, 0, 48);
  const track = new THREE.Mesh(new THREE.RingGeometry(ROTOR_R, 0.445, 48).rotateX(-Math.PI / 2), mat("#2a160e", { roughness: 0.25, metalness: 0.2 }));
  track.position.y = 0.902;
  wheel.add(track);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.455, 0.022, 8, 48).rotateX(Math.PI / 2), brass);
  lip.position.y = 0.905;
  wheel.add(lip);
  const rotor = new THREE.Group();
  rotor.position.y = 0.905;
  wheel.add(rotor);
  const face = new THREE.Mesh(discGeometry, new THREE.MeshStandardMaterial({ map: wheelTexture, roughness: 0.35, metalness: 0.15 }));
  face.scale.set(ROTOR_R, 1, ROTOR_R);
  rotor.add(face);
  const turret = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 16), brass);
  turret.position.y = 0.05;
  rotor.add(turret);
  for (const r of [0, Math.PI / 2]) box(rotor, 0.2, 0.012, 0.012, brass, 0, 0.085, 0, r);
  const rBall = new THREE.Mesh(ballGeometry, mat("#f7f7f2", { roughness: 0.2 }));
  rBall.scale.setScalar(0.017);
  wheel.add(rBall);
  const pole = at(245, 118);
  cyl(g, 0.025, 1.45, brass, pole.x, 0.73, pole.z, 8);
  c.roulette = { rotor, ball: rBall, alpha: 0, number: 0, spin: null, history: [],
    board: canvasPanel(g, 0.62, 0.34, 256, 140, pole.x, 1.62, pole.z + 0.03, -0.25) };
  drawRouletteBoard(c.roulette);
  staff("#c98a3e", 140, 108, 0);

  // Blackjack : table en demi-lune, la banque au fond ; les cartes de la main jouée au dialogue arrivent du sabot.
  const bjp = at(...CASINO_TABLES.blackjack), bj = new THREE.Group();
  bj.position.set(bjp.x, 0, bjp.z);
  g.add(bj);
  const half = (r, h, m, y) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, false, -Math.PI / 2, Math.PI), m);
    mesh.position.y = y; bj.add(mesh); return mesh;
  };
  half(0.86, 0.76, wood, 0.38);
  box(bj, 1.72, 0.76, 0.04, wood, 0, 0.38, 0);
  half(1.0, 0.05, leather, 0.785);
  const bjFelt = drawnTexture(512, 512, (x, w) => {
    x.fillStyle = "#0e5631"; x.fillRect(0, 0, w, w);
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#e9c46a"; x.font = "700 25px Sora, sans-serif"; x.fillText("LE BLACKJACK PAIE 3 POUR 2", 256, 256 + 99);
    x.fillStyle = "#f4efe2"; x.font = "600 17px Sora, sans-serif"; x.fillText("LA BANQUE TIRE À 16 ET RESTE À 17", 256, 256 + 124);
    x.strokeStyle = "#f4efe2"; x.lineWidth = 3;
    for (const d of [25, 62, 90, 118, 155]) { const a = d * Math.PI / 180; x.beginPath(); x.arc(256 + Math.cos(a) * 200, 256 + Math.sin(a) * 200, 22, 0, Math.PI * 2); x.stroke(); }
  });
  const bjTop = new THREE.Mesh(new THREE.CircleGeometry(0.93, 40, Math.PI, Math.PI).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: bjFelt, roughness: 0.95 }));
  bjTop.position.y = 0.812;
  bj.add(bjTop);
  const bjRail = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.045, 8, 40, Math.PI).rotateX(Math.PI / 2), leather);
  bjRail.position.y = 0.83;
  bj.add(bjRail);
  box(bj, 2.0, 0.06, 0.08, leather, 0, 0.83, -0.02);
  box(bj, 0.56, 0.035, 0.13, mat("#151515"), -0.05, 0.83, 0.08);
  ["#c0392b", "#27ae60", "#2980b9", "#f4efe2", "#8e44ad", "#f1c40f"].forEach((col, k) => cyl(bj, 0.022, 0.03, mat(col), -0.27 + k * 0.088, 0.86, 0.08, 12));
  box(bj, 0.16, 0.1, 0.26, mat("#5a1020", { roughness: 0.4 }), BJ_SHOE.x, BJ_SHOE.y - 0.04, BJ_SHOE.z);
  for (const d of [25, 62, 118, 155]) { const a = d * Math.PI / 180; cyl(bj, 0.03, 0.04, mat(d < 90 ? "#c0392b" : "#2980b9"), Math.cos(a) * 0.73, 0.835, Math.sin(a) * 0.73, 12); }
  for (const dx of [-0.6, 0.6]) cyl(bj, 0.006, 1.0, mat("#1a1a1a"), dx, 2.95, 0.1, 4);
  c.blackjack = { player: [], dealer: [], anim: [],
    cards: [...Array(12)].map(() => {
      const m = new THREE.Mesh(cardGeometry, new THREE.MeshBasicMaterial({ map: cardTexture("??") }));
      m.visible = false; bj.add(m); return m;
    }),
    board: canvasPanel(bj, 1.4, 0.4, 512, 146, 0, 2.3, 0.1) };
  drawBlackjackBoard(c.blackjack, null);
  staff("#d9dde8", 400, 140, 0);

  // Poker : table ovale, cartes communes, pot et cartes cachées des joueurs.
  const pk = at(...CASINO_TABLES.poker);
  cyl(g, 1, 0.74, wood, pk.x, 0.37, pk.z, 32).scale.set(0.95, 0.74, 0.55);
  cyl(g, 1, 0.04, felt, pk.x, 0.8, pk.z, 32).scale.set(1.05, 0.04, 0.62);
  const pkRail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 40).rotateX(Math.PI / 2), leather);
  pkRail.scale.set(1.08, 1, 0.66);
  pkRail.position.set(pk.x, 0.83, pk.z);
  g.add(pkRail);
  ["A♠", "K♥", "10♦", "J♣", "Q♠"].forEach((label, k) => {
    const card = new THREE.Mesh(cardGeometry, new THREE.MeshBasicMaterial({ map: cardTexture(label) }));
    card.position.set(pk.x - 0.3 + k * 0.15, 0.825, pk.z - 0.05); g.add(card);
  });
  for (const [x, y] of [[545, 212], [600, 227], [655, 212]]) {
    const s = at(x + (600 - x) * 0.45, y - (y - 165) * 0.62);
    for (const dx of [-0.04, 0.04]) {
      const card = new THREE.Mesh(cardGeometry, new THREE.MeshBasicMaterial({ map: cardTexture("??") }));
      card.position.set(s.x + dx, 0.826, s.z); card.rotation.y = dx * 4; g.add(card);
    }
  }
  for (let k = 0; k < 5; k++) cyl(g, 0.03, 0.02 + k * 0.012, mat(["#c0392b", "#27ae60", "#2980b9", "#f4efe2", "#f1c40f"][k]), pk.x + 0.25 + (k % 2) * 0.07, 0.83 + k * 0.006, pk.z + 0.12 - (k > 2) * 0.07, 12);
  staff("#a37cf0", 600, 112, 0);
  sign(g, "POKER", 1.0, 0.3, { color: "#ffd700", font: "700 70px Sora, sans-serif", blur: 8 }, pk.x, 2.3, pk.z - 0.9);
  sign(g, "ROULETTE", 1.4, 0.3, { color: "#ffd700", font: "700 70px Sora, sans-serif", blur: 8 }, rt.x, 2.3, rt.z - 0.9);
  playTarget(f, g, 2.8, 1.4, 1.5, rt.x, 0.7, rt.z, "casino");
  playTarget(f, bj, 2.1, 1.4, 1.1, 0, 0.7, 0.5, "casino");

  // Machines à sous : rouleaux qui défilent vraiment (une bande de symboles, vue décalée), levier, lampe de toit qui clignote.
  const cabinet = mat("#15101c", { metalness: 0.45, roughness: 0.45 }), chrome = mat("#c9ccd6", { metalness: 0.9, roughness: 0.22 });
  const shadeGeometry = new THREE.PlaneGeometry(0.52, 0.45), shadeMat = new THREE.MeshBasicMaterial({ map: reelShadeTexture(), transparent: true, depthWrite: false });
  const strip = slotStripTexture();
  CASINO_MACHINES.forEach(([mx, my], k) => {
    const [name, theme] = MACHINE_THEMES[k], mg = new THREE.Group();
    mg.userData.fixed = true; // rangée dans c.machines mais immobile : ses pièces fixes fusionnent avec l'étage
    mg.position.copy(at(mx, my));
    g.add(mg);
    box(mg, 0.72, 1.18, 0.56, cabinet, 0, 0.59, 0);
    box(mg, 0.76, 0.03, 0.6, glow(theme, 0.9), 0, 0.075, 0);
    for (const sx of [-0.37, 0.37]) box(mg, 0.025, 1.9, 0.025, glow(theme, 1.4), sx, 1.05, 0.28);
    box(mg, 0.72, 0.64, 0.5, cabinet, 0, 1.5, -0.03);
    box(mg, 0.6, 0.5, 0.02, mat("#07040c"), 0, 1.5, 0.225);
    const reels = [-0.17, 0, 0.17].map(rx => {
      const map = strip.clone(), pos = Math.floor(Math.random() * SLOT_SYMBOLS.length);
      map.repeat.set(1, 0.5);
      map.offset.y = reelOffset(pos);
      const reel = new THREE.Mesh(reelGeometry, new THREE.MeshBasicMaterial({ map, toneMapped: false }));
      reel.position.set(rx, 1.5, 0.238);
      mg.add(reel);
      return { map, pos: map.offset.y, from: 0, dist: 0, stop: 0, target: 0 };
    });
    const shade = new THREE.Mesh(shadeGeometry, shadeMat);
    shade.position.set(0, 1.5, 0.242);
    mg.add(shade);
    box(mg, 0.54, 0.008, 0.004, glow("#ff2d55", 2), 0, 1.5, 0.246);
    for (const dy of [-0.25, 0.25]) box(mg, 0.64, 0.035, 0.04, chrome, 0, 1.5 + dy, 0.235);
    for (const dx of [-0.3, 0.3]) box(mg, 0.035, 0.5, 0.04, chrome, dx, 1.5, 0.235);
    box(mg, 0.72, 0.06, 0.32, cabinet, 0, 1.0, 0.36).rotation.x = 0.3;
    ["#ff3b3b", "#ffd23f", "#4ade80"].forEach((col, b) => cyl(mg, 0.035, 0.03, glow(col, 1.2), -0.18 + b * 0.18, 1.045, 0.34, 12));
    const topper = new THREE.MeshStandardMaterial({ color: theme, emissive: theme, emissiveIntensity: 0.8, roughness: 0.4 });
    box(mg, 0.74, 0.34, 0.48, topper, 0, 2.0, -0.04);
    sign(mg, name, 0.68, 0.22, { color: "#1b0a12", font: "900 72px Sora, sans-serif", blur: 0, w: 400, h: 128 }, 0, 2.0, 0.205);
    box(mg, 0.5, 0.07, 0.14, chrome, 0, 0.32, 0.33);
    box(mg, 0.44, 0.02, 0.1, mat("#0a0610"), 0, 0.36, 0.33);
    let lever = null;
    if (k < 6) {
      cyl(mg, 0.045, 0.1, chrome, 0.4, 1.12, 0.05, 12).rotation.z = Math.PI / 2;
      lever = new THREE.Group();
      lever.position.set(0.44, 1.12, 0.05);
      mg.add(lever);
      cyl(lever, 0.016, 0.5, chrome, 0, 0.25, 0, 8);
      const knob = new THREE.Mesh(ballGeometry, glow("#e01b2f", 0.6));
      knob.scale.setScalar(0.045); knob.position.y = 0.52; lever.add(knob);
    }
    if (k === CASINO_FEATURED) {
      // La machine du jackpot : gyrophare sur le toit, il tourne et clignote pendant la fête.
      c.beacon = new THREE.MeshBasicMaterial({ color: "#ff8a00", toneMapped: false });
      cyl(mg, 0.09, 0.16, c.beacon, 0, 2.25, -0.04, 16);
    }
    playTarget(f, mg, 0.8, 2.3, 0.75, 0, 1.15, 0.05, "casino");
    c.machines.push({ group: mg, reels, topper, lever, leverT: 0, active: false, time: 0, stopAt: 0, flash: 0, wait: Math.random() * 3, busy: false, onDone: null });
  });

  // Bar : comptoir de marbre éclairé par-dessous, arrière-bar rétroéclairé, bouteilles lumineuses (un seul maillage).
  const bar = at(840, 100), shelfZ = at(0, 24).z;
  box(g, 4.8, 1.04, 0.62, mat("#1a0b10", { roughness: 0.35 }), bar.x, 0.52, bar.z);
  for (let k = 0; k < 24; k++) box(g, 0.02, 0.86, 0.012, brass, bar.x - 2.3 + k * 0.2, 0.5, bar.z + 0.315);
  box(g, 5.0, 0.07, 0.78, mat("#e3dccf", { roughness: 0.18, metalness: 0.05 }), bar.x, 1.075, bar.z);
  box(g, 4.9, 0.025, 0.025, glow("#ffb347", 1.6), bar.x, 1.02, bar.z + 0.4);
  box(g, 4.9, 0.025, 0.025, glow("#ffb347", 1.2), bar.x, 0.06, bar.z + 0.33);
  staff("#2b2f3a", 840, 52, 0);
  box(g, 4.7, 1.9, 0.04, glow("#ff9f43", 0.28), bar.x, 1.85, shelfZ - 0.06);
  const bottleShape = [[0, 0], [0.05, 0], [0.055, 0.02], [0.055, 0.17], [0.042, 0.21], [0.018, 0.245], [0.018, 0.31], [0.022, 0.32], [0, 0.32]].map(([r, y]) => new THREE.Vector2(r, y));
  const bottles = new THREE.InstancedMesh(new THREE.LatheGeometry(bottleShape, 10), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), 48);
  const tones = ["#ffb347", "#ff6b6b", "#5ce1ff", "#9bff6b", "#ffd23f", "#ff6fd8", "#c18cff", "#ffe7b0"];
  for (let row = 0; row < 3; row++) {
    const y = 1.12 + row * 0.55;
    box(g, 4.6, 0.03, 0.3, mat("#a9c7d6", { transparent: true, opacity: 0.5, roughness: 0.1 }), bar.x, y, shelfZ + 0.1);
    box(g, 4.6, 0.02, 0.02, glow("#fff1d6", 1.5), bar.x, y - 0.02, shelfZ + 0.24);
    for (let k = 0; k < 16; k++) {
      bottles.setMatrixAt(row * 16 + k, m4.makeTranslation(bar.x - 2.2 + k * 0.29, y + 0.015, shelfZ + 0.1));
      bottles.setColorAt(row * 16 + k, tint.set(tones[(k * 3 + row * 5) % tones.length]));
    }
  }
  g.add(bottles);
  for (let k = 0; k < 4; k++) {
    const x = bar.x - 1.9 + k * 1.25;
    cyl(g, 0.055, 0.16, mat("#b8dce8", { transparent: true, opacity: 0.55 }), x, 1.19, bar.z + 0.15, 12);
    cyl(g, 0.045, 0.08, glow(["#ee966e", "#9fd67b", "#ff6fd8", "#ffd23f"][k], 0.6), x, 1.16, bar.z + 0.15, 12);
  }
  sign(g, "BAR", 1.4, 0.45, { color: "#ffb347" }, bar.x, 3.15, shelfZ - 0.02);

  // Jackpot commun : grand panneau cerné d'ampoules qui défilent (montant et dernier gagnant, redessinés s'ils changent).
  box(g, 6.2, 1.95, 0.08, mat("#22070f", { metalness: 0.4, roughness: 0.4 }), 0, 2.75, back + 0.02);
  for (const dy of [-0.95, 0.95]) box(g, 6.24, 0.05, 0.1, brass, 0, 2.75 + dy, back + 0.04);
  for (const dx of [-3.1, 3.1]) box(g, 0.05, 1.95, 0.1, brass, dx, 2.75, back + 0.04);
  c.jackpot = canvasPanel(g, 5.6, 1.5, 1024, 274, 0, 2.75, back + 0.07);
  drawJackpot(c, null, 0);
  const ring = [];
  for (let k = 0; k < 30; k++) ring.push([-2.9 + k * 0.2, 3.62]);
  for (let k = 0; k < 8; k++) ring.push([2.98, 3.5 - k * 0.2]);
  for (let k = 0; k < 30; k++) ring.push([2.9 - k * 0.2, 1.88]);
  for (let k = 0; k < 8; k++) ring.push([-2.98, 2.0 + k * 0.2]);
  c.bulbs = new THREE.InstancedMesh(ballGeometry, new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), ring.length);
  ring.forEach(([x, y], i) => { c.bulbs.setMatrixAt(i, m4.makeScale(0.04, 0.04, 0.04).setPosition(x, y, back + 0.1)); c.bulbs.setColorAt(i, i % 3 ? BULB_DIM : BULB_ON); });
  g.add(c.bulbs);
  sign(g, "CASINO", 4.2, 1.0, { color: "#ffd700", font: "900 120px Sora, sans-serif", blur: 22 }, 0, 4.2, back + 0.05);

  // Néons sur le haut des vitres (fond, côtés, angles) : leurs couleurs défilent et s'emballent pour un jackpot.
  const neon = (w, h, x, y, z, ry = 0) => {
    const m = new THREE.MeshBasicMaterial({ color: "#ff6fd8", toneMapped: false });
    box(g, w, h, 0.06, m, x, y, z, ry);
    m.color.setHSL(mod1(c.neons.length * 0.045 + 0.85), 0.95, 0.55);
    c.neons.push(m);
  };
  for (let k = 0; k < 8; k++) neon(2.4, 0.06, -8.75 + k * 2.5, 4.7, -6.3);
  for (const x of [-10.25, 10.25]) for (let k = 0; k < 5; k++) neon(2.3, 0.06, x, 4.7, -5 + k * 2.5, Math.PI / 2);
  for (const x of [-10.2, 10.2]) neon(0.06, 4.4, x, 2.5, -6.3);

  // Lustre de cristal au-dessus de l'allée : anneaux dorés, ampoules et pampilles (deux maillages instanciés).
  const lustre = c.lustre = new THREE.Group();
  lustre.position.set(0, 3.75, -0.2);
  g.add(lustre);
  const gold = mat("#d4af37", { metalness: 0.9, roughness: 0.22 });
  cyl(lustre, 0.018, 1.4, gold, 0, 0.95, 0, 6);
  const lights = [], drops = [];
  for (const [r, y] of [[0.9, 0], [0.6, 0.25], [0.32, 0.46]]) {
    const tor = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 8, 48).rotateX(Math.PI / 2), gold);
    tor.position.y = y; lustre.add(tor);
    const n = Math.round(r * 18), nd = Math.round(r * 26);
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; lights.push([Math.cos(a) * r, y + 0.07, Math.sin(a) * r]); }
    for (let k = 0; k < nd; k++) { const a = (k + 0.5) / nd * Math.PI * 2; drops.push([Math.cos(a) * r, y - 0.1 - (k % 2) * 0.09, Math.sin(a) * r]); }
  }
  for (let k = 0; k < 3; k++) box(lustre, 1.8, 0.02, 0.02, gold, 0, 0, 0, k * Math.PI / 3);
  for (let k = 0; k < 6; k++) drops.push([0, -0.14 - k * 0.075, 0]);
  const bulbs = new THREE.InstancedMesh(ballGeometry, new THREE.MeshBasicMaterial({ color: "#ffe6a8", toneMapped: false }), lights.length);
  lights.forEach(([x, y, z], i) => bulbs.setMatrixAt(i, m4.makeScale(0.032, 0.05, 0.032).setPosition(x, y, z)));
  const crystalMat = new THREE.MeshStandardMaterial({ color: "#f4f8ff", metalness: 0.3, roughness: 0.05, emissive: "#9fc3ff", emissiveIntensity: 0.45 });
  const crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), crystalMat, drops.length);
  drops.forEach(([x, y, z], i) => crystals.setMatrixAt(i, m4.makeScale(0.03, 0.055, 0.03).setPosition(x, y, z)));
  const orb = new THREE.Mesh(ballGeometry, crystalMat);
  orb.scale.setScalar(0.09); orb.position.y = -0.62;
  lustre.add(bulbs, crystals, orb);

  // Carré VIP : moquette bordeaux, poteaux dorés et cordons de velours (ouverts côté allée), banquettes capitonnées face à face.
  zone(VIP.x0 + 5, VIP.y0 + 5, 985, 605, "#4b0f24");
  const velvet = mat("#9b1030", { roughness: 0.7 });
  const post = ([x, y]) => {
    const p = at(x, y);
    cyl(g, 0.12, 0.04, brass, p.x, 0.08, p.z, 16);
    cyl(g, 0.03, 0.9, brass, p.x, 0.5, p.z, 10);
    const top = new THREE.Mesh(ballGeometry, brass); top.scale.setScalar(0.05); top.position.set(p.x, 0.97, p.z); g.add(top);
  };
  const rope = (a, b) => {
    const p = at(...a), q = at(...b);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(p.x, 0.86, p.z), new THREE.Vector3((p.x + q.x) / 2, 0.6, (p.z + q.z) / 2), new THREE.Vector3(q.x, 0.86, q.z));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.018, 6), velvet));
  };
  const chains = [[[VIP.x0, VIP.gap[0]], [VIP.x0, 425], [VIP.x0, VIP.y0], [820, VIP.y0], [875, VIP.y0], [930, VIP.y0], [985, VIP.y0]],
    [[VIP.x0, VIP.gap[1]], [VIP.x0, 575], [VIP.x0, 605]]];
  for (const chain of chains) { chain.forEach(post); chain.slice(1).forEach((p, k) => rope(chain[k], p)); }
  const plush = mat("#7a1430", { roughness: 0.8 }), plushDark = mat("#5a0e22", { roughness: 0.8 });
  const rbox = (w, h, d, m, x, y, z) => { const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.05), m); mesh.position.set(x, y, z); g.add(mesh); };
  for (const [seatY, backY] of [[432, 414], [568, 586]]) {
    const s = at(870, seatY), b = at(870, backY);
    box(g, 3.0, 0.24, 0.5, mat("#1c0a10"), s.x, 0.12, s.z);
    rbox(3.0, 0.2, 0.55, plush, s.x, 0.34, s.z);
    rbox(3.0, 0.62, 0.16, plush, b.x, 0.66, b.z);
    for (let k = 0; k < 11; k++) box(g, 0.02, 0.5, 0.17, plushDark, b.x - 1.25 + k * 0.25, 0.68, b.z);
    box(g, 3.04, 0.03, 0.2, brass, b.x, 0.98, b.z);
  }
  const vt = at(...VIP.table);
  box(g, 1.2, 0.36, 0.28, brass, vt.x, 0.2, vt.z);
  box(g, 1.4, 0.05, 0.42, mat("#101014", { roughness: 0.15, metalness: 0.3 }), vt.x, 0.42, vt.z);
  cyl(g, 0.12, 0.2, mat("#8995a7", { metalness: 0.8, roughness: 0.25 }), vt.x, 0.55, vt.z, 16);
  cyl(g, 0.045, 0.36, mat("#294a36"), vt.x, 0.68, vt.z, 12);
  for (const dx of [-0.4, 0.4]) {
    cyl(g, 0.012, 0.14, mat("#c5dfeb"), vt.x + dx, 0.52, vt.z, 6);
    cyl(g, 0.04, 0.1, mat("#eed18a", { transparent: true, opacity: 0.8 }), vt.x + dx, 0.64, vt.z, 12);
  }
  sign(g, "VIP", 1.1, 0.42, { color: "#ffd700", font: "800 110px Sora, sans-serif", w: 256 }, at(875, VIP.y0).x, 1.45, at(0, VIP.y0).z);
  for (const [x, y] of [[975, 398], [975, 600]]) put(g, "pottedPlant", at(x, y).x, at(x, y).z, 0, 2.4);
  staff("#15171f", 745, 588, Math.PI / 2); // videur du carré
  staff("#15171f", 55, 240, Math.PI / 2); // vigile près de l'ascenseur

  // Pièces d'or du jackpot : cachées, lancées depuis la machine du jackpot pendant la fête.
  c.coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), mat("#ffd23f", { metalness: 0.85, roughness: 0.25, emissive: "#a86b00", emissiveIntensity: 0.4 }), 40);
  c.coins.visible = false;
  c.coins.frustumCulled = false;
  g.add(c.coins);
  // Par pièce : vitesse en x, en hauteur, vers la salle, puis son retard au départ.
  const spread = [k => (k - 0.5) * 2.4, k => 2.4 + k * 2.2, k => 0.5 + k * 1.6, k => k * 0.9];
  c.coinFlight = Float32Array.from({ length: 160 }, (_, i) => spread[i % 4](Math.random()));
  f.tick = (dt, t, reduced) => tickCasino(c, dt, t, reduced);
}

function drawJackpot(c, casino, now) {
  const p = c.jackpot, w = casino?.lastWinner, known = Number.isFinite(Number(casino?.jackpot));
  const at = Number(w?.at) > 1e12 ? Number(w.at) / 1000 : Number(w?.at) || 0;
  const line = w?.name ? `Dernier gagnant : ${w.name} · ${money(w.amount)}${at && now ? " · " + agoText(Math.max(0, now - at)) : ""}`
    : "Trois 7 à la machine à sous remportent tout";
  const key = `${known ? Math.round(Number(casino.jackpot)) : "?"}|${line}`;
  if (key === p.key) return;
  p.key = key;
  const x = p.ctx, W = p.w, H = p.h;
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#3b0614"); bg.addColorStop(1, "#14020a");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = "#ffb000"; x.shadowBlur = 18;
  x.fillStyle = "#ffd76a"; x.font = "800 58px Sora, sans-serif"; x.fillText("★  JACKPOT  ★", W / 2, 52);
  x.shadowBlur = 26; x.fillStyle = "#fff4d0"; x.font = "900 108px Sora, sans-serif";
  x.fillText(known ? money(Math.round(Number(casino.jackpot))) : "· · ·", W / 2, 148, W - 80);
  x.shadowBlur = 0; x.fillStyle = "#f3cf9a"; x.font = "500 32px Sora, sans-serif"; x.fillText(line, W / 2, 238, W - 60);
  p.tex.needsUpdate = true;
}

function drawRouletteBoard(r) {
  const p = r.board, key = r.history.join(",");
  if (key === p.key) return;
  p.key = key;
  const x = p.ctx, W = p.w, H = p.h;
  x.fillStyle = "#0b0b10"; x.fillRect(0, 0, W, H);
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillStyle = "#e9c46a"; x.font = "700 20px Sora, sans-serif"; x.fillText("DERNIERS NUMÉROS", W / 2, 18);
  const [last, ...rest] = r.history;
  if (last === undefined) { x.fillStyle = "#c9c9d1"; x.font = "600 24px Sora, sans-serif"; x.fillText("Faites vos jeux", W / 2, 80); }
  else {
    x.fillStyle = rouletteColor(last); x.beginPath(); x.arc(64, 80, 40, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#ffffff"; x.font = "900 44px Sora, sans-serif"; x.fillText(String(last), 64, 82);
    rest.slice(0, 5).forEach((n, k) => {
      x.fillStyle = rouletteColor(n); x.beginPath(); x.arc(134 + k * 26, 80, 12, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#ffffff"; x.font = "700 13px Sora, sans-serif"; x.fillText(String(n), 134 + k * 26, 81);
    });
  }
  p.tex.needsUpdate = true;
}

function drawBlackjackBoard(b, hand) {
  const p = b.board, st = String(hand?.status ?? "");
  const title = hand ? BJ_STATUS[st] ?? st : "BLACKJACK";
  const hidden = (hand?.dealer ?? []).includes("??");
  const line = hand ? `Toi ${hand.playerTotal ?? "?"} · Banque ${hidden ? "?" : hand.dealerTotal ?? "?"}` : "Faites vos jeux";
  const key = `${title}|${line}`;
  if (key === p.key) return;
  p.key = key;
  const x = p.ctx, W = p.w, H = p.h;
  x.fillStyle = "#08130d"; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#e9c46a"; x.lineWidth = 4; x.strokeRect(4, 4, W - 8, H - 8);
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillStyle = st === "lose" || st === "bust" ? "#ff8a8a" : "#ffd76a"; x.font = "800 50px Sora, sans-serif"; x.fillText(title, W / 2, 50, W - 30);
  x.fillStyle = "#e8f0ea"; x.font = "600 32px Sora, sans-serif"; x.fillText(line, W / 2, 108, W - 30);
  p.tex.needsUpdate = true;
}

// Rouleaux : vers la vue du symbole tiré ; sans animation, ils s'y placent tout de suite.
function spinMachine(m, symbols, animate) {
  m.reels.forEach((r, i) => {
    const k = SLOT_SYMBOLS.indexOf(symbols?.[i]);
    r.target = reelOffset(k >= 0 ? k : Math.floor(Math.random() * SLOT_SYMBOLS.length));
    if (!animate) { r.pos = r.target; r.map.offset.y = r.target; }
    r.stop = -1;
  });
  m.active = animate;
  m.time = 0;
  m.stopAt = 1.1;
  if (animate) m.leverT = 0.6;
}
function tickMachine(m, dt) {
  m.time += dt;
  let done = true;
  for (let i = 0; i < m.reels.length; i++) {
    const r = m.reels[i];
    if (r.stop < 0) {
      r.pos += dt * 4.5;
      if (m.time >= m.stopAt + i * 0.45) { r.from = r.pos; r.dist = mod1(r.target - r.pos) + 1; r.stop = m.time; }
      done = false;
    } else {
      const k = Math.min(1, (m.time - r.stop) / 0.75);
      r.pos = r.from + r.dist * easeOut(k);
      if (k < 1) done = false;
    }
    r.map.offset.y = mod1(r.pos);
  }
  if (done) {
    m.active = false;
    const finish = m.onDone;
    m.onDone = null;
    finish?.();
  }
}

// Roulette : le rotor ralentit, la bille tourne à l'envers puis tombe dans la case du numéro tiré et suit le rotor.
function spinRoulette(r, number, animate) {
  r.number = number;
  const target = (ROULETTE_WHEEL.indexOf(number) + 0.5) * POCKET;
  const show = () => { r.history.unshift(number); r.history.length = Math.min(r.history.length, 6); drawRouletteBoard(r); };
  if (!animate) { r.spin = null; show(); return; }
  const T = 7, Tb = 5.4, A = Math.PI * 2 * 1.6, a0 = r.alpha, b0 = Math.atan2(r.ball.position.z, r.ball.position.x);
  const landing = target - (a0 + A * easeOut(Tb / T)) - b0;
  const B = landing - Math.PI * 2 * Math.floor(landing / (Math.PI * 2)) - Math.PI * 2 * 5;
  r.spin = { t: 0, T, Tb, a0, A, b0, B, target, done: show };
}
function tickRoulette(r, dt, reduced) {
  const s = r.spin;
  let b, rad = REST_R, y = 0.917;
  if (!s) {
    if (!reduced) r.alpha += dt * 0.35;
    b = (ROULETTE_WHEEL.indexOf(r.number) + 0.5) * POCKET - r.alpha;
  } else {
    s.t += dt;
    const k = Math.min(1, s.t / s.T), kb = Math.min(1, s.t / s.Tb);
    r.alpha = s.a0 + s.A * easeOut(k);
    if (kb < 1) {
      b = s.b0 + s.B * easeOut(kb);
      rad = TRACK_R; y = 0.922;
      if (kb > 0.72) {
        const u = (kb - 0.72) / 0.28;
        rad = TRACK_R + (REST_R - TRACK_R) * u * u * (3 - 2 * u);
        y = 0.917 + Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 0.035;
      }
    } else b = s.target - r.alpha;
    if (k >= 1) { r.spin = null; s.done(); }
  }
  r.rotor.rotation.y = r.alpha;
  r.ball.position.set(Math.cos(b) * rad, y, Math.sin(b) * rad);
}

// Blackjack : les cartes déjà posées restent (une carte tirée s'ajoute, la carte cachée de la banque se retourne) ;
// une nouvelle main efface la table. Chaque carte part du sabot.
function showBlackjack(c, hand, animate) {
  const b = c.blackjack;
  const player = (Array.isArray(hand.player) ? hand.player : []).slice(0, 6).map(String);
  const dealer = (Array.isArray(hand.dealer) ? hand.dealer : []).slice(0, 6).map(String);
  const follows = (shown, next) => shown.length <= next.length && shown.every((card, i) => card === next[i] || card === "??");
  if (b.final || !follows(b.player, player) || !follows(b.dealer, dealer)) {
    for (const m of b.cards) m.visible = false;
    b.player = []; b.dealer = [];
  }
  b.final = hand.status !== "playing";
  const anim = [];
  let delay = 0;
  const lay = (shown, next, base, z) => next.forEach((label, i) => {
    if (shown[i] === label) return;
    const mesh = b.cards[base + i], tex = cardTexture(label), to = [-0.17 + i * 0.075, 0.816 + i * 0.002, z];
    if (shown[i] === "??") { anim.push({ mesh, tex, to, flip: true, t: -delay }); delay += 0.25; return; }
    if (!animate) { mesh.material.map = tex; mesh.position.set(...to); mesh.rotation.y = 0; mesh.scale.x = 1; mesh.visible = true; return; }
    mesh.material.map = tex; mesh.visible = false;
    anim.push({ mesh, tex, to, flip: false, t: -delay }); delay += 0.3;
  });
  lay(b.player, player, 0, 0.63);
  lay(b.dealer, dealer, 6, 0.25);
  b.player = player; b.dealer = dealer;
  if (!animate) for (const a of anim) { a.mesh.material.map = a.tex; a.mesh.scale.x = 1; }
  b.anim = animate ? anim : [];
  drawBlackjackBoard(b, hand);
}
function tickCards(b, dt) {
  for (const a of b.anim) {
    if (a.done) continue;
    a.t += dt;
    const k = Math.min(1, a.t / 0.35), m = a.mesh;
    if (k <= 0) continue;
    if (a.flip) {
      m.scale.x = Math.max(0.001, Math.abs(Math.cos(k * Math.PI)));
      if (k >= 0.5) m.material.map = a.tex;
    } else {
      const e = easeOut(k);
      m.visible = true;
      m.position.set(BJ_SHOE.x + (a.to[0] - BJ_SHOE.x) * e, a.to[1] + Math.sin(k * Math.PI) * 0.1, BJ_SHOE.z + (a.to[2] - BJ_SHOE.z) * e);
      m.rotation.y = (1 - e) * 1.2;
    }
    if (k >= 1) { a.done = true; m.scale.x = 1; }
  }
}

function tickCasino(c, dt, t, reduced) {
  // Une machine dont la place est occupée par un agent installé tourne de temps en temps (places 0 à 11 = machines).
  for (const m of c.machines) m.busy = false;
  if (!reduced) for (const a of agents.values()) {
    const u = a.userData;
    if (u.floor === "casino" && u.place === "casino" && !u.path.length && u.index < c.machines.length) c.machines[u.index].busy = true;
  }
  for (const m of c.machines) {
    if (m.busy && !m.active && (m.wait -= dt) <= 0) { spinMachine(m, null, true); m.wait = 3 + Math.random() * 4; }
    if (m.active) tickMachine(m, dt);
    if (m.leverT > 0) { m.leverT = Math.max(0, m.leverT - dt); if (m.lever) m.lever.rotation.x = Math.sin((1 - m.leverT / 0.6) * Math.PI) * 0.9; }
    if (m.flash > 0) { m.flash = Math.max(0, m.flash - dt); m.topper.emissiveIntensity = m.flash > 0 && Math.sin(t * 24) > 0 ? 2.4 : 0.8; }
  }
  tickRoulette(c.roulette, dt, reduced);
  tickCards(c.blackjack, dt);
  const party = c.party > 0;
  if (party) { c.party = Math.max(0, c.party - dt); c.partyTime += dt; }
  if (reduced) return;
  // Néons, ampoules du jackpot et lustre : lents d'ordinaire, emballés pendant la fête.
  c.hue = mod1(c.hue + dt * (party ? 0.9 : 0.05));
  for (let k = 0; k < c.neons.length; k++) c.neons[k].color.setHSL(mod1(c.hue + k * 0.045), 0.95, party && Math.sin(t * 16 + k) > 0 ? 0.78 : 0.55);
  const step = Math.floor(t * (party ? 16 : 4));
  if (step !== c.bulbStep) {
    c.bulbStep = step;
    for (let i = 0; i < c.bulbs.count; i++) c.bulbs.setColorAt(i, (i + step) % 3 ? BULB_DIM : BULB_ON);
    c.bulbs.instanceColor.needsUpdate = true;
  }
  c.lustre.rotation.y += dt * (party ? 1.4 : 0.06);
  if (c.beacon) c.beacon.color.set(party && Math.sin(t * 20) > 0 ? "#fff3b0" : "#ff8a00");
  // Pièces : lancées en gerbe, retombent et restent au sol jusqu'à la fin de la fête.
  c.coins.visible = party;
  if (party) {
    const o = c.machines[CASINO_FEATURED].group.position, d = c.dummy, v = c.coinFlight;
    for (let i = 0; i < c.coins.count; i++) {
      const vx = v[i * 4], vy = v[i * 4 + 1], vz = v[i * 4 + 2], tt = c.partyTime - v[i * 4 + 3];
      const land = (vy + Math.sqrt(vy * vy + 2 * 9.8 * 2.15)) / 9.8, te = Math.min(Math.max(tt, 0), land);
      d.position.set(o.x + vx * te, Math.max(0.08, 2.2 + vy * te - 4.9 * te * te), o.z + 0.2 + vz * te);
      d.rotation.set(te * 9 + i, te * 5, 0);
      d.scale.setScalar(tt < 0 ? 0.001 : 1);
      d.updateMatrix();
      c.coins.setMatrixAt(i, d.matrix);
    }
    c.coins.instanceMatrix.needsUpdate = true;
  } else c.partyTime = 0;
}

export { buildCasino, drawJackpot, showBlackjack, spinMachine, spinRoulette };
