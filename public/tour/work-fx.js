// Le travail en 3D : célébrations (tâche livrée, objectif), confettis et tableau de bord du travail dans le bureau.

import * as THREE from "three";
import { bonusText, currentObjective, objectivePct, objectiveProgressText, workDuration, workEventText } from "../work-ui.js";
import { world } from "./state.js";
import { esc } from "./base.js";
import { LightSpot, agents, box, clock, floors, glow, label, live, mat, textTexture } from "./engine.js";
import { canvasPanel, reducedMotion } from "./kit.js";
import { productive } from "./mode.js";

// ---------- le travail en 3D : célébrations et tableau de bord ----------
// Le serveur compte le travail (economy.work) ; la tour le fête. Un nouvel exploit dans work.events d'un résident (id
// jamais vu, ceux du premier chargement ignorés) : une tâche livrée fait sauter de joie le robot qui l'a livrée, une
// gerbe de confettis partant de son bureau ; un objectif, une série ou un badge fête tout l'étage (pluie de confettis,
// enseigne au nom du résident qui s'illumine d'or). Rien n'est animé si le visiteur demande moins de mouvement, ni
// sur un étage qu'on ne regarde pas : aucune célébration ne tourne en tâche de fond.
const workSeen = new Map(); // slug du résident -> plus grand id d'événement déjà vu
const eventTime = t => (Number(t) > 1e12 ? Number(t) / 1000 : Number(t));
function trackWorkEvents(list, now) {
  for (const a of list) {
    const events = a.economy?.work?.events;
    if (!Array.isArray(events)) continue;
    let top = 0;
    for (const e of events) if (Number(e?.id) > top) top = Number(e.id);
    const seen = workSeen.get(a.slug);
    workSeen.set(a.slug, Math.max(top, seen ?? 0));
    if (seen === undefined) continue; // premier chargement : l'historique n'est pas rejoué
    // Les plus anciens d'abord ; au retour d'un onglet en arrière-plan, seulement les trois derniers et pas les vieux.
    const fresh = events.filter(e => Number(e?.id) > seen && !(now - eventTime(e.t) > 180)).sort((x, y) => x.id - y.id).slice(-3);
    for (const e of fresh) celebrateWork(a, e);
  }
}
function celebrateWork(a, e) {
  if (reducedMotion.matches || document.hidden || productive()) return; // mode productif : pas de fête
  const f = floors.get(world.order[world.focus]);
  if (!f || f.kind !== "resident" || f.residentSlug !== a.slug) return; // l'étage de ce résident n'est pas regardé
  const t = clock.elapsedTime;
  if (e.kind === "delivery") {
    // Le robot qui a livré : même outil, sur cet étage ; de préférence celui qui vient de passer en pause, sinon au poste.
    let robot = null;
    for (const g of agents.values()) {
      const u = g.userData;
      if (u.floor !== f.key || u.apt?.slug !== a.slug || u.s?.src !== e.src || !g.visible) continue;
      const rank = (u.state === "travaille" ? 0 : 1e10) + (u.s.updated ?? 0);
      if (!robot || rank > robot.rank) robot = { g, rank };
    }
    if (!robot) return;
    const u = robot.g.userData;
    u.cheer = Number(e.id) % 2 ? "Yes" : "Jump";
    u.cheerUntil = t + 1.9;
    u.cheerText = workEventText(e, { tool: false });
    u.cheerTextUntil = t + 3.5;
    u.bubble.element.textContent = u.cheerText;
    u.bubble.element.className = "bubble3d";
    const p = robot.g.position;
    burstConfetti(f, p.x, 1.15, p.z, 70, 2.3);
    return;
  }
  // Objectif, série, badge : tout l'étage. L'enseigne au nom du résident s'illumine d'or, des confettis tombent du
  // plafond sur tout l'étage et jaillissent du tableau de bord ; un bandeau dit pourquoi.
  if (f.wingId !== "work") return;
  endCelebration(f);
  f.celebration = { start: t, duration: 3.6, banner: label(f.group, esc(workEventText(e)), "owner-tag", 0, 2.45, -6.1) };
  if (f.nameSign && !f.nameFlash) {
    f.nameFlash = new THREE.Mesh(f.nameSign.geometry, new THREE.MeshBasicMaterial({ map: textTexture(f.nameText, { ...f.nameOpts, color: "#ffd76a" }),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    f.nameFlash.position.copy(f.nameSign.position); f.nameFlash.position.z += 0.012;
    f.group.add(f.nameFlash);
  }
  if (f.nameFlash) f.nameFlash.visible = true;
  for (let k = 0; k < 6; k++) showerConfetti(f, -8.5 + k * 3.4, 40);
  if (f.workBoard) burstConfetti(f, f.workBoard.mesh.position.x, 2.9, f.workBoard.mesh.position.z + 0.3, 50, 2.6);
}
function endCelebration(f) {
  const c = f.celebration;
  if (!c) return;
  f.celebration = null;
  c.banner?.element.remove(); c.banner?.removeFromParent();
  if (f.nameFlash) { f.nameFlash.visible = false; f.nameFlash.material.opacity = 0; }
  if (f.accentGlow && f.accentMaterial) f.accentGlow.material = f.accentMaterial;
  if (f.workFlash) f.workFlash.intensity = 0;
}
const ACCENT_FLASH = glow("#ffd76a", 3.2);
// Étage de résident regardé : célébration en cours et confettis.
function tickWorkFloor(f, dt, t) {
  const c = f.celebration;
  if (c) {
    const age = t - c.start;
    if (age >= c.duration || reducedMotion.matches) endCelebration(f);
    else {
      // Trois pulsations dorées qui s'éteignent.
      const env = Math.max(0, 1 - age / c.duration) * (0.55 + 0.45 * Math.cos(age * Math.PI * 2 * 0.85));
      if (f.nameFlash) f.nameFlash.material.opacity = Math.min(1, env * 1.3);
      f.accentMaterial ??= f.accentGlow.material;
      f.accentGlow.material = env > 0.3 ? ACCENT_FLASH : f.accentMaterial;
      if (f.workFlash) f.workFlash.intensity = 9 * env;
    }
  }
  if (confetti.mesh.parent !== f.group || !confetti.alive) return;
  if (reducedMotion.matches) clearConfetti(); else stepConfetti(dt, t);
}
function clearConfetti() {
  const c = confetti;
  c.end.fill(0); c.alive = 0; c.mesh.visible = false;
  for (let i = 0; i < CONFETTI_COUNT; i++) c.mesh.setMatrixAt(i, c.hidden);
  c.mesh.instanceMatrix.needsUpdate = true;
}

// Confettis : une seule série d'instances (un appel de dessin), prêtée à l'étage qui fait la fête ; chaque morceau
// vole, tournoie, se pose au sol puis disparaît. Rien n'est calculé quand aucun ne vole.
const CONFETTI_COUNT = 320;
const confetti = (() => {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.075, 0.045), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CONFETTI_COUNT);
  mesh.frustumCulled = false;
  mesh.visible = false;
  live(mesh);
  const tints = ["#ffd76a", "#ff6fd8", "#7ec3f0", "#4ade80", "#ffffff", "#ff9a3c"].map(c => new THREE.Color(c));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CONFETTI_COUNT; i++) { mesh.setMatrixAt(i, hidden); mesh.setColorAt(i, tints[i % tints.length]); }
  return { mesh, tints, hidden, next: 0, alive: 0, pos: new Float32Array(CONFETTI_COUNT * 3), vel: new Float32Array(CONFETTI_COUNT * 3),
    rot: new Float32Array(CONFETTI_COUNT * 3), spin: new Float32Array(CONFETTI_COUNT * 3), end: new Float32Array(CONFETTI_COUNT), dummy: new THREE.Object3D() };
})();
function confettiOn(f) {
  const c = confetti;
  if (c.mesh.parent !== f.group) { f.group.add(c.mesh); clearConfetti(); }
  c.mesh.visible = true;
}
function addConfetto(x, y, z, vx, vy, vz, life) {
  const c = confetti, i = c.next, t = clock.elapsedTime;
  c.next = (c.next + 1) % CONFETTI_COUNT;
  if (c.end[i] <= t) c.alive++;
  c.pos.set([x, y, z], i * 3); c.vel.set([vx, vy, vz], i * 3);
  c.rot.set([Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3], i * 3);
  c.spin.set([(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 16], i * 3);
  c.end[i] = t + life;
  c.mesh.setColorAt(i, c.tints[Math.floor(Math.random() * c.tints.length)]);
}
// Gerbe : jaillit d'un point (un bureau, le tableau de bord) en cône vers le haut.
function burstConfetti(f, x, y, z, count, speed) {
  confettiOn(f);
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2, up = 0.55 + Math.random() * 0.45, v = speed * (0.6 + Math.random() * 0.5);
    addConfetto(x, y, z, Math.cos(a) * v * (1 - up * 0.6), up * v * 1.25, Math.sin(a) * v * (1 - up * 0.6), 3 + Math.random() * 1.5);
  }
  confetti.mesh.instanceColor.needsUpdate = true;
}
// Pluie : tombe du plafond sur une bande de l'étage.
function showerConfetti(f, x, count) {
  confettiOn(f);
  for (let k = 0; k < count; k++)
    addConfetto(x + (Math.random() - 0.5) * 3.2, 4.3 + Math.random() * 0.6, (Math.random() - 0.5) * 11, (Math.random() - 0.5) * 0.6, -Math.random() * 0.5, (Math.random() - 0.5) * 0.6, 3.6 + Math.random() * 1.2);
  confetti.mesh.instanceColor.needsUpdate = true;
}
function stepConfetti(dt, t) {
  const c = confetti, d = c.dummy;
  let alive = 0;
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    if (c.end[i] <= t) {
      if (c.end[i] > 0) { c.end[i] = 0; c.mesh.setMatrixAt(i, c.hidden); }
      continue;
    }
    alive++;
    const k = i * 3, grounded = c.pos[k + 1] <= 0.08;
    if (!grounded) {
      // Chute freinée et flottement de papier : la vitesse verticale plafonne, un léger vent latéral les fait danser.
      c.vel[k] *= 1 - Math.min(1, dt * 1.6); c.vel[k + 2] *= 1 - Math.min(1, dt * 1.6);
      c.vel[k + 1] = Math.max(-1.1, c.vel[k + 1] - 7 * dt);
      c.pos[k] += (c.vel[k] + Math.sin(t * 5 + i) * 0.35) * dt; c.pos[k + 1] += c.vel[k + 1] * dt; c.pos[k + 2] += c.vel[k + 2] * dt;
      for (let a = 0; a < 3; a++) c.rot[k + a] += c.spin[k + a] * dt;
      if (c.pos[k + 1] <= 0.08) { c.pos[k + 1] = 0.075; c.rot[k] = -Math.PI / 2; c.rot[k + 2] = 0; } // posé à plat
    }
    const fade = Math.min(1, (c.end[i] - t) / 0.5);
    d.position.set(c.pos[k], c.pos[k + 1], c.pos[k + 2]);
    d.rotation.set(c.rot[k], c.rot[k + 1], c.rot[k + 2]);
    d.scale.setScalar(fade);
    d.updateMatrix();
    c.mesh.setMatrixAt(i, d.matrix);
  }
  c.alive = alive;
  c.mesh.instanceMatrix.needsUpdate = true;
  if (!alive) c.mesh.visible = false;
}

