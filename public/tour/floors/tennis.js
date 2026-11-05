// Tennis : court en terre battue, tribunes, échanges et matchs rejoués d’après le serveur.

import * as THREE from "three";
import { P, S, TENNIS_COURT, TENNIS_NPCS, TENNIS_ROWS, TENNIS_SEATS } from "../base.js";
import { LightSpot, box, cyl, glow, mat, sign } from "../engine.js";
import { ballGeometry, canvasPanel, discGeometry, drawnTexture, playTarget } from "../kit.js";
import { holdProp, play } from "../robots.js";
import { put } from "./shell.js";
import { netTexture } from "./shared.js";

// ---------- Tennis ----------
// Court en terre battue devant (filet en x = 500), chaise d'arbitre côté allée, tribunes à trois rangs au fond,
// tableau de score sur la vitre. Deux joueurs du club échangent sans fin ; un set joué au dialogue est rejoué jeu par jeu.
function buildTennis(f, g, { at, tag, staff, back }) {
  const C = TENNIS_COURT, mid = (C.y0 + C.y1) / 2;
  const slab = (x0, y0, x1, y1, m, top) => { const a = P(x0, y0), b = P(x1, y1); return box(g, b.x - a.x, 0.02, b.z - a.z, m, (a.x + b.x) / 2, top - 0.01, (a.z + b.z) / 2); };
  // Terre battue : un grain dessiné une fois ; l'aire de jeu est un ton plus clair que les dégagements.
  const clay = drawnTexture(128, 128, x => {
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 1400; k++) { const v = 200 + Math.random() * 55; x.fillStyle = `rgb(${v},${v * 0.9 | 0},${v * 0.84 | 0})`; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  });
  clay.wrapS = clay.wrapT = THREE.RepeatWrapping;
  clay.repeat.set(8, 3);
  slab(20, 285, 980, 338, mat("#34443b"), 0.066);
  slab(125, 345, 875, 608, new THREE.MeshStandardMaterial({ map: clay, color: "#b4552e", roughness: 0.95 }), 0.07);
  slab(C.x0, C.y0, C.x1, C.y1, new THREE.MeshStandardMaterial({ map: clay, color: "#d26d3e", roughness: 0.95 }), 0.074);
  const white = mat("#f4efe6", { roughness: 0.6 }), lw = 2.5;
  const line = (x0, y0, x1, y1) => slab(x0 - (x0 === x1) * lw / 2, y0 - (y0 === y1) * lw / 2, x1 + (x0 === x1) * lw / 2, y1 + (y0 === y1) * lw / 2, white, 0.08);
  const s0 = C.y0 + 26, s1 = C.y1 - 26;
  for (const y of [C.y0, C.y1, s0, s1]) line(C.x0, y, C.x1, y);
  for (const x of [C.x0, C.x1]) line(x, C.y0, x, C.y1);
  for (const x of [340, 660]) line(x, s0, x, s1);
  line(340, mid, 660, mid);
  line(C.x0, mid, C.x0 + 8, mid);
  line(C.x1 - 8, mid, C.x1, mid);
  // Filet : maille transparente, bande blanche, sangle centrale et poteaux.
  const n = at(500, mid), netLen = (C.y1 - C.y0 + 24) * S;
  const net = new THREE.Mesh(new THREE.PlaneGeometry(netLen, 0.82), new THREE.MeshBasicMaterial({ map: netTexture(netLen / 0.6, 1.4), color: "#dfe5e1", transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  net.position.set(n.x, 0.5, n.z);
  net.rotation.y = Math.PI / 2;
  g.add(net);
  box(g, 0.035, 0.06, netLen, white, n.x, 0.92, n.z);
  box(g, 0.03, 0.82, 0.05, white, n.x, 0.5, n.z);
  for (const y of [C.y0 - 12, C.y1 + 12]) cyl(g, 0.045, 1.0, mat("#1d3b2a", { metalness: 0.5, roughness: 0.4 }), at(500, y).x, 0.5, at(500, y).z, 10);
  // Chaise d'arbitre au filet, côté allée (l'échelle au dos) ; l'arbitre y est assis.
  const u = at(500, 340), green = mat("#1f4d36", { roughness: 0.6 }), steel = mat("#dfe5e1", { metalness: 0.5, roughness: 0.35 });
  for (const dx of [-0.28, 0.28]) for (const dz of [-0.24, 0.24]) cyl(g, 0.03, 1.5, steel, u.x + dx, 0.75, u.z + dz, 8);
  box(g, 0.7, 0.06, 0.6, green, u.x, 1.5, u.z);
  box(g, 0.52, 0.08, 0.46, green, u.x, 1.58, u.z);
  box(g, 0.52, 0.55, 0.06, green, u.x, 1.9, u.z - 0.24);
  for (const dx of [-0.27, 0.27]) box(g, 0.05, 0.22, 0.46, green, u.x + dx, 1.73, u.z);
  box(g, 0.6, 0.04, 0.1, steel, u.x, 1.05, u.z + 0.32);
  for (let k = 0; k < 5; k++) box(g, 0.5, 0.03, 0.03, steel, u.x, 0.25 + k * 0.28, u.z - 0.27);
  staff("#f4efe6", 500, 350, 0, "Sitting", 1.38);
  // Tribunes : deux marches (les rangs 2 et 3), un banc par section et par rang, sièges violet et vert, nez de marche lumineux.
  const stepMat = mat("#2c5a46", { roughness: 0.7 }), nose = glow("#7ee0b0", 0.6), benchMat = mat("#273038", { roughness: 0.5 });
  const seatMats = [mat("#5b2a86", { roughness: 0.5 }), mat("#1f6b3a", { roughness: 0.5 }), mat("#5b2a86", { roughness: 0.5 })];
  TENNIS_ROWS.forEach(({ bench: by, floor }, k) => {
    if (floor) {
      const a = at(500, by - 15), b = at(500, by + 35);
      box(g, 14.2, floor, b.z - a.z, stepMat, 0, floor / 2, (a.z + b.z) / 2);
      box(g, 14.2, 0.025, 0.03, nose, 0, floor - 0.005, b.z + 0.005);
    }
    for (const [x0, x1] of [[185, 465], [535, 815]]) box(g, (x1 - x0) * S, 0.42, 0.44, benchMat, at((x0 + x1) / 2, by).x, floor + 0.21, at(0, by).z);
    for (const sx of TENNIS_SEATS) {
      const s = at(sx, by);
      box(g, 0.56, 0.05, 0.42, seatMats[k], s.x, floor + 0.445, s.z);
      box(g, 0.56, 0.42, 0.05, seatMats[k], s.x, floor + 0.68, s.z - 0.21);
    }
  });
  box(g, 14.2, 1.8, 0.1, mat("#173328"), 0, 0.9, at(0, 117).z);
  for (const x of [325, 675]) {
    sign(g, "PENTHOUSE OPEN", 3.2, 0.3, { color: "#f1e3b8", font: "800 70px Sora, sans-serif", blur: 6, w: 1024, h: 96 }, at(x, 0).x, 0.18, at(0, 225).z + 0.01);
    sign(g, "COURT CENTRAL", 3.2, 0.3, { color: "#7ee0b0", font: "800 70px Sora, sans-serif", blur: 6, w: 1024, h: 96 }, at(x, 0).x, 0.53, at(0, 175).z + 0.01);
  }
  // Tableau de score sur la vitre, au-dessus des tribunes.
  box(g, 5.5, 1.75, 0.1, mat("#0d1a14", { metalness: 0.4 }), 0, 3.0, back + 0.02);
  const board = canvasPanel(g, 5.2, 1.5, 1024, 296, 0, 3.0, back + 0.08);
  // Projecteurs sur mâts, tournés vers le court, et une lumière blanche au-dessus du jeu.
  const poleMat = mat("#3a4a42", { metalness: 0.6, roughness: 0.35 }), headMat = mat("#1e2622");
  for (const [x, y] of [[115, 612], [885, 612], [150, 100], [850, 100]]) {
    const p = at(x, y), head = new THREE.Group();
    cyl(g, 0.07, 4.2, poleMat, p.x, 2.1, p.z, 8);
    head.position.set(p.x, 4.25, p.z);
    head.rotation.y = Math.atan2(-p.x, at(0, mid).z - p.z);
    g.add(head);
    box(head, 0.9, 0.42, 0.16, headMat, 0, 0, 0);
    box(head, 0.82, 0.34, 0.02, glow("#f3f6ff", 2.2), 0, 0, 0.09);
  }
  const lamp = new LightSpot("#fff4e0", 9, 20, 1.4, 1);
  lamp.position.set(0, 4.2, at(0, mid).z);
  g.add(lamp);
  // Une rangée de plantes de chaque côté du court, deux au fond.
  for (const y of [380, 450, 520, 590]) put(g, "pottedPlant", at(45, y).x, at(45, y).z, 0, 2.4);
  for (const y of [360, 430, 500, 570]) put(g, "pottedPlant", at(955, y).x, at(955, y).z, 0, 2.4);
  for (const x of [60, 940]) put(g, "pottedPlant", at(x, 60).x, at(x, 60).z, 0, 2.6);
  f.roomTags = [tag("Court central", 125, 345), tag("Tribunes", 150, 125)];
  // Les deux joueurs du club, la balle et son ombre.
  const players = TENNIS_NPCS.map(([x, y], k) => {
    const p = staff(k ? "#2fb898" : "#e0814f", x, y, k ? -Math.PI / 2 : Math.PI / 2);
    holdProp(p, "racket", k ? 0.3 : 0);
    p.userData.court = { X: x, Y: y, goal: y, swing: 0, cheer: "Idle", cheerT: 0 };
    return p;
  });
  const ball = new THREE.Mesh(ballGeometry, glow("#d8f53a", 0.9));
  ball.scale.setScalar(0.05);
  g.add(ball);
  const shadow = new THREE.Mesh(discGeometry, new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.scale.set(0.06, 1, 0.06);
  shadow.position.y = 0.083;
  g.add(shadow);
  playTarget(f, g, 15, 0.4, 5.3, 0, 0.2, at(0, 476).z, "tennis");
  f.tennis = { players, ball, shadow, board, shot: { t: 0, T: 1, hitter: 0, winner: false, swung: false, toss: false }, pause: 0.8, serve: 0, left: -1, match: null, last: null };
  drawTennisBoard(f.tennis);
  f.tick = (dt, t, reduced) => tickTennis(f.tennis, dt, reduced);
}

// Un coup : du frappeur au rebond chez l'adversaire, puis jusqu'à la raquette de celui-ci (ou au fond du court pour un coup gagnant).
function tennisShot(tn, hitter, winner) {
  const s = tn.shot, dir = hitter ? -1 : 1, hp = tn.players[hitter].userData.court, rp = tn.players[1 - hitter].userData.court;
  s.hitter = hitter; s.winner = winner; s.t = 0; s.T = tn.match ? 0.95 : 1.3; s.swung = false;
  s.ax = hp.X + dir * 18; s.ay = hp.Y + 6;
  s.bx = 500 + dir * (winner ? 200 + Math.random() * 60 : 70 + Math.random() * 190);
  s.by = winner ? (rp.Y > 485 ? 410 + Math.random() * 40 : 520 + Math.random() * 40) : 405 + Math.random() * 160;
  s.cy = Math.min(575, Math.max(395, s.by + (Math.random() - 0.5) * 40));
  s.cx = winner ? 500 + dir * 370 : rp.X - dir * 18;
  s.ch = winner ? 0.1 : 0.85;
  rp.goal = winner ? rp.Y + (s.cy - rp.Y) * 0.35 : s.cy - 6;
  hp.goal = 485 + (Math.random() - 0.5) * 50;
}
// Un point : pendant un set rejoué, le gagnant du jeu sert et finit par le coup gagnant (1 ou 3 coups) ; sinon échange libre.
function tennisPoint(tn) {
  const m = tn.match;
  let server;
  if (m && m.k < m.games.length) { server = m.games[m.k] === "toi" ? 0 : 1; tn.left = Math.random() < 0.35 ? 1 : 3; }
  else { server = tn.serve = 1 - tn.serve; tn.left = -1; }
  tennisShot(tn, server, tn.left === 1);
  tn.shot.t = -0.9; // lancer de balle, puis le geste : la balle part en son milieu (voir tickTennis)
  tn.shot.toss = true;
}
function tennisPointOver(tn) {
  const m = tn.match;
  tn.pause = 1.2;
  for (const p of tn.players) p.userData.court.goal = 485;
  if (!m || m.done || m.k >= m.games.length) return;
  if (m.games[m.k] === "toi") m.toi++; else m.pro++;
  m.k++;
  if (m.k >= m.games.length) {
    m.done = true;
    tn.pause = 4.5;
    tn.players.forEach((p, i) => Object.assign(p.userData.court, { cheer: (i === 0) === m.won ? "Yes" : "No", cheerT: 2.6 }));
  }
  drawTennisBoard(tn);
}
function startTennisMatch(tn, r, animate) {
  const games = (Array.isArray(r.games) ? r.games : []).filter(x => x === "toi" || x === "pro").slice(0, 13);
  const score = Array.isArray(r.score) ? [Number(r.score[0]) || 0, Number(r.score[1]) || 0]
    : [games.filter(x => x === "toi").length, games.filter(x => x === "pro").length];
  const won = typeof r.won === "boolean" ? r.won : score[0] > score[1];
  if (!animate || !games.length) { tn.match = null; tn.last = { score, won, games }; drawTennisBoard(tn); return; }
  tn.match = { games, k: 0, toi: 0, pro: 0, score, won, done: false };
  tn.pause = 0.6;
  for (const p of tn.players) Object.assign(p.userData.court, { goal: 485, cheerT: 0 });
  drawTennisBoard(tn);
}
function tickTennis(tn, dt, reduced) {
  tn.ball.visible = tn.shadow.visible = !reduced;
  if (reduced) { for (const p of tn.players) play(p, "Idle"); return; }
  const s = tn.shot;
  if (tn.pause > 0) {
    tn.pause -= dt;
    if (tn.pause <= 0) {
      if (tn.match?.done) { tn.last = { score: tn.match.score, won: tn.match.won, games: tn.match.games }; tn.match = null; drawTennisBoard(tn); }
      tennisPoint(tn);
    }
  } else {
    s.t += dt;
    if (s.toss && s.t >= -0.35) { s.toss = false; tn.players[s.hitter].userData.court.swing = 0.83; }
    const k = Math.max(0, s.t) / s.T, kb = 0.62;
    let X, Y, H;
    if (s.t < 0) {
      // Service : la balle monte devant le serveur et redescend à hauteur de frappe.
      const v = (s.t + 0.9) / 0.9;
      X = s.ax; Y = s.ay; H = 0.35 + 0.5 * v + 1.6 * v * (1 - v);
    } else if (k < kb) {
      const v = k / kb;
      X = s.ax + (s.bx - s.ax) * v; Y = s.ay + (s.by - s.ay) * v; H = 0.85 * (1 - v) + 0.09 * v + 4.2 * v * (1 - v);
    } else {
      const v = Math.min(1, (k - kb) / (1 - kb));
      X = s.bx + (s.cx - s.bx) * v; Y = s.by + (s.cy - s.by) * v; H = 0.09 * (1 - v) + s.ch * v + (s.winner ? 1.2 : 2.2) * v * (1 - v);
    }
    tn.ball.position.set(X * S - 10, Math.max(0.09, H), Y * S - 6.2);
    tn.shadow.position.set(X * S - 10, 0.083, Y * S - 6.2);
    if (!s.winner && !s.swung && s.T - s.t < 0.4) { s.swung = true; tn.players[1 - s.hitter].userData.court.swing = 0.83; }
    if (s.t >= s.T) {
      if (s.winner) tennisPointOver(tn);
      else {
        if (tn.left > 0) tn.left--;
        tennisShot(tn, 1 - s.hitter, tn.left === 1 || (tn.left < 0 && Math.random() < 0.12));
      }
    }
  }
  // Les joueurs suivent la balle le long de leur ligne de fond : coup au contact, course, joie ou dépit à la fin du set.
  for (const p of tn.players) {
    const d = p.userData.court, gap = d.goal - d.Y;
    d.Y += Math.sign(gap) * Math.min(Math.abs(gap), dt * 160);
    p.position.z = d.Y * S - 6.2;
    if (d.swing > 0) d.swing -= dt;
    if (d.cheerT > 0) d.cheerT -= dt;
    play(p, d.cheerT > 0 ? d.cheer : d.swing > 0 ? "Punch" : Math.abs(gap) > 8 ? "Running" : "Idle");
  }
}
function drawTennisBoard(tn) {
  const p = tn.board, m = tn.match, last = tn.last;
  const toi = m ? m.toi : last ? last.score[0] : 0, pro = m ? m.pro : last ? last.score[1] : 0;
  const games = m ? m.games.slice(0, m.k) : last?.games ?? [];
  const status = m ? (m.done ? (m.won ? "VICTOIRE !" : "DÉFAITE") : `SET EN COURS · JEU ${Math.min(m.k + 1, m.games.length)}`)
    : last ? `DERNIER SET · ${last.won ? "VICTOIRE" : "DÉFAITE"}` : "ENTRAÎNEMENT";
  const key = `${toi}|${pro}|${status}|${games.join("")}`;
  if (key === p.key) return;
  p.key = key;
  const x = p.ctx, W = p.w, H = p.h;
  x.fillStyle = "#0b241a"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#13392a"; x.fillRect(0, 0, W, 70);
  x.textBaseline = "middle";
  x.font = "700 38px Sora, sans-serif"; x.textAlign = "left"; x.fillStyle = "#cfe8d6"; x.fillText("COURT CENTRAL", 34, 36);
  x.textAlign = "right"; x.fillStyle = m?.done && !m.won ? "#ff9a9a" : "#ffd84a"; x.fillText(status, W - 34, 36, 600);
  [["TOI", toi, "#e0814f", "toi"], ["PRO", pro, "#2fb898", "pro"]].forEach(([name, value, color, id], i) => {
    const y = 125 + i * 100;
    x.fillStyle = color; x.fillRect(34, y - 32, 14, 64);
    x.textAlign = "left"; x.fillStyle = "#f4f7f5"; x.font = "800 62px Sora, sans-serif"; x.fillText(name, 68, y + 2);
    games.forEach((w, j) => { x.fillStyle = w === id ? color : "#1c3a2c"; x.fillRect(250 + j * 46, y - 17, 36, 34); });
    x.textAlign = "right"; x.fillStyle = "#ffd84a"; x.font = "900 86px Sora, sans-serif"; x.fillText(String(value), W - 40, y + 4);
  });
  x.fillStyle = "#1f4d36"; x.fillRect(34, 173, W - 68, 3);
  p.tex.needsUpdate = true;
}

export { buildTennis, startTennisMatch };
