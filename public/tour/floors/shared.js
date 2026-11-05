// Étages communs (toit, Salon, Club) et kit des étages de jeu : télé du Salon, fumée, textures dessinées,
// géométries partagées, machines à sous, cartes. buildShared() construit chaque étage commun.

import * as THREE from "three";
import { CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { world } from "../state.js";
import { ASHTRAYS, CAFE_TABLES, CLUB_NPCS, DECK, P, REST_GROUPS, S, STALLS, around } from "../base.js";
import { LightSpot, box, cyl, finishFloor, glow, label, live, mat, renderer, sign } from "../engine.js";
import { drawnTexture, mod1 } from "../kit.js";
import { beacons } from "../city.js";
import { makeRobot, play } from "../robots.js";
import { put, shell } from "./shell.js";
import { buildCasino } from "./casino.js";
import { buildTennis } from "./tennis.js";
import { buildGolf } from "./golf.js";

// ---------- étages communs ----------
// La télécommande : « Auto » met la première chaîne en direct de la liste (Lofi Girl, en direct 24 h/24, en dernier recours).
// La chaîne est commune à tout le penthouse : le serveur la garde, et chacun voit la même télé.
const CHANNEL_NAMES = { otplol_: "OTPLOL", lec: "LEC", riotgames: "Riot Games", kamet0: "Kameto", caedrel: "Caedrel", zerator: "ZeratoR", eslcs: "ESL CS", lofigirl: "Lofi Girl · 24 h/24" };
// Lien perso (idée de la branche de Quentin) : le serveur ne garde qu'une vidéo YouTube ou une chaîne Twitch normalisées.
const tvChannel = () => world.tvChoice !== "auto" && world.tvChoice !== "custom" ? world.tvChoice : Object.keys(world.liveNow).find(c => world.liveNow[c]) ?? "lofigirl";
const streamUrl = c => `https://player.twitch.tv/?channel=${encodeURIComponent(c)}&parent=${location.hostname}&muted=true&autoplay=true`;
// Lien perso valide : seulement les champs normalisés (identifiant YouTube, nom de chaîne Twitch), jamais une URL saisie.
const tvCustomNow = () => {
  if (world.tvChoice !== "custom") return null;
  if (world.tvCustom?.kind === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(world.tvCustom.id ?? "")) return world.tvCustom;
  if (world.tvCustom?.kind === "twitch" && /^[a-z0-9_]{3,25}$/i.test(world.tvCustom.channel ?? "")) return world.tvCustom;
  return null;
};
function tvUrl() {
  const c = tvCustomNow();
  if (c?.kind === "youtube") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(c.id)}?autoplay=1&mute=1&rel=0`;
  return streamUrl(c?.kind === "twitch" ? c.channel : tvChannel());
}
// Page ouverte d'un clic sur l'écran, avec le son.
function tvPageUrl() {
  const c = tvCustomNow();
  if (c?.kind === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(c.id)}`;
  return `https://www.twitch.tv/${encodeURIComponent(c?.kind === "twitch" ? c.channel : tvChannel())}`;
}
const stream = Object.assign(document.createElement("iframe"), { title: "Télé du salon", allow: "autoplay; fullscreen; encrypted-media; picture-in-picture" });
Object.assign(stream.style, { width: "1280px", height: "720px", border: "0", background: "#000", backfaceVisibility: "hidden" });
let tvFrame = null;

// Petits nuages en un seul appel de dessin ; le dégradé évite les particules carrées.
function ambientSmoke(parent, origin, color, count, spread, rise) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d"), gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: spread,
    map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0.4, depthWrite: false }));
  cloud.position.copy(origin);
  cloud.userData = { spread, rise, count };
  cloud.frustumCulled = false;
  parent.add(cloud);
  return cloud;
}

// ---------- étages de jeu : casino, tennis, golf ----------
// Géométries et textures des jeux, créées une seule fois (le reste du kit commun est dans ../kit.js).
const cardGeometry = new THREE.PlaneGeometry(0.11, 0.155).rotateX(-Math.PI / 2);
const reelGeometry = new THREE.PlaneGeometry(0.17, 0.4);
const BULB_ON = new THREE.Color("#ffe9a8"), BULB_DIM = new THREE.Color("#4a2a0c");

