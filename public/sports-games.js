// Mini-jeux d'adresse des étages Tennis et Golf : un vrai match contre le robot du club, un parcours de mini-golf en 3 trous.
// Canvas 2D, aucun fichier externe. La partie se joue entièrement dans le navigateur ; à la fin, son résultat honnête
// (score, durée de jeu réelle) part au serveur, qui vérifie qu'il est possible et plafonne les parties récompensées par jour.
// Tout texte venu du serveur passe par esc. Une seule boucle requestAnimationFrame, arrêtée à la fermeture du dialogue.
import { CURRENCY, SPORTS } from "./economy-data.js";

const W = 480, H = 600; // repère logique des deux jeux, mis à l'échelle à l'affichage
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const sign = v => (v < 0 ? -1 : 1);
const FONT = '"Sora", system-ui, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const TENNIS = SPORTS.tennis, GOLF = SPORTS.golf;
const DAILY = SPORTS.dailyRewards;
const gainText = (money, xp) => [money ? `+${money} ${CURRENCY}` : "", xp ? `+${xp} XP` : ""].filter(Boolean).join(" · ");
const levelOf = id => TENNIS.levels.find(l => l.id === id) ?? TENNIS.levels[1] ?? TENNIS.levels[0];
const KEY_MSG = "Ouvre « Relier mes agents » pour retrouver ta clé : partie jouée sans enregistrement.";

// ---------- dessin : petits outils communs ----------
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// Générateur pseudo-aléatoire à graine : le décor (tribunes, grain du sable) reste identique d'un rendu à l'autre.
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function offscreen(k) {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(W * k)); cv.height = Math.max(1, Math.round(H * k));
  const c = cv.getContext("2d");
  c.setTransform(k, 0, 0, k, 0, 0);
  return { cv, c };
}
// Grand message au centre (« Ace ! », « Trou en un ! ») : apparition en douceur, petit rebond sauf mouvement réduit.
function drawMsg(c, m, reduced, y) {
  if (!m) return;
  const alpha = clamp(Math.min(m.t / 0.12, (m.dur - m.t) / 0.35), 0, 1);
  if (alpha <= 0) return;
  const pop = reduced ? 1 : 1 + 0.3 * Math.max(0, 1 - m.t / 0.2) * Math.cos(m.t * 30);
  c.save();
  c.globalAlpha = alpha;
  c.translate(W / 2, y);
  c.scale(pop, pop);
  const size = m.big ? 38 : 28;
  c.font = `700 ${size}px ${FONT}`;
  const tw = c.measureText(m.text).width;
  c.font = `600 14px ${FONT}`;
  const sw = m.sub ? c.measureText(m.sub).width : 0;
  const bw = Math.max(tw, sw) + 40, bh = m.sub ? size + 40 : size + 22;
  c.fillStyle = "rgba(6, 8, 18, .74)";
  rrect(c, -bw / 2, -bh / 2, bw, bh, 14); c.fill();
  c.strokeStyle = m.color; c.globalAlpha = alpha * 0.55; c.lineWidth = 1.5; c.stroke();
  c.globalAlpha = alpha;
  c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `700 ${size}px ${FONT}`;
  if (m.big && !reduced) { c.shadowColor = m.color; c.shadowBlur = 18; }
  c.fillStyle = m.color;
  c.fillText(m.text, 0, m.sub ? -10 : 1);
  c.shadowBlur = 0;
  if (m.sub) { c.font = `600 14px ${FONT}`; c.fillStyle = "#ece9e0"; c.fillText(m.sub, 0, size / 2 + 6); }
  c.restore();
}
const msgOf = (text, sub = "", color = "#f4d699", dur = 1.4, big = false) => ({ text, sub, color, dur, big, t: 0 });

// Particules (poussière de terre battue, confettis, éclaboussures) : purement décoratives, coupées en mouvement réduit.
function stepFx(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) { list.splice(i, 1); continue; }
    p.vy += (p.g ?? 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot = (p.rot ?? 0) + (p.vr ?? 0) * dt;
    if (p.grow) p.size += p.grow * dt;
  }
}
function drawFx(c, list) {
  for (const p of list) {
    c.globalAlpha = clamp(p.life / p.max, 0, 1) * (p.alpha ?? 1);
    if (p.kind === "ring") {
      c.strokeStyle = p.color; c.lineWidth = 1.6;
      c.beginPath(); c.ellipse(p.x, p.y, p.size, p.size * (p.flat ?? 1), 0, 0, TAU); c.stroke();
    } else if (p.kind === "conf") {
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.color; c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); c.restore();
    } else {
      c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill();
    }
  }
  c.globalAlpha = 1;
}
function confetti(list, x, y, n = 70) {
  const colors = ["#f4d699", "#e8c27a", "#ff5d5d", "#4ade80", "#7cc4ff", "#ffffff"];
  for (let i = 0; i < n; i++) {
    const a = rand(-Math.PI, 0), v = rand(120, 340);
    list.push({ kind: "conf", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420, life: rand(1.2, 2), max: 2, size: rand(5, 9), rot: rand(0, TAU), vr: rand(-9, 9), color: colors[i % colors.length] });
  }
}

