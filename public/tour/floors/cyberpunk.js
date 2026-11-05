// Ambiance cyberpunk : néons, grille au sol, salle serveurs, borne d’arcade, drone BYTE et écrans du résident.

import * as THREE from "three";
import { world } from "../state.js";
import { BOSS, LANE, OPEN, P, S, STATE_COLOR, quotaRemaining, stateOf } from "../base.js";
import { LightSpot, box, boxGeometry, cyl, glow, label, live, mat, sign } from "../engine.js";
import { reducedMotion } from "../kit.js";

// ---------- ambiance cyberpunk ----------
// Néons magenta et cyan, sol à grille, salle serveurs, borne d'arcade et hologramme ; les écrans affichent les textes du résident.
const CYBER = { floor: "#07060f", open: "#0d0b1c", boss: "#150c24", pink: "#ff2bd6", cyan: "#00e5ff", violet: "#8b5cff" };
const screenTexts = a => {
  const own = a.profile?.screens?.length ? a.profile.screens : [a.name];
  return [0, 1, 2].map(k => own[k % own.length]);
};

// Écran néon : fond quadrillé, texte principal, sous-titre et barres d'activité décoratives.
function neonScreen(c, text, k) {
  const ctx = c.getContext("2d"), { width: w, height: h } = c, color = [CYBER.pink, CYBER.cyan, CYBER.violet][k % 3];
  ctx.fillStyle = "#08061a"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#1f1747"; ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let size = Math.round(h * 0.26);
  ctx.font = `700 ${size}px Sora, sans-serif`;
  while (size > 24 && ctx.measureText(text.toUpperCase()).width > w * 0.84) ctx.font = `700 ${size -= 6}px Sora, sans-serif`;
  ctx.shadowColor = color; ctx.shadowBlur = 36; ctx.fillStyle = color;
  ctx.fillText(text.toUpperCase(), w / 2, h * 0.42);
  ctx.shadowBlur = 0; ctx.fillStyle = "#cfd8ff"; ctx.font = `500 ${Math.round(h * 0.06)}px monospace`;
  ctx.fillText(["> EN LIGNE", "> AGENTS ACTIFS", "> SYSTÈME OK"][k % 3], w / 2, h * 0.66);
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 4 ? color : "#ffffff"; ctx.globalAlpha = 0.55;
    const bar = 18 + (i * 37 + k * 11) % 70;
    ctx.fillRect(w * 0.1 + i * w * 0.045, h * 0.9 - bar, w * 0.03, bar);
  }
  ctx.globalAlpha = 1; ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
}

// BYTE, le drone de l'étage : il patrouille, parle, et file chez le résident quand un agent attend son accord.
const BYTE_LINES = [
  "Bip boup. Café détecté ☕", "git commit -m \"ça marche chez moi\"", "Nouvelle commande TikTok Shop 📦",
  "toksy.fr en orbite 🚀", "Scan terminé : 0 bug. Pour l'instant.", "404 : sommeil introuvable",
  "Ctrl+S. Toujours. Ctrl+S.", "Qui a laissé un console.log ici ?", "Psst… tape « toksy » 😏",
  "Pixel dort encore sur le serveur 🐈", "Je ne suis pas un bug, je suis une feature", "Encore un colis expédié 📦✨",
];
// Mode secret : taper « toksy » hors d'un champ lance 12 s d'overdrive sur les étages cyberpunk.
let overdriveUntil = 0, typed = "";
addEventListener("keydown", e => {
  if (e.target.closest?.("input, select, textarea, dialog") || e.key.length !== 1) return;
  typed = (typed + e.key.toLowerCase()).slice(-5);
  if (typed === "toksy") overdriveUntil = performance.now() / 1000 + 12;
});
const noise = x => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
const canvasTexture = (w, h) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  return { c, ctx: c.getContext("2d"), texture };
};
const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