// Machines à sous : les six symboles du serveur, dessinés au trait (pas d'émoji : même rendu partout) sur une bande
// verticale ; chaque rouleau en est une copie (même image envoyée une fois à la carte graphique) dont on décale la vue.
const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
let slotStrip = null, reelShade = null, netMap = null;
function drawSlotSymbol(x, i, cx, cy) {
  x.save();
  x.lineJoin = "round";
  if (i === 0) { // cerises
    x.strokeStyle = "#2f7d32"; x.lineWidth = 5;
    x.beginPath(); x.moveTo(cx - 20, cy + 6); x.quadraticCurveTo(cx - 6, cy - 26, cx + 12, cy - 38);
    x.moveTo(cx + 22, cy + 10); x.quadraticCurveTo(cx + 20, cy - 16, cx + 12, cy - 38); x.stroke();
    x.fillStyle = "#48a64c"; x.beginPath(); x.ellipse(cx + 26, cy - 38, 14, 7, -0.4, 0, Math.PI * 2); x.fill();
    for (const [dx, dy] of [[-20, 18], [22, 22]]) {
      const gr = x.createRadialGradient(cx + dx - 7, cy + dy - 7, 2, cx + dx, cy + dy, 22);
      gr.addColorStop(0, "#ff9a9a"); gr.addColorStop(0.5, "#e01b2f"); gr.addColorStop(1, "#7a0614");
      x.fillStyle = gr; x.beginPath(); x.arc(cx + dx, cy + dy, 21, 0, Math.PI * 2); x.fill();
    }
  } else if (i === 1) { // citron
    const gr = x.createRadialGradient(cx - 12, cy - 10, 4, cx, cy, 46);
    gr.addColorStop(0, "#fff7a8"); gr.addColorStop(0.6, "#ffd21f"); gr.addColorStop(1, "#d48f00");
    x.fillStyle = gr;
    x.beginPath(); x.ellipse(cx, cy, 40, 28, -0.25, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(cx + 39, cy - 10, 9, 6, -0.25, 0, Math.PI * 2); x.ellipse(cx - 39, cy + 10, 9, 6, -0.25, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#a06c00"; x.lineWidth = 2; x.beginPath(); x.ellipse(cx, cy, 40, 28, -0.25, 0, Math.PI * 2); x.stroke();
  } else if (i === 2) { // cloche
    const gr = x.createLinearGradient(cx - 42, 0, cx + 42, 0);
    gr.addColorStop(0, "#a8740a"); gr.addColorStop(0.42, "#ffe27a"); gr.addColorStop(1, "#9a6a08");
    x.fillStyle = gr;
    x.beginPath(); x.moveTo(cx, cy - 40);
    x.bezierCurveTo(cx + 30, cy - 40, cx + 28, cy - 2, cx + 40, cy + 22); x.lineTo(cx - 40, cy + 22);
    x.bezierCurveTo(cx - 28, cy - 2, cx - 30, cy - 40, cx, cy - 40); x.fill();
    x.fillRect(cx - 44, cy + 20, 88, 9);
    x.fillStyle = "#6e4904";
    x.beginPath(); x.arc(cx, cy + 35, 9, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(cx, cy - 44, 6, 0, Math.PI * 2); x.fill();
  } else if (i === 3) { // étoile
    const gr = x.createRadialGradient(cx - 8, cy - 6, 4, cx, cy, 48);
    gr.addColorStop(0, "#fff3a0"); gr.addColorStop(0.55, "#ffc21a"); gr.addColorStop(1, "#ff8a00");
    x.fillStyle = gr; x.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 19 : 46; x.lineTo(cx + Math.cos(a) * r, cy + 4 + Math.sin(a) * r); }
    x.closePath(); x.fill(); x.strokeStyle = "#b35a00"; x.lineWidth = 3; x.stroke();
  } else if (i === 4) { // diamant
    const gr = x.createLinearGradient(cx - 36, cy - 34, cx + 36, cy + 40);
    gr.addColorStop(0, "#d4fbff"); gr.addColorStop(0.5, "#46d3f5"); gr.addColorStop(1, "#1677b8");
    x.fillStyle = gr; x.beginPath();
    for (const [dx, dy] of [[-36, -12], [-18, -34], [18, -34], [36, -12], [0, 40]]) x.lineTo(cx + dx, cy + dy);
    x.closePath(); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.75)"; x.lineWidth = 2.5; x.beginPath();
    x.moveTo(cx - 36, cy - 12); x.lineTo(cx + 36, cy - 12);
    x.moveTo(cx - 18, cy - 34); x.lineTo(cx - 8, cy - 12); x.lineTo(cx, cy + 40); x.lineTo(cx + 8, cy - 12); x.lineTo(cx + 18, cy - 34);
    x.stroke();
  } else { // sept
    x.font = "900 104px Sora, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = 8; x.strokeStyle = "#5a0010"; x.strokeText("7", cx, cy + 6);
    const gr = x.createLinearGradient(0, cy - 45, 0, cy + 45);
    gr.addColorStop(0, "#ff6a7c"); gr.addColorStop(1, "#c3001c");
    x.fillStyle = gr; x.fillText("7", cx, cy + 6);
  }
  x.restore();
}
function slotStripTexture() {
  slotStrip ??= drawnTexture(128, 128 * SLOT_SYMBOLS.length, x => SLOT_SYMBOLS.forEach((_, i) => {
    x.fillStyle = i % 2 ? "#f3ecdc" : "#fbf7ec"; x.fillRect(0, i * 128, 128, 128);
    x.fillStyle = "rgba(0,0,0,0.08)"; x.fillRect(0, i * 128, 128, 3);
    drawSlotSymbol(x, i, 64, i * 128 + 64);
  }));
  slotStrip.wrapT = THREE.RepeatWrapping;
  return slotStrip;
}
// Vue d'une bande de rouleau : trois symboles visibles, celui de l'indice i au centre (sur la ligne de paiement).
const reelOffset = i => mod1(0.75 - (i + 0.5) / SLOT_SYMBOLS.length);
// Ombre haute et basse devant les rouleaux : ils paraissent bombés.
function reelShadeTexture() {
  return reelShade ??= drawnTexture(8, 128, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "rgba(0,0,0,0.85)"); gr.addColorStop(0.3, "rgba(0,0,0,0)"); gr.addColorStop(0.7, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.85)");
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
  });
}
// Maille de filet (tennis, practice) : chaque filet en prend une copie à sa propre répétition.
function netTexture(rx, ry) {
  netMap ??= drawnTexture(64, 64, x => {
    x.strokeStyle = "rgba(240,244,240,0.9)"; x.lineWidth = 2;
    for (let k = 0; k <= 64; k += 8) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, 64); x.moveTo(0, k); x.lineTo(64, k); x.stroke(); }
  });
  const t = netMap.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
// Cartes : une texture par carte, créée au premier tirage puis réutilisée ; « ?? » est le dos (carte cachée de la banque).
const cardTextures = new Map();
function cardTexture(label) {
  if (!cardTextures.has(label)) cardTextures.set(label, drawnTexture(128, 180, (x, w, h) => {
    x.fillStyle = label === "??" ? "#8c1c2b" : "#fbfaf5";
    x.beginPath(); x.roundRect(2, 2, w - 4, h - 4, 12); x.fill();
    if (label === "??") {
      x.strokeStyle = "#e9c46a"; x.lineWidth = 3; x.beginPath(); x.roundRect(12, 12, w - 24, h - 24, 8); x.stroke();
      x.strokeStyle = "rgba(233,196,106,0.45)"; x.lineWidth = 2;
      for (let k = -h; k < w; k += 14) { x.beginPath(); x.moveTo(k, 16); x.lineTo(k + h, h - 16); x.moveTo(k + h, 16); x.lineTo(k, h - 16); x.stroke(); }
      return;
    }
    const suit = label.slice(-1), rank = label.slice(0, -1);
    x.fillStyle = "♥♦".includes(suit) ? "#c8102e" : "#15161c";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.font = "700 36px Sora, sans-serif"; x.fillText(rank, 26, 28); x.fillText(suit, 26, 62);
    x.font = "86px serif"; x.fillText(suit, w / 2 + 8, h / 2 + 18);
    x.save(); x.translate(w, h); x.rotate(Math.PI); x.font = "700 36px Sora, sans-serif"; x.fillText(rank, 26, 28); x.restore();
  }));
  return cardTextures.get(label);
}
// Roulette européenne : ordre réel des cases (comme la roue du dialogue), dans le sens des aiguilles d'une montre vu de dessus.
const ROULETTE_WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const POCKET = Math.PI * 2 / ROULETTE_WHEEL.length;
const rouletteColor = n => n === 0 ? "#1f8f4e" : ROULETTE_RED.has(n) ? "#b3243a" : "#17181e";
const ROTOR_R = 0.33, TRACK_R = 0.385, REST_R = 0.207;