// Raquette vue de face : manche gainé, cœur en V, cadre ovale et cordage tendu. L'origine est le bout du manche,
// la tête est vers le haut (−y) : rotate(angle) l'incline. Le centre du tamis est à (0, −58) dans ce repère.
const RACKET_HEAD = 58;
function drawRacket(c, x, y, size, angle, { frame = "#1d2030", accent = "#e8c27a", glow = 0, hand = true } = {}) {
  c.save();
  c.translate(x, y); c.rotate(angle); c.scale(size, size);
  // manche
  c.fillStyle = "#2b2119"; rrect(c, -3, -26, 6, 26, 2.5); c.fill();
  c.strokeStyle = accent; c.lineWidth = 0.9; c.globalAlpha = 0.75;
  for (let k = -23; k < -3; k += 3.2) { c.beginPath(); c.moveTo(-3, k); c.lineTo(3, k + 2); c.stroke(); }
  c.globalAlpha = 1;
  c.fillStyle = frame; rrect(c, -3.6, -2.5, 7.2, 3.5, 1.2); c.fill();
  // cœur en V et pont
  c.strokeStyle = frame; c.lineWidth = 2.6; c.lineCap = "round";
  c.beginPath(); c.moveTo(-2.2, -25); c.lineTo(-9.5, -42); c.moveTo(2.2, -25); c.lineTo(9.5, -42); c.stroke();
  c.lineWidth = 1.6; c.beginPath(); c.moveTo(-8.6, -41); c.quadraticCurveTo(0, -37, 8.6, -41); c.stroke();
  // cordage
  c.save();
  c.beginPath(); c.ellipse(0, -RACKET_HEAD, 12.6, 16.8, 0, 0, TAU); c.clip();
  c.fillStyle = glow > 0 ? `rgba(255, 226, 140, ${0.18 + 0.3 * glow})` : "rgba(255, 255, 255, .06)";
  c.fillRect(-14, -RACKET_HEAD - 18, 28, 36);
  c.strokeStyle = "rgba(244, 241, 230, .82)"; c.lineWidth = 0.55;
  for (let k = -12; k <= 12; k += 2.6) { c.beginPath(); c.moveTo(k, -RACKET_HEAD - 18); c.lineTo(k, -RACKET_HEAD + 18); c.stroke(); }
  for (let k = -17; k <= 17; k += 2.6) { c.beginPath(); c.moveTo(-14, -RACKET_HEAD + k); c.lineTo(14, -RACKET_HEAD + k); c.stroke(); }
  c.fillStyle = accent; c.globalAlpha = 0.8; c.font = `700 9px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText("P", 0, -RACKET_HEAD + 1);
  c.restore();
  // cadre
  c.lineWidth = 3.4; c.strokeStyle = frame;
  c.beginPath(); c.ellipse(0, -RACKET_HEAD, 14, 18.4, 0, 0, TAU); c.stroke();
  c.lineWidth = 0.9; c.strokeStyle = accent;
  c.beginPath(); c.ellipse(0, -RACKET_HEAD, 15.4, 19.8, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
  if (glow > 0) {
    c.globalAlpha = glow; c.lineWidth = 2; c.strokeStyle = "#ffe08a";
    c.beginPath(); c.ellipse(0, -RACKET_HEAD, 17.5, 22, 0, 0, TAU); c.stroke(); c.globalAlpha = 1;
  }
  // main gantée avec poignet éponge
  if (hand) {
    c.fillStyle = "#e9b58f"; c.beginPath(); c.ellipse(0, -9, 4.8, 5.6, 0, 0, TAU); c.fill();
    c.fillStyle = accent; rrect(c, -5, -3.5, 10, 4.5, 1.5); c.fill();
  }
  c.restore();
}

// =====================================================================================================================
// Tennis : court en terre battue vu depuis le fond de court, en perspective légère. Le joueur est la raquette du bas.
// Unités en mètres : x en travers (simple ±4,115), y en profondeur (filet en 0, ta ligne de fond en −11,885), z en hauteur.
// =====================================================================================================================
const L = 11.885, SW = 4.115, DW = 5.485, SL = 6.4, NET = 0.95, G = 9.8;
const REACH = 1.3, AI_REACH = 1.25, PLAYER_SPEED = 8.6, AI_SPEED = 6.3;
const PTS = ["0", "15", "30", "40", "Jeu"];
const P = { cx: 240, near: 520, far: 150, k: 0.55, ppm: 34, zf: 0.82 };
P.hz = (P.far * (1 + P.k) - P.near) / P.k;
const sOf = y => 1 / (1 + P.k * (y + L) / (2 * L));
function proj(x, y, z = 0) {
  const s = sOf(y);
  return { x: P.cx + x * P.ppm * s, y: P.hz + (P.near - P.hz) * s - z * P.ppm * P.zf * s, s };
}
// Écran -> sol, pour un point vu à la hauteur z (la raquette est tenue à ~1 m).
function unproj(sx, sy, z = 0) {
  let s = 1;
  for (let i = 0; i < 4; i++) s = clamp((sy + z * P.ppm * P.zf * s - P.hz) / (P.near - P.hz), 0.45, 1.5);
  return { x: (sx - P.cx) / (P.ppm * s), y: ((1 / s - 1) / P.k) * 2 * L - L };
}
const netTop = x => NET + 0.12 * Math.min(1, (x / (DW + 0.9)) ** 2);

function tennisGame(ui) {
  let phase = "setup", lv = levelOf(ui.prefs.level), time = 0, playTime = 0;
  let games = [0, 0], points = [0, 0], server = 0, faults = 0, timer = 0, then = null, tossT = 0, msg = null, rally = 0;
  let marks = [], fx = [], trail = [], fb = null, lastWinner = -1, result = null, cache = null;
  const b = { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0, held: true, bounces: 0, hitter: "", serve: false, netHit: false, weak: false, box: null, prevY: 0 };
  const p = { x: 0.6, y: -L - 0.4, tx: 0.6, ty: -L - 0.4, aim: 0, swing: null, cool: 0, mode: "pointer", lean: 0 };
  const a = { x: 0, y: L + 0.6, react: 0, err: 0, swing: -1, toss: false };

  const say = text => ui.say(text);
  const scoreText = () => (points[0] === 3 && points[1] === 3 ? "40–40" : `${PTS[points[0]]}–${PTS[points[1]]}`);
  const side = () => ((points[0] + points[1]) % 2 === 0 ? 1 : -1); // 1 : côté égalité (droite du serveur), −1 : avantage
  const wait = (sec, fn) => { phase = "pause"; timer = sec; then = fn; };

  // ----- mise en jeu -----
  function prepServe() {
    phase = "serve"; tossT = 0; b.held = true; b.netHit = false; b.bounces = 0; b.serve = false; b.hitter = ""; b.vx = b.vy = b.vz = 0;
    marks = []; trail = []; rally = 0; p.swing = null; a.swing = -1;
    const sd = side();
    if (server === 0) {
      p.x = p.tx = 1.5 * sd; p.y = p.ty = -L - 0.45; a.x = -2.7 * sd; a.y = L + 0.7;
    } else {
      a.x = -1.5 * sd; a.y = L + 0.45; p.x = p.tx = 2.7 * sd; p.y = p.ty = -L - 0.6;
      timer = 0.9;
    }
    const decisive = points[0] === 3 && points[1] === 3;
    const matchBall = [0, 1].some(w => games[w] === TENNIS.gamesToWin - 1 && points[w] === 3 && points[1 - w] <= 3);
    if (faults === 0) say(`${scoreText()}${decisive ? ", point décisif" : ""}. ${server === 0 ? "À toi de servir." : "Service du robot."}`);
    if (faults === 0 && (decisive || matchBall)) msg = msgOf(matchBall ? "Balle de match" : "Point décisif", decisive ? "40–40 : le point suivant gagne le jeu" : "", "#f4d699", 1.3);
    ui.refresh();
  }
  function launch(tx, ty, speed, margin) {
    const z0 = clamp(b.z, 0.25, 3.2), dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
    let T = d / speed, vz = 0;
    for (let i = 0; i < 40; i++) {
      vz = (-z0 + 0.5 * G * T * T) / T;
      if (margin == null) break;
      const tn = -b.y / (dy / T);
      if (!(tn > 0 && tn < T)) break;
      if (z0 + vz * tn - 0.5 * G * tn * tn >= NET + margin) break;
      T *= 1.06;
    }
    b.z = z0; b.vx = dx / T; b.vy = dy / T; b.vz = vz; b.bounces = 0; b.netHit = false; b.held = false;
  }
  function serveHit(who, q) {
    const sd = side();
    let x0, x1, dir;
    if (who === 0) { dir = 1; [x0, x1] = sd === 1 ? [-SW, 0] : [0, SW]; } else { dir = -1; [x0, x1] = sd === 1 ? [0, SW] : [-SW, 0]; }
    const mid = (x0 + x1) / 2, half = (x1 - x0) / 2, second = faults === 1;
    let tx, ty, speed;
    if (who === 0) {
      const err = (1 - q) * (second ? 0.6 : 1);
      tx = mid + p.aim * (half - 0.4) + rand(-1, 1) * err * 1.5;
      ty = SL - rand(0.45, 0.9) + rand(-0.4, 1) * err * 2.1;
      speed = (15 + 11 * q) * (second ? 0.84 : 1);
      if (q > 0.85) fb = { text: "Service parfait !", t: 0, color: "#ffe08a" };
    } else {
      const lvl = lv.speed, pf = (second ? 0.05 : 0.15) / lvl;
      tx = mid + rand(-0.85, 0.85) * (half - 0.4);
      ty = -(SL - rand(0.4, 1.5));
      speed = (14 + rand(0, 7)) * (0.8 + 0.25 * lvl) * (second ? 0.84 : 1);
      if (Math.random() < pf) { if (Math.random() < 0.5) ty -= rand(0.8, 1.6); else tx = (tx > mid ? x1 + 0.7 : x0 - 0.7); }
      a.swing = 0;
    }
    launch(tx, dir * Math.abs(ty), speed, null);
    b.serve = true; b.hitter = who === 0 ? "p" : "a"; b.box = [x0, x1, dir]; b.weak = false;
    phase = "rally";
    if (who === 0) { a.react = 0.32 / lv.speed; a.err = rand(-1, 1) * 0.45 / lv.speed; }
  }
  function serveFault(text) {
    if (phase !== "rally") return;
    if (faults === 0) {
      faults = 1;
      msg = msgOf(text, "Second service", "#ffb36b", 1.1);
      say(`${text} Second service.`);
      wait(1.15, prepServe);
    } else {
      faults = 0;
      endPoint(b.hitter === "p" ? 1 : 0, "Double faute !", "");
    }
  }
  function endPoint(w, text, sub) {
    if (phase !== "rally") return;
    faults = 0; lastWinner = w;
    points[w]++;
    const who = w === 0 ? "Point pour toi" : "Point pour le robot";
    msg = msgOf(text, sub || (points[w] >= 4 ? `${who} · et le jeu` : `${who} · ${scoreText()}`), w === 0 ? "#7ef0a6" : "#ff9a9a", 1.4);
    say(`${text}${sub ? " " + sub : ""} ${w === 0 ? "Point pour toi" : "Point pour le robot"}.`);
    if (w === 0 && !ui.reduced() && /Ace|gagnant/i.test(text)) { const q = proj(b.x, b.y, 0); confetti(fx, q.x, q.y, 24); }
    ui.refresh();
    wait(1.45, afterPoint);
  }
  function afterPoint() {
    const w = lastWinner;
    if (points[w] >= 4) {
      games[w]++; points = [0, 0];
      if (games[w] >= TENNIS.gamesToWin) {
        msg = msgOf(w === 0 ? "Jeu, set et match !" : "Le robot gagne", `${games[0]}–${games[1]}`, w === 0 ? "#f4d699" : "#ff9a9a", 2.2, true);
        if (w === 0 && !ui.reduced()) confetti(fx, W / 2, 260, 90);
        say(`${w === 0 ? "Jeu, set et match pour toi" : "Le robot gagne le match"}, ${games[0]} jeux à ${games[1]}.`);
        ui.refresh();
        finish(w === 0);
        return;
      }
      server = 1 - server;
      msg = msgOf(w === 0 ? "Jeu Toi" : "Jeu Robot", `Jeux ${games[0]}–${games[1]}`, w === 0 ? "#7ef0a6" : "#ff9a9a", 1.5, true);
      say(`Jeu ${w === 0 ? "pour toi" : "pour le robot"}. Jeux : ${games[0]} à ${games[1]}.`);
      ui.refresh();
      wait(1.6, prepServe);
      return;
    }
    prepServe();
  }
  function finish(won) {
    phase = "over";
    const payload = { sport: "tennis", level: lv.id, won, games: [...games], duration: Math.max(1, Math.round(playTime)) };
    // Le résultat part tout de suite ; la carte s'affiche une fois la célébration jouée.
    const mine = result = { won, games: [...games], payload, reward: null, shown: false, delay: 2 };
    ui.send(payload).then(r => { mine.reward = r; if (phase === "over" && result === mine && mine.shown) ui.overlay(resultHtml()); ui.refresh(); });
  }

  // ----- frappes -----
  function playerHit(q, kind) {
    const off = clamp((b.x - p.x) / REACH, -1, 1);
    let tx, ty, speed, margin = 0.18;
    if (kind === "contre") {
      tx = rand(-2.6, 2.6); ty = rand(3.5, 7); speed = 9.5; margin = Math.random() < 0.18 ? null : 0.15;
      fb = { text: "Contre", t: 0, color: "#c9cede" };
    } else {
      tx = off * 4.6 + rand(-1, 1) * (1 - q) * 0.9;
      ty = 6 + 5 * q + rand(-1, 1) * (1 - q) * 1.1;
      speed = 11.5 + 11.5 * q;
      if (q < 0.2) margin = null;
      fb = q >= 0.75 ? { text: "Parfait !", t: 0, color: "#ffe08a" } : q >= 0.45 ? { text: "Bien", t: 0, color: "#7ef0a6" }
        : { text: p.swing?.late ? "Trop tard" : "Trop tôt", t: 0, color: "#ffb36b" };
      if (q >= 0.75 && !ui.reduced()) {
        const s = proj(b.x, b.y, b.z);
        for (let i = 0; i < 12; i++) { const an = rand(0, TAU), v = rand(40, 130); fx.push({ x: s.x, y: s.y, vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: 0.35, max: 0.35, size: rand(1.2, 2.4), color: "#ffe08a" }); }
      }
    }
    if (margin == null) ty = Math.min(ty, rand(1.2, 3.5));
    launch(tx, ty, speed, margin);
    b.hitter = "p"; b.serve = false; b.drop = false; b.weak = kind === "contre" || q < 0.35;
    a.react = 0.28 / lv.speed; a.err = rand(-1, 1) * 0.5 / lv.speed;
    if (p.swing) p.swing.pending = false;
    rally++;
  }
  function aiHit() {
    const lvl = lv.speed, stretch = Math.abs(b.x - a.x) > 0.85, attack = b.weak;
    // Plus le robot est fort, plus il joue loin de toi, et il glisse des amorties quand tu restes au fond du court.
    let tx = Math.random() < 0.25 + 0.55 * (lvl - 0.75) ? -sign(p.x || rand(-1, 1)) * rand(2.2, 3.1 + 0.5 * lvl) : rand(-3.3, 3.3);
    if (attack) tx = sign(tx) * rand(2.7, 3.8);
    let ty = -rand(7.4, 10.9), margin = 0.2, drop = false;
    // Un échange qui s'éternise met le robot sous pression : il frappe plus fort… et se trompe plus souvent.
    const press = Math.min(12, rally) / 12;
    let speed = (12 + rand(0, 4) + (attack ? 3.5 : 0)) * (0.8 + 0.27 * lvl) * (stretch ? 0.86 : 1) * (1 + 0.2 * press);
    if (!stretch && !attack && p.y < -8.5 && Math.random() < Math.max(0, (lvl - 0.8) * 0.3)) {
      drop = true; tx = rand(-3, 3); ty = -rand(2.2, 4.2); speed = rand(10, 11.5); margin = 0.25;
    }
    const pErr = 0.1 / (lvl * lvl) + (stretch ? 0.1 : 0) + (attack ? 0.04 : 0) + (drop ? 0.05 : 0) + 0.1 * press;
    if (Math.random() < pErr) {
      const k = Math.random();
      if (k < 0.4) tx = sign(tx) * rand(SW + 0.3, SW + 1.4);
      else if (k < 0.75) ty = -rand(L + 0.4, L + 2);
      else { margin = null; ty = -rand(1.5, 3); speed *= 1.15; }
    }
    launch(tx, ty, speed, margin);
    b.hitter = "a"; b.serve = false; b.weak = false; b.drop = drop;
    a.swing = 0;
    rally++;
  }

  // ----- règles : rebonds et filet -----
  function bounce() {
    marks.push({ x: b.x, y: b.y, out: false });
    if (marks.length > 8) marks.shift();
    if (!ui.reduced()) {
      const s = proj(b.x, b.y, 0);
      for (let i = 0; i < 6; i++) fx.push({ x: s.x + rand(-4, 4), y: s.y, vx: rand(-26, 26), vy: rand(-22, -6), g: 60, life: 0.45, max: 0.45, size: rand(1.4, 2.6) * s.s, color: "#e7a07a", alpha: 0.8 });
    }
    if (phase !== "rally" || b.netHit) return;
    const mark = marks[marks.length - 1];
    if (b.bounces === 0) {
      const TOL = 0.05;
      let inside;
      if (b.serve) {
        const [x0, x1, dir] = b.box;
        inside = b.x >= x0 - TOL && b.x <= x1 + TOL && dir * b.y >= 0 && dir * b.y <= SL + TOL;
        if (!inside) { mark.out = true; serveFault("Faute !"); return; }
      } else {
        const dir = b.hitter === "p" ? 1 : -1;
        inside = Math.abs(b.x) <= SW + TOL && dir * b.y > 0 && dir * b.y <= L + TOL;
        if (!inside) { mark.out = true; endPoint(b.hitter === "p" ? 1 : 0, "Faute !", "Balle dehors"); return; }
      }
      b.bounces = 1;
    } else {
      const w = b.hitter === "p" ? 0 : 1;
      if (b.serve) endPoint(w, "Ace !", w === 0 ? "Service gagnant" : "Le robot sert un ace");
      else endPoint(w, w === 1 ? (b.drop ? "Amortie du robot" : "Gagnant du robot") : rally >= 6 ? "Coup gagnant !" : "Gagnant !", "");
    }
  }
  function stepBall(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const py = b.y, pz = b.z;
      b.vz -= G * h; b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      if (!b.netHit && py !== 0 && sign(py) !== sign(b.y) && Math.abs(b.x) < DW + 0.9) {
        const zc = pz + (b.z - pz) * (-py / (b.y - py));
        if (zc < netTop(b.x)) {
          b.netHit = true; b.y = sign(py) * 0.08; b.vy = -b.vy * 0.1; b.vx *= 0.3; b.vz = Math.min(0, b.vz) * 0.3;
          if (phase === "rally") { if (b.serve) serveFault("Filet !"); else endPoint(b.hitter === "p" ? 1 : 0, "Filet !", ""); }
        }
      }
      if (b.z <= 0 && b.vz < 0) {
        b.z = 0;
        if (b.vz < -1.2) bounce();
        b.vz = -b.vz * 0.68; b.vx *= 0.84; b.vy *= 0.84;
        if (b.vz < 1) { b.vz = 0; b.vx *= 0.9; b.vy *= 0.9; }
      }
      if (phase === "rally") { playerContact(py); aiContact(); }
    }
    if (phase === "rally" && (Math.abs(b.y) > L + 9 || Math.abs(b.x) > 13)) {
      const w = b.hitter === "p" ? 0 : 1;
      if (b.bounces === 1) endPoint(w, w === 0 ? "Gagnant !" : "Gagnant du robot", "");
      else endPoint(1 - w, "Faute !", "Balle dehors");
    }
  }
  const idealY = () => p.y + 0.6;
  function canHit() {
    return b.hitter === "a" && !b.netHit && b.y < 0 && b.vy < 0 && (b.bounces === 1 || (b.bounces === 0 && !b.serve))
      && b.z <= 2.8 && Math.abs(b.x - p.x) <= REACH && b.y <= p.y + 2.4 && b.y >= p.y - 1.1;
  }
  const quality = e => clamp(1 - (Math.abs(e) / 0.2) ** 1.15, 0, 1);
  function playerContact(prevY) {
    if (b.hitter !== "a" || b.netHit) return;
    if (p.swing?.pending && canHit() && b.y <= idealY()) { playerHit(quality(p.swing.t), "frappe"); return; }
    // Contre automatique : la balle rebondie touche le tamis sans frappe, elle repart molle.
    if (!p.swing?.pending && b.bounces === 1 && prevY > p.y && b.y <= p.y && Math.abs(b.x - p.x) <= 0.5 && b.z <= 1.9) playerHit(0, "contre");
  }
  function aiContact() {
    if (b.hitter !== "p" || b.netHit || b.bounces !== 1 || b.vy <= 0 || b.y <= 0) return;
    if (b.y >= a.y - 0.5 && b.y <= a.y + 0.9 && Math.abs(b.x - a.x) <= AI_REACH && b.z <= 3) aiHit();
  }

  // ----- action du joueur (clic, espace, tap) -----
  function action() {
    if (phase === "serve" && server === 0) { phase = "toss"; tossT = 0; b.held = false; b.z = 1; b.vz = 6.2; return; }
    if (phase === "toss" && server === 0) {
      serveHit(0, quality(((tossT - 0.633) / 0.32) * 0.2));
      p.swing = { t: 0, pending: false, anim: 0 };
      return;
    }
    if (phase !== "rally" || p.cool > 0) return;
    p.cool = 0.32;
    p.swing = { t: 0, pending: true, anim: 0, late: false };
    if (canHit() && b.y <= idealY()) {
      p.swing.late = true;
      playerHit(quality((idealY() - b.y) / Math.max(1, -b.vy)), "frappe");
    }
  }

  // ----- déplacements -----
  function movePlayer(dt, keys) {
    const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), ky = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const locked = (phase === "serve" || phase === "toss") && server === 0;
    const x0 = p.x;
    if (locked) {
      if (kx) { p.mode = "keys"; p.aim = clamp(p.aim + kx * 1.5 * dt, -1, 1); }
      else if (p.mode === "pointer") p.aim = clamp((p.tx - p.x) / 2.4, -1, 1);
      return;
    }
    if (kx || ky) {
      p.mode = "keys";
      p.x += kx * PLAYER_SPEED * dt; p.y += ky * PLAYER_SPEED * 0.75 * dt; p.tx = p.x; p.ty = p.y;
    } else {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = PLAYER_SPEED * dt;
      if (d > 0.001) { const k = Math.min(1, step / d); p.x += dx * k; p.y += dy * k * 0.9; }
    }
    p.x = clamp(p.x, -DW - 1.2, DW + 1.2); p.y = clamp(p.y, -L - 1.3, -1.6);
    p.lean += (clamp((p.x - x0) / Math.max(dt, 1e-3) / PLAYER_SPEED, -1, 1) - p.lean) * Math.min(1, dt * 10);
  }
  function moveAI(dt) {
    const sp = AI_SPEED * lv.speed;
    let tx = a.x, ty = a.y;
    if (phase === "rally" && b.hitter === "p" && !b.netHit) {
      if (a.react > 0) { a.react -= dt; return; }
      let yb = b.y, xb = b.x;
      if (b.bounces === 0) { const t = (b.vz + Math.sqrt(b.vz * b.vz + 2 * G * Math.max(0, b.z))) / G; xb = b.x + b.vx * t; yb = b.y + b.vy * t; }
      const out = b.bounces === 0 && (Math.abs(xb) > SW + 0.05 || yb > L + 0.05 || (b.serve && b.box && (xb < b.box[0] - 0.05 || xb > b.box[1] + 0.05 || yb > SL + 0.05)));
      if (out) { tx = a.x * 0.98; ty = L + 0.8; }
      else {
        ty = clamp(yb + 2.6, 4, L + 1.6);
        tx = b.vy > 0.1 ? b.x + (ty - b.y) * (b.vx / b.vy) + a.err : b.x;
      }
    } else if (phase === "rally" || phase === "pause") {
      tx = clamp(-p.x * 0.15, -1.5, 1.5); ty = L + 0.7;
    } else return;
    const dx = tx - a.x, dy = ty - a.y;
    a.x += clamp(dx, -sp * dt, sp * dt); a.y += clamp(dy, -sp * 0.75 * dt, sp * 0.75 * dt);
    a.x = clamp(a.x, -DW - 1.5, DW + 1.5); a.y = clamp(a.y, 2.2, L + 2);
  }

  // ----- boucle -----
  function update(dt, keys) {
    time += dt;
    if (msg) { msg.t += dt; if (msg.t > msg.dur) msg = null; }
    if (fb) { fb.t += dt; if (fb.t > 0.75) fb = null; }
    stepFx(fx, dt);
    if (a.swing >= 0) { a.swing += dt; if (a.swing > 0.4) a.swing = -1; }
    if (p.swing) { p.swing.t += dt; p.swing.anim += dt; if (p.swing.pending && p.swing.t > 0.2) p.swing.pending = false; if (p.swing.anim > 0.36) p.swing = null; }
    if (p.cool > 0) p.cool -= dt;
    if (phase === "over" && result && !result.shown) {
      result.delay -= dt;
      if (result.delay <= 0) { result.shown = true; ui.overlay(resultHtml()); }
    }
    if (phase === "setup" || phase === "over") { a.x = Math.sin(time * 0.7) * 1.2; return; }
    playTime += dt;
    movePlayer(dt, keys);
    moveAI(dt);
    if (phase === "serve") {
      b.x = server === 0 ? p.x + 0.35 : a.x - 0.35; b.y = server === 0 ? p.y + 0.15 : a.y - 0.15; b.z = 1;
      if (server === 1) { timer -= dt; if (timer <= 0) { phase = "toss"; tossT = 0; b.held = false; b.vz = 6.2; } }
    } else if (phase === "toss") {
      tossT += dt; b.z = 1 + 6.2 * tossT - 0.5 * G * tossT * tossT;
      if (server === 1 && tossT >= 0.6) serveHit(1, rand(0.5, 0.95));
      else if (server === 0 && tossT > 1.27) { phase = "serve"; b.held = true; say("Balle rattrapée : relance-la et frappe-la en haut."); }
    } else if (phase === "rally" || phase === "pause") {
      if (!b.held) stepBall(dt);
      if (phase === "pause") { timer -= dt; if (timer <= 0) { const fn = then; then = null; fn?.(); } }
    }
    if (!ui.reduced() && !b.held && (phase === "rally" || phase === "pause")) {
      const s = proj(b.x, b.y, b.z); trail.push({ x: s.x, y: s.y, r: s.s });
      if (trail.length > 7) trail.shift();
    } else trail.length = 0;
  }

  // ----- rendu -----
  function buildCache(k) {
    const { cv, c } = offscreen(k), rnd = seeded(7);
    // tribunes du club, dans les couleurs de l'étage 3D
    const sky = c.createLinearGradient(0, 0, 0, 110);
    sky.addColorStop(0, "#0b1712"); sky.addColorStop(1, "#173426");
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    for (let r = 0; r < 4; r++) {
      const y = 8 + r * 18;
      c.fillStyle = "#273038"; c.fillRect(0, y + 10, W, 4);
      for (let x = 4 + (r % 2) * 9; x < W; x += 18) {
        c.fillStyle = (Math.floor(x / 18) + r) % 6 === 0 ? "#1f6b3a" : "#5b2a86"; rrect(c, x, y, 14, 10, 2); c.fill();
        if (rnd() < 0.55) {
          const tones = ["#e9b58f", "#c98b62", "#8a5a3c", "#f2d0b0"], shirts = ["#e8c27a", "#7cc4ff", "#ff7a7a", "#f4efe6", "#4ade80", "#c4a1ff"];
          c.fillStyle = shirts[Math.floor(rnd() * shirts.length)]; rrect(c, x + 2, y + 2, 10, 8, 3); c.fill();
          c.fillStyle = tones[Math.floor(rnd() * tones.length)]; c.beginPath(); c.arc(x + 7, y - 1, 3.6, 0, TAU); c.fill();
        }
      }
    }
    c.fillStyle = "#1f4d36"; c.fillRect(0, 84, W, 26);
    c.fillStyle = "#2c5a46"; c.fillRect(0, 84, W, 2);
    c.fillStyle = "#f4efe6"; c.font = `600 11px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("PENTHOUSE  ·  TENNIS CLUB  ·  COURT CENTRAL", W / 2, 97.5);
    // terre battue
    const poly = (pts, fill) => { c.beginPath(); pts.forEach(([x, y], i) => { const q = proj(x, y); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }); c.closePath(); c.fillStyle = fill; c.fill(); };
    poly([[-10, L + 4.5], [10, L + 4.5], [10, -L - 6], [-10, -L - 6]], "#b4552e");
    poly([[-DW, L], [DW, L], [DW, -L], [-DW, -L]], "#d26d3e");
    for (let i = 0; i < 900; i++) {
      const x = rand(-9.5, 9.5), y = rand(-L - 4, L + 4.2), q = proj(x, y);
      c.fillStyle = rnd() < 0.5 ? "rgba(120, 45, 20, .16)" : "rgba(255, 210, 170, .12)";
      c.fillRect(q.x, q.y, 2.4 * q.s, 1.1 * q.s);
    }
    // lignes
    c.strokeStyle = "#f4efe6"; c.lineCap = "butt";
    const line = (x1, y1, x2, y2) => { const A = proj(x1, y1), B = proj(x2, y2); c.lineWidth = 2.3 * (A.s + B.s) / 2; c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke(); };
    for (const y of [-L, L]) line(-DW, y, DW, y);
    for (const x of [-DW, DW, -SW, SW]) line(x, -L, x, L);
    for (const y of [-SL, SL]) line(-SW, y, SW, y);
    line(0, -SL, 0, SL);
    line(0, -L, 0, -L + 0.3); line(0, L, 0, L - 0.3);
    return cv;
  }
  function drawNet(c) {
    const A = proj(-DW - 0.9, 0, 0), B = proj(DW + 0.9, 0, 0);
    const top = x => proj(x, 0, netTop(x)).y;
    c.fillStyle = "rgba(10, 14, 12, .28)";
    c.beginPath(); c.moveTo(A.x, A.y);
    for (let x = -DW - 0.9; x <= DW + 0.9 + 1e-6; x += 0.5) c.lineTo(proj(x, 0).x, top(x));
    c.lineTo(B.x, B.y); c.closePath(); c.fill();
    c.strokeStyle = "rgba(223, 229, 225, .5)"; c.lineWidth = 0.7;
    for (let x = -DW - 0.9; x <= DW + 0.9; x += 0.32) { const X = proj(x, 0).x; c.beginPath(); c.moveTo(X, A.y); c.lineTo(X, top(x)); c.stroke(); }
    for (let z = 0.15; z < NET; z += 0.16) { c.beginPath(); c.moveTo(A.x, proj(0, 0, z).y); c.lineTo(B.x, proj(0, 0, z).y); c.stroke(); }
    c.strokeStyle = "#f4efe6"; c.lineWidth = 2.6;
    c.beginPath(); for (let x = -DW - 0.9; x <= DW + 0.9 + 1e-6; x += 0.5) { const X = proj(x, 0).x; x <= -DW - 0.9 ? c.moveTo(X, top(x)) : c.lineTo(X, top(x)); } c.stroke();
    c.fillStyle = "#1d3b2a";
    for (const x of [-DW - 0.9, DW + 0.9]) { const q = proj(x, 0); c.fillRect(q.x - 2.5, top(x) - 2, 5, q.y - top(x) + 2); }
  }
  function drawBall(c) {
    const g = proj(b.x, b.y, 0), s = proj(b.x, b.y, b.z), r = Math.max(3.4, 0.2 * P.ppm * s.s);
    c.fillStyle = `rgba(30, 10, 5, ${clamp(0.42 - b.z * 0.06, 0.12, 0.42)})`;
    c.beginPath(); c.ellipse(g.x, g.y, r * 1.1, r * 0.45, 0, 0, TAU); c.fill();
    for (let i = 0; i < trail.length - 1; i++) {
      const t = trail[i]; c.fillStyle = `rgba(226, 245, 90, ${0.05 + 0.05 * i})`;
      c.beginPath(); c.arc(t.x, t.y, r * (0.5 + 0.07 * i), 0, TAU); c.fill();
    }
    const grad = c.createRadialGradient(s.x - r * 0.35, s.y - r * 0.4, r * 0.2, s.x, s.y, r);
    grad.addColorStop(0, "#f7ff9e"); grad.addColorStop(1, "#c6dc2c");
    c.fillStyle = grad; c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.fill();
    c.strokeStyle = "rgba(255, 255, 255, .85)"; c.lineWidth = Math.max(0.8, r * 0.18);
    c.beginPath(); c.arc(s.x - r * 0.9, s.y, r * 0.75, -0.9, 0.9); c.stroke();
    // sommet du lancer au service : un halo indique le bon moment
    if (phase === "toss" && server === 0) {
      const q = quality(((tossT - 0.633) / 0.32) * 0.2);
      if (q > 0.55) { c.strokeStyle = `rgba(255, 224, 138, ${q})`; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, r + 5, 0, TAU); c.stroke(); }
    }
  }
  function drawRobot(c) {
    const g = proj(a.x, a.y, 0), u = P.ppm * P.zf * g.s * 1.45;
    c.save(); c.translate(g.x, g.y);
    c.fillStyle = "rgba(30, 10, 5, .35)"; c.beginPath(); c.ellipse(0, 0, 0.45 * u, 0.14 * u, 0, 0, TAU); c.fill();
    c.fillStyle = "#8d96a8";
    c.fillRect(-0.2 * u, -0.46 * u, 0.13 * u, 0.46 * u); c.fillRect(0.07 * u, -0.46 * u, 0.13 * u, 0.46 * u);
    c.fillStyle = "#eef1f6"; rrect(c, -0.31 * u, -1.06 * u, 0.62 * u, 0.62 * u, 0.12 * u); c.fill();
    c.fillStyle = "#e8c27a"; c.fillRect(-0.31 * u, -0.78 * u, 0.62 * u, 0.08 * u);
    c.fillStyle = "#59f0ff"; c.beginPath(); c.arc(0, -0.92 * u, 0.05 * u, 0, TAU); c.fill();
    c.fillStyle = "#eef1f6"; rrect(c, -0.26 * u, -1.5 * u, 0.52 * u, 0.38 * u, 0.1 * u); c.fill();
    c.fillStyle = "#10131c"; rrect(c, -0.2 * u, -1.42 * u, 0.4 * u, 0.17 * u, 0.06 * u); c.fill();
    c.fillStyle = "#59f0ff";
    for (const ex of [-0.09, 0.09]) { c.beginPath(); c.arc(ex * u, -1.335 * u, 0.04 * u, 0, TAU); c.fill(); }
    c.strokeStyle = "#8d96a8"; c.lineWidth = 0.04 * u; c.beginPath(); c.moveTo(0, -1.5 * u); c.lineTo(0, -1.68 * u); c.stroke();
    c.fillStyle = "#ff5d5d"; c.beginPath(); c.arc(0, -1.7 * u, 0.05 * u, 0, TAU); c.fill();
    // bras et raquette, côté droit du robot (à gauche à l'écran)
    const k = a.swing >= 0 ? Math.sin(Math.min(1, a.swing / 0.3) * Math.PI) : 0;
    const hx = (-0.5 - 0.2 * k) * u, hy = (-0.78 + 0.1 * k) * u;
    c.strokeStyle = "#cfd5e0"; c.lineWidth = 0.11 * u; c.lineCap = "round";
    c.beginPath(); c.moveTo(-0.3 * u, -0.98 * u); c.lineTo(hx, hy); c.stroke();
    c.beginPath(); c.moveTo(0.3 * u, -0.98 * u); c.lineTo(0.42 * u, -0.62 * u); c.stroke();
    const serving = server === 1 && (phase === "serve" || phase === "toss");
    drawRacket(c, hx, hy, u / 75, serving ? (phase === "toss" ? 0.4 : -0.2) : -0.5 - 1.3 * k, { frame: "#c8283c", accent: "#f4efe6", hand: false });
    c.restore();
  }
  function drawPlayer(c) {
    const g = proj(p.x, p.y, 0), head = proj(p.x, p.y, 1);
    const hittable = phase === "rally" && canHit();
    c.fillStyle = hittable ? "rgba(255, 224, 138, .16)" : "rgba(255, 255, 255, .07)";
    c.strokeStyle = hittable ? "rgba(255, 224, 138, .6)" : "rgba(255, 255, 255, .2)";
    c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.ellipse(g.x, g.y, REACH * P.ppm * g.s, REACH * P.ppm * g.s * 0.3, 0, 0, TAU); c.fill(); c.stroke();
    c.setLineDash([]);
    c.fillStyle = "rgba(30, 10, 5, .35)"; c.beginPath(); c.ellipse(g.x, g.y, 18 * g.s, 6 * g.s, 0, 0, TAU); c.fill();
    // angle : prêt (tête inclinée), puis coup droit balayé de droite à gauche
    let ang = 0.42 - 0.12 * p.lean;
    if (p.swing) {
      const t = clamp(p.swing.anim / 0.26, 0, 1);
      ang = t < 0.25 ? 0.42 + 0.6 * (t / 0.25) : 1.02 - 2.4 * (1 - (1 - (t - 0.25) / 0.75) ** 2);
    }
    if ((phase === "serve" || phase === "toss") && server === 0) ang = phase === "toss" ? -0.35 : 0.2;
    const size = 1.05 * g.s, hx = Math.sin(ang) * RACKET_HEAD * size, hy = -Math.cos(ang) * RACKET_HEAD * size;
    const glow = hittable ? 0.35 + 0.25 * Math.sin(time * 18) : 0;
    drawRacket(c, head.x - hx, head.y - hy, size, ang, { frame: "#1d2030", accent: "#e8c27a", glow: ui.reduced() ? (hittable ? 0.5 : 0) : glow });
    if (fb) {
      c.globalAlpha = clamp(1 - fb.t / 0.75, 0, 1);
      c.font = `700 15px ${FONT}`; c.textAlign = "center"; c.fillStyle = fb.color;
      c.fillText(fb.text, head.x, head.y - 78 * g.s - (ui.reduced() ? 0 : fb.t * 24));
      c.globalAlpha = 1;
    }
  }
  function drawAim(c) {
    if (!((phase === "serve" || phase === "toss") && server === 0)) return;
    const sd = side(), [x0, x1] = sd === 1 ? [-SW, 0] : [0, SW], mid = (x0 + x1) / 2, half = (x1 - x0) / 2;
    const tx = mid + p.aim * (half - 0.4), ty = SL - 0.65, q = proj(tx, ty);
    c.fillStyle = "rgba(255, 224, 138, .12)";
    c.beginPath(); [[x0, 0], [x1, 0], [x1, SL], [x0, SL]].forEach(([x, y], i) => { const r = proj(x, y); i ? c.lineTo(r.x, r.y) : c.moveTo(r.x, r.y); }); c.closePath(); c.fill();
    c.strokeStyle = "#ffe08a"; c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(q.x, q.y, 12 * q.s, 5 * q.s, 0, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(q.x - 16 * q.s, q.y); c.lineTo(q.x + 16 * q.s, q.y); c.stroke();
  }
  function drawBoard(c) {
    c.save();
    c.fillStyle = "rgba(6, 10, 18, .9)"; rrect(c, 10, 10, 196, 58, 9); c.fill();
    c.strokeStyle = "rgba(232, 194, 122, .5)"; c.lineWidth = 1; c.stroke();
    c.textBaseline = "middle";
    const rows = [["TOI", 0, 26], ["ROBOT", 1, 52]];
    for (const [name, i, y] of rows) {
      c.textAlign = "left"; c.font = `600 13px ${FONT}`; c.fillStyle = "#eef0f6"; c.fillText(name, 22, y);
      if (server === i && phase !== "setup" && phase !== "over") { c.fillStyle = "#d7f04a"; c.beginPath(); c.arc(80, y, 4, 0, TAU); c.fill(); }
      c.textAlign = "center"; c.font = `700 16px ${MONO}`; c.fillStyle = "#e8c27a"; c.fillText(String(games[i]), 116, y + 1);
      c.fillStyle = "#e8c27a"; rrect(c, 140, y - 10, 54, 20, 5); c.fill();
      c.fillStyle = "#1a1305"; c.font = `700 13px ${MONO}`; c.fillText(PTS[Math.min(points[i], 4)], 167, y + 1);
    }
    const decisive = points[0] === 3 && points[1] === 3 && phase !== "over";
    c.font = `600 11px ${FONT}`;
    const lw = Math.max(c.measureText(lv.name).width, 96) + 20;
    c.fillStyle = "rgba(6, 10, 18, .9)"; rrect(c, W - 10 - lw, 10, lw, decisive ? 58 : 42, 9); c.fill();
    c.strokeStyle = "rgba(232, 194, 122, .35)"; c.lineWidth = 1; c.stroke();
    c.textAlign = "right"; c.fillStyle = "#eef0f6"; c.fillText(lv.name, W - 20, 24);
    c.fillStyle = "#8e95aa"; c.fillText(`${TENNIS.gamesToWin} jeux gagnants`, W - 20, 40);
    if (decisive) { c.fillStyle = "#ffe08a"; c.fillText("Point décisif", W - 20, 56); }
    c.restore();
  }
  function drawHint(c) {
    let text = "";
    if (phase === "serve" && server === 0) text = "Espace, clic ou tap : lance la balle";
    else if (phase === "toss" && server === 0) text = "Frappe quand la balle est tout en haut !";
    else if (phase === "rally" && rally === 0 && b.hitter === "a" && games[0] + games[1] === 0 && points[0] + points[1] < 2) text = "Place la raquette, frappe quand la balle arrive";
    if (!text) return;
    // Le panneau du club devient un tableau lumineux qui affiche la consigne.
    c.fillStyle = "#081009"; c.fillRect(0, 86, W, 24);
    c.fillStyle = "#f4d699"; c.font = `600 13px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
    if (!ui.reduced()) { c.shadowColor = "#f4d699"; c.shadowBlur = 8; }
    c.fillText(text, W / 2, 98.5);
    c.shadowBlur = 0;
  }
  function draw(c, k) {
    if (!cache || cache.k !== k) cache = { k, cv: buildCache(k) };
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(cache.cv, 0, 0); c.restore();
    for (const m of marks) {
      const q = proj(m.x, m.y);
      c.fillStyle = "rgba(125, 48, 22, .55)"; c.beginPath(); c.ellipse(q.x, q.y, 6 * q.s, 2.6 * q.s, 0, 0, TAU); c.fill();
      if (m.out && phase === "pause") { c.strokeStyle = "#ffffff"; c.lineWidth = 1.5; c.beginPath(); c.ellipse(q.x, q.y, 13 * q.s, 6 * q.s, 0, 0, TAU); c.stroke(); }
    }
    drawAim(c);
    const ballLive = !(phase === "setup" || phase === "over");
    if (ballLive && b.y > a.y) drawBall(c);
    drawRobot(c);
    if (ballLive && b.y > 0 && b.y <= a.y) drawBall(c);
    drawNet(c);
    if (ballLive && b.y <= 0 && b.y > p.y) drawBall(c);
    drawPlayer(c);
    if (ballLive && b.y <= 0 && b.y <= p.y) drawBall(c);
    drawFx(c, fx);
    drawBoard(c);
    drawHint(c);
    drawMsg(c, msg, ui.reduced(), 318);
  }

  // ----- interface -----
  function pointer(type, x, y, e) {
    const w = unproj(x, y, 1);
    p.tx = clamp(w.x, -DW - 1.2, DW + 1.2); p.ty = clamp(w.y, -L - 1.3, -1.6);
    if (type === "move") { if (e.pointerType === "mouse" || e.buttons) p.mode = "pointer"; return; }
    if (type === "down") { p.mode = "pointer"; if (phase !== "setup" && phase !== "over") action(); }
  }
  function key(e, down, keys) {
    if (down && !e.repeat && (e.key === " " || e.key === "Enter") && phase !== "setup" && phase !== "over") { action(); return true; }
    return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) || (e.key === " " || e.key === "Enter");
  }
  function start() {
    lv = levelOf(ui.prefs.level);
    games = [0, 0]; points = [0, 0]; server = 0; faults = 0; playTime = 0; result = null; msg = null; fx = [];
    ui.overlay(null);
    prepServe();
    msg = msgOf("Que le match commence !", `Contre ${lv.name}`, "#f4d699", 1.5);
    ui.focusCanvas();
    ui.refresh();
  }
  function setupHtml() {
    const lvls = TENNIS.levels.map(l => `<button type="button" role="radio" class="sport-level" data-level="${l.id}" aria-checked="${l.id === ui.prefs.level}">
      <span class="sport-level-icon" aria-hidden="true">${l.icon}</span><span><b>${l.name}</b><small>Victoire : ${gainText(l.money, l.xp)}</small></span></button>`).join("");
    return `<div class="sport-card"><h4>Match en ${TENNIS.gamesToWin} jeux gagnants</h4>
      <p>Points 15 · 30 · 40 · Jeu. À 40–40, le point suivant décide. Le service change à chaque jeu.</p>
      <div class="sport-levels" role="radiogroup" aria-label="Ton adversaire">${lvls}</div>
      <p class="sport-small">Défaite : +${TENNIS.lossXp} XP. ${limitText(ui.left("tennis"))}</p>
      <button type="button" class="sport-go" data-act="start">Jouer le match</button></div>`;
  }
  function resultHtml() {
    const r = result, rw = r.reward;
    return `<div class="sport-card result ${r.won ? "won" : "lost"}"><p class="sport-kicker">${r.won ? "Victoire" : "Défaite"} · ${r.games[0]}–${r.games[1]}</p>
      <h4>${r.won ? `Tu bats ${lv.name} !` : `${lv.name} l'emporte`}</h4>
      <p class="sport-reward ${rw ? rw.tone : ""}" role="status">${rw ? rw.html : "Envoi du résultat…"}</p>
      <div class="sport-row"><button type="button" class="sport-go" data-act="start">Rejouer</button><button type="button" class="sport-alt" data-act="levels">Changer de niveau</button></div></div>`;
  }
  function act(name, el) {
    if (name === "start") start();
    else if (name === "levels") { phase = "setup"; ui.overlay(setupHtml()); ui.refresh(); }
    else if (name === "level") {
      ui.prefs.level = el.dataset.level; lv = levelOf(ui.prefs.level);
      el.closest(".sport-levels")?.querySelectorAll("[data-level]").forEach(x => x.setAttribute("aria-checked", String(x === el)));
      ui.refresh();
    }
  }
  function sideHtml() {
    const lvl = levelOf(ui.prefs.level);
    return `<h4>Score</h4>
      <table class="sport-score"><caption class="sr-only">Score du match</caption><thead><tr><th scope="col"></th><th scope="col">Jeux</th><th scope="col">Points</th></tr></thead>
      <tbody><tr><th scope="row">Toi${server === 0 && phase !== "setup" ? ' <i class="sport-serve" title="Au service"></i>' : ""}</th><td>${games[0]}</td><td>${PTS[Math.min(points[0], 4)]}</td></tr>
      <tr><th scope="row">Robot${server === 1 && phase !== "setup" ? ' <i class="sport-serve" title="Au service"></i>' : ""}</th><td>${games[1]}</td><td>${PTS[Math.min(points[1], 4)]}</td></tr></tbody></table>
      <h4>Gains</h4><p class="sport-small">Victoire contre <b>${lvl.name}</b> : ${gainText(lvl.money, lvl.xp)}<br>Défaite : +${TENNIS.lossXp} XP</p>
      <p class="sport-small sport-limit">${limitText(ui.left("tennis"))}</p>
      <details class="sport-help"${ui.wide() ? " open" : ""}><summary>Commandes</summary><ul>
        <li><b>Souris / doigt</b> : déplacer la raquette</li><li><b>Clic, Espace, tap</b> : frapper. Pile au bon moment, la balle part plus fort et plus loin.</li>
        <li><b>Bord du tamis</b> : la balle part en angle (attention au couloir)</li><li><b>← → ↑ ↓</b> ou <b>A D W S</b> (Q D Z S) : se déplacer ; monte vers le filet pour les balles courtes</li>
        <li><b>Service</b> : un appui lance la balle, un second la frappe au sommet ; vise avec la souris ou ← →</li><li><b>P</b> : pause</li></ul></details>`;
  }
  return {
    update, draw, pointer, key, act, sideHtml,
    setup() { phase = "setup"; ui.overlay(setupHtml()); },
    playing: () => !(phase === "setup" || phase === "over"),
    resized() { cache = null; },
    snapshot: () => ({ phase, server, games: [...games], points: [...points], faults, level: lv.id, playTime, rally,
      ball: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, bounces: b.bounces, hitter: b.hitter, serve: b.serve, held: b.held },
      p: { x: p.x, y: p.y, cool: p.cool, swing: !!p.swing }, a: { x: a.x, y: a.y }, tossT, result: result && { ...result, reward: result.reward && { ...result.reward } } }),
  };
}

// =====================================================================================================================
// Golf : mini-golf vu de dessus, 3 trous (par 2, 3, 4). Murs, bumper, moulin, bunker, étang et pente.
// =====================================================================================================================
const BALL_R = 6, HOLE_R = 10, CAPTURE = 330, MAX_SHOT = 900;
const HOLES = [
  {
    name: "Le Bumper", tee: [240, 520], hole: [240, 122],
    shape: [[110, 60], [370, 60], [410, 100], [410, 540], [370, 580], [110, 580], [70, 540], [70, 100]],
    walls: [], bumpers: [{ x: 240, y: 330, r: 26 }],
    sand: [{ x: 304, y: 164, rx: 34, ry: 17 }], water: [],
    slopes: [{ x: 80, y: 392, w: 320, h: 62, fx: 1, fy: 0 }], mill: null,
  },
  {
    name: "L'Étang", tee: [142, 528], hole: [348, 112],
    shape: [[70, 580], [215, 580], [215, 330], [410, 228], [410, 58], [192, 58], [70, 168]],
    walls: [], bumpers: [{ x: 122, y: 222, r: 16 }],
    sand: [{ x: 288, y: 96, rx: 26, ry: 14 }], water: [{ x: 262, y: 224, rx: 52, ry: 32 }],
    slopes: [{ x: 80, y: 392, w: 128, h: 74, fx: -0.85, fy: 0 }], mill: null,
  },
  {
    name: "Le Moulin", tee: [120, 528], hole: [352, 116],
    shape: [[60, 50], [420, 50], [420, 580], [60, 580]],
    walls: [[60, 412, 312, 412], [168, 240, 420, 240]], bumpers: [],
    sand: [{ x: 232, y: 500, rx: 40, ry: 19 }], water: [{ x: 228, y: 138, rx: 40, ry: 27 }],
    slopes: [{ x: 66, y: 262, w: 96, h: 134, fx: 0, fy: -1 }], mill: { x: 240, y: 326, len: 60, hub: 15, w: 1.25 },
  },
];
const SCORE_NAMES = { "-3": "Albatros !", "-2": "Eagle !", "-1": "Birdie !", 0: "Par", 1: "Bogey", 2: "Double bogey", 3: "Triple bogey" };
const inEllipse = (e, x, y) => ((x - e.x) / e.rx) ** 2 + ((y - e.y) / e.ry) ** 2 <= 1;
const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const vsPar = d => (d === 0 ? "au par" : d < 0 ? `${d}` : `+${d}`);
function collideSeg(o, x1, y1, x2, y2, wr, rest) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((o.x - x1) * dx + (o.y - y1) * dy) / l2, 0, 1) : 0;
  const cx = x1 + t * dx, cy = y1 + t * dy;
  let nx = o.x - cx, ny = o.y - cy;
  const d = Math.hypot(nx, ny), R = BALL_R + wr;
  if (d >= R || d < 1e-6) return false;
  nx /= d; ny /= d; o.x = cx + nx * R; o.y = cy + ny * R;
  const vn = o.vx * nx + o.vy * ny;
  if (vn < 0) { o.vx -= (1 + rest) * vn * nx; o.vy -= (1 + rest) * vn * ny; o.vx *= 0.97; o.vy *= 0.97; }
  return true;
}

function golfGame(ui) {
  let phase = "setup", h = 0, n = 0, strokes = [], playTime = 0, time = 0, timer = 0, then = null, msg = null, fx = [], cache = null;
  let mill = 0, slow = 0, club = null, drag = null, lipped = false, sinkT = 0, splashAt = null, result = null;
  const ball = { x: 0, y: 0, vx: 0, vy: 0 }, aim = { ang: -Math.PI / 2, pow: 0.45 };
  let last = { x: 0, y: 0 }, flashes = [];
  const hole = () => HOLES[h];
  const par = i => GOLF.par[i] ?? 3;
  const wait = (sec, fn) => { phase = "pause"; timer = sec; then = fn; };
  const pointAtHole = () => { const H0 = hole(); aim.ang = Math.atan2(H0.hole[1] - ball.y, H0.hole[0] - ball.x); };
  const total = () => strokes.reduce((s, v) => s + v, 0);
  const parSoFar = () => strokes.reduce((s, _, i) => s + par(i), 0);

  function segments(H0) {
    const segs = H0.shape.map((pt, i) => { const q = H0.shape[(i + 1) % H0.shape.length]; return [pt[0], pt[1], q[0], q[1], 6]; });
    for (const w of H0.walls) segs.push([...w, 5]);
    return segs;
  }
  function startHole(i) {
    h = i; n = 0; lipped = false; club = null; drag = null;
    const H0 = hole();
    H0.segs ??= segments(H0);
    ball.x = H0.tee[0]; ball.y = H0.tee[1]; ball.vx = ball.vy = 0; last = { x: ball.x, y: ball.y };
    flashes = H0.bumpers.map(() => 0);
    aim.pow = 0.45; pointAtHole();
    cache = null; phase = "aim";
    msg = msgOf(`Trou ${i + 1} · par ${par(i)}`, H0.name, "#f4d699", 1.2);
    ui.say(`Trou ${i + 1} sur ${HOLES.length}, par ${par(i)} : ${H0.name}.`);
    ui.refresh();
  }

  // ----- coup -----
  function shoot() {
    if (phase !== "aim" || aim.pow < 0.04) return;
    n++; last = { x: ball.x, y: ball.y }; drag = null; slow = 0; lipped = false;
    club = { t: 0, ang: aim.ang, pow: aim.pow, fade: 0 };
    ui.refresh();
    if (ui.reduced()) launchBall(); else phase = "swing";
  }
  function launchBall() {
    const sp = 60 + (MAX_SHOT - 60) * club.pow;
    ball.vx = Math.cos(club.ang) * sp; ball.vy = Math.sin(club.ang) * sp;
    phase = "roll";
  }
  function physics(dt) {
    const H0 = hole();
    let ax = 0, ay = 0;
    for (const s of H0.slopes) if (inRect(s, ball.x, ball.y)) { ax += s.fx * 115; ay += s.fy * 115; }
    const sand = H0.sand.some(e => inEllipse(e, ball.x, ball.y));
    const k = sand ? 4.6 : 0.85, cfr = sand ? 170 : 26;
    ball.vx += ax * dt; ball.vy += ay * dt;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 0) { const ns = Math.max(0, sp - (k * sp + cfr) * dt); ball.vx *= ns / sp; ball.vy *= ns / sp; }
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    for (const s of H0.segs) collideSeg(ball, s[0], s[1], s[2], s[3], s[4], 0.78);
    H0.bumpers.forEach((u, i) => {
      const dx = ball.x - u.x, dy = ball.y - u.y, d = Math.hypot(dx, dy), R = u.r + BALL_R;
      if (d >= R || d < 1e-6) return;
      const nx = dx / d, ny = dy / d; ball.x = u.x + nx * R; ball.y = u.y + ny * R;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= 2 * vn * nx; ball.vy -= 2 * vn * ny;
        const s2 = Math.hypot(ball.vx, ball.vy), want = Math.max(s2 * 1.05, 180);
        ball.vx *= want / s2; ball.vy *= want / s2;
        flashes[i] = 0.35;
      }
    });
    if (H0.mill) collideMill(H0.mill);
    // trou : la balle tombe si elle passe lentement dessus, sinon elle lèche le bord
    const [hx, hy] = H0.hole, dh = Math.hypot(ball.x - hx, ball.y - hy), s3 = Math.hypot(ball.vx, ball.vy);
    if (dh < HOLE_R && s3 < CAPTURE && phase === "roll") { phase = "sink"; sinkT = 0; return; }
    if (dh < HOLE_R + 4 && s3 < CAPTURE * 1.4) { ball.vx += (hx - ball.x) / dh * 260 * dt; ball.vy += (hy - ball.y) / dh * 260 * dt; }
    if (dh < HOLE_R - 3 && s3 >= CAPTURE && !lipped) {
      lipped = true;
      const a0 = Math.atan2(ball.vy, ball.vx), toward = Math.atan2(hy - ball.y, hx - ball.x);
      let d = toward - a0; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      const na = a0 + clamp(d, -0.35, 0.35), ns = s3 * 0.82;
      ball.vx = Math.cos(na) * ns; ball.vy = Math.sin(na) * ns;
    }
    if (H0.water.some(e => inEllipse(e, ball.x, ball.y)) && phase === "roll") splash();
  }
  function millBlades(m) {
    return [0, 1, 2, 3].map(i => { const a0 = mill + i * Math.PI / 2; return [m.x + Math.cos(a0) * m.hub, m.y + Math.sin(a0) * m.hub, m.x + Math.cos(a0) * m.len, m.y + Math.sin(a0) * m.len]; });
  }
  function collideMill(m) {
    // moyeu fixe
    const dx = ball.x - m.x, dy = ball.y - m.y, d = Math.hypot(dx, dy), R = m.hub + BALL_R;
    if (d < R && d > 1e-6) {
      const nx = dx / d, ny = dy / d; ball.x = m.x + nx * R; ball.y = m.y + ny * R;
      const vn = ball.vx * nx + ball.vy * ny; if (vn < 0) { ball.vx -= 1.7 * vn * nx; ball.vy -= 1.7 * vn * ny; }
    }
    // ailes en rotation : rebond dans le repère de l'aile, qui pousse la balle
    for (const [x1, y1, x2, y2] of millBlades(m)) {
      const ex = x2 - x1, ey = y2 - y1, l2 = ex * ex + ey * ey;
      const t = clamp(((ball.x - x1) * ex + (ball.y - y1) * ey) / l2, 0, 1), cx = x1 + t * ex, cy = y1 + t * ey;
      let nx = ball.x - cx, ny = ball.y - cy; const dd = Math.hypot(nx, ny), RR = BALL_R + 4;
      if (dd >= RR || dd < 1e-6) continue;
      nx /= dd; ny /= dd; ball.x = cx + nx * RR; ball.y = cy + ny * RR;
      const bvx = -m.w * (cy - m.y), bvy = m.w * (cx - m.x);
      const rvx = ball.vx - bvx, rvy = ball.vy - bvy, vn = rvx * nx + rvy * ny;
      if (vn < 0) { ball.vx = rvx - 1.6 * vn * nx + bvx; ball.vy = rvy - 1.6 * vn * ny + bvy; }
      if (phase === "aim") { phase = "roll"; slow = 0; last = { x: ball.x, y: ball.y }; } // balle au repos poussée par une aile
    }
  }
  function splash() {
    phase = "splash"; splashAt = { x: ball.x, y: ball.y };
    n++;
    if (!ui.reduced()) for (let i = 0; i < 3; i++) fx.push({ kind: "ring", x: ball.x, y: ball.y, vx: 0, vy: 0, size: 4 + i * 5, grow: 34, life: 0.9, max: 0.9, color: "#cfe9ff", flat: 0.7 });
    msg = msgOf("Plouf !", "Balle replacée · +1 coup de pénalité", "#7cc4ff", 1.3);
    ui.say("Plouf ! La balle est replacée, un coup de pénalité.");
    ui.refresh();
    wait(1.1, () => {
      splashAt = null; ball.x = last.x; ball.y = last.y; ball.vx = ball.vy = 0;
      if (n >= GOLF.maxStrokes) pickUp(); else { phase = "aim"; pointAtHole(); }
    });
  }
  function stopBall() {
    ball.vx = ball.vy = 0;
    if (n >= GOLF.maxStrokes) { pickUp(); return; }
    phase = "aim"; pointAtHole();
    ui.say(`Coup ${n} joué. ${Math.round(Math.hypot(hole().hole[0] - ball.x, hole().hole[1] - ball.y) / 10)} pas du trou.`);
  }
  function pickUp() {
    strokes[h] = GOLF.maxStrokes;
    msg = msgOf("Balle ramassée", `${GOLF.maxStrokes} coups sur ce trou`, "#ffb36b", 1.8);
    ui.say(`Balle ramassée : ${GOLF.maxStrokes} coups sur le trou ${h + 1}.`);
    ui.refresh();
    wait(1.9, nextHole);
  }
  function holed() {
    const score = Math.min(n, GOLF.maxStrokes), diff = score - par(h);
    strokes[h] = score;
    const ace = score === 1;
    const name = ace ? "Trou en un !" : SCORE_NAMES[diff] ?? `+${diff}`;
    msg = msgOf(name, `${score} coup${score > 1 ? "s" : ""} · par ${par(h)}`, ace ? "#ffe08a" : diff < 0 ? "#7ef0a6" : diff === 0 ? "#f4d699" : "#ffb36b", ace ? 2.6 : 1.8, ace || diff < 0);
    if (!ui.reduced() && (ace || diff < 0)) confetti(fx, hole().hole[0], hole().hole[1], ace ? 110 : 40);
    ui.say(`${name} Trou ${h + 1} en ${score} coup${score > 1 ? "s" : ""}, par ${par(h)}.`);
    ui.refresh();
    wait(ace ? 2.6 : 1.9, nextHole);
  }
  function nextHole() {
    if (h + 1 < HOLES.length) { startHole(h + 1); return; }
    phase = "over";
    const payload = { sport: "golf", strokes: [...strokes], duration: Math.max(1, Math.round(playTime)) };
    const mine = result = { payload, reward: null };
    ui.say(`Parcours terminé en ${total()} coups, ${vsPar(total() - parSoFar())}.`);
    ui.overlay(resultHtml());
    ui.refresh();
    ui.send(payload).then(r => { mine.reward = r; if (phase === "over" && result === mine) ui.overlay(resultHtml()); ui.refresh(); });
  }
  // ----- boucle -----
  function update(dt, keys) {
    time += dt;
    if (msg) { msg.t += dt; if (msg.t > msg.dur) msg = null; }
    stepFx(fx, dt);
    flashes = flashes.map(f => Math.max(0, f - dt));
    const H0 = hole();
    if (H0.mill) mill += H0.mill.w * dt;
    if (phase === "setup" || phase === "over") return;
    playTime += dt;
    if (phase === "aim") {
      const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), ky = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      if (kx && !drag) aim.ang += kx * (keys.shift ? 0.45 : 1.5) * dt;
      if (ky && !drag) aim.pow = clamp(aim.pow + ky * 0.6 * dt, 0, 1);
      if (H0.mill) collideMill(H0.mill);
      if (phase === "aim") { ball.vx = ball.vy = 0; }
    }
    if (club && phase === "aim") club = null; // la balle s'est arrêtée : le putter revient derrière elle, sur la nouvelle visée
    if (club) {
      club.t += dt;
      if (phase === "swing" && club.t >= 0.14) launchBall();
      if (phase !== "aim" && phase !== "swing") club.fade += dt;
      if (club.fade > 0.45) club = null;
    }
    if (phase === "roll") {
      const sp = Math.hypot(ball.vx, ball.vy), steps = Math.max(1, Math.ceil((sp * dt) / 2.5)) + (H0.mill ? 1 : 0);
      for (let i = 0; i < steps && phase === "roll"; i++) physics(dt / steps);
      if (phase === "roll") {
        const s = Math.hypot(ball.vx, ball.vy), onSlope = H0.slopes.some(r => inRect(r, ball.x, ball.y));
        if (s < (onSlope ? 14 : 7)) { slow += dt; if (!onSlope || slow > 0.7) stopBall(); } else slow = 0;
      }
    } else if (phase === "sink") {
      sinkT += dt;
      const [hx, hy] = H0.hole; ball.x += (hx - ball.x) * Math.min(1, dt * 14); ball.y += (hy - ball.y) * Math.min(1, dt * 14);
      if (sinkT > 0.32) holed();
    } else if (phase === "pause") {
      timer -= dt; if (timer <= 0) { const fn = then; then = null; fn?.(); }
    }
  }

  // ----- rendu -----
  function buildCache(k) {
    const { cv, c } = offscreen(k), H0 = hole(), rnd = seeded(31 + h);
    c.fillStyle = "#14211a"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(255, 255, 255, .03)"; c.lineWidth = 1;
    for (let x = 0; x < W; x += 24) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    const shape = () => { c.beginPath(); H0.shape.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
    // ombre portée du parcours
    c.save(); c.translate(4, 6); shape(); c.fillStyle = "rgba(0, 0, 0, .35)"; c.fill(); c.restore();
    shape(); const gr = c.createLinearGradient(0, 40, 0, 590); gr.addColorStop(0, "#4f9f58"); gr.addColorStop(1, "#3a7341"); c.fillStyle = gr; c.fill();
    c.save(); shape(); c.clip();
    for (let y = 40; y < 600; y += 36) { c.fillStyle = "rgba(255, 255, 255, .045)"; c.fillRect(0, y, W, 18); }
    for (let i = 0; i < 500; i++) { c.fillStyle = rnd() < 0.5 ? "rgba(20, 60, 25, .18)" : "rgba(170, 230, 150, .1)"; c.fillRect(rnd() * W, 40 + rnd() * 560, 1.3, 2.4); }
    // pentes : bande hachurée (les chevrons animés sont dessinés à chaque image)
    for (const s of H0.slopes) {
      c.save(); c.beginPath(); c.rect(s.x, s.y, s.w, s.h); c.clip();
      c.fillStyle = "rgba(20, 50, 25, .28)"; c.fillRect(s.x, s.y, s.w, s.h);
      c.strokeStyle = "rgba(255, 255, 255, .06)"; c.lineWidth = 6;
      for (let o = -s.h; o < s.w + s.h; o += 14) { c.beginPath(); c.moveTo(s.x + o, s.y); c.lineTo(s.x + o + s.h, s.y + s.h); c.stroke(); }
      c.restore();
    }
    // bunkers
    for (const e of H0.sand) {
      c.fillStyle = "#2f6136"; c.beginPath(); c.ellipse(e.x, e.y, e.rx + 3, e.ry + 3, 0, 0, TAU); c.fill();
      const sg = c.createRadialGradient(e.x - e.rx * 0.3, e.y - e.ry * 0.3, 2, e.x, e.y, e.rx);
      sg.addColorStop(0, "#f0dfae"); sg.addColorStop(1, "#cdb57a"); c.fillStyle = sg;
      c.beginPath(); c.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU); c.fill();
      for (let i = 0; i < e.rx * e.ry / 6; i++) {
        const a0 = rnd() * TAU, r0 = Math.sqrt(rnd());
        c.fillStyle = rnd() < 0.5 ? "rgba(140, 110, 60, .35)" : "rgba(255, 250, 230, .5)";
        c.fillRect(e.x + Math.cos(a0) * r0 * (e.rx - 2), e.y + Math.sin(a0) * r0 * (e.ry - 2), 1.2, 1.2);
      }
    }
    // départ
    const [tx, ty] = H0.tee;
    c.fillStyle = "#2b5a33"; rrect(c, tx - 16, ty - 12, 32, 24, 5); c.fill();
    c.strokeStyle = "rgba(255, 255, 255, .25)"; c.lineWidth = 1; c.stroke();
    c.restore();
    // bords en bois
    c.lineJoin = "round"; shape(); c.lineWidth = 12; c.strokeStyle = "#6e4523"; c.stroke();
    shape(); c.lineWidth = 4; c.strokeStyle = "#a4703f"; c.stroke();
    for (const [x1, y1, x2, y2] of H0.walls) {
      c.lineCap = "round"; c.lineWidth = 10; c.strokeStyle = "#6e4523"; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.lineWidth = 3.5; c.strokeStyle = "#a4703f"; c.stroke();
    }
    // trou
    const [hx, hy] = H0.hole;
    c.fillStyle = "#2f6136"; c.beginPath(); c.arc(hx, hy, HOLE_R + 4, 0, TAU); c.fill();
    const hg = c.createRadialGradient(hx + 2, hy + 2, 1, hx, hy, HOLE_R);
    hg.addColorStop(0, "#020403"); hg.addColorStop(1, "#18241b"); c.fillStyle = hg;
    c.beginPath(); c.arc(hx, hy, HOLE_R, 0, TAU); c.fill();
    c.strokeStyle = "rgba(255, 255, 255, .55)"; c.lineWidth = 1.2; c.beginPath(); c.arc(hx, hy, HOLE_R, Math.PI * 0.1, Math.PI * 0.95); c.stroke();
    return cv;
  }
  function drawWater(c, e) {
    c.save();
    c.fillStyle = "#245a3a"; c.beginPath(); c.ellipse(e.x, e.y, e.rx + 3.5, e.ry + 3.5, 0, 0, TAU); c.fill();
    const wg = c.createRadialGradient(e.x - e.rx * 0.3, e.y - e.ry * 0.4, 3, e.x, e.y, e.rx);
    wg.addColorStop(0, "#5aa7e0"); wg.addColorStop(1, "#215f9c"); c.fillStyle = wg;
    c.beginPath(); c.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU); c.fill(); c.clip();
    c.strokeStyle = "rgba(220, 240, 255, .35)"; c.lineWidth = 1.2;
    const shift = ui.reduced() ? 0 : time * 10;
    for (let i = -3; i <= 3; i++) {
      const yy = e.y + i * 8, xx = e.x + ((i * 17 + shift) % 30) - 15;
      c.beginPath(); c.moveTo(xx - 10, yy); c.quadraticCurveTo(xx - 5, yy - 2.5, xx, yy); c.quadraticCurveTo(xx + 5, yy + 2.5, xx + 10, yy); c.stroke();
    }
    c.restore();
  }
  function drawSlope(c, s) {
    c.save(); c.beginPath(); c.rect(s.x, s.y, s.w, s.h); c.clip();
    const ang = Math.atan2(s.fy, s.fx), along = Math.abs(s.fx) > Math.abs(s.fy) ? s.w : s.h, across = along === s.w ? s.h : s.w;
    const shift = ui.reduced() ? 0 : (time * 26) % 26;
    c.translate(s.x + s.w / 2, s.y + s.h / 2); c.rotate(ang);
    c.strokeStyle = "rgba(235, 255, 225, .35)"; c.lineWidth = 2.4; c.lineCap = "round";
    for (let u = -along / 2 - 26 + shift; u < along / 2 + 26; u += 26) {
      for (let v = -across / 2 + 14; v < across / 2; v += 30) { c.beginPath(); c.moveTo(u - 5, v - 7); c.lineTo(u + 3, v); c.lineTo(u - 5, v + 7); c.stroke(); }
    }
    c.restore();
    c.fillStyle = "rgba(235, 255, 225, .7)"; c.font = `600 10px ${FONT}`; c.textAlign = "left"; c.textBaseline = "top";
    c.fillText("PENTE", s.x + 4, s.y + 3);
  }
  function drawMill(c, m) {
    // ombre des ailes
    c.save();
    c.lineCap = "round";
    for (const [x1, y1, x2, y2] of millBlades(m)) { c.strokeStyle = "rgba(0, 0, 0, .22)"; c.lineWidth = 12; c.beginPath(); c.moveTo(x1 + 4, y1 + 5); c.lineTo(x2 + 4, y2 + 5); c.stroke(); }
    for (let i = 0; i < 4; i++) {
      const a0 = mill + i * Math.PI / 2;
      c.save(); c.translate(m.x, m.y); c.rotate(a0);
      c.fillStyle = "#6e4523"; c.fillRect(m.hub - 2, -2.5, m.len - m.hub + 2, 5);
      c.fillStyle = "rgba(244, 239, 230, .92)"; c.fillRect(m.hub + 6, 2.5, m.len - m.hub - 8, 9);
      c.strokeStyle = "#8a5a2b"; c.lineWidth = 1;
      for (let x = m.hub + 6; x <= m.len - 2; x += 8) { c.beginPath(); c.moveTo(x, 2.5); c.lineTo(x, 11.5); c.stroke(); }
      c.strokeRect(m.hub + 6, 2.5, m.len - m.hub - 8, 9);
      c.restore();
    }
    const rg = c.createRadialGradient(m.x - 4, m.y - 4, 2, m.x, m.y, m.hub);
    rg.addColorStop(0, "#c46a3a"); rg.addColorStop(1, "#7a3418");
    c.fillStyle = rg; c.beginPath(); c.arc(m.x, m.y, m.hub, 0, TAU); c.fill();
    c.strokeStyle = "#4a2410"; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = "#e8c27a"; c.beginPath(); c.arc(m.x, m.y, 3, 0, TAU); c.fill();
    c.restore();
  }
  function drawFlag(c) {
    const [hx, hy] = hole().hole, near = Math.hypot(ball.x - hx, ball.y - hy) < 70 || phase === "sink";
    c.save(); c.globalAlpha = near ? 0.35 : 1;
    c.strokeStyle = "rgba(0, 0, 0, .25)"; c.lineWidth = 2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + 26, hy + 10); c.stroke();
    const tx = hx - 4, ty = hy - 52;
    c.strokeStyle = "#f4f1e8"; c.lineWidth = 2.2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
    const wave = ui.reduced() ? 0 : Math.sin(time * 5) * 3;
    c.fillStyle = "#e0393e";
    c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(tx + 14, ty + 2 + wave, tx + 28, ty + 7 + wave * 0.6); c.quadraticCurveTo(tx + 14, ty + 11 - wave, tx, ty + 15); c.closePath(); c.fill();
    c.fillStyle = "#fff"; c.font = `700 9px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(h + 1), tx + 10, ty + 8);
    c.restore();
  }
  function drawBumpers(c) {
    hole().bumpers.forEach((u, i) => {
      const f = flashes[i] ?? 0;
      c.fillStyle = "rgba(0, 0, 0, .3)"; c.beginPath(); c.arc(u.x + 3, u.y + 4, u.r, 0, TAU); c.fill();
      c.fillStyle = f > 0 ? "#ffe08a" : "#c8283c"; c.beginPath(); c.arc(u.x, u.y, u.r, 0, TAU); c.fill();
      c.fillStyle = "#f4efe6"; c.beginPath(); c.arc(u.x, u.y, u.r * 0.68, 0, TAU); c.fill();
      c.fillStyle = f > 0 ? "#ffe08a" : "#c8283c"; c.beginPath(); c.arc(u.x, u.y, u.r * 0.38, 0, TAU); c.fill();
      if (f > 0 && !ui.reduced()) { c.strokeStyle = `rgba(255, 224, 138, ${f * 2.4})`; c.lineWidth = 2; c.beginPath(); c.arc(u.x, u.y, u.r + 6 + (0.35 - f) * 30, 0, TAU); c.stroke(); }
    });
  }
  function drawBall(c) {
    if (phase === "splash" || (phase === "pause" && splashAt)) return;
    let r = BALL_R;
    if (phase === "sink") r = BALL_R * Math.max(0.2, 1 - sinkT / 0.34);
    if (phase === "pause" && !splashAt && strokes[h] != null) return;
    c.fillStyle = "rgba(0, 0, 0, .3)"; c.beginPath(); c.ellipse(ball.x + 2, ball.y + 3, r, r * 0.8, 0, 0, TAU); c.fill();
    const g = c.createRadialGradient(ball.x - r * 0.4, ball.y - r * 0.4, 0.5, ball.x, ball.y, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#cfd4dc");
    c.fillStyle = g; c.beginPath(); c.arc(ball.x, ball.y, r, 0, TAU); c.fill();
    c.fillStyle = "rgba(120, 130, 145, .4)";
    for (const [dx, dy] of [[1.5, 1], [-1, 2], [2, -1.5]]) { c.beginPath(); c.arc(ball.x + dx * r / 6, ball.y + dy * r / 6, 0.7, 0, TAU); c.fill(); }
  }
  // Putter vu de dessus : tête derrière la balle, manche qui remonte vers le golfeur, à droite du coup.
  function drawClub(c) {
    if (!club && phase !== "aim") return;
    const ang = club ? club.ang : aim.ang, pow = club ? club.pow : aim.pow;
    let back = 4 + pow * 30, alpha = 1;
    if (club) {
      const t = clamp(club.t / 0.14, 0, 1);
      back = (4 + pow * 30) * (1 - t * t) - (club.t > 0.14 ? Math.min(10, (club.t - 0.14) * 60) : 0);
      alpha = clamp(1 - club.fade / 0.45, 0, 1);
    }
    const ox = club && phase !== "swing" ? last.x : ball.x, oy = club && phase !== "swing" ? last.y : ball.y;
    c.save(); c.globalAlpha = alpha;
    c.translate(ox - Math.cos(ang) * (BALL_R + 3 + back), oy - Math.sin(ang) * (BALL_R + 3 + back)); c.rotate(ang);
    c.strokeStyle = "rgba(0, 0, 0, .25)"; c.lineWidth = 3; c.beginPath(); c.moveTo(3, 4); c.lineTo(-10, 66); c.stroke();
    c.strokeStyle = "#c9ced6"; c.lineWidth = 2.4; c.lineCap = "round"; c.beginPath(); c.moveTo(0, 4); c.lineTo(-13, 62); c.stroke();
    c.strokeStyle = "#1c1f26"; c.lineWidth = 5; c.beginPath(); c.moveTo(-10, 48); c.lineTo(-14, 66); c.stroke();
    const hg = c.createLinearGradient(-3, 0, 3, 0); hg.addColorStop(0, "#7d8794"); hg.addColorStop(1, "#e3e8ee");
    c.fillStyle = hg; rrect(c, -3.5, -12, 7, 24, 2.5); c.fill();
    c.fillStyle = "#e8c27a"; c.fillRect(2.2, -9, 1.3, 18);
    c.restore();
  }
  function drawAim(c) {
    if (phase !== "aim") return;
    const len = 26 + aim.pow * 120, ex = ball.x + Math.cos(aim.ang) * len, ey = ball.y + Math.sin(aim.ang) * len;
    const col = `hsl(${Math.round(120 - 115 * aim.pow)}, 80%, 58%)`;
    if (drag?.moved) {
      c.strokeStyle = "rgba(255, 255, 255, .45)"; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(ball.x, ball.y); c.lineTo(ball.x - Math.cos(aim.ang) * aim.pow * 60, ball.y - Math.sin(aim.ang) * aim.pow * 60); c.stroke();
      c.fillStyle = "rgba(255, 255, 255, .7)"; c.beginPath(); c.arc(ball.x - Math.cos(aim.ang) * aim.pow * 60, ball.y - Math.sin(aim.ang) * aim.pow * 60, 4, 0, TAU); c.fill();
    }
    c.strokeStyle = col; c.lineWidth = 3; c.setLineDash([7, 6]); c.lineCap = "round";
    c.beginPath(); c.moveTo(ball.x + Math.cos(aim.ang) * 10, ball.y + Math.sin(aim.ang) * 10); c.lineTo(ex, ey); c.stroke();
    c.setLineDash([]);
    c.fillStyle = col; c.save(); c.translate(ex, ey); c.rotate(aim.ang);
    c.beginPath(); c.moveTo(10, 0); c.lineTo(-5, -7); c.lineTo(-5, 7); c.closePath(); c.fill(); c.restore();
  }
  function drawHud(c) {
    c.fillStyle = "rgba(6, 10, 18, .82)"; c.fillRect(0, 0, W, 36);
    c.textBaseline = "middle"; c.textAlign = "left"; c.font = `700 13px ${FONT}`; c.fillStyle = "#f4d699";
    c.fillText(`TROU ${h + 1}/${HOLES.length} · PAR ${par(h)}`, 12, 18);
    c.font = `600 12px ${FONT}`; c.fillStyle = "#c9cede"; c.fillText(hole().name, 152, 18);
    c.textAlign = "right"; c.font = `700 13px ${MONO}`; c.fillStyle = "#eef0f6";
    c.fillText(`COUP ${Math.max(n, 0)}/${GOLF.maxStrokes}`, W - 12, 18);
    if (strokes.length) { c.fillStyle = "#8e95aa"; c.font = `600 11px ${MONO}`; c.fillText(`Total ${total()} (${vsPar(total() - parSoFar())})`, W - 122, 18); }
    // jauge de puissance
    if (phase === "aim" || phase === "swing") {
      const x = W - 24, y = 70, hh = 200, pw = phase === "aim" ? aim.pow : club?.pow ?? 0;
      c.fillStyle = "rgba(6, 10, 18, .7)"; rrect(c, x - 4, y - 4, 18, hh + 8, 8); c.fill();
      const g = c.createLinearGradient(0, y + hh, 0, y); g.addColorStop(0, "#4ade80"); g.addColorStop(0.6, "#fbbf24"); g.addColorStop(1, "#ff5d5d");
      c.fillStyle = g; rrect(c, x, y + hh * (1 - pw), 10, hh * pw, 4); c.fill();
      c.fillStyle = "#eef0f6"; c.font = `700 10px ${MONO}`; c.textAlign = "center"; c.fillText(`${Math.round(pw * 100)}%`, x + 5, y + hh + 16);
    }
  }
  function draw(c, k) {
    if (!cache || cache.k !== k || cache.h !== h) cache = { k, h, cv: buildCache(k) };
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(cache.cv, 0, 0); c.restore();
    const H0 = hole();
    H0.slopes.forEach(s => drawSlope(c, s));
    H0.water.forEach(e => drawWater(c, e));
    drawBumpers(c);
    drawAim(c);
    drawBall(c);
    if (H0.mill) drawMill(c, H0.mill);
    drawClub(c);
    drawFlag(c);
    drawFx(c, fx);
    drawHud(c);
    drawMsg(c, msg, ui.reduced(), 300);
  }

  // ----- interface -----
  function pointer(type, x, y, e) {
    if (type === "down") {
      if (phase !== "aim") return;
      drag = { sx: x, sy: y, moved: false, id: e.pointerId };
      return;
    }
    if (!drag || (e.pointerId != null && drag.id !== e.pointerId)) return;
    if (type === "move") {
      const dx = drag.sx - x, dy = drag.sy - y, d = Math.hypot(dx, dy);
      if (d > 6) { drag.moved = true; aim.ang = Math.atan2(dy, dx); aim.pow = clamp(d / 170, 0, 1); }
    } else if (type === "up") {
      const ok = drag.moved && aim.pow >= 0.05;
      drag = null;
      if (ok) shoot();
    } else if (type === "cancel") drag = null;
  }
  function key(e, down) {
    if (down && !e.repeat && (e.key === " " || e.key === "Enter") && phase === "aim") { shoot(); return true; }
    return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter"].includes(e.key);
  }
  function start() {
    strokes = []; playTime = 0; result = null; fx = []; msg = null;
    ui.overlay(null);
    startHole(0);
    ui.focusCanvas();
  }
  function setupHtml() {
    const p0 = GOLF.par0, up = GOLF.underPar;
    return `<div class="sport-card"><h4>Parcours de ${HOLES.length} trous · par ${GOLF.par.reduce((s, v) => s + v, 0)}</h4>
      <p>${HOLES.map((x, i) => `Trou ${i + 1} : ${x.name}, par ${par(i)}`).join(" · ")}. Bunker, étang, pente, bumper et moulin.</p>
      <ul class="sport-bareme"><li>Parcours au par : <b>${gainText(p0.money, p0.xp)}</b></li><li>Chaque coup sous le par : <b>${gainText(up.money, up.xp)}</b></li>
        <li>Trou en un : <b>+${GOLF.ace} ${CURRENCY}</b> par trou</li><li>Au-dessus du par : <b>+${GOLF.overXp} XP</b></li></ul>
      <p class="sport-small">Balle ramassée à ${GOLF.maxStrokes} coups. ${limitText(ui.left("golf"))}</p>
      <button type="button" class="sport-go" data-act="start">Commencer le parcours</button></div>`;
  }
  function resultHtml() {
    const t = total(), d = t - parSoFar(), rw = result?.reward, aces = strokes.filter(v => v === 1).length;
    return `<div class="sport-card result ${d <= 0 ? "won" : ""}"><p class="sport-kicker">Parcours terminé</p>
      <h4>${t} coups · ${vsPar(d)}${aces ? ` · ${aces} trou${aces > 1 ? "s" : ""} en un !` : ""}</h4>
      ${cardHtml(true)}
      <p class="sport-reward ${rw ? rw.tone : ""}" role="status">${rw ? rw.html : "Envoi du résultat…"}</p>
      <div class="sport-row"><button type="button" class="sport-go" data-act="start">Rejouer</button></div></div>`;
  }
  function cardHtml(compact = false) {
    const cell = i => {
      const v = strokes[i];
      if (v == null) return `<td${i === h && phase !== "setup" && phase !== "over" ? ' class="now"' : ""}>${i === h && n && phase !== "setup" && phase !== "over" ? `<small>${n}</small>` : "–"}</td>`;
      const d = v - par(i);
      return `<td class="${v === 1 ? "ace" : d < 0 ? "under" : d > 0 ? "over" : "par"}">${v}</td>`;
    };
    return `<table class="sport-card-table${compact ? " compact" : ""}"><caption class="sr-only">Carte de score</caption>
      <thead><tr><th scope="col">Trou</th>${HOLES.map((_, i) => `<th scope="col">${i + 1}</th>`).join("")}<th scope="col">Total</th></tr></thead>
      <tbody><tr><th scope="row">Par</th>${HOLES.map((_, i) => `<td>${par(i)}</td>`).join("")}<td>${GOLF.par.reduce((s, v) => s + v, 0)}</td></tr>
      <tr><th scope="row">Toi</th>${HOLES.map((_, i) => cell(i)).join("")}<td><b>${strokes.length ? total() : "–"}</b></td></tr></tbody></table>`;
  }
  function act(name) { if (name === "start") start(); }
  function sideHtml() {
    const p0 = GOLF.par0;
    return `<h4>Carte de score</h4>${cardHtml()}
      <h4>Gains</h4><p class="sport-small">Au par : ${gainText(p0.money, p0.xp)} · sous le par : ${gainText(GOLF.underPar.money, GOLF.underPar.xp)} par coup · trou en un : +${GOLF.ace} ${CURRENCY}</p>
      <p class="sport-small sport-limit">${limitText(ui.left("golf"))}</p>
      <details class="sport-help"${ui.wide() ? " open" : ""}><summary>Commandes</summary><ul>
        <li><b>Glisser</b> depuis la balle vers l'arrière, comme une fronde, puis relâcher</li><li><b>← →</b> viser (Maj : plus fin), <b>↑ ↓</b> puissance, <b>Espace</b> frapper</li>
        <li><b>Sable</b> : freine fort · <b>Eau</b> : balle replacée, +1 coup · <b>Pente</b> : pousse la balle</li>
        <li>La balle tombe si elle passe <b>lentement</b> sur le trou</li><li><b>P</b> : pause</li></ul></details>`;
  }
  return {
    update, draw, pointer, key, act, sideHtml,
    setup() { phase = "setup"; h = 0; const H0 = hole(); H0.segs ??= segments(H0); ball.x = H0.tee[0]; ball.y = H0.tee[1]; ui.overlay(setupHtml()); },
    playing: () => !(phase === "setup" || phase === "over"),
    resized() { cache = null; },
    snapshot: () => ({ phase, hole: h, n, strokes: [...strokes], playTime, ball: { ...ball }, aim: { ...aim }, target: hole().hole, mill,
      result: result && { ...result, reward: result.reward && { ...result.reward } } }),
  };
}