// Tableau de bord du travail, dans le bureau du résident : sur la vitre du fond, au-dessus du frigo, entre l'enseigne
// au nom du résident et le néon (s'il est acheté). Objectif en cours et sa barre, tâches livrées, agents au travail
// et prime d'équipe, série de jours. La texture n'est redessinée que si une valeur affichée change.
function buildWorkBoard(f, g) {
  const x = 6.5, y = 3.56, z = -6.36;
  box(g, 1.56, 1.12, 0.05, mat("#0d1018", { metalness: 0.5, roughness: 0.4 }), x, y, z - 0.04);
  box(g, 1.44, 0.022, 0.03, glow("#f1cd85", 0.9), x, y - 0.6, z - 0.01);
  f.workBoard = canvasPanel(g, 1.48, 1.04, 1024, 720, x, y, z);
  f.workFlash = new LightSpot("#ffd76a", 0, 13, 1.4, 1); // lumière dorée des célébrations (éteinte sinon)
  f.workFlash.position.set(0, 3.3, -4.6);
  g.add(f.workFlash);
  drawWorkBoard(f.workBoard, null);
}
function drawFlame(x, cx, cy, s, color) {
  x.fillStyle = color;
  x.beginPath(); x.moveTo(cx, cy - s);
  x.bezierCurveTo(cx + s * 0.9, cy - s * 0.2, cx + s * 0.75, cy + s * 0.75, cx, cy + s * 0.8);
  x.bezierCurveTo(cx - s * 0.75, cy + s * 0.75, cx - s * 0.9, cy - s * 0.1, cx - s * 0.15, cy - s * 0.45);
  x.bezierCurveTo(cx - s * 0.1, cy - s * 0.1, cx + s * 0.05, cy - s * 0.4, cx, cy - s);
  x.fill();
}
// Mode productif : temps de travail, tâches livrées et agents au travail, sans objectifs, série ni prime.
function drawWorkBoard(p, apt) {
  const zen = productive(), w = apt?.economy?.work ?? null, full = Array.isArray(w?.objectives) && !zen;
  const today = w?.today ?? {}, team = w?.team ?? {}, streak = w?.streak ?? {};
  const goal = full ? currentObjective(w.objectives) : null;
  const minutes = Math.round(Number(today.minutes) || 0), deliveries = Number(today.deliveries) || 0;
  const active = Number(team.active) || 0, bonus = Number(team.bonus) || 0, days = Number(streak.days) || 0;
  const key = JSON.stringify([zen, !!w, full, goal && [goal.id, goal.title, objectiveProgressText(goal), objectivePct(goal)], full && w.objectives.every(o => o.done),
    minutes, deliveries, active, bonus, days, !!streak.today, Number(streak.bonus) || 0]);
  if (key === p.key) return;
  p.key = key;
  const x = p.ctx, W = p.w, H = p.h, gold = "#f1cd85";
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#111a2c"); bg.addColorStop(1, "#0a0f1b");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.strokeStyle = gold; x.lineWidth = 6; x.strokeRect(10, 10, W - 20, H - 20);
  x.textBaseline = "middle"; x.textAlign = "left";
  x.fillStyle = gold; x.font = "700 46px Sora, sans-serif"; x.fillText("TRAVAIL DU JOUR", 50, 72);
  // Série en haut à droite : flamme vive si la journée compte déjà, terne sinon.
  const lit = days > 0 && (streak.today || !full);
  if (!zen) {
    drawFlame(x, W - 210, 72, 30, lit ? "#ff9a3c" : "#4a3a2a");
    x.textAlign = "right"; x.fillStyle = lit ? "#ffd2a0" : "#8a93a6"; x.font = "800 50px Sora, sans-serif";
    x.fillText(`${days} j`, W - 50, 74);
  }
  x.fillStyle = "#26324a"; x.fillRect(50, 120, W - 100, 3);
  x.textAlign = "left";
  if (!w) {
    x.fillStyle = "#c9d3e6"; x.font = "500 40px Sora, sans-serif"; x.fillText("En attente des premières minutes…", 50, 300, W - 100);
  } else if (full) {
    x.fillStyle = "#8f9bb8"; x.font = "600 28px Sora, sans-serif"; x.fillText(goal ? "OBJECTIF EN COURS" : "OBJECTIFS DU JOUR", 50, 170);
    x.fillStyle = "#f4f6fb"; x.font = "700 50px Sora, sans-serif";
    x.fillText(goal ? String(goal.title ?? "") : "Tous atteints !", 50, 232, W - 100);
    const pct = goal ? objectivePct(goal) / 100 : 1, bw = W - 100;
    x.fillStyle = "#1c2740"; x.beginPath(); x.roundRect(50, 280, bw, 44, 22); x.fill();
    if (pct > 0) {
      const gr = x.createLinearGradient(50, 0, 50 + bw, 0); gr.addColorStop(0, "#c99a3e"); gr.addColorStop(1, "#ffe08a");
      x.fillStyle = gr; x.beginPath(); x.roundRect(50, 280, Math.max(44, bw * pct), 44, 22); x.fill();
    }
    x.textAlign = "right"; x.fillStyle = "#dfe5f2"; x.font = "600 32px Sora, sans-serif";
    x.fillText(goal ? objectiveProgressText(goal) : `${workDuration(minutes)} de travail`, W - 50, 360);
    x.textAlign = "left"; x.fillStyle = "#8f9bb8"; x.font = "500 30px Sora, sans-serif";
    x.fillText(goal?.metric === "minutes" ? `${workDuration(minutes)} aujourd'hui` : `${workDuration(minutes)} de travail aujourd'hui`, 50, 360, W / 2);
  } else {
    x.fillStyle = "#8f9bb8"; x.font = "600 28px Sora, sans-serif"; x.fillText("TEMPS DE TRAVAIL", 50, 170);
    x.fillStyle = "#f4f6fb"; x.font = "800 96px Sora, sans-serif"; x.fillText(workDuration(minutes), 50, 280, W - 100);
  }
  // Trois tuiles : tâches livrées, agents au travail (et prime d'équipe), série.
  const people = active === 1 ? "agent" : active ? "agents" : "personne";
  const tiles = [
    ["TÂCHES LIVRÉES", String(deliveries), deliveries ? "aujourd'hui" : "pas encore", "#7ee0b0"],
    ["AU TRAVAIL", String(active), bonus > 0 && !zen ? `prime ${bonusText(bonus)}` : people, bonus > 0 && !zen ? "#ffd76a" : "#7ec3f0"],
    ...(zen ? [] : [["SÉRIE", `${days} j`, Number(streak.bonus) > 0 ? `salaire ${bonusText(streak.bonus)}` : streak.today ? "jour compté" : "≥ 1 h par jour", "#ff9a3c"]]),
  ];
  const tw = (W - 100 - 20 * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([title, value, sub, color], k) => {
    const tx = 50 + k * (tw + 20), ty = 420;
    x.fillStyle = "#141e33"; x.beginPath(); x.roundRect(tx, ty, tw, 250, 18); x.fill();
    x.fillStyle = color; x.fillRect(tx, ty + 18, 6, 214);
    x.textAlign = "center";
    x.fillStyle = "#8f9bb8"; x.font = "600 26px Sora, sans-serif"; x.fillText(title, tx + tw / 2, ty + 42, tw - 30);
    x.fillStyle = "#f4f6fb"; x.font = "800 92px Sora, sans-serif"; x.fillText(value, tx + tw / 2, ty + 132, tw - 30);
    x.fillStyle = color; x.font = "600 28px Sora, sans-serif"; x.fillText(sub, tx + tw / 2, ty + 210, tw - 30);
  });
  x.textAlign = "left";
  p.tex.needsUpdate = true;
}
function updateWorkBoards(list) {
  for (const a of list) {
    const f = floors.get(`${a.slug}:work`);
    if (f?.workBoard) drawWorkBoard(f.workBoard, a);
  }
}

export { buildWorkBoard, confetti, endCelebration, tickWorkFloor, trackWorkEvents, updateWorkBoards };