function buildShared(def) {
  const f = shell(def.floor, { glass: !def.top });
  const g = f.group;
  Object.assign(f, { key: def.id, kind: "shared", name: def.name, def, staff: [] });
  const back = P(500, 22).z;
  const at = (x, y) => P(x, y);
  const zone = (x0, y0, x1, y1, color) => {
    const a = P(x0, y0), b = P(x1, y1);
    box(g, b.x - a.x, 0.03, b.z - a.z, mat(color), (a.x + b.x) / 2, 0.05, (a.z + b.z) / 2);
  };
  const wallX = (x, y0, y1, h = 1.05, m = mat("#39415a")) => {
    const a = P(x, y0), b = P(x, y1);
    box(g, 0.12, h, b.z - a.z, m, a.x, h / 2, (a.z + b.z) / 2);
  };
  const tag = (text, x, y) => label(g, text, "room-tag", P(x, 0).x + 0.25, 0.08, P(0, y).z + 0.4);
  const staff = (color, x, y, ry, anim = "Idle", h = 0) => {
    const r = makeRobot(color);
    r.position.copy(P(x, y, h));
    r.rotation.y = ry;
    play(r, anim);
    g.add(r);
    f.staff.push(r);
    return r;
  };

  if (def.id === "roof") {
    // Le toit de la tour : garde-corps, édicule de l'ascenseur, machinerie, et une terrasse en bois plus petite que le toit
    const rail = mat("#6a7086", { metalness: 0.7, roughness: 0.3 });
    box(g, 20.8, 0.06, 0.06, rail, 0, 1.05, -6.45);
    for (const x of [-10.35, 10.35]) box(g, 0.06, 0.06, 12.9, rail, x, 1.05, 0);
    for (let x = -10.3; x <= 10.4; x += 1.3) box(g, 0.04, 1.05, 0.04, rail, x, 0.52, -6.45);
    box(g, 0.2, 3, 2.8, mat("#232838"), -10.35, 1.5, 0);
    box(g, 1.6, 0.12, 2.8, mat("#232838"), -9.6, 3.0, 0);
    sign(g, "PENTHOUSE", 9, 1.4, { color: "#f1cd85", font: "700 80px Sora, sans-serif", w: 1024, h: 160 }, 0, 3.2, -6.3);
    box(g, 9.4, 0.08, 0.08, glow("#f1cd85", 0.8), 0, 2.45, -6.3);
    for (const x of [-4.4, 4.4]) box(g, 0.08, 2.4, 0.08, mat("#3a3f52"), x, 1.2, -6.3);
    for (const x of [90, 210]) {
      const p = at(x, 90);
      box(g, 1.8, 1.2, 1.4, mat("#3b4152", { metalness: 0.5 }), p.x, 0.6, p.z);
      cyl(g, 0.5, 0.08, mat("#1c2030"), p.x, 1.24, p.z);
    }
    const tank = at(890, 110);
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) cyl(g, 0.06, 1.2, mat("#3a3f52"), tank.x + dx, 0.6, tank.z + dz, 8);
    cyl(g, 1.0, 1.8, mat("#5a4636"), tank.x, 2.1, tank.z);
    const mast = at(960, 560);
    cyl(g, 0.06, 5, mat("#6a7086", { metalness: 0.7 }), mast.x, 2.5, mast.z, 8);
    f.beacon = cyl(g, 0.12, 0.2, beacons, mast.x, 5.1, mast.z, 10);
    const d = P(DECK.x + DECK.w / 2, DECK.y + DECK.h / 2);
    box(g, DECK.w * S, 0.08, DECK.h * S, mat("#6b4a2f", { roughness: 0.9 }), d.x, 0.06, d.z);
    // Lames et éclairage rasant donnent du relief au deck sans relever les chemins des agents.
    for (let x = -DECK.w * S / 2 + 0.28; x < DECK.w * S / 2; x += 0.28)
      box(g, 0.012, 0.008, DECK.h * S, mat("#352c26"), d.x + x, 0.104, d.z);
    for (const x of [DECK.x, DECK.x + DECK.w]) {
      const edge = at(x, DECK.y + DECK.h / 2);
      box(g, 0.035, 0.035, DECK.h * S, glow("#e5b975", 0.7), edge.x, 0.13, edge.z);
    }
    tag("Terrasse fumeurs", DECK.x, DECK.y);
    for (const [x, y] of ASHTRAYS) {
      const p = at(x, y);
      cyl(g, 0.05, 1.0, mat("#4a4f60", { metalness: 0.6 }), p.x, 0.5, p.z);
      cyl(g, 0.22, 0.08, mat("#6a7086", { metalness: 0.6 }), p.x, 1.02, p.z);
    }
    for (const x of [440, 600]) put(g, "bench", at(x, 585).x, at(x, 585).z, Math.PI, 2.6);
    for (const [x, y] of [[DECK.x + 10, DECK.y + 10], [DECK.x + DECK.w - 10, DECK.y + 10], [DECK.x + DECK.w - 10, DECK.y + DECK.h - 10]]) put(g, "pottedPlant", at(x, y).x, at(x, y).z, 0, 2.8);
    // Guirlandes d'ampoules au-dessus de la terrasse
    for (const y of [280, 420, 560]) for (let k = 0; k < 9; k++) {
      const p = at(DECK.x + k * (DECK.w / 8), y), h = 3.0 - Math.sin((k / 8) * Math.PI) * 0.45;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow("#ffd38a", 2.4));
      bulb.position.set(p.x, h, p.z);
      g.add(bulb);
    }
    // Coin détente à gauche du deck, à l'écart de l'allée de l'ascenseur.
    zone(35, 380, 255, 590, "#45352c");
    for (const y of [410, 560]) {
      const seat = at(125, y), facing = y === 410 ? -1 : 1;
      box(g, 3.4, 0.25, 1.05, mat("#594536"), seat.x, 0.3, seat.z);
      box(g, 3.1, 0.24, 0.9, mat("#d0c1a3"), seat.x, 0.53, seat.z);
      box(g, 3.4, 0.7, 0.18, mat("#344d45"), seat.x, 0.8, seat.z + facing * 0.48);
      for (const dx of [-1.6, 1.6]) box(g, 0.18, 0.6, 1.05, mat("#594536"), seat.x + dx, 0.63, seat.z);
      for (const dx of [-1, 0, 1]) box(g, 0.55, 0.45, 0.2, mat(dx ? "#677568" : "#b47c52"), seat.x + dx, 0.86, seat.z + facing * 0.28);
    }
    const fire = at(145, 485);
    cyl(g, 0.55, 0.35, mat("#252a32", { metalness: 0.65 }), fire.x, 0.25, fire.z);
    cyl(g, 0.48, 0.05, mat("#181318"), fire.x, 0.44, fire.z);
    f.flames = [];
    for (let k = 0; k < 7; k++) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 7), glow(k % 2 ? "#ffad42" : "#ff6230", 2));
      flame.position.set(fire.x + Math.cos(k * 2.4) * 0.27, 0.64, fire.z + Math.sin(k * 2.4) * 0.27);
      g.add(flame); f.flames.push(flame);
    }
    f.fireGlow = new LightSpot("#ff9c4a", 3, 5, 2);
    f.fireGlow.position.set(fire.x, 1, fire.z); g.add(f.fireGlow);
    f.haze = [ambientSmoke(g, P(145, 485, 0.9), "#aab6c7", 24, 0.7, 2.4)];
    // Distributeur, canettes et poubelle contre le fond : aucun nouveau meuble dans les trajets.
    const vending = at(365, 90);
    box(g, 1.1, 2, 0.7, mat("#202b3b"), vending.x, 1, vending.z);
    box(g, 0.8, 1.2, 0.04, glow("#72d8df", 0.35), vending.x, 1.18, vending.z + 0.37);
    for (let k = 0; k < 12; k++) cyl(g, 0.06, 0.16, mat(["#ff946c", "#7ec3f0", "#a4d87a"][k % 3]),
      vending.x - 0.27 + (k % 4) * 0.18, 0.83 + Math.floor(k / 4) * 0.32, vending.z + 0.4, 8);
    box(g, 0.5, 0.12, 0.05, mat("#090e19"), vending.x, 0.28, vending.z + 0.38);
    sign(g, "ROOFTOP", 2.7, 0.55, { color: "#ffd38a" }, at(145, 600).x, 2.6, at(0, 600).z);
    for (const x of [40, 250]) put(g, "pottedPlant", at(x, 590).x, at(x, 590).z, 0, 2.5);
    // Pergola ajourée au-dessus du brasero, ouverte côté allée et vue sur la ville.
    const timber = mat("#514236"), brass = mat("#ae9362", { metalness: 0.55, roughness: 0.4 });
    for (const x of [25, 265]) for (const y of [370, 605]) {
      const post = at(x, y);
      box(g, 0.12, 2.85, 0.12, timber, post.x, 1.425, post.z);
    }
    const pergola = at(145, 487.5);
    for (const x of [25, 265]) box(g, 0.18, 0.18, 4.9, timber, at(x, 0).x, 2.85, pergola.z);
    for (let k = 0; k < 10; k++) box(g, 4.95, 0.1, 0.12, timber, pergola.x, 2.98, at(0, 370 + k * 235 / 9).z);
    for (const x of [25, 265]) box(g, 0.035, 0.025, 4.6, glow("#ffd89b", 0.8), at(x, 0).x, 2.74, pergola.z);
    // Jardinières sur le fond et le côté droit ; l'allée centrale reste dégagée.
    for (const [x, y] of [[470, 100], [650, 100], [960, 355]]) {
      const planter = at(x, y);
      box(g, 1.3, 0.55, 0.65, mat("#363f3b"), planter.x, 0.3, planter.z);
      for (const dx of [-0.4, 0, 0.4]) {
        put(g, "plantSmall1", planter.x + dx, planter.z, 0, 3, 0.55);
        cyl(g, 0.025, 0.28, brass, planter.x + dx, 0.8, planter.z + 0.28, 6);
      }
    }
    // Petit bar minéral à droite, en dehors du deck et des destinations des fumeurs.
    const bar = at(860, 210);
    box(g, 3.4, 1.05, 0.85, mat("#384941"), bar.x, 0.57, bar.z);
    for (let k = 0; k < 14; k++) box(g, 0.035, 0.82, 0.03, timber, bar.x - 1.55 + k * 0.24, 0.55, bar.z + 0.44);
    box(g, 3.6, 0.12, 1, mat("#c8bfa9", { roughness: 0.3 }), bar.x, 1.15, bar.z);
    box(g, 3.3, 0.025, 0.025, glow("#f4c782", 0.9), bar.x, 1.04, bar.z + 0.45);
    for (const x of [810, 860, 910]) {
      const stool = at(x, 265);
      cyl(g, 0.06, 0.75, brass, stool.x, 0.4, stool.z, 8);
      cyl(g, 0.27, 0.07, mat("#a17b56"), stool.x, 0.83, stool.z, 16);
      cyl(g, 0.22, 0.05, mat("#282f34"), stool.x, 0.09, stool.z, 12);
    }
    for (let k = 0; k < 4; k++) {
      cyl(g, 0.07, 0.26, mat(k % 2 ? "#496b54" : "#aa793f", { roughness: 0.25 }), bar.x - 1.2 + k * 0.18, 1.34, bar.z - 0.18, 10);
      cyl(g, 0.035, 0.1, brass, bar.x - 1.2 + k * 0.18, 1.52, bar.z - 0.18, 8);
    }
    for (const dx of [0.5, 0.9]) cyl(g, 0.08, 0.18, mat("#c4d8cf", { roughness: 0.2 }), bar.x + dx, 1.31, bar.z + 0.12, 12);
    staff("#bfa17b", 810, 175, 0);
    for (const dx of [-1.2, 1.2]) cyl(g, 0.025, 1.3, brass, bar.x + dx, 1.85, bar.z - 0.48, 6);
    sign(g, "SKY BAR", 2.4, 0.5, { color: "#ead4a7" }, bar.x, 2.35, bar.z - 0.48);
    // Brise-vue devant la machinerie, sans masquer l'enseigne du toit.
    const screen = at(150, 175);
    for (let k = 0; k < 18; k++) box(g, 0.07, 1.6, 0.1, timber, screen.x - 1.9 + k * 0.22, 0.8, screen.z);
    // Câbles des guirlandes et petits luminaires de rive, sans nouvelle lumière dynamique.
    for (const y of [280, 420, 560]) {
      const points = [];
      for (let k = 0; k <= 16; k++) points.push(P(DECK.x + k * DECK.w / 16, y, 3 - Math.sin(k / 16 * Math.PI) * 0.45));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: "#4c4438" })));
    }
    for (const x of [-9.8, -4.8, 4.8, 9.8]) {
      box(g, 0.18, 0.5, 0.18, mat("#313a3b"), x, 0.28, 6.1);
      box(g, 0.2, 0.06, 0.2, glow("#f1cc8d", 0.9), x, 0.56, 6.1);
    }
    // Manche à air : le même vent emporte les volutes de fumée.
    const wind = at(800, 60);
    cyl(g, 0.035, 3.1, rail, wind.x, 1.55, wind.z, 8);
    f.windSock = new THREE.Group(); f.windSock.position.set(wind.x, 3, wind.z);
    for (let k = 0; k < 5; k++) {
      const part = new THREE.Mesh(new THREE.CylinderGeometry(0.16 - k * 0.023, 0.16 - k * 0.023, 0.18, 12, 1, true), mat(k % 2 ? "#ece3cb" : "#e27b46", { side: THREE.DoubleSide }));
      part.rotation.z = Math.PI / 2; part.position.x = 0.1 + k * 0.18;
      f.windSock.add(part);
    }
    g.add(f.windSock);
    const night = new LightSpot("#ffd38a", 10, 16, 1.5, 1);
    night.position.set(d.x, 3, d.z);
    g.add(night);
  }

  if (def.id === "lounge") {
    zone(20, 20, 400, 600, "#3a2a20");
    zone(420, 20, 720, 600, "#2a2738");
    zone(740, 20, 980, 280, "#30291f");
    zone(740, 340, 980, 600, "#1d2b30");
    for (const x of [410, 730]) { wallX(x, 20, 270); wallX(x, 350, 600); }
    f.roomTags = [tag("Café", 20, 20), tag("Salle de repos", 420, 20), tag("Bureau de tabac", 740, 20), tag("Toilettes", 740, 340)];

    // Café : comptoir avancé avec la barista derrière, ardoise du menu, machines, vitrine à pâtisseries,
    // quatre tables avec chaises (les agents s'y assoient), tasses fumantes, suspensions, porte-manteau
    for (let i = 0; i < 7; i++) put(g, "kitchenBar", at(80 + i * 43, 80).x, at(80 + i * 43, 80).z, Math.PI);
    for (const x of [110, 175]) put(g, "kitchenCoffeeMachine", at(x, 80).x, at(x, 80).z, Math.PI, 2, 0.84);
    put(g, "kitchenBlender", at(235, 80).x, at(235, 80).z, Math.PI, 2, 0.84);
    put(g, "toaster", at(265, 80).x, at(265, 80).z, Math.PI, 2, 0.84);
    put(g, "plantSmall1", at(80, 80).x, at(80, 80).z, 0, 2, 0.84);
    const vit = at(320, 80);
    box(g, 0.8, 0.34, 0.36, new THREE.MeshStandardMaterial({ color: "#bfe3ff", transparent: true, opacity: 0.25, roughness: 0.05 }), vit.x, 1.01, vit.z);
    box(g, 0.78, 0.03, 0.34, glow("#ffe2a8", 0.6), vit.x, 0.86, vit.z);
    for (let k = 0; k < 6; k++) cyl(g, 0.05, 0.05, mat(["#c98a3e", "#e8b4c8", "#6b3e26"][k % 3]), vit.x - 0.28 + (k % 3) * 0.28, 0.9 + Math.floor(k / 3) * 0.13, vit.z + (k < 3 ? 0.08 : -0.06), 10);
    put(g, "kitchenFridgeSmall", at(370, 40).x, at(370, 40).z, Math.PI, 2.4);
    staff("#c98a3e", 200, 45, 0);
    const board = at(200, 22);
    box(g, 2.3, 1.15, 0.04, mat("#1b1f1c"), board.x, 1.85, back + 0.04);
    box(g, 2.4, 1.25, 0.03, mat("#6b4a2f"), board.x, 1.85, back + 0.02);
    ["ESPRESSO  1,50", "CAPPUCCINO  2,80", "MATCHA  3,50", "CROISSANT  1,30"].forEach((line, k) =>
      sign(g, line, 2.0, 0.24, { color: "#f2efe6", font: "600 64px Sora, sans-serif", w: 1024, h: 128, blur: 4 }, board.x, 2.25 - k * 0.26, back + 0.07));
    sign(g, "CAFÉ", 2.6, 0.7, { color: "#f1cd85", font: "700 80px Sora, sans-serif" }, board.x, 2.95, back + 0.05);
    for (const [x, y] of CAFE_TABLES) {
      const t = at(x, y);
      put(g, "tableRound", t.x, t.z, 0, 2);
      for (const [cx, cy, f] of around(x, y, 52, 4, Math.PI / 4)) put(g, "chairCushion", at(cx, cy).x, at(cx, cy).z, f, 2);
      cyl(g, 0.05, 0.22, glow("#7ec3f0", 0.4), t.x + 0.15, 0.85, t.z + 0.1);
      cyl(g, 0.05, 0.08, mat("#f2efe6"), t.x - 0.15, 0.78, t.z - 0.05, 12);
      // Suspension au-dessus de la table : fil, abat-jour, ampoule
      cyl(g, 0.01, 2.2, mat("#1a1d26"), t.x, 3.6, t.z, 4);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.25, 20, 1, true), mat("#c9a86a", { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }));
      shade.position.set(t.x, 2.45, t.z);
      g.add(shade);
      cyl(g, 0.07, 0.07, glow("#ffd38a", 2.4), t.x, 2.35, t.z, 10);
      // Vapeur au-dessus de la tasse
      f.steam ??= [];
      for (let k = 0; k < 2; k++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: "#f2efe6", transparent: true, opacity: 0, depthWrite: false }));
        p.userData = { x: t.x - 0.15, z: t.z - 0.05, phase: k / 2 + x / 100 };
        g.add(p);
        f.steam.push(p);
      }
    }
    put(g, "coatRackStanding", at(385, 590).x, at(385, 590).z, 0, 2.2);
    put(g, "trashcan", at(200, 595).x, at(200, 595).z, 0, 1.4);
    put(g, "pottedPlant", at(40, 580).x, at(40, 580).z, 0, 2.6);
    put(g, "plantSmall1", at(395, 110).x, at(395, 110).z, 0, 2.6);

    // Salle de repos : deux salons face à la télé
    for (const [x, y] of REST_GROUPS) {
      put(g, "rugRound", at(x, y + 20).x, at(x, y + 20).z, 0, 3.2);
      put(g, "tableCoffee", at(x, y).x, at(x, y).z, 0, 2);
      put(g, "loungeSofa", at(x, y + 80).x, at(x, y + 80).z, Math.PI, 2.6);
      put(g, "loungeChairRelax", at(x + 105, y).x, at(x + 105, y).z, -Math.PI / 2, 2);
      put(g, "lampRoundFloor", at(x - 95, y - 40).x, at(x - 95, y - 40).z, 0, 2.2);
    }
    // Grand écran mural : le direct d'OTPLOL sur Twitch, muet
    const tv = at(570, 24);
    tvFrame = live(box(g, 4.8, 2.7, 0.08, mat("#0b0d14", { metalness: 0.6, roughness: 0.3 }), tv.x, 1.85, tv.z)); // cliquable
    const view = new CSS3DObject(stream);
    view.position.set(tv.x, 1.85, tv.z + 0.05);
    view.scale.setScalar(4.5 / 1280);
    g.add(view);
    sign(g, "REPOS", 2.6, 0.7, { color: "#c7a8ff", font: "700 80px Sora, sans-serif" }, at(570, 20).x, 3.2, back + 0.05);

    // Bureau de tabac : la carotte rouge, les étagères, le comptoir et le buraliste
    for (const x of [790, 860, 930]) put(g, "bookcaseOpen", at(x, 34).x, at(x, 34).z, 0, 2.6);
    for (let i = 0; i < 4; i++) put(g, "kitchenBar", at(795 + i * 43, 120).x, at(795 + i * 43, 120).z, Math.PI);
    const car = at(860, 20);
    box(g, 0.95, 0.95, 0.05, glow("#e5322d", 0.9), car.x, 3.4, back + 0.06).rotation.z = Math.PI / 4;
    sign(g, "TABAC", 1.5, 0.4, { color: "#ffffff", font: "800 90px Sora, sans-serif", blur: 8 }, car.x, 3.4, back + 0.1);
    sign(g, "VAPE", 1.2, 0.35, { color: "#9ff5df", font: "700 80px Sora, sans-serif" }, at(950, 20).x, 3.25, back + 0.05);
    staff("#d9dde8", 860, 75, 0);
    // Les étagères : puffs JNR à gauche, cartouches de cigarettes au milieu, puffs Respire à droite.
    // Étagères du modèle (×2,6) à 0,34, 0,96 et 1,59 m ; 0,83 m de large utiles.
    const shelves = (x, name, color, colors) => {
      const p = at(x, 34);
      [0.34, 0.96, 1.59].forEach((y, r) => {
        for (let c = 0; c < 6; c++) cyl(g, 0.045, 0.17, glow(colors[(r * 6 + c) % colors.length], 0.8), p.x - 0.33 + c * 0.132, y + 0.085, p.z + 0.12, 8);
      });
      box(g, 1.0, 0.04, 0.06, glow(color, 1.2), p.x, 2.36, p.z + 0.3);
      sign(g, name, 1.1, 0.3, { color, font: "800 96px Sora, sans-serif", w: 512, h: 128, blur: 18 }, p.x, 2.56, p.z + 0.3);
    };
    shelves(790, "JNR", "#ff4fa3", ["#ff4fa3", "#ffd36e", "#7ec3f0", "#4ade80", "#a37cf0"]);
    shelves(930, "RESPIRE", "#5fd4ff", ["#5fd4ff", "#ff7a59", "#c7f26b", "#f1cd85", "#ff6fd8"]);
    const pc = at(860, 34);
    // Paquets stylisés : une texture par marque, réutilisée sur les paquets en stock.
    const brands = [
      ["Marlboro", "#c83536", "#f2eee3"], ["Marlboro Gold", "#bfa265", "#f2eee3"],
      ["Camel", "#c3a060", "#f0dfaa"], ["Winston", "#b32d35", "#f2eee3"],
      ["Lucky Strike", "#bd3334", "#f2eee3"], ["Chesterfield", "#345882", "#f2eee3"],
      ["Philip Morris", "#384667", "#f2eee3"], ["L&M", "#bf3e3e", "#f2eee3"],
      ["Rothmans", "#293d67", "#e9e4d6"], ["Gauloises", "#294c83", "#dce4ed"],
      ["Gitanes", "#223f77", "#dce4ed"], ["Vogue", "#476b61", "#ece9df"],
    ];
    const packFace = new THREE.PlaneGeometry(0.16, 0.29);
    brands.forEach(([name, color, paper], i) => {
      const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 448;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = paper; ctx.fillRect(0, 0, 256, 448);
      ctx.fillStyle = color;
      if (name.startsWith("Marlboro")) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(256, 0); ctx.lineTo(256, 170);
        ctx.lineTo(128, 95); ctx.lineTo(0, 170); ctx.closePath(); ctx.fill();
      } else if (name === "Lucky Strike") {
        ctx.beginPath(); ctx.arc(128, 105, 76, 0, Math.PI * 2); ctx.fill();
      } else ctx.fillRect(0, 0, 256, 120);
      ctx.fillStyle = "#25252a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const words = name.split(" ");
      words.forEach((word, k) => {
        ctx.font = "bold 42px Georgia, serif";
        const scale = Math.min(1, 230 / ctx.measureText(word).width);
        ctx.save(); ctx.translate(128, 200 + k * 48); ctx.scale(scale, 1); ctx.fillText(word, 0, 0); ctx.restore();
      });
      ctx.fillStyle = "#353535"; ctx.fillRect(8, 340, 240, 100);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 27px sans-serif";
      ctx.fillText("FUMER TUE", 128, 390);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
      const x = pc.x - 0.285 + (i % 4) * 0.19, y = [1.59, 0.96, 0.34][Math.floor(i / 4)] + 0.145;
      // Le paquet (couleur du papier) et sa face imprimée, posée devant : des maillages à un seul matériau, que la
      // fusion regroupe (un paquet à six matériaux coûtait six appels de dessin).
      for (let stock = 0; stock < 2; stock++) {
        const z = pc.z + 0.24 - stock * 0.12, front = new THREE.Mesh(packFace, face);
        box(g, 0.16, 0.29, 0.10, mat(paper), x, y, z);
        front.position.set(x, y, z + 0.051); g.add(front);
      }
    });
    sign(g, "CIGARETTES", 1.25, 0.26, { color: "#f1cd85", font: "700 80px Sora, sans-serif", blur: 8 }, pc.x, 2.56, pc.z + 0.3);

    // Toilettes : trois cabines contre la façade, deux lavabos avec miroirs, la file d'attente
    const tile = mat("#2a3a40");
    for (let i = 0; i <= STALLS.length; i++) wallX(STALLS[0] - 37.5 + i * 75, 490, 600, 1.5, tile);
    box(g, STALLS.length * 1.5, 0.9, 0.06, tile, P(STALLS[1], 0).x, 0.45, at(0, 600).z);
    for (const x of STALLS) put(g, "toilet", at(x, 560).x, at(x, 560).z, Math.PI, 1.6); // réservoir contre la façade, cuvette vers l'allée
    for (const y of [380, 450]) {
      put(g, "bathroomSink", at(965, y).x, at(965, y).z, -Math.PI / 2, 2, 0.8);
      box(g, 0.04, 0.7, 0.9, glow("#a9d8e8", 0.25), at(985, y).x, 1.6, at(985, y).z);
    }
    sign(g, "WC", 0.9, 0.5, { color: "#9ff5df", font: "700 90px Sora, sans-serif", w: 256 }, at(860, 480).x, 2.1, at(0, 480).z);
  }

  if (def.id === "club") {
    // Scène et cabine du DJ devant un mur de LED, néon, lasers, piste lumineuse, boules à facettes, projecteurs,
    // bar avec barman et bouteilles, carré VIP, videur à l'entrée
    const stage = at(500, 75);
    box(g, 6.4, 0.4, 1.8, mat("#2a1638"), 0, 0.2, stage.z);
    box(g, 2.6, 0.9, 0.7, mat("#14101c", { metalness: 0.5 }), 0, 0.85, stage.z + 0.4);
    box(g, 2.62, 0.08, 0.72, glow("#ff6fd8", 1.4), 0, 1.32, stage.z + 0.4);
    staff("#a37cf0", 500, 60, 0, "Dance", 0.4);
    const eq = document.createElement("canvas");
    eq.width = 128; eq.height = 48;
    f.eq = { ctx: eq.getContext("2d"), tex: new THREE.CanvasTexture(eq) };
    f.eq.tex.colorSpace = THREE.SRGBColorSpace;
    f.eq.tex.magFilter = THREE.NearestFilter;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), new THREE.MeshBasicMaterial({ map: f.eq.tex }));
    wall.position.set(0, 2.25, back + 0.03);
    g.add(wall);
    sign(g, "CLUB", 3.6, 0.9, { color: "#ff6fd8" }, 0, 4.0, back + 0.05);
    for (const x of [300, 700]) put(g, "speaker", at(x, 60).x, at(x, 60).z, 0, 3, 0.4);
    f.lasers = ["#4ade80", "#ff4d6d", "#4ade80", "#7ec3f0", "#ff4d6d", "#4ade80"].map((col, i) => {
      const pivot = new THREE.Group();
      pivot.position.set((i - 2.5) * 0.4, 1.4, stage.z + 0.7);
      pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 10, 4).rotateX(Math.PI / 2).translate(0, 0, 5),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
      g.add(pivot);
      return pivot;
    });
    f.tiles = [];
    for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 8; c2++) {
      const t = box(g, 0.96, 0.03, 0.96, new THREE.MeshStandardMaterial({ color: "#1a1024", emissive: "#ff6fd8", emissiveIntensity: 0.6 }), -3.5 + c2, 0.06, at(0, 190).z + r);
      t.userData.k = r * 8 + c2;
      f.tiles.push(t);
    }
    f.discos = [380, 620].map(x => {
      const d = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), mat("#dfe6ff", { metalness: 1, roughness: 0.15, flatShading: true }));
      d.position.copy(P(x, 300, 3.4));
      g.add(d);
      return d;
    });
    f.spots = ["#ff6fd8", "#7ec3f0", "#ffd36e"].map((col, i) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
      cone.position.copy(P(300 + i * 200, 300, 2.2));
      g.add(cone);
      return cone;
    });
    // Habitués du Club : six PNJ dispersés, avec rythmes et emotes décalés.
    f.dancers = [];
    for (let k = 0; k < CLUB_NPCS.length; k++) {
      const [x, y] = CLUB_NPCS[k];
      staff(["#d86c91", "#65bab5", "#d7b369", "#8499d5", "#ae7cc7", "#cf885f"][k], x, y, k * 1.1, "Dance");
      const dancer = f.staff.at(-1);
      dancer.userData.mixer.update(k * 0.37);
      dancer.userData.mixer.timeScale = 0.9 + (k % 3) * 0.1;
      f.dancers.push(dancer);
    }
    // Bar : comptoir lumineux, tabourets, barman, étagère de bouteilles
    box(g, 0.6, 1.1, 7, mat("#3a2140"), at(900, 330).x, 0.55, at(900, 330).z);
    box(g, 0.7, 0.06, 7.1, glow("#ff6fd8", 0.5), at(900, 330).x, 1.12, at(900, 330).z);
    for (const y of [180, 240, 300, 360, 420, 480]) put(g, "stoolBar", at(855, y).x, at(855, y).z, Math.PI / 2);
    staff("#2b2f3a", 945, 330, -Math.PI / 2);
    box(g, 0.3, 0.05, 6, mat("#2a2030"), at(985, 330).x, 1.6, at(985, 330).z);
    box(g, 0.3, 0.05, 6, mat("#2a2030"), at(985, 330).x, 2.2, at(985, 330).z);
    for (let k = 0; k < 24; k++) {
      const p = at(985, 190 + (k % 12) * 25);
      cyl(g, 0.05, 0.32, glow(["#ffd36e", "#7ec3f0", "#4ade80", "#ff6fd8"][k % 4], 0.8), p.x, k < 12 ? 1.79 : 2.39, p.z, 8);
    }
    // Carré VIP : tapis, cordon doré, deux canapés, table basse
    zone(40, 380, 240, 590, "#4a1830");
    for (const [x, y] of [[240, 380], [240, 485], [240, 590]]) cyl(g, 0.04, 0.9, mat("#c9a86a", { metalness: 0.8, roughness: 0.3 }), at(x, y).x, 0.45, at(x, y).z, 8);
    box(g, 0.03, 0.03, 4.2, mat("#a3203a"), at(240, 485).x, 0.8, at(240, 485).z);
    for (const y of [420, 530]) put(g, "loungeDesignSofa", at(70, y).x, at(70, y).z, 0, 2.2);
    put(g, "tableCoffee", at(160, 475).x, at(160, 475).z, 0, 2);
    sign(g, "VIP", 1.4, 0.5, { color: "#f1cd85", font: "700 90px Sora, sans-serif", w: 256 }, at(140, 380).x, 2.2, at(0, 380).z);
    // Platines du DJ : disques qui tournent et petite console à faders.
    f.records = [-0.72, 0.72].map(x => {
      const disc = cyl(g, 0.25, 0.025, mat("#090c17"), x, 1.38, stage.z + 0.4, 32);
      cyl(disc, 0.07, 0.03, glow("#7ec3f0", 0.6), 0, 0.015, 0);
      box(disc, 0.12, 0.005, 0.025, mat("#eae4d5"), 0.15, 0.02, 0);
      return disc;
    });
    for (let k = 0; k < 5; k++) {
      box(g, 0.025, 0.02, 0.25, mat("#060913"), -0.2 + k * 0.1, 1.38, stage.z + 0.4);
      box(g, 0.055, 0.03, 0.045, glow("#ffd36e", 0.6), -0.2 + k * 0.1, 1.4, stage.z + 0.33 + (k % 3) * 0.06);
    }
    // Cocktails sur le bar et champagne dans le carré VIP.
    for (const y of [180, 240, 360, 480]) {
      const p = at(900, y);
      cyl(g, 0.06, 0.18, mat("#b8dce8", { transparent: true, opacity: 0.6 }), p.x, 1.24, p.z, 12);
      cyl(g, 0.05, 0.09, glow(y % 80 ? "#ee966e" : "#9fd67b", 0.4), p.x, 1.22, p.z, 12);
      box(g, 0.015, 0.2, 0.015, mat("#f3e5c4"), p.x + 0.025, 1.35, p.z).rotation.z = 0.25;
    }
    const champagne = at(160, 475);
    cyl(g, 0.14, 0.22, mat("#8995a7", { metalness: 0.8, roughness: 0.25 }), champagne.x, 0.85, champagne.z);
    cyl(g, 0.055, 0.4, mat("#294a36"), champagne.x, 1.02, champagne.z, 12);
    for (const dx of [-0.3, 0.3]) {
      cyl(g, 0.015, 0.18, mat("#c5dfeb"), champagne.x + dx, 0.87, champagne.z);
      cyl(g, 0.06, 0.12, mat("#eed18a"), champagne.x + dx, 1.02, champagne.z, 12);
    }
    // Deux machines à fumée au bord de la scène, sans masquer les personnages.
    f.haze = [280, 720].map(x => {
      const p = at(x, 100);
      box(g, 0.45, 0.25, 0.6, mat("#181b29"), p.x, 0.23, p.z);
      return ambientSmoke(g, P(x, 110, 0.4), "#ae92d1", 28, 1.2, 1.4);
    });
    // Le videur, bras croisés près de l'ascenseur
    staff("#15171f", 70, 240, Math.PI / 2);
  }
  const helpers = { at, zone, tag, staff, back };
  if (def.id === "casino") buildCasino(f, g, helpers);
  if (def.id === "tennis") buildTennis(f, g, helpers);
  if (def.id === "golf") buildGolf(f, g, helpers);
  return finishFloor(f);
}

export {
  BULB_DIM, BULB_ON, CHANNEL_NAMES, POCKET, REST_R, ROTOR_R, ROULETTE_WHEEL, SLOT_SYMBOLS, TRACK_R, buildShared,
  cardGeometry, cardTexture, netTexture, reelGeometry, reelOffset, reelShadeTexture, rouletteColor,
  slotStripTexture, stream, streamUrl, tvChannel, tvCustomNow, tvFrame, tvPageUrl, tvUrl,
};