function limitText(left) {
  if (left == null) return `${DAILY} parties récompensées par jour et par sport ; au-delà, on joue pour le plaisir.`;
  if (left <= 0) return "Limite du jour atteinte : les prochaines parties se jouent pour le plaisir, sans gain.";
  return `Encore ${left} partie${left > 1 ? "s" : ""} récompensée${left > 1 ? "s" : ""} aujourd'hui (sur ${DAILY}).`;
}

// =====================================================================================================================
// Dialogue : sélecteur de sport, canvas, panneau latéral, envoi du résultat.
// =====================================================================================================================
export function createSportsGames({ dialog, body, esc, getToken, onResult, celebrate }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const prefs = { level: "pro" };
  const left = { tennis: null, golf: null };
  const keys = { left: false, right: false, up: false, down: false, shift: false };
  let sport = "tennis", game = null, raf = 0, last = 0, ac = null, ro = null, canvas = null, ctx = null, view = { sc: 1, k: 1 }, paused = false;
  let el = {}, sideKey = "", mountId = 0;

  // Chaque partie reçoit son interface ; une partie d'un montage précédent (dialogue refermé, autre sport) n'y touche plus,
  // même quand la réponse du serveur arrive après coup.
  const uiFor = id => {
    const live = () => id === mountId;
    return {
      prefs,
      reduced: () => reduced.matches,
      wide: () => innerWidth > 760,
      left: s => left[s],
      say(text) { if (live() && el.status) el.status.textContent = text; },
      overlay(html) { if (live()) showOverlay(html); },
      focusCanvas() { if (live()) canvas?.focus({ preventScroll: true }); },
      refresh() { if (live()) renderSide(); },
      send,
    };
  };

  async function send(payload) {
    const s = payload.sport, token = getToken?.();
    if (!token) return { html: esc(KEY_MSG), tone: "warn" };
    let r, j = null;
    try {
      r = await fetch("/api/game/sport", { method: "POST", headers: { "Content-Type": "application/json", "X-Tour-Token": token }, body: JSON.stringify(payload) });
      try { j = await r.json(); } catch { j = null; }
    } catch {
      return { html: "Connexion impossible : résultat non enregistré.", tone: "err" };
    }
    if (r.status === 401 || r.status === 403) return { html: esc(KEY_MSG), tone: "warn" };
    if (!r.ok || !j) return { html: esc(j?.error ?? "Résultat non enregistré."), tone: "err" };
    const rw = j.reward ?? {};
    if (Number.isFinite(rw.left)) left[s] = rw.left;
    try { onResult?.(j); } catch (e) { console.error(e); }
    try { if (j.toasts?.length) celebrate?.(j.toasts); } catch (e) { console.error(e); }
    renderSide(true);
    if (rw.capped) return { html: esc("Limite du jour atteinte : partie jouée pour le plaisir, sans gain."), tone: "mute" };
    const g = gainText(Number(rw.money) || 0, Number(rw.xp) || 0);
    const after = Number.isFinite(rw.left) ? ` <small>${esc(limitText(rw.left))}</small>` : "";
    return { html: g ? `Gagné : <b>${esc(g)}</b>${after}` : `Pas de gain cette fois.${after}`, tone: g ? "ok" : "mute" };
  }

  function renderSide(force = false) {
    if (!el.side || !game) return;
    const html = game.sideHtml();
    if (!force && html === sideKey) return;
    // Le panneau d'aide reste ouvert ou fermé comme le résident l'a laissé.
    const open = el.side.querySelector("details")?.open;
    sideKey = html;
    el.side.innerHTML = html;
    if (open != null) { const d = el.side.querySelector("details"); if (d) d.open = open; }
  }

  function shellHtml() {
    return `<div class="sport" data-sport="${sport}">
      <header class="sport-head">
        <h3 id="sportTitle">${sport === "tennis" ? "🎾 Tennis · match contre le robot du club" : "⛳ Golf · parcours de mini-golf"}</h3>
        <div class="sport-switch" role="group" aria-label="Choisir le sport">
          <button type="button" data-sport="tennis" aria-pressed="${sport === "tennis"}">🎾 Tennis</button>
          <button type="button" data-sport="golf" aria-pressed="${sport === "golf"}">⛳ Golf</button>
        </div>
      </header>
      <div class="sport-layout">
        <div class="sport-col">
          <div class="sport-stage">
            <canvas class="sport-canvas" tabindex="0" aria-label="${sport === "tennis" ? "Court de tennis : déplace la raquette et frappe la balle" : "Parcours de mini-golf : vise et règle la puissance"}"></canvas>
            <div class="sport-overlay" hidden></div>
          </div>
          <div class="sport-bar"><p class="sport-status" role="status" aria-live="polite"></p>
            <button type="button" class="sport-pause" data-act="pause" aria-label="Mettre en pause">⏸</button></div>
        </div>
        <aside class="sport-side" aria-label="Score et règles"></aside>
      </div></div>`;
  }

  function resize() {
    if (!canvas || !el.col) return;
    const availW = el.col.clientWidth || W;
    const availH = Math.max(280, innerHeight - (innerWidth <= 720 ? 190 : 200));
    const sc = clamp(Math.min(availW / W, availH / H), 0.45, 1.6);
    const dpr = clamp(devicePixelRatio || 1, 1, 2), cw = Math.round(W * sc), ch = Math.round(H * sc);
    const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw; canvas.height = bh;
      canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
      view = { sc, k: bw / W };
      game?.resized();
    }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    let dt = (t - last) / 1000;
    last = t;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    if (!paused) game.update(dt, keys);
    ctx.setTransform(view.k, 0, 0, view.k, 0, 0);
    game.draw(ctx, view.k);
    if (paused) {
      ctx.fillStyle = "rgba(6, 8, 18, .55)"; ctx.fillRect(0, 0, W, H);
    }
  }

  function showOverlay(html) {
    if (!el.overlay) return;
    el.overlay.hidden = !html;
    el.overlay.innerHTML = html ?? "";
    if (html) el.overlay.querySelector(".sport-go")?.focus({ preventScroll: true });
  }

  function pause(on) {
    if (!game) return;
    if (on && !game.playing()) return;
    paused = on;
    for (const k of Object.keys(keys)) keys[k] = false;
    if (on) {
      showOverlay(`<div class="sport-card"><h4>⏸ Pause</h4><p>La partie t'attend : le chrono est arrêté.</p><button type="button" class="sport-go" data-act="resume">Reprendre</button></div>`);
      if (el.status) el.status.textContent = "Partie en pause.";
    } else {
      showOverlay(null);
      canvas?.focus({ preventScroll: true });
      last = performance.now();
    }
  }

  const KEYMAP = { ArrowLeft: "left", a: "left", q: "left", ArrowRight: "right", d: "right", ArrowUp: "up", w: "up", z: "up", ArrowDown: "down", s: "down" };
  // Écouté sur le document tant que le dialogue est ouvert (le focus peut retomber sur <body> dans un dialogue modal) ;
  // une touche utilisée par le jeu ne remonte pas jusqu'à la tour (↑ ↓ y changent d'étage).
  function onKey(e, down) {
    if (!game || !dialog.open || e.ctrlKey || e.metaKey || e.altKey || !e.key) return;
    const tag = e.target?.tagName;
    const control = tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "SUMMARY" || tag === "A" || tag === "TEXTAREA";
    const used = () => { e.preventDefault(); e.stopPropagation(); };
    keys.shift = e.shiftKey;
    const name = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (paused) {
      if (down && (e.key.toLowerCase() === "p" || (!control && (e.key === " " || e.key === "Enter")))) { used(); pause(false); }
      else if (name) used();
      return;
    }
    if (down && e.key.toLowerCase() === "p" && game.playing()) { used(); pause(true); return; }
    if (name && !(control && tag !== "BUTTON")) { keys[name] = down; if (e.key.startsWith("Arrow")) used(); }
    if (control && (e.key === " " || e.key === "Enter")) return;
    if (game.key(e, down, keys)) used();
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
  }

  function mount(s) {
    teardown();
    sport = s;
    sideKey = "";
    body.innerHTML = shellHtml();
    el = {
      root: body.querySelector(".sport"), col: body.querySelector(".sport-col"), overlay: body.querySelector(".sport-overlay"),
      side: body.querySelector(".sport-side"), status: body.querySelector(".sport-status"),
    };
    canvas = body.querySelector(".sport-canvas");
    ctx = canvas.getContext("2d");
    ac = new AbortController();
    const { signal } = ac;
    body.addEventListener("click", e => {
      const sw = e.target.closest("[data-sport]");
      if (sw && sw.tagName === "BUTTON") { if (sw.dataset.sport !== sport) mount(sw.dataset.sport); return; }
      const lvl = e.target.closest("[data-level]");
      if (lvl) { game.act("level", lvl); return; }
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "pause") pause(!paused);
      else if (b.dataset.act === "resume") pause(false);
      else game.act(b.dataset.act, b);
    }, { signal });
    document.addEventListener("keydown", e => onKey(e, true), { signal });
    document.addEventListener("keyup", e => onKey(e, false), { signal });
    canvas.addEventListener("pointerdown", e => {
      if (paused || !game) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      const [x, y] = local(e); game.pointer("down", x, y, e); e.preventDefault();
    }, { signal });
    canvas.addEventListener("pointermove", e => { if (!paused && game) { const [x, y] = local(e); game.pointer("move", x, y, e); } }, { signal });
    canvas.addEventListener("pointerup", e => { if (!paused && game) { const [x, y] = local(e); game.pointer("up", x, y, e); } }, { signal });
    canvas.addEventListener("pointercancel", e => game?.pointer("cancel", 0, 0, e), { signal });
    canvas.addEventListener("contextmenu", e => e.preventDefault(), { signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); }, { signal });
    window.addEventListener("blur", () => { for (const k of Object.keys(keys)) keys[k] = false; }, { signal });
    window.addEventListener("resize", resize, { signal });
    if ("ResizeObserver" in window) { ro = new ResizeObserver(() => resize()); ro.observe(el.col); }
    paused = false;
    const ui = uiFor(++mountId);
    game = s === "golf" ? golfGame(ui) : tennisGame(ui);
    game.setup();
    renderSide(true);
    resize();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function teardown() {
    cancelAnimationFrame(raf); raf = 0;
    ac?.abort(); ac = null;
    ro?.disconnect(); ro = null;
    game = null; paused = false;
    for (const k of Object.keys(keys)) keys[k] = false;
  }

  // Fermeture : la boucle s'arrête et tous les écouteurs partent ; une partie en cours est abandonnée sans envoi.
  dialog.addEventListener("close", () => { teardown(); mountId++; body.innerHTML = ""; canvas = ctx = null; el = {}; });

  function open(s) {
    const which = s === "golf" ? "golf" : "tennis";
    if (!dialog.open) dialog.showModal();
    mount(which);
  }

  const api = { open };
  // Lecture seule, pour les tests automatisés : l'état courant de la partie.
  Object.defineProperty(api, "_etat", { value: () => (game ? { sport, paused, ...game.snapshot() } : null) });
  return api;
}
