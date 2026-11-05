// Golf : putting green, practice, étang, club-house, putts rejoués d’après le serveur.

import * as THREE from "three";
import { GOLF_BUNKER, GOLF_GREEN, GOLF_HOLES, GOLF_MATS, GOLF_POND, GOLF_STANCE, GOLF_TABLES, GOLF_TEE, P, S } from "../base.js";
import { LightSpot, box, cyl, glow, live, mat, sign } from "../engine.js";
import { ballGeometry, canvasPanel, discGeometry, drawnTexture, mod1, playTarget } from "../kit.js";
import { holdProp, play } from "../robots.js";
import { put } from "./shell.js";
import { netTexture } from "./shared.js";

// ---------- Golf ----------
// Putting green devant (trois trous), practice et son filet au fond à gauche, étang au centre, club-house au fond à droite,
// bunker, voiturette et bancs. Le golfeur du club putte en boucle sur le trou 2 ; un putt joué au dialogue y est rejoué.
const PUTT_DIST = { court: 50, moyen: 125, long: 250 };
const PUTT_NAMES = { court: "Putt de 1 m", moyen: "Putt de 4 m", long: "Putt de 12 m" };
const PUTT_MISS = { "trop court": [-18, 0], "trop long": [30, 0], "à gauche": [16, -15], "à droite": [16, 15] };
function buildGolf(f, g, { at, tag, staff, back }) {
  const slab = (x0, y0, x1, y1, m, top) => { const a = P(x0, y0), b = P(x1, y1); return box(g, b.x - a.x, 0.02, b.z - a.z, m, (a.x + b.x) / 2, top - 0.01, (a.z + b.z) / 2); };
  const ellipse = (cx, cy, rx, ry, m, top) => {
    const e = new THREE.Mesh(discGeometry, m);
    e.position.copy(at(cx, cy)); e.position.y = top; e.scale.set(rx * S, 1, ry * S); g.add(e); return e;
  };
  // Gazon tondu en bandes (une texture par tonte, dessinée une fois).
  const grass = (base, stripe, rx, ry) => {
    const t = drawnTexture(256, 256, x => {
      for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? base : stripe; x.fillRect(k * 32, 0, 32, 256); }
      for (let k = 0; k < 1200; k++) { x.fillStyle = `rgba(10,40,15,${(0.05 + Math.random() * 0.1).toFixed(2)})`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
  };
  const G = GOLF_GREEN, B = GOLF_BUNKER, W = GOLF_POND;
  slab(20, 20, 980, 600, grass("#2f6136", "#356a3c", 3, 2), 0.062);
  slab(20, 288, 980, 332, mat("#b9ad8f", { roughness: 1 }), 0.066);
  ellipse(G.cx, G.cy, G.rx + 14, G.ry + 11, mat("#3f8a49", { roughness: 0.9 }), 0.07);
  ellipse(G.cx, G.cy, G.rx, G.ry, grass("#5aac63", "#4f9f58", 2, 2), 0.074);
  // Légers reliefs dans le rough, hors des chemins.
  for (const [x, y, r] of [[55, 170, 45], [690, 598, 24], [292, 604, 16]]) {
    const mound = new THREE.Mesh(ballGeometry, mat("#3a7341", { roughness: 0.95 }));
    mound.position.copy(at(x, y)); mound.position.y = 0.04; mound.scale.set(r * S, 0.16, r * S * 0.8); g.add(mound);
  }
  // Trous : coupe, bordure blanche, mât et drapeau numéroté qui flotte (une géométrie partagée, ondulée à chaque image).
  const flagGeo = new THREE.PlaneGeometry(0.44, 0.28, 10, 1).translate(0.22, 0, 0);
  const stick = mat("#f4f1e8", { roughness: 0.4 });
  GOLF_HOLES.forEach(([hx, hy], k) => {
    const p = at(hx, hy);
    ellipse(hx, hy, 3.6, 3.6, mat("#0a0c0a"), 0.077);
    const lipRing = new THREE.Mesh(new THREE.RingGeometry(0.072, 0.086, 24).rotateX(-Math.PI / 2), mat("#e9ecef"));
    lipRing.position.set(p.x, 0.0775, p.z); g.add(lipRing);
    const flagMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: drawnTexture(128, 82, (x, w, h) => {
      x.fillStyle = ["#e63946", "#ffd23f", "#4cc9f0"][k]; x.fillRect(0, 0, w, h);
      x.fillStyle = "#14213d"; x.font = "900 60px Sora, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(k + 1), w / 2, h / 2 + 3);
    }) });
    if (k === 1) {
      // Trou des putts joués : le drapeau est couché à côté, comme quand on putte.
      cyl(g, 0.012, 1.7, stick, p.x + 0.2, 0.09, p.z + 0.45, 6).rotation.z = Math.PI / 2;
      const laid = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28).rotateX(-Math.PI / 2), flagMat);
      laid.position.set(p.x + 1.27, 0.082, p.z + 0.31); g.add(laid);
      return;
    }
    cyl(g, 0.012, 1.7, stick, p.x, 0.92, p.z, 6);
    const flag = live(new THREE.Mesh(flagGeo, flagMat)); // géométrie ondulée à chaque image
    flag.position.set(p.x, 1.62, p.z); flag.rotation.y = -0.5; g.add(flag);
  });
  // Bunker : sable ratissé, lèvre d'herbe et râteau.
  const sand = drawnTexture(128, 128, x => {
    x.fillStyle = "#e6d3a0"; x.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 900; k++) { x.fillStyle = Math.random() < 0.5 ? "#d4bf86" : "#f2e3b8"; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
    x.strokeStyle = "rgba(150,120,70,0.35)"; x.lineWidth = 2;
    for (let k = 8; k < 128; k += 10) { x.beginPath(); x.moveTo(0, k); x.bezierCurveTo(40, k - 6, 80, k + 6, 128, k); x.stroke(); }
  });
  ellipse(B.cx, B.cy, B.rx + 8, B.ry + 7, mat("#3a7341"), 0.07);
  ellipse(B.cx, B.cy, B.rx, B.ry, new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }), 0.073);
  const rake = at(B.cx + 55, B.cy + 22), wood = mat("#8a6a45", { roughness: 0.7 });
  cyl(g, 0.014, 1.3, wood, rake.x, 0.1, rake.z, 6).rotation.z = Math.PI / 2;
  box(g, 0.06, 0.04, 0.42, mat("#2b2f33"), rake.x + 0.65, 0.1, rake.z);
  // Étang : margelle de pierre, eau qui miroite, nénuphars, roseaux, ronds dans l'eau et un canard.
  ellipse(W.cx, W.cy, W.rx + 12, W.ry + 10, mat("#6f726b", { roughness: 0.9 }), 0.068);
  const water = new THREE.MeshStandardMaterial({ color: "#1f6a8f", roughness: 0.12, metalness: 0.3, emissive: "#0b3a55", emissiveIntensity: 0.6 });
  ellipse(W.cx, W.cy, W.rx, W.ry, water, 0.072);
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, stone = new THREE.Mesh(ballGeometry, mat(k % 2 ? "#8a8d86" : "#a3a69e", { roughness: 0.9 }));
    stone.position.copy(at(W.cx + Math.cos(a) * (W.rx + 9), W.cy + Math.sin(a) * (W.ry + 8))); stone.position.y = 0.07;
    stone.scale.set(0.16, 0.08, 0.13); g.add(stone);
  }
  for (const [dx, dy] of [[-40, -15], [-55, 12], [30, 20], [50, -18]]) {
    ellipse(W.cx + dx, W.cy + dy, 7, 6, mat("#3f8a49"), 0.076);
    if (dx < 0) { const bloom = new THREE.Mesh(ballGeometry, glow("#ff9ec4", 0.4)); bloom.scale.setScalar(0.04); bloom.position.copy(at(W.cx + dx + 2, W.cy + dy)); bloom.position.y = 0.1; g.add(bloom); }
  }
  for (let k = 0; k < 9; k++) {
    const a = Math.PI * (1.1 + k * 0.1), r = at(W.cx + Math.cos(a) * (W.rx - 6), W.cy + Math.sin(a) * (W.ry - 5));
    cyl(g, 0.012, 0.5 + (k % 3) * 0.15, mat("#4c7a3a"), r.x, 0.3, r.z, 5);
  }
  const rippleGeo = new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2);
  const ripples = [[560, 190, 0], [625, 215, 0.5]].map(([x, y, phase]) => {
    const ring = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: "#cfe9f5", transparent: true, opacity: 0, depthWrite: false }));
    ring.position.copy(at(x, y)); ring.position.y = 0.077; ring.userData.phase = phase; g.add(ring); return ring;
  });
  const duck = new THREE.Group(), duckYellow = mat("#ffd23f", { roughness: 0.6 });
  const duckPart = (sx, sy, sz, m, x, y, z) => { const o = new THREE.Mesh(ballGeometry, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); duck.add(o); };
  duckPart(0.12, 0.08, 0.17, duckYellow, 0, 0.05, 0);
  duckPart(0.07, 0.07, 0.07, duckYellow, 0, 0.15, 0.1);
  box(duck, 0.05, 0.02, 0.07, mat("#ff8a00"), 0, 0.14, 0.18);
  g.add(duck);
  // Practice : cinq tapis face à un grand filet, seaux de balles ; le pro du club frappe au dernier tapis.
  const postMat = mat("#3d4a42", { metalness: 0.5, roughness: 0.4 });
  for (const x of [90, 290, 490]) cyl(g, 0.05, 3.0, postMat, at(x, 30).x, 1.5, at(x, 30).z, 8);
  const pn = at(290, 30);
  const practiceNet = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.9), new THREE.MeshBasicMaterial({ map: netTexture(14, 5), color: "#d9e2dc", transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  practiceNet.position.set(pn.x, 1.5, pn.z + 0.02);
  g.add(practiceNet);
  box(g, 8.0, 0.04, 0.04, postMat, pn.x, 2.98, pn.z);
  const target = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 32), glow("#ffd23f", 0.8));
  target.position.set(pn.x + 1.6, 1.6, pn.z + 0.05); g.add(target);
  sign(g, "PRACTICE", 2.2, 0.45, { color: "#f1e3b8", font: "800 80px Sora, sans-serif", blur: 8 }, pn.x - 2.2, 2.6, pn.z + 0.06);
  for (const x of GOLF_MATS) {
    const m = at(x, 92);
    box(g, 1.14, 0.025, 1.44, mat("#1b2a20"), m.x, 0.07, m.z);
    box(g, 1.1, 0.03, 1.4, mat("#43c260", { roughness: 1 }), m.x, 0.08, m.z);
    cyl(g, 0.012, 0.05, stick, at(x + GOLF_TEE.dx, 0).x, 0.11, at(0, GOLF_TEE.y).z, 6);
    // Seau de balles devant le golfeur, côté filet : hors de son élan et derrière le club vu de la salle.
    const pail = at(x + 5, 70);
    cyl(g, 0.12, 0.26, mat("#c8452c", { roughness: 0.5 }), pail.x, 0.22, pail.z, 12);
    for (let b = 0; b < 3; b++) { const ball = new THREE.Mesh(ballGeometry, stick); ball.scale.setScalar(0.035); ball.position.set(pail.x - 0.04 + b * 0.04, 0.37, pail.z + (b % 2) * 0.03); g.add(ball); }
  }
  const pro = staff("#c9a86a", GOLF_MATS[4] + GOLF_TEE.dx - GOLF_STANCE.ahead, GOLF_TEE.y + GOLF_STANCE.side, Math.PI / 2);
  holdProp(pro, "iron");
  const rangeBall = new THREE.Mesh(ballGeometry, glow("#ffffff", 0.4));
  rangeBall.scale.setScalar(0.035);
  g.add(rangeBall);
  // Club-house : comptoir, auvent rayé, bouteilles, barman ; deux tables à parasol ; enseigne sur la vitre.
  const cb = at(845, 80), shelfZ = at(0, 22).z;
  box(g, 4.6, 1.05, 0.6, mat("#5a3b26", { roughness: 0.5 }), cb.x, 0.525, cb.z);
  box(g, 4.8, 0.07, 0.75, mat("#e8e0cf", { roughness: 0.3 }), cb.x, 1.08, cb.z);
  box(g, 4.7, 0.02, 0.02, glow("#ffd89b", 1.2), cb.x, 1.02, cb.z + 0.37);
  staff("#e8c27a", 845, 42, 0);
  for (const y of [1.5, 2.0]) {
    box(g, 4.4, 0.04, 0.3, mat("#3a2a1e"), cb.x, y, shelfZ + 0.1);
    for (let k = 0; k < 12; k++) cyl(g, 0.04, 0.26, glow(["#ffb347", "#9bff6b", "#ff6b6b", "#5ce1ff"][(k + y * 2) % 4], 0.5), cb.x - 2 + k * 0.36, y + 0.15, shelfZ + 0.1, 8);
  }
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 1.1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8,
    map: drawnTexture(256, 32, (x, w, h) => { for (let k = 0; k < 16; k++) { x.fillStyle = k % 2 ? "#f4ecd8" : "#2f6b45"; x.fillRect(k * 16, 0, 16, h); } }) }));
  awning.position.set(cb.x, 2.75, cb.z - 0.15);
  awning.rotation.x = -Math.PI / 2 + 0.35;
  g.add(awning);
  sign(g, "CLUB-HOUSE", 3.2, 0.6, { color: "#f1e3b8", font: "700 90px Sora, sans-serif", w: 900, h: 160 }, cb.x, 3.35, shelfZ + 0.02);
  const parasol = mat("#f4ecd8", { side: THREE.DoubleSide, roughness: 0.8 });
  for (const [tx, ty] of GOLF_TABLES) {
    const t = at(tx, ty);
    put(g, "tableRound", t.x, t.z, 0, 2);
    put(g, "chairCushion", at(tx - 45, ty).x, t.z, Math.PI / 2, 2);
    put(g, "chairCushion", at(tx + 45, ty).x, t.z, -Math.PI / 2, 2);
    cyl(g, 0.02, 2.3, mat("#c9ccd6", { metalness: 0.6 }), t.x, 1.15, t.z, 6);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.35, 8, 1, true), parasol);
    canopy.position.set(t.x, 2.3, t.z); g.add(canopy);
    cyl(g, 0.05, 0.15, glow("#9fd67b", 0.4), t.x + 0.12, 0.82, t.z + 0.05, 10);
  }
  // Bancs au bord du green (assise à 0,45 m), côté club-house.
  for (const by of [400, 480]) {
    const b = at(930, by);
    box(g, 0.44, 0.06, 1.3, wood, b.x, 0.42, b.z);
    box(g, 0.06, 0.42, 1.3, wood, b.x + 0.22, 0.72, b.z);
    for (const dz of [-0.55, 0.55]) box(g, 0.4, 0.4, 0.06, postMat, b.x, 0.2, b.z + dz);
  }
  // Voiturette garée devant à droite.
  const cart = new THREE.Group(), cartWhite = mat("#f2f0ea", { roughness: 0.4 }), tire = mat("#1d2226", { roughness: 0.8 });
  cart.position.copy(at(870, 570)); cart.rotation.y = 0.15; g.add(cart);
  box(cart, 2.0, 0.28, 1.0, cartWhite, 0, 0.42, 0);
  box(cart, 0.55, 0.42, 0.95, cartWhite, 0.72, 0.68, 0);
  box(cart, 0.7, 0.12, 0.9, mat("#2b5d3a"), -0.1, 0.66, 0);
  box(cart, 0.12, 0.45, 0.9, mat("#2b5d3a"), -0.48, 0.92, 0);
  for (const [x, z] of [[0.55, 0.45], [0.55, -0.45], [-0.55, 0.45], [-0.55, -0.45]]) box(cart, 0.04, 1.2, 0.04, steelOf(), x, 1.2, z);
  box(cart, 1.5, 0.06, 1.1, cartWhite, 0, 1.82, 0);
  for (const [x, z] of [[0.65, 0.5], [0.65, -0.5], [-0.65, 0.5], [-0.65, -0.5]]) cyl(cart, 0.2, 0.14, tire, x, 0.2, z, 16).rotation.x = Math.PI / 2;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 6, 20), tire);
  wheel.position.set(0.38, 1.0, 0.2); wheel.rotation.set(0, Math.PI / 2, 0.5); cart.add(wheel);
  const bag = cyl(cart, 0.14, 0.8, mat("#8a1c2b", { roughness: 0.5 }), -0.9, 0.9, 0.2, 12);
  bag.rotation.z = 0.25;
  for (let k = 0; k < 3; k++) cyl(cart, 0.012, 0.3, steelOf(), -1.0 + k * 0.04, 1.4, 0.15 + k * 0.05, 5);
  // Plantes le long de la vitre gauche et près des bancs.
  for (const y of [370, 440, 600]) put(g, "pottedPlant", at(28, y).x, at(28, y).z, 0, 2.4);
  for (const y of [345, 535]) put(g, "pottedPlant", at(972, y).x, at(972, y).z, 0, 2.4);
  // Panneau du dernier putt, sur la vitre du fond.
  box(g, 4.25, 1.2, 0.08, mat("#0f2416", { metalness: 0.4 }), at(590, 0).x, 2.7, back + 0.02);
  const board = canvasPanel(g, 4.0, 1.0, 1024, 256, at(590, 0).x, 2.7, back + 0.07);
  const sun = new LightSpot("#fff8e8", 6, 18, 1.4, 1);
  sun.position.set(at(G.cx, 0).x, 4, at(0, G.cy).z);
  g.add(sun);
  f.roomTags = [tag("Practice", 90, 35), tag("Putting green", 255, 345), tag("Club-house", 725, 35)];
  playTarget(f, g, (G.rx * 2 + 28) * S, 0.4, (G.ry * 2 + 22) * S, at(G.cx, G.cy).x, 0.2, at(G.cx, G.cy).z, "golf");
  playTarget(f, g, 8.4, 2.6, 2.4, pn.x, 1.2, at(0, 75).z, "golf");
  // Golfeur du club et sa balle, sur la ligne du trou 2 ; lui se tient de profil, en retrait de la ligne.
  const [hx, hy] = GOLF_HOLES[1];
  const putter = staff("#d9dde8", hx - PUTT_DIST.moyen - GOLF_STANCE.side, hy - GOLF_STANCE.ahead, 0);
  holdProp(putter, "putter");
  const ball = new THREE.Mesh(ballGeometry, glow("#ffffff", 0.45));
  ball.scale.setScalar(0.035);
  g.add(ball);
  f.golf = { flagGeo, flagBase: Float32Array.from(flagGeo.attributes.position.array), water, ripples, duck, pro, putter, ball, board, last: null,
    range: { ball: rangeBall, t: 1, tx: GOLF_MATS[4] + GOLF_TEE.dx, th: 1.5 }, putt: { phase: "rest", t: 0, event: false } };
  planPutt(f.golf, "moyen", true, null, false);
  f.golf.putt.phase = "aim";
  drawGolfBoard(f.golf);
  f.tick = (dt, t, reduced) => tickGolf(f.golf, dt, t, reduced);
}
function steelOf() { return mat("#c9ccd6", { metalness: 0.7, roughness: 0.3 }); }

