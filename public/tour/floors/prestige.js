// Ambiance Prestige (l’étage de Paul-Adrien) : chevrons, marbre, boiseries, lustres, bureaux de ministre,
// spider sur plateau tournant, green de putting.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOSS, LANE, OPEN, P, S } from "../base.js";
import { LightSpot, box, cyl, glow, live, mat, redBullEditions, redBullTextures } from "../engine.js";
import { ballGeometry, discGeometry, drawnTexture, reducedMotion } from "../kit.js";
import { roomFloor } from "./room.js";

// ---------- ambiance Prestige ----------
// Pour le résident qui aime le golf, le Red Bull et les vieilles italiennes : parquet à chevrons et marbre clair,
// boiseries de noyer à liseré doré, grands tapis, lustres de cristal. Chaque poste est un bureau de ministre (noyer,
// sous-main de cuir, lampe de banquier, fauteuil Chesterfield, double écran, canette Red Bull) ; chez le résident, un
// spider rouge des années 60 tourne lentement sur son plateau sous les projecteurs, à côté d'un green de putting, d'un
// sac de golf, d'une vitrine à trophées et d'affiches de Grand Prix. Aucun logo ni nom de marque automobile.
// Tout est construit avec des matériaux et des textures partagés (créés au premier étage Prestige) : la fusion des
// maillages immobiles ramène l'étage à quelques dizaines d'appels de dessin. Seuls le plateau tournant et le drapeau
// bougent, et seulement sur l'étage regardé.
let prestigeKit = null;
function prestigeMaterials() {
  if (prestigeKit) return prestigeKit;
  const rand = (() => { let r = 7; return () => (r = (r * 16807) % 2147483647) / 2147483647; })();
  // Parquet à chevrons (point de Hongrie) en noyer : colonnes de lames inclinées à 45°, alternées.
  const parquet = drawnTexture(512, 512, (x, W, H) => {
    x.fillStyle = "#2a180d"; x.fillRect(0, 0, W, H);
    const cw = 64, ph = 32, tones = ["#5a3820", "#6a4327", "#4f311b", "#74492b", "#61401f"];
    for (let c = 0; c < W / cw; c++) for (let r = -3; r < H / ph + 3; r++) {
      const s = c % 2 ? 1 : -1, x0 = c * cw, y0 = r * ph + (s > 0 ? cw : 0);
      x.fillStyle = tones[Math.floor(rand() * tones.length)];
      x.beginPath(); x.moveTo(x0 + 1, y0 + 1); x.lineTo(x0 + cw - 1, y0 - s * cw + 1); x.lineTo(x0 + cw - 1, y0 - s * cw + ph - 1); x.lineTo(x0 + 1, y0 + ph - 1); x.closePath(); x.fill();
      x.strokeStyle = "rgba(30,16,8,0.35)"; x.lineWidth = 1;
      for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(x0 + 2, y0 + k * ph / 4 + rand() * 3); x.lineTo(x0 + cw - 2, y0 - s * cw + k * ph / 4 + rand() * 3); x.stroke(); }
    }
  });
  // Marbre clair veiné en grandes dalles (deux par texture), joints fins.
  const marble = drawnTexture(512, 512, (x, W, H) => {
    x.fillStyle = "#ddd5c7"; x.fillRect(0, 0, W, H);
    for (let v = 0; v < 14; v++) {
      x.strokeStyle = v % 4 ? "rgba(120,118,112,0.35)" : "rgba(176,146,92,0.45)"; x.lineWidth = v % 4 ? 1.2 : 2.2; x.beginPath();
      for (let y = 0; y <= H; y += 8) { const px = v * 40 - 40 + y * 0.35 + Math.sin(y * 0.02 + v * 1.9) * 26; y ? x.lineTo(px, y) : x.moveTo(px, y); }
      x.stroke();
    }
    x.strokeStyle = "rgba(90,84,74,0.55)"; x.lineWidth = 2;
    for (const k of [0, 256]) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, H); x.moveTo(0, k); x.lineTo(W, k); x.stroke(); }
  });
  // Tapis d'Orient : champ grenat, bordure marine à frises dorées, médaillon central.
  const rug = drawnTexture(1024, 448, (x, W, H) => {
    x.fillStyle = "#1b2140"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#c9a24a"; x.fillRect(18, 18, W - 36, H - 36);
    x.fillStyle = "#1b2140"; x.fillRect(24, 24, W - 48, H - 48);
    for (let i = 40; i < W - 40; i += 28) for (const y of [36, H - 36]) { x.fillStyle = "#c9a24a"; x.beginPath(); x.moveTo(i, y - 7); x.lineTo(i + 7, y); x.lineTo(i, y + 7); x.lineTo(i - 7, y); x.fill(); }
    for (let i = 40; i < H - 40; i += 28) for (const xx of [36, W - 36]) { x.fillStyle = "#c9a24a"; x.beginPath(); x.moveTo(xx, i - 7); x.lineTo(xx + 7, i); x.lineTo(xx, i + 7); x.lineTo(xx - 7, i); x.fill(); }
    x.fillStyle = "#c9a24a"; x.fillRect(52, 52, W - 104, H - 104);
    x.fillStyle = "#6c1420"; x.fillRect(58, 58, W - 116, H - 116);
    x.globalAlpha = 0.35; x.fillStyle = "#8e2430";
    for (let i = 80; i < W - 80; i += 46) for (let j = 80; j < H - 80; j += 46) { x.beginPath(); x.arc(i, j, 5, 0, Math.PI * 2); x.fill(); }
    x.globalAlpha = 1;
    const cx = W / 2, cy = H / 2;
    for (const [r, col] of [[150, "#c9a24a"], [138, "#1b2140"], [104, "#c9a24a"], [92, "#7a1a26"], [40, "#c9a24a"]]) {
      x.fillStyle = col; x.beginPath(); x.moveTo(cx - r * 1.9, cy); x.lineTo(cx, cy - r * 0.82); x.lineTo(cx + r * 1.9, cy); x.lineTo(cx, cy + r * 0.82); x.closePath(); x.fill();
    }
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      x.fillStyle = "#c9a24a"; x.beginPath(); x.moveTo(cx + sx * (W / 2 - 58), cy + sy * (H / 2 - 58)); x.lineTo(cx + sx * (W / 2 - 150), cy + sy * (H / 2 - 58)); x.lineTo(cx + sx * (W / 2 - 58), cy + sy * (H / 2 - 120)); x.fill();
    }
  });
  // Cuir capitonné (Chesterfield) : losanges et boutons.
  const tuft = drawnTexture(256, 256, (x, W, H) => {
    x.fillStyle = "#5e2017"; x.fillRect(0, 0, W, H);
    const n = 4, sw = W / n, sh = H / n;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const gx = i * sw + (j % 2 ? sw / 2 : 0), gy = j * sh;
      const gr = x.createRadialGradient(gx, gy, 2, gx, gy, sw * 0.62);
      gr.addColorStop(0, "rgba(20,4,2,0.55)"); gr.addColorStop(0.35, "rgba(120,48,34,0.15)"); gr.addColorStop(1, "rgba(150,62,44,0)");
      x.fillStyle = gr; x.fillRect(gx - sw, gy - sh, sw * 2, sh * 2);
    }
    x.strokeStyle = "rgba(25,6,3,0.5)"; x.lineWidth = 2;
    for (let j = 0; j <= n; j++) for (let i = -1; i <= n; i++) {
      const gx = i * sw + (j % 2 ? sw / 2 : 0), gy = j * sh;
      x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + sw / 2, gy + sh); x.moveTo(gx, gy); x.lineTo(gx - sw / 2, gy + sh); x.stroke();
    }
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const gx = i * sw + (j % 2 ? sw / 2 : 0), gy = j * sh;
      x.fillStyle = "#2a0b06"; x.beginPath(); x.arc(gx, gy, 4.5, 0, Math.PI * 2); x.fill();
      x.fillStyle = "rgba(220,150,120,0.35)"; x.beginPath(); x.arc(gx - 1, gy - 1, 1.6, 0, Math.PI * 2); x.fill();
    }
  });
  // Gazon de putting tondu en bandes.
  const green = drawnTexture(256, 256, (x, W, H) => {
    for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? "#4f9f58" : "#5aac63"; x.fillRect(k * 32, 0, 32, H); }
    for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(10,40,15,${(0.04 + rand() * 0.08).toFixed(2)})`; x.fillRect(rand() * W, rand() * H, 2, 2); }
  });
  // Affiches rétro de Grand Prix (trois sur une même texture) : courses imaginaires, voitures sans marque.
  const posters = drawnTexture(1152, 512, (x) => {
    const car = (ox, oy, s, body) => {
      x.save(); x.translate(ox, oy); x.scale(s, s);
      x.fillStyle = body; x.beginPath(); x.moveTo(-120, 10); x.bezierCurveTo(-120, -22, -80, -26, -40, -28); x.bezierCurveTo(-20, -48, 20, -48, 34, -30);
      x.bezierCurveTo(80, -28, 118, -22, 124, 4); x.lineTo(124, 14); x.lineTo(-120, 14); x.closePath(); x.fill();
      x.fillStyle = "#1a1a1a"; for (const wx of [-76, 80]) { x.beginPath(); x.arc(wx, 14, 20, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = "#e9e3d2"; for (const wx of [-76, 80]) { x.beginPath(); x.arc(wx, 14, 9, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = "#f4efe2"; x.beginPath(); x.arc(-4, -6, 13, 0, Math.PI * 2); x.fill();
      x.restore();
    };
    const sheets = [
      { bg: ["#f2c14e", "#e07a2e"], title: "GRAN PREMIO", year: "1961", sub: "CIRCUITO DEL LAGO", body: "#c8102e", road: "#3a2a1e" },
      { bg: ["#7ec3f0", "#2a5d9c"], title: "COPPA DELLE ALPI", year: "1963", sub: "SALITA DEL PASSO", body: "#d81f26", road: "#22313f" },
      { bg: ["#f4ecd8", "#d9c39a"], title: "GRAN PREMIO", year: "1966", sub: "CORSA DELLE COLLINE", body: "#b5121b", road: "#5a3a22" },
    ];
    sheets.forEach((p, i) => {
      x.save(); x.translate(i * 384, 0);
      const gr = x.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, p.bg[0]); gr.addColorStop(1, p.bg[1]);
      x.fillStyle = gr; x.fillRect(0, 0, 384, 512);
      x.fillStyle = "rgba(255,255,255,0.35)"; x.beginPath(); x.arc(270, 150, 60, 0, Math.PI * 2); x.fill();
      x.fillStyle = "rgba(40,40,60,0.35)"; x.beginPath(); x.moveTo(0, 300); x.lineTo(110, 190); x.lineTo(200, 270); x.lineTo(300, 170); x.lineTo(384, 260); x.lineTo(384, 340); x.lineTo(0, 340); x.fill();
      x.fillStyle = p.road; x.beginPath(); x.moveTo(0, 360); x.quadraticCurveTo(192, 300, 384, 350); x.lineTo(384, 420); x.quadraticCurveTo(192, 380, 0, 430); x.fill();
      car(190, 360, 1.05, p.body);
      x.strokeStyle = "rgba(255,255,255,0.7)"; x.lineWidth = 3; for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(40 + k * 14, 330 + k * 12); x.lineTo(70 + k * 14, 330 + k * 12); x.stroke(); }
      x.textAlign = "center"; x.fillStyle = "#1b1b1b"; x.font = "800 40px Sora, sans-serif"; x.fillText(p.title, 192, 62, 350);
      x.font = "900 76px Sora, sans-serif"; x.fillStyle = "#b5121b"; x.fillText(p.year, 192, 140);
      x.font = "600 22px Sora, sans-serif"; x.fillStyle = "#1b1b1b"; x.fillText(p.sub, 192, 478, 350);
      x.strokeStyle = "#1b1b1b"; x.lineWidth = 6; x.strokeRect(8, 8, 368, 496);
      x.restore();
    });
  });
  const grille = drawnTexture(128, 64, (x, W, H) => {
    x.fillStyle = "#0b0b0d"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "#8c9097"; x.lineWidth = 2;
    for (let k = 0; k <= W; k += 10) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, H); x.stroke(); }
    for (let k = 0; k <= H; k += 10) { x.beginPath(); x.moveTo(0, k); x.lineTo(W, k); x.stroke(); }
  });
  const roundel = drawnTexture(128, 128, (x, W) => {
    x.fillStyle = "#f6f3ea"; x.fillRect(0, 0, W, W);
    x.fillStyle = "#151515"; x.font = "900 70px Sora, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("27", W / 2, W / 2 + 4);
  });
  const flag = drawnTexture(128, 84, (x, W, H) => {
    x.fillStyle = "#c8102e"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#ffffff"; x.font = "900 52px Sora, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("18", W / 2, H / 2 + 3);
  });
  const tiled = (t, rx, ry) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  prestigeKit = {
    parquet: new THREE.MeshStandardMaterial({ map: tiled(parquet, 4.4, 4.1), roughness: 0.42, metalness: 0.05 }),
    marble: new THREE.MeshStandardMaterial({ map: tiled(marble, 4, 7.25), roughness: 0.24, metalness: 0.05 }),
    rug: new THREE.MeshStandardMaterial({ map: rug, roughness: 0.95 }),
    tuft: new THREE.MeshStandardMaterial({ map: tuft, roughness: 0.45, metalness: 0.05 }),
    green: new THREE.MeshStandardMaterial({ map: tiled(green, 2, 3), roughness: 0.95 }),
    posters: new THREE.MeshBasicMaterial({ map: posters }),
    grille: new THREE.MeshStandardMaterial({ map: grille, roughness: 0.5, metalness: 0.4 }),
    roundel: new THREE.MeshStandardMaterial({ map: roundel, roughness: 0.3 }),
    flag: new THREE.MeshBasicMaterial({ map: flag, side: THREE.DoubleSide }),
    walnut: mat("#4a2c1a", { roughness: 0.42 }), walnutDark: mat("#2b1910", { roughness: 0.5 }), mahogany: mat("#4f1d14", { roughness: 0.38 }),
    gold: mat("#c9a24a", { metalness: 0.85, roughness: 0.28 }), brass: mat("#b8913f", { metalness: 0.8, roughness: 0.32 }),
    blotter: mat("#1f4a33", { roughness: 0.7 }), velvet: mat("#3a0f18", { roughness: 0.9 }),
    bankerShade: mat("#1e6b3c", { emissive: "#2f9a55", emissiveIntensity: 0.9, roughness: 0.3, side: THREE.DoubleSide }),
    bulb: glow("#ffe2a6", 1.6), screenBack: mat("#14161c", { metalness: 0.4, roughness: 0.4 }), keyboard: mat("#1a1c22"),
    ball: mat("#f4f1e8", { roughness: 0.35 }), pencil: mat("#2f5a8a"), crystal: new THREE.MeshStandardMaterial({ color: "#f6f9ff", metalness: 0.3, roughness: 0.05, emissive: "#ffe9c4", emissiveIntensity: 0.55 }),
    paint: new THREE.MeshPhysicalMaterial({ color: "#b3101b", metalness: 0.15, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
    chrome: mat("#dfe3e8", { metalness: 1, roughness: 0.12 }), tire: mat("#151515", { roughness: 0.85 }), seat: mat("#c69a63", { roughness: 0.55 }),
    cabin: mat("#1c1512", { roughness: 0.8 }), steering: mat("#6b3f1d", { roughness: 0.4 }), lamp: glow("#fff4d6", 1.9), tail: glow("#ff2a2a", 1.5),
    glass: new THREE.MeshStandardMaterial({ color: "#cfe3ff", transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    beam: new THREE.MeshBasicMaterial({ color: "#fff1d0", transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    shelfGlass: new THREE.MeshStandardMaterial({ color: "#dff0ff", transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false }),
    // Géométries communes : abat-jour de banquier (demi-cylindre couché), canette, coupe de trophée.
    shade: new THREE.CylinderGeometry(0.075, 0.075, 0.3, 14, 1, true, 0, Math.PI).rotateZ(Math.PI / 2),
    can: new THREE.CylinderGeometry(0.033, 0.033, 0.165, 16), canTop: new THREE.CylinderGeometry(0.0335, 0.0335, 0.008, 16), canFace: new THREE.PlaneGeometry(0.06, 0.155),
    cup: new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.07, 0.025], [0.02, 0.04], [0.016, 0.11], [0.03, 0.13], [0.085, 0.17], [0.1, 0.26], [0.094, 0.262], [0.08, 0.18], [0, 0.16]].map(([r, y]) => new THREE.Vector2(r, y)), 20),
    dualScreen: mergeGeometries([new THREE.PlaneGeometry(0.54, 0.32).translate(-0.29, 0, 0), new THREE.PlaneGeometry(0.54, 0.32).translate(0.29, 0, 0)]),
    chesterSeat: new RoundedBoxGeometry(0.6, 0.12, 0.36, 2, 0.04), chesterBack: new RoundedBoxGeometry(0.84, 0.85, 0.18, 2, 0.06),
  };
  return prestigeKit;
}
// Plusieurs maillages transparents de même matériau réunis à la main (la fusion automatique laisse les transparents).
function mergedMesh(parent, geometries, material) {
  const mesh = new THREE.Mesh(mergeGeometries(geometries.map(g => g.index ? g.toNonIndexed() : g)), material);
  parent.add(mesh);
  return mesh;
}
// Lampe de banquier : socle et tige en laiton, abat-jour vert émissif, ampoule chaude dessous.
function bankerLamp(g, M, x, y, z) {
  cyl(g, 0.07, 0.02, M.brass, x, y + 0.01, z, 16);
  cyl(g, 0.009, 0.28, M.brass, x, y + 0.15, z, 8);
  box(g, 0.24, 0.014, 0.028, M.bulb, x, y + 0.285, z);
  const shade = new THREE.Mesh(M.shade, M.bankerShade);
  shade.position.set(x, y + 0.29, z); g.add(shade);
}
// Bureau de ministre et fauteuil Chesterfield, aux places exactes des postes (DESKS) : le robot assis (bassin à
// 0,47 m, au-dessus du centre du fauteuil) a les jambes sous le plateau, entre les caissons, face à ses deux écrans.
// Renvoie l'écran (les deux dalles en un maillage) que update() allume quand le poste est occupé.
function prestigeDesk(g, M, d, k, cans) {
  const dc = P(d.cx, d.cy), ch = P(d.cx, d.cy - 52), zc = dc.z + 0.035;
  box(g, 1.7, 0.05, 0.85, M.walnut, dc.x, 0.755, zc);
  box(g, 1.72, 0.022, 0.87, M.gold, dc.x, 0.722, zc);
  box(g, 0.95, 0.006, 0.48, M.blotter, dc.x, 0.783, zc - 0.13);
  for (const s of [-1, 1]) {
    box(g, 0.42, 0.66, 0.78, M.walnut, dc.x + s * 0.62, 0.4, zc);
    box(g, 0.45, 0.06, 0.81, M.walnutDark, dc.x + s * 0.62, 0.06, zc);
    for (const y of [0.24, 0.45, 0.63]) box(g, 0.14, 0.018, 0.02, M.gold, dc.x + s * 0.62, y, zc - 0.4);
  }
  box(g, 0.82, 0.48, 0.04, M.walnut, dc.x, 0.47, zc + 0.39);
  box(g, 0.66, 0.014, 0.014, M.gold, dc.x, 0.58, zc + 0.413);
  box(g, 0.66, 0.014, 0.014, M.gold, dc.x, 0.36, zc + 0.413);
  // Double écran, tourné vers le fauteuil ; clavier sur le sous-main.
  for (const s of [-1, 1]) {
    box(g, 0.58, 0.36, 0.03, M.screenBack, dc.x + s * 0.29, 1.07, zc + 0.2);
    box(g, 0.04, 0.2, 0.03, M.screenBack, dc.x + s * 0.29, 0.88, zc + 0.22);
    box(g, 0.2, 0.012, 0.14, M.screenBack, dc.x + s * 0.29, 0.786, zc + 0.22);
  }
  box(g, 0.44, 0.018, 0.14, M.keyboard, dc.x, 0.795, zc - 0.14);
  bankerLamp(g, M, dc.x - 0.62, 0.78, zc + 0.1);
  // Canette Red Bull (édition selon le poste) ; balle de golf presse-papier ou pot à crayons, en alternance.
  cans.push([dc.x + 0.6, 0.78, zc - 0.12, k % redBullEditions.length]);
  if (k % 2) {
    cyl(g, 0.035, 0.1, M.walnutDark, dc.x + 0.45, 0.83, zc - 0.25, 12);
    for (let i = 0; i < 3; i++) cyl(g, 0.006, 0.17, i % 2 ? M.gold : M.pencil, dc.x + 0.435 + i * 0.015, 0.89, zc - 0.25 + (i - 1) * 0.012, 6);
  } else {
    cyl(g, 0.026, 0.012, M.gold, dc.x + 0.45, 0.787, zc - 0.25, 12);
    const ball = new THREE.Mesh(ballGeometry, M.ball); ball.scale.setScalar(0.022); ball.position.set(dc.x + 0.45, 0.814, zc - 0.25); g.add(ball);
  }
  // Fauteuil Chesterfield : assise à 0,47 m, haut dossier capitonné, accoudoirs roulés, pieds boule. Le bassin du robot
  // est au-dessus du centre du fauteuil et ses genoux 0,16 m devant : l'assise s'arrête juste derrière ses mollets.
  const tuft = M.tuft;
  box(g, 0.8, 0.29, 0.42, tuft, ch.x, 0.2, ch.z - 0.11);
  const seat = new THREE.Mesh(M.chesterSeat, tuft); seat.position.set(ch.x, 0.41, ch.z - 0.08); g.add(seat);
  const back = new THREE.Mesh(M.chesterBack, tuft); back.position.set(ch.x, 0.75, ch.z - 0.33); g.add(back);
  for (const s of [-1, 1]) {
    box(g, 0.13, 0.3, 0.5, tuft, ch.x + s * 0.37, 0.47, ch.z - 0.1);
    cyl(g, 0.08, 0.52, tuft, ch.x + s * 0.38, 0.64, ch.z - 0.1, 14).rotation.x = Math.PI / 2;
    for (const dz of [-0.28, 0.06]) cyl(g, 0.035, 0.06, M.walnutDark, ch.x + s * 0.33, 0.03, ch.z + dz, 8);
  }
  const screen = new THREE.Mesh(M.dualScreen, mat("#1d2433"));
  screen.position.set(dc.x, 1.07, zc + 0.183);
  screen.rotation.y = Math.PI;
  g.add(screen);
  return screen;
}
// Canettes des bureaux : un corps et un couvercle instanciés, une face (photo de l'édition) par édition.
function prestigeCans(g, M, cans) {
  const m4 = new THREE.Matrix4(), color = new THREE.Color();
  const bodies = new THREE.InstancedMesh(M.can, mat("#ffffff", { metalness: 0.3, roughness: 0.35 }), cans.length);
  const tops = new THREE.InstancedMesh(M.canTop, M.chrome, cans.length);
  cans.forEach(([x, y, z, e], i) => {
    bodies.setMatrixAt(i, m4.makeTranslation(x, y + 0.0825, z)); bodies.setColorAt(i, color.set(redBullEditions[e].color));
    tops.setMatrixAt(i, m4.makeTranslation(x, y + 0.168, z));
  });
  g.add(bodies, tops);
  redBullEditions.forEach((edition, e) => {
    const mine = cans.filter(c => c[3] === e), photo = redBullTextures.get(edition.image);
    if (!mine.length || !photo) return;
    const faces = new THREE.InstancedMesh(M.canFace, prestigeKit.faces?.[e] ?? ((prestigeKit.faces ??= [])[e] = new THREE.MeshBasicMaterial({ map: photo, transparent: true, alphaTest: 0.08, toneMapped: false })), mine.length);
    mine.forEach(([x, y, z], i) => faces.setMatrixAt(i, m4.makeTranslation(x, y + 0.0825, z + 0.034)));
    g.add(faces);
  });
}
// Lustre de cristal : anneaux et bras dorés (fusionnés avec l'étage), bougies et pampilles collectées pour deux
// séries d'instances communes à tous les lustres de l'étage.
function chandelier(g, M, x, z, r, bulbs, drops) {
  const y = 3.95;
  cyl(g, 0.012, 4.7 - y - 0.3, M.gold, x, (4.7 + y + 0.3) / 2, z, 6);
  cyl(g, 0.09, 0.05, M.gold, x, 4.68, z, 16);
  cyl(g, 0.05, 0.42, M.gold, x, y + 0.12, z, 12);
  for (const [rr, yy, n] of [[r, y, 8], [r * 0.6, y + 0.22, 6]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.016, 6, 40).rotateX(Math.PI / 2), M.gold);
    ring.position.set(x, yy, z); g.add(ring);
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2, bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr;
      box(g, rr, 0.012, 0.012, M.gold, x + Math.cos(a) * rr / 2, yy - 0.02, z + Math.sin(a) * rr / 2, -a);
      cyl(g, 0.022, 0.08, M.ball, bx, yy + 0.05, bz, 8);
      bulbs.push([bx, yy + 0.11, bz]);
    }
    for (let k = 0; k < n * 2; k++) { const a = (k + 0.5) / (n * 2) * Math.PI * 2; drops.push([x + Math.cos(a) * rr, yy - 0.09 - (k % 2) * 0.07, z + Math.sin(a) * rr]); }
  }
  for (let k = 0; k < 6; k++) drops.push([x, y - 0.12 - k * 0.07, z]);
}
function prestigeChandeliers(g, M, bulbs, drops) {
  const m4 = new THREE.Matrix4();
  const flames = new THREE.InstancedMesh(ballGeometry, M.bulb, bulbs.length);
  bulbs.forEach(([x, y, z], i) => flames.setMatrixAt(i, m4.makeScale(0.026, 0.04, 0.026).setPosition(x, y, z)));
  const crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), M.crystal, drops.length);
  drops.forEach(([x, y, z], i) => crystals.setMatrixAt(i, m4.makeScale(0.028, 0.05, 0.028).setPosition(x, y, z)));
  g.add(flames, crystals);
}
// Coque du spider (échelle 1, avant en +x) : sections en super-ellipse le long de la voiture, capot creusé entre les
// ailes galbées, passages de roue découpés, baquet ouvert de l'habitacle.
function spiderBodyGeometry() {
  const smooth = table => xq => {
    let i = 0;
    while (i < table.length - 2 && xq > table[i + 1][0]) i++;
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    const m0 = i > 0 ? (y1 - table[i - 1][1]) / (x1 - table[i - 1][0]) : (y1 - y0) / (x1 - x0);
    const m1 = i < table.length - 2 ? (table[i + 2][1] - y0) / (table[i + 2][0] - x0) : (y1 - y0) / (x1 - x0);
    const h = x1 - x0, t = Math.min(1, Math.max(0, (xq - x0) / h)), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
  };
  const top = smooth([[-2.22, 0.6], [-2.12, 0.7], [-1.9, 0.78], [-1.5, 0.84], [-1.15, 0.87], [-0.75, 0.86], [-0.3, 0.84], [0.4, 0.83], [0.9, 0.84], [1.25, 0.86], [1.65, 0.81], [1.95, 0.72], [2.12, 0.6], [2.22, 0.5]]);
  const half = smooth([[-2.22, 0.36], [-2.12, 0.6], [-1.9, 0.75], [-1.5, 0.83], [-1.15, 0.85], [-0.6, 0.81], [0, 0.8], [0.6, 0.8], [1.25, 0.85], [1.7, 0.79], [1.98, 0.66], [2.14, 0.5], [2.22, 0.34]]);
  const base = smooth([[-2.22, 0.5], [-2.1, 0.36], [-1.8, 0.25], [-1.2, 0.21], [0, 0.2], [1.2, 0.21], [1.9, 0.24], [2.12, 0.3], [2.22, 0.38]]);
  // Capot creusé entre les ailes avant et arrière ; baquet de l'habitacle (dip profond, bords nets : les portières).
  const hood = smooth([[-2.22, 0], [-1.7, 0.02], [-1.15, 0.05], [-0.8, 0.03], [0.6, 0.03], [1.25, 0.07], [1.8, 0.04], [2.22, 0]]);
  const well = xq => { const a = Math.min(1, Math.max(0, (xq + 0.78) / 0.12)), b = Math.min(1, Math.max(0, (0.48 - xq) / 0.12)); return 0.36 * Math.min(a, b); };
  const arch = xq => { let y = 0; for (const ax of [1.25, -1.15]) { const d = xq - ax; if (Math.abs(d) < 0.44) y = Math.max(y, 0.28 + Math.sqrt(0.44 * 0.44 - d * d)); } return y; };
  const STEPS = 150, SEG = 36, n = 3.2, pos = [], index = [];
  for (let i = 0; i <= STEPS; i++) {
    const x = -2.22 + 4.44 * i / STEPS, t = top(x), b = Math.max(base(x), arch(x)), w = half(x), c = (t + b) / 2, h = (t - b) / 2;
    for (let j = 0; j < SEG; j++) {
      const th = j / SEG * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      const u = Math.sign(cs) * Math.abs(cs) ** (2 / n), v = Math.sign(sn) * Math.abs(sn) ** (2 / n);
      let y = c + h * v;
      if (v > 0) {
        const au = Math.abs(u);
        y -= hood(x) * v * (1 - au * au) ** 2;
        y -= well(x) * v * Math.min(1, Math.max(0, (0.8 - au) / 0.08));
      }
      pos.push(x, y, w * u);
    }
  }
  for (let i = 0; i < STEPS; i++) for (let j = 0; j < SEG; j++) {
    const a = i * SEG + j, b2 = i * SEG + (j + 1) % SEG, c2 = a + SEG, d2 = b2 + SEG;
    index.push(a, c2, b2, b2, c2, d2);
  }
  // Nez et poupe fermés par un éventail.
  for (const [ring, sign] of [[0, -1], [STEPS, 1]]) {
    let cx = 0, cy = 0;
    for (let j = 0; j < SEG; j++) { cx += pos[(ring * SEG + j) * 3]; cy += pos[(ring * SEG + j) * 3 + 1]; }
    const center = pos.length / 3;
    pos.push(cx / SEG + sign * 0.015, cy / SEG, 0);
    for (let j = 0; j < SEG; j++) {
      const a = ring * SEG + j, b2 = ring * SEG + (j + 1) % SEG;
      if (sign > 0) index.push(a, b2, center); else index.push(b2, a, center);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}
// Roue fil chromée : pneu, jante, rayons croisés, moyeu à papillon (géométries communes, posées quatre fois).
function spiderWheel(parent, M, x, z, side) {
  const kit = prestigeKit;
  kit.wheel ??= (() => {
    const spokes = [];
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, off = k % 2 ? 0.035 : -0.035;
      const from = new THREE.Vector3(Math.cos(a) * 0.05, Math.sin(a) * 0.05, off), to = new THREE.Vector3(Math.cos(a + 0.5) * 0.2, Math.sin(a + 0.5) * 0.2, -off);
      const len = from.distanceTo(to), geo = new THREE.CylinderGeometry(0.0045, 0.0045, len, 4);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      geo.applyQuaternion(q); geo.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      spokes.push(geo.toNonIndexed());
    }
    return { tire: new THREE.TorusGeometry(0.245, 0.08, 12, 32), rim: new THREE.TorusGeometry(0.205, 0.018, 8, 32), spokes: mergeGeometries(spokes) };
  })();
  const w = new THREE.Group(); w.position.set(x, 0.325, z); parent.add(w);
  w.add(new THREE.Mesh(kit.wheel.tire, M.tire), new THREE.Mesh(kit.wheel.rim, M.chrome), new THREE.Mesh(kit.wheel.spokes, M.chrome));
  cyl(w, 0.05, 0.1, M.cabin, 0, 0, 0, 16).rotation.x = Math.PI / 2;
  const hub = cyl(w, 0.042, 0.07, M.chrome, 0, 0, side * 0.07, 12); hub.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) box(w, 0.13, 0.025, 0.02, M.chrome, s * 0.05, 0, side * 0.1, s * 0.25).rotation.z = s * 0.3;
}
// Le spider : roadster italien du milieu des années 60, rouge vernis, sans logo ni nom.
function spider(M) {
  const car = new THREE.Group();
  prestigeKit.body ??= spiderBodyGeometry();
  car.add(new THREE.Mesh(prestigeKit.body, M.paint));
  // Baquet : plancher sombre, deux sièges baquets en cuir fauve, planche de bord, volant à jante bois (conduite à gauche).
  box(car, 1.12, 0.06, 1.14, M.cabin, -0.15, 0.46, 0);
  prestigeKit.bucket ??= [new RoundedBoxGeometry(0.44, 0.1, 0.44, 2, 0.04), new RoundedBoxGeometry(0.1, 0.38, 0.44, 2, 0.045)];
  for (const z of [-0.32, 0.32]) {
    const cushion = new THREE.Mesh(prestigeKit.bucket[0], M.seat); cushion.position.set(-0.3, 0.54, z); car.add(cushion);
    const back = new THREE.Mesh(prestigeKit.bucket[1], M.seat); back.position.set(-0.56, 0.74, z); back.rotation.z = 0.22; car.add(back);
  }
  box(car, 0.18, 0.2, 1.3, M.cabin, 0.42, 0.72, 0);
  for (const z of [-0.45, -0.2]) { const gauge = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 20), M.chrome); gauge.position.set(0.33, 0.78, z); gauge.rotation.y = Math.PI / 2; car.add(gauge); }
  const wheel = new THREE.Group(); wheel.position.set(0.16, 0.86, -0.32); wheel.rotation.set(0, Math.PI / 2, -0.45, "YZX"); car.add(wheel);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.014, 8, 32), M.steering));
  for (let k = 0; k < 3; k++) box(wheel, 0.16, 0.012, 0.01, M.chrome, Math.cos(k * 2.1 - 1.57) * 0.08, Math.sin(k * 2.1 - 1.57) * 0.08, 0, 0).rotation.z = k * 2.1 - 1.57;
  cyl(car, 0.02, 0.4, M.cabin, 0.32, 0.74, -0.32, 8).rotation.z = 1.1;
  // Pare-brise incliné, cerclé de chrome.
  const shield = new THREE.Group(); shield.position.set(0.5, 0.82, 0); shield.rotation.z = 0.62; car.add(shield);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.3), M.glass); pane.position.y = 0.16; pane.rotation.y = Math.PI / 2; shield.add(pane);
  box(shield, 0.02, 0.022, 1.28, M.chrome, 0, 0.32, 0);
  for (const z of [-0.63, 0.63]) box(shield, 0.02, 0.33, 0.022, M.chrome, 0, 0.16, z);
  // Calandre ovale chromée, phares ronds sous bulle, pare-chocs fins, feux et échappements.
  const oval = (rz, ry, x0, y0) => new THREE.CatmullRomCurve3(Array.from({ length: 32 }, (_, k) => new THREE.Vector3(x0, y0 + Math.sin(k / 32 * Math.PI * 2) * ry, Math.cos(k / 32 * Math.PI * 2) * rz)), true);
  const grille = new THREE.Mesh(new THREE.CircleGeometry(1, 32), M.grille); grille.position.set(2.2, 0.43, 0); grille.scale.set(0.3, 0.115, 1); grille.rotation.y = Math.PI / 2; car.add(grille);
  car.add(new THREE.Mesh(new THREE.TubeGeometry(oval(0.31, 0.125, 2.205, 0.43), 48, 0.016, 6, true), M.chrome));
  const bubbles = [];
  for (const z of [-0.58, 0.58]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), M.lamp); lamp.position.set(1.99, 0.66, z); lamp.rotation.y = Math.PI / 2; car.add(lamp);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 24), M.chrome); bezel.position.set(1.995, 0.66, z); bezel.rotation.y = Math.PI / 2; car.add(bezel);
    bubbles.push(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).scale(0.24, 0.11, 0.12).translate(1.94, 0.665, z));
  }
  mergedMesh(car, bubbles, M.glass);
  const bar = (pts, r = 0.018) => car.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 24, r, 6), M.chrome));
  for (const s of [-1, 1]) bar([[2.2, 0.36, s * 0.14], [2.14, 0.36, s * 0.42], [2.0, 0.37, s * 0.6], [1.86, 0.38, s * 0.68]]);
  bar([[-1.92, 0.44, -0.74], [-2.18, 0.44, -0.42], [-2.25, 0.44, 0], [-2.18, 0.44, 0.42], [-1.92, 0.44, 0.74]]);
  for (const z of [-0.56, -0.42, 0.42, 0.56]) { const t = cyl(car, 0.035, 0.03, M.tail, -2.17, 0.6, z, 12); t.rotation.z = Math.PI / 2; }
  for (const z of [-0.28, 0.28]) { const e = cyl(car, 0.028, 0.18, M.chrome, -2.25, 0.27, z, 10); e.rotation.z = Math.PI / 2; }
  // Rond de course blanc sur les portières.
  for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.CircleGeometry(0.17, 28), M.roundel); r.position.set(-0.1, 0.56, s * 0.806); r.rotation.y = s > 0 ? 0 : Math.PI; car.add(r); }
  for (const [x, z] of [[1.25, -0.68], [1.25, 0.68], [-1.15, -0.68], [-1.15, 0.68]]) spiderWheel(car, M, x, z, Math.sign(z));
  return car;
}
// Le bureau du résident en version Prestige : spider sur plateau tournant (sud-est), green de putting (sud-ouest),
// sac de golf (mur est), vitrine à trophées (au fond, à la place des bibliothèques), frigo Red Bull sur socle, affiches
// de Grand Prix (vitre du fond, en frise), lustre. Rien sur les places des agents (y 300 à 405), ni dans l'allée,
// ni sur le décor acheté (piano jusqu'à y 446, plante XL et aquarium contre le mur est, statue au nord-ouest).
function prestigeBoss(f, g, M, drops, bulbs) {
  // Plateau tournant : base fixe, disque et voiture (vivants), portique de projecteurs.
  const tc = P(830, 513), R = 1.62;
  cyl(g, R + 0.06, 0.08, M.walnutDark, tc.x, 0.04, tc.z, 48);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.022, 6, 64).rotateX(Math.PI / 2), M.gold); ring.position.set(tc.x, 0.085, tc.z); g.add(ring);
  const table = live(new THREE.Group()); table.position.set(tc.x, 0, tc.z); g.add(table);
  cyl(table, R, 0.05, mat("#0d0d12", { metalness: 0.4, roughness: 0.18 }), 0, 0.105, 0, 48);
  const car = spider(M); car.scale.setScalar(0.7); car.position.y = 0.13; car.rotation.y = 0.5; table.add(car);
  box(g, 3.9, 0.045, 0.045, M.gold, tc.x, 4.25, tc.z);
  for (const dx of [-1.9, 1.9]) cyl(g, 0.015, 0.45, M.gold, tc.x + dx, 4.5, tc.z, 6);
  const beams = [];
  for (const dx of [-1.3, 0, 1.3]) {
    const head = new THREE.Group(); head.position.set(tc.x + dx, 4.12, tc.z); head.rotation.z = -dx * 0.22; g.add(head);
    cyl(head, 0.09, 0.22, M.screenBack, 0, 0, 0, 14);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), M.lamp); lens.position.y = -0.112; lens.rotation.x = Math.PI / 2; head.add(lens);
    beams.push(new THREE.ConeGeometry(0.85, 3.6, 20, 1, true).translate(0, -1.9, 0).rotateZ(-dx * 0.22).translate(tc.x + dx, 4.12, tc.z));
  }
  mergedMesh(g, beams, M.beam);
  const spot = new LightSpot("#fff1d6", 10, 8, 1.4, 2); spot.position.set(tc.x, 3.2, tc.z); g.add(spot);
  // Green de putting : avant-green, green tondu, trou et drapeau qui flotte, deux balles.
  const gc = P(703, 527);
  const fringe = new THREE.Mesh(discGeometry, mat("#2f6a37", { roughness: 0.95 })); fringe.position.set(gc.x, 0.07, gc.z); fringe.scale.set(0.72, 1, 1.38); g.add(fringe);
  const lawn = new THREE.Mesh(discGeometry, M.green); lawn.position.set(gc.x, 0.076, gc.z); lawn.scale.set(0.64, 1, 1.3); g.add(lawn);
  const hole = new THREE.Mesh(discGeometry, mat("#0a0c0a")); hole.position.set(gc.x + 0.05, 0.079, gc.z - 0.75); hole.scale.set(0.054, 1, 0.054); g.add(hole);
  const lip = new THREE.Mesh(new THREE.RingGeometry(0.054, 0.066, 20).rotateX(-Math.PI / 2), mat("#e9ecef")); lip.position.set(gc.x + 0.05, 0.08, gc.z - 0.75); g.add(lip);
  cyl(g, 0.008, 1.1, mat("#f4f1e8", { roughness: 0.4 }), gc.x + 0.05, 0.63, gc.z - 0.75, 6);
  const flagGeo = new THREE.PlaneGeometry(0.3, 0.2, 8, 1).translate(0.15, 0, 0);
  const flag = live(new THREE.Mesh(flagGeo, M.flag)); flag.position.set(gc.x + 0.05, 1.07, gc.z - 0.75); flag.rotation.y = -0.6; g.add(flag);
  for (const [dx, dz] of [[0.18, 0.2], [-0.12, 0.55]]) { const b = new THREE.Mesh(ballGeometry, M.ball); b.scale.setScalar(0.021); b.position.set(gc.x + dx, 0.099, gc.z + dz); g.add(b); }
  // Sac de golf appuyé contre la cloison est : cuir grenat, cerclages dorés, fers et bois capuchonnés.
  const bag = new THREE.Group(); bag.position.copy(P(962, 478)); bag.rotation.z = -0.16; g.add(bag);
  cyl(bag, 0.13, 0.82, mat("#6e1a1c", { roughness: 0.55 }), 0, 0.43, 0, 16);
  for (const y of [0.06, 0.82]) cyl(bag, 0.137, 0.05, M.gold, 0, y, 0, 16);
  box(bag, 0.08, 0.36, 0.16, mat("#4a1012", { roughness: 0.6 }), -0.13, 0.42, 0);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05, cx = Math.cos(a) * 0.06, cz = Math.sin(a) * 0.06;
    cyl(bag, 0.007, 0.36, M.chrome, cx, 1.0, cz, 6);
    if (k < 3) box(bag, 0.075, 0.03, 0.05, M.chrome, cx + 0.02, 1.19, cz);
    else { const hd = new THREE.Mesh(ballGeometry, k === 4 ? mat("#c8102e", { roughness: 0.8 }) : mat("#1b1b1b", { roughness: 0.5 })); hd.scale.set(0.055, 0.045, 0.045); hd.position.set(cx, 1.2, cz); bag.add(hd); }
  }
  // Vitrine à trophées : cadre de noyer, fond de velours, étagères de verre, coupes dorées.
  const vc = P(729, 34), VW = 2.2, VH = 2.1, VD = 0.45;
  box(g, VW, 0.1, VD, M.walnutDark, vc.x, 0.05, vc.z);
  box(g, VW, 0.08, VD, M.walnutDark, vc.x, VH - 0.04, vc.z);
  for (const s of [-1, 1]) box(g, 0.07, VH, VD, M.walnut, vc.x + s * (VW / 2 - 0.035), VH / 2, vc.z);
  box(g, VW - 0.14, VH - 0.18, 0.03, M.velvet, vc.x, VH / 2, vc.z - VD / 2 + 0.03);
  box(g, VW - 0.14, 0.02, 0.02, M.bulb, vc.x, VH - 0.1, vc.z + 0.12);
  box(g, VW + 0.04, 0.03, VD + 0.04, M.gold, vc.x, VH, vc.z);
  const shelves = [];
  for (const y of [0.55, 1.05, 1.55]) shelves.push(new THREE.BoxGeometry(VW - 0.14, 0.015, VD - 0.08).translate(vc.x, y, vc.z));
  shelves.push(new THREE.PlaneGeometry(VW - 0.14, VH - 0.18).translate(vc.x, VH / 2, vc.z + VD / 2 - 0.01));
  mergedMesh(g, shelves, M.shelfGlass);
  [0.1, 0.56, 1.06, 1.56].forEach((y, row) => {
    for (let k = 0; k < 4; k++) {
      const cup = new THREE.Mesh(M.cup, M.gold), s = 0.8 + ((k + row) % 3) * 0.25;
      cup.scale.setScalar(s); cup.position.set(vc.x - 0.75 + k * 0.5, y + 0.005, vc.z + 0.02); g.add(cup);
      box(g, 0.12 * s, 0.03, 0.06, mat("#16161a"), vc.x - 0.75 + k * 0.5, y + 0.02, vc.z + 0.12);
    }
  });
  // Frigo Red Bull mis en valeur : socle de marbre et liseré lumineux rouge.
  const fr = P(835, 55);
  box(g, 1.5, 0.05, 1.22, M.marble, fr.x, 0.04, fr.z);
  for (const [w, d, dx, dz] of [[1.5, 0.025, 0, 0.61], [0.025, 1.22, -0.75, 0], [0.025, 1.22, 0.75, 0]]) box(g, w, 0.025, d, glow("#ff2a3a", 1.6), fr.x + dx, 0.07, fr.z + dz);
  // Affiches de Grand Prix encadrées, en frise sur la vitre du fond (au-dessus du néon s'il est acheté).
  const posters = [];
  [7.9, 8.8, 9.7].forEach((x, i) => {
    const plane = new THREE.PlaneGeometry(0.76, 1.0), uv = plane.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
    posters.push(plane.translate(x, 3.95, -6.37));
    box(g, 0.82, 1.06, 0.03, M.gold, x, 3.95, -6.4);
  });
  const sheet = new THREE.Mesh(mergeGeometries(posters), M.posters); g.add(sheet);
  chandelier(g, M, P(820, 335).x, P(820, 335).z, 0.5, bulbs, drops);
  f.prestige = { table, flag, flagBase: Float32Array.from(flagGeo.attributes.position.array) };
}
// Tout l'étage Prestige (aile principale) : sols, boiseries, tapis, lustres, lumière chaude.
function prestigeFloor(f, g, M, bulbs, drops, room) {
  const c = P(OPEN.x + OPEN.w / 2, OPEN.y + OPEN.h / 2), b = P(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2);
  box(g, OPEN.w * S, 0.03, OPEN.h * S, room.sol !== "auto" ? roomFloor(room.sol, OPEN) : M.parquet, c.x, 0.05, c.z);
  box(g, BOSS.w * S, 0.03, BOSS.h * S, room.solBureau !== "auto" ? roomFloor(room.solBureau, BOSS) : M.marble, b.x, 0.05, b.z);
  // Grands tapis sous les deux rangées de bureaux, hors de l'allée centrale.
  for (const [y0, y1] of [[62, 290], [335, 592]]) {
    const a = P(62, y0), e = P(612, y1);
    box(g, e.x - a.x, 0.01, e.z - a.z, M.rug, (a.x + e.x) / 2, 0.07, (a.z + e.z) / 2);
  }
  // Boiseries basses le long des vitres (sauf la porte de l'ascenseur), lisse dorée et montants.
  const panel = (w, d, x, z) => {
    box(g, w, 1.0, d, M.walnut, x, 0.55, z);
    box(g, w + (d > w ? 0.02 : 0), 0.035, d + (w > d ? 0.02 : 0), M.gold, x, 1.065, z);
  };
  panel(20.6, 0.04, 0, -6.44);
  for (let x = -9.75; x <= 9.8; x += 1.3) box(g, 0.05, 0.86, 0.05, M.walnutDark, x, 0.55, -6.41);
  panel(0.04, 5.3, -10.36, -3.55); panel(0.04, 5.3, -10.36, 3.55); panel(0.04, 12.4, 10.36, 0);
  // Deux lustres au-dessus de l'allée centrale de l'open space (bien au-dessus des têtes).
  for (const x of [250, 420]) chandelier(g, M, P(x, LANE).x, P(x, LANE).z, 0.55, bulbs, drops);
  f.warmSpot.color.set("#ffcf96");
  const chandelierLight = new LightSpot("#ffd9a8", 8, 14, 1.5, 2); chandelierLight.position.set(c.x, 3.5, c.z); g.add(chandelierLight);
}
// Plateau tournant et drapeau du green : seulement sur l'étage regardé, figés si les animations sont réduites.
function tickPrestige(p, dt, t) {
  if (reducedMotion.matches) return;
  p.table.rotation.y += dt * 0.12;
  const pos = p.flag.geometry.attributes.position, base = p.flagBase;
  for (let i = 0; i < pos.count; i++) { const x = base[i * 3]; pos.array[i * 3 + 2] = Math.sin(x * 14 - t * 5) * 0.035 * (x / 0.3); }
  pos.needsUpdate = true;
}

export {
  bankerLamp, chandelier, prestigeBoss, prestigeCans, prestigeChandeliers, prestigeDesk, prestigeFloor,
  prestigeMaterials, tickPrestige,
};