// Visage de BYTE : yeux ronds au calme, ^^ en fête, barres rouges en alerte, trait fermé quand il cligne.
function drawFace(face, mood, blink) {
  const { ctx } = face, color = mood === "alerte" ? "#ff3b5c" : mood === "fete" ? "#ffe066" : CYBER.cyan;
  ctx.fillStyle = "#05030f"; ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.shadowColor = color; ctx.shadowBlur = 12;
  for (const x of [40, 88]) {
    if (blink) ctx.fillRect(x - 12, 30, 24, 4);
    else if (mood === "fete") { ctx.beginPath(); ctx.arc(x, 40, 11, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
    else if (mood === "alerte") ctx.fillRect(x - 8, 16, 16, 30);
    else { ctx.beginPath(); ctx.ellipse(x, 32, 9, 13, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.shadowBlur = 0; face.texture.needsUpdate = true;
}

// Démo de la borne d'arcade : un serpent qui joue tout seul vers la pomme la plus proche.
const newSnake = best => ({ body: [[4, 6], [3, 6], [2, 6]], dir: [1, 0], apple: [11, 4], score: 0, best: best ?? 0 });
function stepSnake(s) {
  const [hx, hy] = s.body[0], [ax, ay] = s.apple;
  const free = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 12 && !s.body.some(([bx, by]) => bx === x && by === y);
  const options = [[1, 0], [0, 1], [-1, 0], [0, -1]].filter(([dx, dy]) => dx !== -s.dir[0] || dy !== -s.dir[1])
    .map(d => ({ d, x: hx + d[0], y: hy + d[1] })).filter(o => free(o.x, o.y))
    .sort((a, b) => Math.abs(a.x - ax) + Math.abs(a.y - ay) - Math.abs(b.x - ax) - Math.abs(b.y - ay));
  if (!options.length) return newSnake(Math.max(s.best, s.score));
  const pick = options.length > 1 && Math.random() < 0.08 ? options[1] : options[0];
  s.dir = pick.d; s.body.unshift([pick.x, pick.y]);
  if (pick.x === ax && pick.y === ay) {
    s.score += 10;
    do s.apple = [Math.floor(Math.random() * 16), Math.floor(Math.random() * 12)]; while (s.body.some(([bx, by]) => bx === s.apple[0] && by === s.apple[1]));
  } else s.body.pop();
  return s;
}
function drawSnake(screen, s) {
  const { ctx } = screen;
  ctx.fillStyle = "#06041a"; ctx.fillRect(0, 0, 256, 192);
  ctx.fillStyle = "#140f33"; for (let x = 0; x < 16; x++) for (let y = 0; y < 12; y++) ctx.fillRect(x * 16 + 7, y * 16 + 7, 2, 2);
  ctx.shadowBlur = 10; ctx.shadowColor = ctx.fillStyle = CYBER.pink; ctx.fillRect(s.apple[0] * 16 + 3, s.apple[1] * 16 + 3, 10, 10);
  s.body.forEach(([x, y], k) => { ctx.shadowColor = ctx.fillStyle = k ? CYBER.cyan : "#ffffff"; ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14); });
  ctx.shadowBlur = 0; ctx.fillStyle = "#ffe066"; ctx.font = "bold 13px monospace";
  ctx.fillText(`SCORE ${String(s.score).padStart(4, "0")}`, 6, 186); ctx.fillText(`HI ${String(s.best).padStart(4, "0")}`, 180, 186);
  screen.texture.needsUpdate = true;
}

// Écrans du bureau en direct : agents à gauche, marque et compteur de colis au centre, quotas à droite.
function drawBossScreen(screen, a, now, fx, texts) {
  const { c, k } = screen, ctx = c.getContext("2d"), { width: w, height: h } = c;
  if (k === 1) {
    // Le fond néon (texte, halo, barres) est dessiné une fois puis recopié : seuls l'heure et le compteur changent.
    if (!screen.base) { screen.base = document.createElement("canvas"); screen.base.width = w; screen.base.height = h; neonScreen(screen.base, texts[0], 1); }
    ctx.drawImage(screen.base, 0, 0);
    ctx.fillStyle = "#08061a"; ctx.fillRect(40, 30, w - 80, 70);
    ctx.fillStyle = "#cfd8ff"; ctx.font = "600 44px monospace"; ctx.textAlign = "center";
    ctx.fillText(new Date().toLocaleTimeString("fr-FR"), w / 2, 82);
    ctx.fillStyle = CYBER.pink; ctx.font = "700 36px monospace";
    ctx.fillText(`COLIS EXPÉDIÉS · ${fx.shipped}`, w / 2, h * 0.79); ctx.textAlign = "start";
  } else {
    ctx.fillStyle = "#08061a"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = k ? CYBER.violet : CYBER.cyan; ctx.lineWidth = 6; ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = "#cfd8ff"; ctx.font = "700 44px Sora, sans-serif"; ctx.fillText(k ? "QUOTAS" : "AGENTS · LIVE", 48, 78);
    const rows = k ? [["Claude 5 h", a?.usage?.claude?.five_hour], ["Claude semaine", a?.usage?.claude?.seven_day],
      ["ChatGPT 5 h", a?.usage?.chatgpt?.five_hour], ["ChatGPT semaine", a?.usage?.chatgpt?.seven_day]]
      .map(([name, win]) => { const left = win ? quotaRemaining(win, now) : null; return [name, left, left === null ? "—" : left + " %", left !== null && left <= 20 ? "#ff3b5c" : CYBER.violet]; })
      : [["au travail", "travaille", STATE_COLOR.travaille], ["attend ton accord", "autorisation", STATE_COLOR.autorisation],
        ["attend la suite", "attend", STATE_COLOR.attend], ["en pause", "fini", STATE_COLOR.fini]]
        .map(([name, st, color]) => { const n = (a?.sessions ?? []).filter(s => stateOf(s, now) === st).length; return [name, Math.min(100, n * 25), String(n), color]; });
    // Agents et quotas : redessinés (et renvoyés à la carte graphique) seulement quand un chiffre change.
    const key = JSON.stringify(rows);
    if (key === screen.key) return;
    screen.key = key;
    rows.forEach(([name, pct, value, color], r) => {
      const y = 150 + r * 110;
      ctx.fillStyle = "#8f9bd0"; ctx.font = "500 32px Sora, sans-serif"; ctx.fillText(name, 48, y);
      ctx.fillStyle = color; ctx.font = "700 40px monospace"; ctx.textAlign = "end"; ctx.fillText(value, w - 48, y); ctx.textAlign = "start";
      ctx.fillStyle = "#1a1540"; ctx.fillRect(48, y + 18, w - 96, 22);
      ctx.shadowColor = ctx.fillStyle = color; ctx.shadowBlur = 16; ctx.fillRect(48, y + 18, (w - 96) * (pct ?? 0) / 100, 22); ctx.shadowBlur = 0;
    });
  }
  screen.texture.needsUpdate = true;
}

function cyberpunk(f, apt) {
  const g = f.group, { pink, cyan, violet } = CYBER, texts = screenTexts(apt);
  const center = P(OPEN.x + OPEN.w / 2, LANE), m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), color = new THREE.Color();
  const cyanC = new THREE.Color(cyan), violetC = new THREE.Color(violet), pinkC = new THREE.Color(pink);
  const fx = { waves: [0], sessions: new Map(), primed: false, shipped: 0, mood: "calme", moodUntil: 0, said: -99, bubbleUntil: 0,
    meowUntil: 0, nextData: 0, nextRain: 0, nextSnake: 0, nextLeds: 0, nextBoss: 0, nextWave: 0, burstAt: -99, face: "", alert: false, working: 0 };

  // Grille lumineuse au sol : une instance par ligne ; des ondes partent de l'hologramme et la parcourent.
  const grid = [];
  for (let x = OPEN.x + 40; x < OPEN.x + OPEN.w; x += 80) grid.push({ d: Math.abs(P(x, 0).x - center.x), pos: P(x, OPEN.y + OPEN.h / 2, 0.075), size: new THREE.Vector3(0.03, 0.01, OPEN.h * S - 0.2) });
  for (let y = OPEN.y + 40; y < OPEN.y + OPEN.h; y += 80) grid.push({ d: Math.abs(P(0, y).z - center.z), pos: P(OPEN.x + OPEN.w / 2, y, 0.075), size: new THREE.Vector3(OPEN.w * S - 0.2, 0.01, 0.03) });
  const lines = new THREE.InstancedMesh(boxGeometry, new THREE.MeshBasicMaterial({ toneMapped: false }), grid.length);
  grid.forEach((l, k) => { lines.setMatrixAt(k, m4.compose(l.pos, q0, l.size)); lines.setColorAt(k, violetC); });
  g.add(lines);
  // Tubes néon le long de la façade et des cloisons, magenta en haut, cyan en bas.
  box(g, 20.4, 0.05, 0.05, glow(pink, 2.2), 0, 4.55, -6.4);
  box(g, 20.4, 0.05, 0.05, glow(cyan, 2), 0, 0.12, -6.4);
  for (const x of [-10.3, 10.3]) {
    box(g, 0.05, 0.05, 12.6, glow(pink, 2.2), x, 4.55, 0);
    box(g, 0.05, 0.05, 12.6, glow(cyan, 2), x, 0.12, 0);
  }
  for (const x of [OPEN.x + OPEN.w, BOSS.x]) box(g, 0.04, 0.04, OPEN.h * S, glow(cyan, 1.6), P(x, 0).x, 1.08, P(0, OPEN.y + OPEN.h / 2).z);
  // Enseignes néon des projets du résident, sur la vitre du fond ; la première grésille de temps en temps.
  const signs = texts.slice(0, 2).map((text, k) => {
    const x = P(OPEN.x + OPEN.w * (k ? 0.72 : 0.28), 0).x, tint = k ? cyan : pink;
    box(g, 5.1, 1.05, 0.04, mat("#0b0918"), x, 2.0, -6.44);
    box(g, 5.1, 0.03, 0.03, glow(tint, 1.6), x, 1.46, -6.41);
    return sign(g, text.toUpperCase(), 5, 1, { color: tint, font: "700 160px Sora, sans-serif", w: 1024, h: 205, blur: 26 }, x, 2.0, -6.41);
  });
  // Pluie de données sur la vitre ouest, de part et d'autre de l'ascenseur.
  const rain = canvasTexture(128, 256), drops = Array.from({ length: 16 }, () => Math.random() * -32);
  const rainM = new THREE.MeshBasicMaterial({ map: rain.texture, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (const z of f.tv ? [3.4] : [-3.4, 3.4]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.8), rainM);
    panel.position.set(-10.3, 2.3, z); panel.rotation.y = Math.PI / 2; g.add(panel);
  }
  // Écrans des postes : le texte du résident au repos, cyan vif quand un agent travaille.
  const idle = canvasTexture(256, 160);
  neonScreen(idle.c, texts[0], 0);
  f.idleScreen = new THREE.MeshBasicMaterial({ map: idle.texture });
  f.busyScreen = glow(cyan, 1.8);

  // Baies serveurs contre la cloison ouest : leurs diodes clignotent plus vite quand les agents travaillent.
  const leds = [];
  for (const [y, k] of [[520, 0], [440, 1]]) {
    const p = P(48, y);
    box(g, 0.6, 2.1, 0.9, mat("#0e0d1a", { metalness: 0.6, roughness: 0.4 }), p.x, 1.05, p.z);
    box(g, 0.02, 1.9, 0.8, mat("#16142b"), p.x + 0.31, 1.05, p.z);
    for (let r = 0; r < 8; r++) for (let d = 0; d < 3; d++) leds.push({ pos: new THREE.Vector3(p.x + 0.33, 0.3 + r * 0.22, p.z - 0.25 + d * 0.25), hot: d === 2 && r % 3 === k });
  }
  const ledMesh = new THREE.InstancedMesh(boxGeometry, new THREE.MeshBasicMaterial({ toneMapped: false }), leds.length), ledSize = new THREE.Vector3(0.02, 0.04, 0.06);
  leds.forEach((l, k) => { ledMesh.setMatrixAt(k, m4.compose(l.pos, q0, ledSize)); ledMesh.setColorAt(k, l.hot ? pinkC : cyanC); });
  g.add(ledMesh);

  // Pixel, le chat néon, assis sur la première baie : il suit BYTE des yeux et remue la queue.
  const cat = new THREE.Group(), fur = mat("#1b1630", { roughness: 0.7 });
  cat.position.copy(P(48, 520, 2.1)); cat.rotation.y = Math.PI / 2; g.add(cat);
  box(cat, 0.22, 0.2, 0.34, fur, 0, 0.1, 0);
  box(cat, 0.23, 0.04, 0.05, glow(pink, 1.4), 0, 0.2, 0.1);
  const head = new THREE.Group(); head.position.set(0, 0.27, 0.13); cat.add(head);
  box(head, 0.2, 0.17, 0.17, fur, 0, 0, 0.02);
  for (const dx of [-0.06, 0.06]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), fur);
    ear.position.set(dx, 0.12, 0.02); ear.rotation.y = Math.PI / 4; head.add(ear);
  }
  const eyes = [-0.05, 0.05].map(dx => box(head, 0.035, 0.03, 0.01, glow(cyan, 2.4), dx, 0.01, 0.11));
  box(head, 0.03, 0.02, 0.01, glow(pink, 1.6), 0, -0.04, 0.11);
  const tail = new THREE.Group(); tail.position.set(0, 0.06, -0.17); cat.add(tail);
  cyl(tail, 0.022, 0.32, fur, 0, 0.14, -0.05, 8).rotation.x = -0.4;
  box(tail, 0.05, 0.05, 0.05, glow(pink, 1.6), 0, 0.29, -0.11);
  const meow = label(cat, "", "drone-bubble cat", 0, 0.62, 0); meow.visible = false;

  // Tapis d'expédition des commandes TikTok Shop, avec portique scanner ; la cadence suit le travail des agents.
  const belt0 = P(95, 36).x, belt1 = P(560, 36).x, beltZ = P(0, 36).z, beltLen = belt1 - belt0, steel = mat("#2a2550", { metalness: 0.6, roughness: 0.35 });
  box(g, beltLen + 0.4, 0.08, 0.5, mat("#15122a", { metalness: 0.4, roughness: 0.6 }), (belt0 + belt1) / 2, 0.55, beltZ);
  box(g, beltLen + 0.4, 0.02, 0.02, glow(pink, 1.4), (belt0 + belt1) / 2, 0.6, beltZ + 0.26);
  for (let x = belt0; x <= belt1 + 0.01; x += beltLen / 4) for (const dz of [-0.2, 0.2]) box(g, 0.06, 0.5, 0.06, steel, x, 0.26, beltZ + dz);
  const scanX = (belt0 + belt1) / 2;
  for (const dz of [-0.3, 0.3]) box(g, 0.06, 0.75, 0.06, steel, scanX, 0.95, beltZ + dz);
  const scanBar = box(g, 0.08, 0.06, 0.66, glow(cyan, 2), scanX, 1.33, beltZ);
  sign(g, "EXPÉDITIONS", 1.3, 0.22, { color: cyan, font: "700 64px Sora, sans-serif", blur: 14 }, belt1 - 0.4, 0.95, beltZ + 0.05);
  const parcelArt = canvasTexture(128, 128);
  parcelArt.ctx.fillStyle = "#b98a52"; parcelArt.ctx.fillRect(0, 0, 128, 128);
  parcelArt.ctx.fillStyle = pink; parcelArt.ctx.fillRect(54, 0, 20, 128);
  parcelArt.ctx.fillStyle = "#1b1630"; parcelArt.ctx.font = "800 26px Sora, sans-serif"; parcelArt.ctx.textAlign = "center"; parcelArt.ctx.fillText(texts[1] ?? texts[0], 64, 96, 120);
  const PARCELS = 7, parcels = new THREE.InstancedMesh(boxGeometry, new THREE.MeshStandardMaterial({ map: parcelArt.texture, roughness: 0.8 }), PARCELS);
  const parcelSize = new THREE.Vector3(0.32, 0.24, 0.3), parcelPos = new THREE.Vector3(), phases = Array.from({ length: PARCELS }, (_, k) => k / PARCELS);
  g.add(parcels);
  let beltRun = 0;

  // Borne d'arcade dans le coin est : le serpent joue en démo.
  const arcade = new THREE.Group(); arcade.position.copy(P(600, 150)); g.add(arcade);
  box(arcade, 0.8, 1.9, 0.75, mat("#140f2e"), 0, 0.95, 0);
  for (const dx of [-0.41, 0.41]) box(arcade, 0.03, 1.9, 0.03, glow(pink, 1.8), dx, 0.95, 0.38);
  const snakeScreen = canvasTexture(256, 192);
  const arcadeScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshBasicMaterial({ map: snakeScreen.texture, toneMapped: false }));
  arcadeScreen.position.set(0, 1.35, 0.38); arcade.add(arcadeScreen);
  box(arcade, 0.76, 0.08, 0.3, mat("#221a48"), 0, 0.98, 0.42);
  for (const [dx, tint] of [[-0.2, pink], [0.05, cyan], [0.2, violet]]) cyl(arcade, 0.035, 0.03, glow(tint, 1.8), dx, 1.03, 0.42, 12);
  sign(arcade, "ARCADE", 0.7, 0.16, { color: pink, font: "700 72px Sora, sans-serif", blur: 18 }, 0, 1.78, 0.38);
  let snake = newSnake();
  drawSnake(snakeScreen, snake);

  // Hologramme projeté du plafond : noyau filaire, anneau, nom qui tourne et particules en orbite.
  const holo = new THREE.Group(); holo.position.set(center.x, 3.3, center.z); g.add(holo);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshBasicMaterial({ color: cyan, wireframe: true, transparent: true, opacity: 0.85, toneMapped: false }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 6, 48), new THREE.MeshBasicMaterial({ color: pink, toneMapped: false }));
  holo.add(core, ring);
  const logo = sign(holo, (texts[1] ?? texts[0]).toUpperCase(), 1.5, 0.3, { color: "#ffffff", font: "700 90px Sora, sans-serif", blur: 22 }, 0, -0.72, 0);
  logo.material.side = THREE.DoubleSide;
  cyl(g, 0.24, 0.12, mat("#1a1530", { metalness: 0.7 }), center.x, 4.62, center.z, 20);
  cyl(g, 0.12, 0.02, glow(cyan, 2.5), center.x, 4.55, center.z, 20);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.15, 32, 1, true), additive(cyan, 0.07));
  beam.position.set(center.x, 3.98, center.z); g.add(beam);
  const ORBIT = 90, orbit = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(ORBIT * 3), 3)),
    new THREE.PointsMaterial({ color: pink, size: 0.05, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  holo.add(orbit);
  // Confettis néon lancés par l'hologramme quand un agent termine une tâche.
  const BURST = 160, burstVel = new Float32Array(BURST * 3), burstColors = new Float32Array(BURST * 3);
  const confetti = new THREE.Points(new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(BURST * 3), 3))
    .setAttribute("color", new THREE.Float32BufferAttribute(burstColors, 3)),
    new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  confetti.visible = false; holo.add(confetti);
  const palette = [pinkC, cyanC, violetC, new THREE.Color("#ffe066")];
  const burst = now => {
    const pos = confetti.geometry.attributes.position;
    for (let k = 0; k < BURST; k++) {
      const a = Math.random() * Math.PI * 2, up = Math.random() * 0.9 + 0.1, speed = 2 + Math.random() * 2.5;
      pos.setXYZ(k, 0, 0, 0);
      burstVel.set([Math.cos(a) * speed * (1 - up * 0.5), up * speed * 1.2, Math.sin(a) * speed * (1 - up * 0.5)], k * 3);
      burstColors.set(palette[k % 4].toArray(), k * 3);
    }
    pos.needsUpdate = true; confetti.geometry.attributes.color.needsUpdate = true;
    confetti.visible = true; fx.burstAt = now; fx.waves.push(now);
  };

  // BYTE : coque sphérique, visière à visage, quatre rotors, antenne et faisceau scanner.
  const drone = new THREE.Group(), shellM = mat("#1c1838", { metalness: 0.75, roughness: 0.3 });
  drone.position.set(center.x, 2.5, center.z); g.add(drone);
  drone.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), shellM));
  const face = canvasTexture(128, 64);
  const visor = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.135), new THREE.MeshBasicMaterial({ map: face.texture, toneMapped: false }));
  visor.position.set(0, 0.02, 0.212); drone.add(visor);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.012, 6, 32), new THREE.MeshBasicMaterial({ color: pink, toneMapped: false }));
  belt.rotation.x = Math.PI / 2; drone.add(belt);
  const rotors = [0, 1, 2, 3].map(i => {
    const a = Math.PI / 4 + i * Math.PI / 2;
    box(drone, 0.03, 0.02, 0.3, shellM, Math.sin(a) * 0.25, 0.1, Math.cos(a) * 0.25, a);
    const rotor = new THREE.Group(); rotor.position.set(Math.sin(a) * 0.4, 0.13, Math.cos(a) * 0.4); drone.add(rotor);
    for (const r of [0, Math.PI / 2]) box(rotor, 0.22, 0.006, 0.025, additive(cyan, 0.6), 0, 0, 0, r);
    return rotor;
  });
  cyl(drone, 0.008, 0.14, shellM, 0, 0.28, 0, 6);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: pink, toneMapped: false }));
  tip.position.y = 0.36; drone.add(tip);
  const scan = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2, 24, 1, true), additive(cyan, 0.06));
  scan.position.y = -1.05; drone.add(scan);
  const bubble = label(drone, "", "drone-bubble", 0, 0.62, 0); bubble.visible = false;
  const say = (now, text, seconds = 5) => { bubble.element.textContent = text; fx.bubbleUntil = now + seconds; fx.said = now; };
  drawFace(face, "calme", false);

  // Lumières d'ambiance : magenta sur l'open space, cyan sur le bureau ; arc-en-ciel en overdrive.
  const lights = [[330, 310, pink], [820, 310, cyan]].map(([x, y, tint]) => {
    const light = new LightSpot(tint, 9, 14, 1.6);
    light.position.copy(P(x, y, 3.4)); g.add(light);
    return light;
  });
  const boss = f.bossScreens ?? [];
  const target = new THREE.Vector3(), toDrone = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  live(head, tail, scanBar, core, ring, tip, ...eyes, ...rotors); // animés par tick ci-dessous : jamais fusionnés
  const scanOn = glow(pink, 3), scanOff = glow(cyan, 2);

  f.cyber = {
    hit: drone,
    // Un clic sur BYTE : salto, confettis et une réplique.
    poke() {
      const now = performance.now() / 1000;
      fx.flipAt = now; fx.mood = "fete"; fx.moodUntil = now + 2.5;
      say(now, BYTE_LINES[Math.floor(Math.random() * BYTE_LINES.length)]);
      burst(now);
    },
    tick(dt, near) {
      if (!near) { bubble.visible = meow.visible = false; return; }
      const now = performance.now() / 1000, still = reducedMotion.matches, od = now < overdriveUntil;
      const a = world.residents.find(x => x.slug === f.residentSlug), dnow = world.data?.now ?? now;

      // Lecture de l'activité, deux fois par seconde : fin de tâche = fête, nouveau travail = onde au sol.
      if (now >= fx.nextData) {
        fx.nextData = now + 0.5;
        const states = (a?.sessions ?? []).map(s => [`${s.src}:${s.sid}`, stateOf(s, dnow)]);
        fx.working = states.filter(([, st]) => st === "travaille").length;
        fx.alert = states.some(([, st]) => st === "autorisation");
        if (fx.primed) for (const [key, st] of states) {
          const before = fx.sessions.get(key);
          if (before === "travaille" && (st === "fini" || st === "attend")) { burst(now); fx.mood = "fete"; fx.moodUntil = now + 3; say(now, "GG ! Tâche bouclée ✅"); }
          if (before !== "travaille" && st === "travaille") fx.waves.push(now);
        }
        fx.sessions = new Map(states); fx.primed = true;
      }
      if (od && !fx.wasOd) { say(now, "MODE OVERDRIVE 🔥🔥🔥", 6); burst(now); }
      fx.wasOd = od;
      const mood = fx.alert ? "alerte" : now < fx.moodUntil || od ? "fete" : "calme";
      if (now - fx.said > 10) {
        const lines = [...BYTE_LINES];
        if (fx.working) lines.push(`${fx.working} agent${fx.working > 1 ? "s" : ""} au charbon ⚡`, `${fx.working} agent${fx.working > 1 ? "s" : ""} au charbon ⚡`);
        say(now, fx.alert ? "🚨 Un agent attend ton feu vert !" : lines[Math.floor(noise(now) * lines.length)]);
      }
      bubble.visible = now < fx.bubbleUntil;

      // Vol de BYTE : patrouille en huit au-dessus des postes, ou station devant le bureau si un accord est attendu.
      const k = still ? 0 : now * (od ? 2.4 : 1);
      if (fx.alert) target.copy(P(820, 300, 2.3 + Math.sin(k * 6) * 0.05));
      else target.set(center.x + Math.sin(k * 0.23) * 4.6, 2.5 + Math.sin(k * 1.7) * 0.12, center.z + Math.sin(k * 0.37 + 1) * 2.4);
      toDrone.subVectors(target, drone.position);
      drone.position.addScaledVector(toDrone, Math.min(1, dt * (fx.alert ? 1.5 : 3)));
      if (toDrone.lengthSq() > 1e-3) {
        const turn = (Math.atan2(toDrone.x, toDrone.z) - drone.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        drone.rotation.y += turn * Math.min(1, dt * 3);
      }
      drone.rotation.x = fx.flipAt && now - fx.flipAt < 0.8 ? (now - fx.flipAt) / 0.8 * Math.PI * 2 : 0.12;
      if (!still) rotors.forEach((r, i) => { r.rotation.y += dt * (i % 2 ? 38 : -38); });
      scan.rotation.z = still ? 0 : Math.sin(now * 1.3) * 0.25;
      tip.visible = still || Math.floor(now * 2) % 2 === 0;
      const blink = !still && noise(Math.floor(now * 3)) > 0.93;
      if (fx.face !== mood + blink) { fx.face = mood + blink; drawFace(face, mood, blink); }

      // Pixel suit BYTE du regard, remue la queue, cligne, et miaule quand le drone passe tout près.
      toDrone.subVectors(drone.position, cat.position).applyAxisAngle(yAxis, -cat.rotation.y);
      head.rotation.y += (Math.max(-1.1, Math.min(1.1, Math.atan2(toDrone.x, toDrone.z))) - head.rotation.y) * Math.min(1, dt * 4);
      head.rotation.x = -Math.max(-0.4, Math.min(0.5, Math.atan2(toDrone.y - 0.3, Math.hypot(toDrone.x, toDrone.z))));
      tail.rotation.z = still ? 0 : Math.sin(now * (od ? 9 : 2.2)) * 0.5;
      eyes.forEach(e => { e.scale.y = !still && noise(Math.floor(now * 2) + 7) > 0.9 ? 0.15 : 1; });
      if (toDrone.length() < 1.6 && now > fx.meowUntil + 6) { meow.element.textContent = od ? "MIAOU !!! 😼" : "Miaou. 😼"; fx.meowUntil = now + 2; }
      meow.visible = now < fx.meowUntil;

      // Ondes du sol : une toutes les 4 s (bien plus en overdrive), plus une à chaque tâche lancée ou terminée.
      if (!still && now >= fx.nextWave) { fx.waves.push(now); fx.nextWave = now + (od ? 0.7 : 4); }
      while (fx.waves.length && now - fx.waves[0] >= 3.2) fx.waves.shift(); // ondes ajoutées dans l'ordre du temps
      grid.forEach((l, i) => {
        let lit = 0;
        for (const w of fx.waves) lit += Math.exp(-((l.d - (now - w) * 5) ** 2) / 0.35) * Math.max(0, 1 - (now - w) / 3.2);
        if (od && !still) color.setHSL((now * 0.25 + i * 0.05) % 1, 1, 0.55);
        else color.copy(violetC).lerp(cyanC, Math.min(1, lit));
        lines.setColorAt(i, color.multiplyScalar(0.55 + Math.min(lit, 1.5)));
      });
      lines.instanceColor.needsUpdate = true;

      // Diodes des baies, colis sur le tapis et scanner.
      if (now >= fx.nextLeds) {
        fx.nextLeds = now + 1 / 12;
        const rate = still ? 0 : od ? 14 : 2 + fx.working * 3;
        leds.forEach((l, i) => ledMesh.setColorAt(i, noise(Math.floor(now * rate) * 0.37 + i * 7.3) > 0.35 ? (l.hot ? pinkC : cyanC) : color.set("#0a1a24")));
        ledMesh.instanceColor.needsUpdate = true;
      }
      const speed = still ? 0 : od ? 2.6 : 0.3 + Math.min(fx.working, 4) * 0.25;
      const before = beltRun; beltRun += dt * speed / beltLen;
      fx.shipped += Math.floor(beltRun * PARCELS) - Math.floor(before * PARCELS);
      let scanning = false;
      phases.forEach((p, i) => {
        const s = (p + beltRun) % 1, x = belt0 + s * beltLen;
        parcels.setMatrixAt(i, m4.compose(parcelPos.set(x, 0.71, beltZ), q0, parcelSize));
        scanning ||= Math.abs(x - scanX) < 0.2;
      });
      parcels.instanceMatrix.needsUpdate = true;
      scanBar.material = scanning ? scanOn : scanOff;

      // Hologramme, particules en orbite et confettis.
      core.rotation.y = still ? 0 : now * (od ? 4 : 0.9); core.rotation.x = still ? 0 : now * 0.35;
      ring.rotation.x = Math.PI / 2.4 + (still ? 0 : Math.sin(now * 0.8) * 0.3); ring.rotation.z = still ? 0 : now * 0.6;
      logo.rotation.y = still ? 0 : now * (od ? 3 : 0.7);
      const orbitPos = orbit.geometry.attributes.position;
      for (let i = 0; i < ORBIT; i++) {
        const ang = i / ORBIT * Math.PI * 2 + (still ? 0 : now * (0.5 + (i % 3) * 0.2)), rad = 0.75 + (i % 3) * 0.18;
        orbitPos.setXYZ(i, Math.cos(ang) * rad, Math.sin(ang * 3 + i) * 0.12, Math.sin(ang) * rad);
      }
      orbitPos.needsUpdate = true;
      beam.material.opacity = 0.06 + (still ? 0 : Math.sin(now * 3) * 0.015) + (od ? 0.05 : 0);
      const age = now - fx.burstAt;
      if (confetti.visible) {
        if (age > 2.6) confetti.visible = false;
        const pos = confetti.geometry.attributes.position;
        for (let i = 0; i < BURST; i++) {
          burstVel[i * 3 + 1] -= 4.2 * dt;
          pos.setXYZ(i, pos.getX(i) + burstVel[i * 3] * dt, pos.getY(i) + burstVel[i * 3 + 1] * dt, pos.getZ(i) + burstVel[i * 3 + 2] * dt);
        }
        pos.needsUpdate = true; confetti.material.opacity = Math.max(0, 1 - age / 2.6);
      }

      // Enseigne qui grésille, lumières qui respirent (arc-en-ciel lent en overdrive).
      if (signs[0]) signs[0].material.opacity = !still && Math.sin(now * 23.7) * Math.sin(now * 7.1 + 1.3) > 0.93 ? 0.3 : 1;
      lights.forEach((light, i) => {
        if (od && !still) light.color.setHSL((now * 0.2 + i * 0.5) % 1, 1, 0.55);
        else light.color.set(i ? cyan : pink);
        light.intensity = 9 + (still ? 0 : Math.sin(now * 0.9 + i * 2) * 1.5);
      });

      // Textures dessinées à cadence réduite : pluie de données, serpent de l'arcade, écrans du bureau.
      if (!still && now >= fx.nextRain) {
        fx.nextRain = now + 1 / 15;
        const ctx = rain.ctx;
        ctx.fillStyle = "rgba(0, 0, 0, 0.18)"; ctx.fillRect(0, 0, 128, 256);
        ctx.font = "bold 11px monospace";
        drops.forEach((y, i) => {
          const word = "TOKSY·DANY·0xC0FFEE·SHIP·"[Math.floor(noise(i * 3.1 + Math.floor(y)) * 24)] ?? "0";
          ctx.fillStyle = noise(i + y) > 0.85 ? "#ffffff" : i % 4 ? cyan : pink;
          ctx.fillText(noise(i * 1.7 + y) > 0.8 ? word : "0123456789ABCDEF"[Math.floor(noise(y * 9.1 + i) * 16)], i * 8, y * 12);
          drops[i] = y * 12 > 256 && Math.random() > 0.9 ? 0 : y + (od ? 2 : 1);
        });
        rain.texture.needsUpdate = true;
      }
      if (!still && now >= fx.nextSnake) { fx.nextSnake = now + (od ? 0.05 : 0.12); snake = stepSnake(snake); drawSnake(snakeScreen, snake); }
      if (now >= fx.nextBoss) { fx.nextBoss = now + 1; boss.forEach(screen => drawBossScreen(screen, a, dnow, fx, texts)); }
    },
  };
}

export { CYBER, cyberpunk, neonScreen, screenTexts };