function planPutt(gf, shot, holed, miss, event) {
  const p = gf.putt, [hx, hy] = GOLF_HOLES[1], off = holed ? [0, 0] : PUTT_MISS[miss] ?? PUTT_MISS["trop court"];
  p.shot = shot; p.holed = holed; p.event = event;
  p.startX = hx - (PUTT_DIST[shot] ?? PUTT_DIST.moyen);
  p.endX = hx + off[0]; p.endY = hy + off[1];
  p.fromX = gf.putter.position.x;
  p.phase = "walk"; p.t = 0;
  gf.ball.visible = true;
  gf.ball.position.set(p.startX * S - 10, 0.11, hy * S - 6.2);
}
// Résultat du serveur : le golfeur se place à la bonne distance et rejoue le putt (ou, sans animation, la balle est posée où elle s'arrête).
function puttResult(gf, r, animate) {
  const shot = PUTT_DIST[r.shot] ? r.shot : "moyen", holed = r.holed === true;
  const miss = holed ? null : PUTT_MISS[r.miss] ? r.miss : "trop court";
  planPutt(gf, shot, holed, miss, true);
  gf.last = { shot, holed, miss };
  if (animate) return; // le panneau s'affiche quand la balle s'arrête
  const p = gf.putt;
  gf.putter.position.x = (p.startX - GOLF_STANCE.side) * S - 10;
  play(gf.putter, "Idle");
  gf.ball.position.set(p.endX * S - 10, 0.11, p.endY * S - 6.2);
  gf.ball.visible = !holed;
  p.phase = "rest"; p.t = 0;
  drawGolfBoard(gf);
}
function tickPutt(gf, dt) {
  const p = gf.putt, golfer = gf.putter, ball = gf.ball, hy = GOLF_HOLES[1][1];
  p.t += dt;
  if (p.phase === "walk") {
    const goal = (p.startX - GOLF_STANCE.side) * S - 10, k = Math.min(1, p.t / 0.9);
    golfer.position.x = p.fromX + (goal - p.fromX) * k;
    const walking = k < 1 && Math.abs(goal - p.fromX) > 0.05;
    play(golfer, walking ? "Walking" : "Idle");
    golfer.rotation.y = walking ? (goal < p.fromX ? -Math.PI / 2 : Math.PI / 2) : 0; // il longe la ligne, puis se met de profil, le trou à sa gauche
    if (k >= 1) { p.phase = "aim"; p.t = 0; }
  } else if (p.phase === "aim") {
    if (p.t > 0.7) { p.phase = "swing"; p.t = 0; play(golfer, "Putt"); }
  } else if (p.phase === "swing") {
    if (p.t > 0.2) { p.phase = "roll"; p.t = 0; } // le club traverse vers le trou : la balle part
  } else if (p.phase === "roll") {
    if (p.t > 0.63 && golfer.userData.anim === "Putt") play(golfer, "Idle");
    const k = Math.min(1, p.t / (0.9 + (p.endX - p.startX) / 140)), e = 1 - (1 - k) ** 2;
    ball.position.set((p.startX + (p.endX - p.startX) * e) * S - 10, 0.11, (hy + (p.endY - hy) * e * e) * S - 6.2);
    if (k >= 1) {
      p.phase = p.holed ? "drop" : "rest"; p.t = 0;
      play(golfer, p.holed ? "Yes" : "No");
      if (p.event) drawGolfBoard(gf);
    }
  } else if (p.phase === "drop") {
    const k = Math.min(1, p.t / 0.25);
    ball.position.y = 0.11 - 0.14 * k;
    if (k >= 1) { ball.visible = false; p.phase = "rest"; p.t = 0; }
  } else if (p.phase === "rest") {
    if (p.t > 1.7) play(golfer, "Idle");
    if (p.t > (p.event ? 4.5 : 2.2)) {
      const misses = Object.keys(PUTT_MISS);
      planPutt(gf, "moyen", Math.random() < 0.7, misses[Math.floor(Math.random() * misses.length)], false);
    }
  }
}
function tickRange(gf, dt) {
  const r = gf.range, tee = GOLF_TEE.y, x0 = GOLF_MATS[4] + GOLF_TEE.dx;
  r.t += dt;
  if (r.t >= 3.4) { r.t = 0; r.tx = x0 + (Math.random() - 0.5) * 120; r.th = 1.1 + Math.random() * 1.4; play(gf.pro, "Punch"); }
  else if (r.t > 0.83) play(gf.pro, "Idle");
  // Le fer traverse vers le filet : la balle s'envole, retombe au pied du filet, puis une nouvelle attend sur le tee.
  const k = r.t - 0.2;
  let X = x0, Y = tee, H = 0.11;
  if (k > 0 && k < 0.55) { const u = k / 0.55; X = x0 + (r.tx - x0) * u; Y = tee + (34 - tee) * u; H = 0.11 + (r.th - 0.11) * u + 3.2 * u * (1 - u); }
  else if (k >= 0.55 && k < 1.6) { const u = Math.min(1, (k - 0.55) / 0.5); X = r.tx; Y = 36 + u * 4; H = r.th + (0.11 - r.th) * u; }
  r.ball.position.set(X * S - 10, H, Y * S - 6.2);
}
function tickGolf(gf, dt, t, reduced) {
  if (reduced) return;
  const pos = gf.flagGeo.attributes.position, base = gf.flagBase;
  for (let i = 0; i < pos.count; i++) { const x = base[i * 3]; pos.array[i * 3 + 2] = Math.sin(x * 9 - t * 6) * 0.05 * (x / 0.44); }
  pos.needsUpdate = true;
  gf.water.emissiveIntensity = 0.55 + Math.sin(t * 1.3) * 0.12;
  for (const ring of gf.ripples) {
    const k = mod1(t / 2.6 + ring.userData.phase);
    ring.scale.set(0.05 + k * 0.5, 1, 0.05 + k * 0.5);
    ring.material.opacity = 0.45 * (1 - k);
  }
  const a = t * 0.12, W = GOLF_POND;
  gf.duck.position.set((W.cx + Math.cos(a) * W.rx * 0.5) * S - 10, 0.075, (W.cy + Math.sin(a) * W.ry * 0.45) * S - 6.2);
  gf.duck.rotation.y = Math.atan2(-Math.sin(a) * W.rx, Math.cos(a) * W.ry);
  tickPutt(gf, dt);
  tickRange(gf, dt);
}
function drawGolfBoard(gf) {
  const p = gf.board, l = gf.last;
  const title = l ? (l.holed ? "DANS LE TROU !" : "RATÉ DE PEU") : "PUTTING GREEN";
  const line = l ? `${PUTT_NAMES[l.shot]}${l.holed ? "" : " · " + l.miss}` : "Putts de 1 m, 4 m ou 12 m";
  const key = `${title}|${line}`;
  if (key === p.key) return;
  p.key = key;
  const x = p.ctx, W = p.w, H = p.h;
  x.fillStyle = "#0c2414"; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#e9c46a"; x.lineWidth = 6; x.strokeRect(6, 6, W - 12, H - 12);
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillStyle = l && !l.holed ? "#ffb4a8" : "#ffd76a"; x.font = "800 82px Sora, sans-serif"; x.fillText(title, W / 2, 92, W - 60);
  x.fillStyle = "#e3f2e6"; x.font = "600 46px Sora, sans-serif"; x.fillText(line, W / 2, 184, W - 60);
  p.tex.needsUpdate = true;
}

export { buildGolf, puttResult };
