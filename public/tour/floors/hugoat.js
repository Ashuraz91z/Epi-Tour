// Étage de Hugo (« hugoat ») : marbre noir veiné d'or, bureau en or, billets de 100 $, balcon piscine,
// showroom avec une GT noire sur plateau tournant et invitées en maillot. Appelé par resident.js pour ce seul étage.

import * as THREE from "three";
import { BOSS, LANE, P, S } from "../base.js";
import { LightSpot, box, boxGeometry, cyl, glow, live, mat } from "../engine.js";
import { put } from "./shell.js";

const canvasTexture = (w, h) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  return { c, ctx: c.getContext("2d"), texture };
};

// Réservé à l'étage « hugoat » : marbre et or partout, billets de 100 $ au sol, balcon piscine à l'est et invitées en maillot.
// Marbre blanc (colonnes, margelle) ou noir veiné d'or (sols).
function marbleTexture(base = "#f4f1ec", vein = "rgba(120,115,110,0.22)", accent = "rgba(176,140,70,0.45)") {
  const { c, ctx, texture } = canvasTexture(512, 512);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 512, 512);
  ctx.lineCap = "round";
  for (let k = 0; k < 26; k++) {
    ctx.strokeStyle = k % 5 ? vein : accent;
    ctx.lineWidth = 0.6 + Math.random() * 2.4;
    let x = Math.random() * 512, y = Math.random() * 512;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (Math.random() - 0.3) * 120; y += (Math.random() - 0.5) * 90; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return { c, texture };
}

function billTexture() {
  const { ctx, texture } = canvasTexture(256, 110);
  ctx.fillStyle = "#cfdcc0"; ctx.fillRect(0, 0, 256, 110);
  ctx.strokeStyle = "#3d5a3a"; ctx.lineWidth = 6; ctx.strokeRect(5, 5, 246, 100);
  ctx.fillStyle = "#b9c9a6"; ctx.beginPath(); ctx.ellipse(128, 55, 34, 40, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2f4a2c"; ctx.font = "700 30px Sora, sans-serif"; ctx.textBaseline = "middle";
  ctx.fillText("100", 14, 28); ctx.fillText("100", 190, 84);
  ctx.font = "700 12px Sora, sans-serif"; ctx.fillText("THE UNITED STATES OF HUGOAT", 50, 98);
  return texture;
}

// Invitée en maillot, construite en volumes lissés ; « allongee » la couche sur un transat.
// Peaux hâlées et maillots vifs, pour trancher sur le marbre.
const SKINS = ["#c68a5e", "#a8693f", "#e0a678", "#7a4a2c", "#d29a6c", "#5c3620"];
const HAIRS = ["#1a0f0a", "#d9a441", "#6b2a12", "#0b0b0b", "#b5733a"];
const SUITS = ["#ff1f5a", "#ffc400", "#00b4ff", "#c0007a", "#111111", "#ff5a00", "#00d68f"];
const hugoatGeo = {
  thigh: new THREE.CylinderGeometry(0.105, 0.06, 0.46, 16),
  calf: new THREE.CylinderGeometry(0.062, 0.038, 0.42, 14),
  arm: new THREE.CapsuleGeometry(0.033, 0.48, 4, 10),
  ball: new THREE.SphereGeometry(1, 24, 16),
  // Silhouette en sablier : hanches larges, taille fine, poitrine, épaules.
  torso: new THREE.LatheGeometry([[0.001, 0], [0.19, 0], [0.175, 0.07], [0.135, 0.15], [0.1, 0.22], [0.115, 0.31], [0.135, 0.4], [0.125, 0.48], [0.07, 0.54], [0.001, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)), 24),
};
function woman(g, x, z, ry, k, pose = "debout") {
  const skin = mat(SKINS[k % SKINS.length], { roughness: 0.42, metalness: 0.05 }), hair = mat(HAIRS[(k * 3) % HAIRS.length], { roughness: 0.45 });
  const suit = mat(SUITS[k % SUITS.length], { roughness: 0.3, metalness: 0.15 });
  const root = new THREE.Group(), body = new THREE.Group();
  root.position.set(x, 0, z); root.rotation.y = ry; root.add(body); g.add(root);
  const part = (geo, m, px, py, pz, sx = 1, sy = sx, sz = sx) => {
    const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.scale.set(sx, sy, sz); body.add(o); return o;
  };
  for (const s of [-1, 1]) {
    part(hugoatGeo.thigh, skin, s * 0.09, 0.66, 0).rotation.z = s * 0.06;
    part(hugoatGeo.ball, skin, s * 0.075, 0.43, 0.005, 0.06);
    part(hugoatGeo.calf, skin, s * 0.072, 0.22, -0.005);
    part(hugoatGeo.ball, skin, s * 0.072, 0.025, 0.04, 0.038, 0.025, 0.08);
    part(hugoatGeo.ball, skin, s * 0.075, 0.9, -0.065, 0.095, 0.1, 0.085);
    part(hugoatGeo.ball, suit, s * 0.072, 0.88, -0.075, 0.093, 0.075, 0.08);
    part(hugoatGeo.ball, suit, s * 0.062, 1.25, 0.075, 0.078, 0.075, 0.07);
    const arm = part(hugoatGeo.arm, skin, s * 0.205, 1.13, 0);
    arm.rotation.z = s * 0.14;
    part(hugoatGeo.ball, skin, s * 0.17, 1.37, 0, 0.055);
    part(hugoatGeo.ball, mat("#1a0f0a"), s * 0.033, 1.615, 0.088, 0.016, 0.01, 0.01);
  }
  part(hugoatGeo.ball, skin, 0, 0.9, 0, 0.19, 0.13, 0.13);
  part(hugoatGeo.ball, suit, 0, 0.87, 0.01, 0.192, 0.075, 0.13);
  part(hugoatGeo.torso, skin, 0, 0.86, 0, 1, 1, 0.74);
  box(body, 0.03, 0.012, 0.01, mat("#b8323a", { roughness: 0.3 }), 0, 1.55, 0.098);
  cyl(body, 0.04, 0.12, skin, 0, 1.46, 0, 12);
  part(hugoatGeo.ball, skin, 0, 1.6, 0.01, 0.085, 0.11, 0.095);
  part(hugoatGeo.ball, hair, 0, 1.645, -0.015, 0.098, 0.105, 0.1);
  part(hugoatGeo.ball, hair, 0, 1.38, -0.075, 0.12, 0.26, 0.055);
  if (k % 2) box(body, 0.15, 0.03, 0.02, mat("#0b0b0b", { metalness: 0.6, roughness: 0.2 }), 0, 1.62, 0.1);
  if (k % 3 === 0) for (const s of [-1, 1]) part(hugoatGeo.ball, glow("#ffd76a", 0.6), s * 0.088, 1.56, 0.01, 0.012);
  if (pose === "allongee") { body.rotation.x = -1.25; body.position.set(0, 0.42, 0.75); }
  return root;
}

// GT V12 à moteur avant, tout en noir (sans logo) : long capot plongeant, ailes musclées, habitacle reculé,
// poupe tronquée à becquet, quatre feux ronds. Échelle réelle (4,7 m), l'avant vers +x.
function supercar() {
  const car = new THREE.Group();
  // Reflets de studio (bandes lumineuses) propres à la voiture : sans eux, un noir brillant ne montre aucune forme.
  const studio = canvasTexture(512, 256), sctx = studio.ctx, sky = sctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, "#101013"); sky.addColorStop(0.45, "#26262c"); sky.addColorStop(0.55, "#060607"); sky.addColorStop(1, "#000000");
  sctx.fillStyle = sky; sctx.fillRect(0, 0, 512, 256);
  sctx.fillStyle = "#ffffff"; for (const x of [40, 170, 300, 430]) sctx.fillRect(x, 40, 22, 60);
  studio.texture.mapping = THREE.EquirectangularReflectionMapping;
  const paint = new THREE.MeshPhysicalMaterial({ color: "#0c0c0e", metalness: 0.4, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, envMap: studio.texture, envMapIntensity: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#050608", metalness: 0.9, roughness: 0.03, envMap: studio.texture, envMapIntensity: 1.2 });
  const satin = mat("#0d0d0f", { metalness: 0.65, roughness: 0.4 }), rubber = mat("#0b0b0b", { roughness: 0.92 });
  const v = (x, y) => new THREE.Vector2(x, y);
  // Profil de côté lissé (spline), extrudé puis arrondi par un fort chanfrein : pas d'arêtes vives.
  const extrude = (shape, width, bevel) => new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 8, curveSegments: 24 }).translate(0, 0, -width / 2);
  const body = new THREE.Shape();
  body.moveTo(2.22, 0.16); body.lineTo(2.36, 0.3);
  body.splineThru([v(2.36, 0.46), v(2.2, 0.58), v(1.6, 0.68), v(0.95, 0.78)]);
  body.lineTo(-1.2, 0.84);
  body.splineThru([v(-1.9, 0.88), v(-2.28, 0.93)]);
  body.lineTo(-2.36, 0.74); body.lineTo(-2.33, 0.3); body.lineTo(-2.18, 0.16); body.closePath();
  const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); car.add(o); return o; };
  add(extrude(body, 1.42, 0.2), paint);
  const cabin = new THREE.Shape();
  cabin.moveTo(1.0, 0.8);
  cabin.splineThru([v(0.45, 1.05), v(-0.15, 1.19), v(-0.75, 1.2), v(-1.45, 1.06), v(-2.05, 0.9)]);
  cabin.lineTo(-2.0, 0.82); cabin.closePath();
  add(extrude(cabin, 0.92, 0.17), glass);
  // Toit et montants peints par-dessus le vitrage, comme sur la vraie voiture.
  const roof = new THREE.Shape();
  roof.moveTo(0.2, 1.14); roof.splineThru([v(-0.2, 1.205), v(-0.75, 1.215), v(-1.3, 1.1)]); roof.lineTo(-1.2, 1.08); roof.splineThru([v(-0.75, 1.18), v(0.15, 1.12)]); roof.closePath();
  add(extrude(roof, 0.86, 0.06), paint, 0, 0.01);
  // Ailes musclées au-dessus des roues ; l'arrière est plus large que l'avant.
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(1, 32, 16), paint, 1.42, 0.56, s * 0.7).scale.set(0.82, 0.3, 0.3);
    add(new THREE.SphereGeometry(1, 32, 16), paint, -1.5, 0.6, s * 0.74).scale.set(0.95, 0.34, 0.32);
  }
  // Calandre, lame, diffuseur, becquet et quatre sorties d'échappement.
  box(car, 0.06, 0.16, 1.3, rubber, 2.4, 0.3, 0);
  box(car, 0.45, 0.03, 1.8, satin, 2.18, 0.15, 0);
  box(car, 0.3, 0.14, 1.5, satin, -2.3, 0.2, 0);
  box(car, 0.26, 0.04, 1.62, paint, -2.24, 0.99, 0).rotation.z = -0.12;
  const pipe = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 18).rotateZ(Math.PI / 2);
  for (const z of [-0.52, -0.38, 0.38, 0.52]) add(pipe, mat("#26262a", { metalness: 0.9, roughness: 0.3 }), -2.42, 0.23, z);
  // Phares effilés sur les ailes, feux arrière ronds doublés, ouïes derrière les roues avant.
  const lamp = new THREE.CylinderGeometry(0.065, 0.065, 0.03, 24).rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) {
    box(car, 0.42, 0.035, 0.16, glow("#f2f6ff", 2.6), 2.05, 0.6, s * 0.62, s * 0.35).rotation.z = -0.18;
    for (const dz of [0.42, 0.64]) add(lamp, glow("#ff1414", 2.6), -2.4, 0.78, s * dz);
    for (let k = 0; k < 3; k++) box(car, 0.35, 0.02, 0.03, rubber, 0.95 - k * 0.04, 0.5 + k * 0.06, s * 0.92);
    box(car, 0.12, 0.05, 0.03, paint, 0.82, 0.9, s * 0.72);
  }
  // Roues : pneus taille basse, jantes noires à dix branches, étriers.
  const tire = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 40).rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.245, 0.245, 0.29, 40).rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 16).rotateX(Math.PI / 2);
  const spokeM = mat("#18181b", { metalness: 0.85, roughness: 0.25 });
  for (const [x, z] of [[1.42, -0.78], [1.42, 0.78], [-1.5, -0.8], [-1.5, 0.8]]) {
    const s = Math.sign(z);
    add(tire, rubber, x, 0.34, z);
    add(rim, mat("#070708", { roughness: 0.6 }), x, 0.34, z);
    add(hub, spokeM, x, 0.34, z + s * 0.01);
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2, spoke = box(car, 0.025, 0.2, 0.02, spokeM, x + Math.sin(a) * 0.12, 0.34 + Math.cos(a) * 0.12, z + s * 0.145);
      spoke.rotation.z = -a;
    }
    box(car, 0.16, 0.09, 0.04, mat("#1c1c1c", { metalness: 0.5 }), x + 0.13, 0.46, z - s * 0.02);
  }
  // Ombre au sol.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.55, depthWrite: false }));
  shadow.position.y = 0.125; car.add(shadow);
  return car;
}

function hugoat(f) {
  const g = f.group, marble = marbleTexture(), gold = mat("#d4af37", { metalness: 0.9, roughness: 0.22 });
  const led = glow("#ffb84d", 2.6), magenta = "#ff3fa4";
  const nero = marbleTexture("#121014", "rgba(90,85,95,0.35)", "rgba(222,176,82,0.85)").texture;
  nero.repeat.set(6, 4);
  const marbleFloor = new THREE.MeshStandardMaterial({ map: nero, roughness: 0.08, metalness: 0.25 });
  const marbleM = new THREE.MeshStandardMaterial({ map: marble.texture, roughness: 0.2 });
  // Lumière de la coque tamisée et dorée : l'ambiance vient des LED, lustres et de la piscine.
  f.warmSpot.intensity = 6; f.warmSpot.color.set("#ffb36b");
  // Sol en marbre noir veiné d'or sur tout l'étage, liserés LED dorés au bord et le long de l'allée.
  box(g, 20.4, 0.01, 12.4, marbleFloor, 0, 0.072, 0);
  for (const z of [-6.15, 6.15]) box(g, 20.4, 0.012, 0.05, led, 0, 0.08, z);
  for (const x of [-10.15, 10.15]) box(g, 0.05, 0.012, 12.4, led, x, 0.08, 0);
  for (const z of [-0.9, 0.9]) box(g, 20.4, 0.012, 0.03, led, 0, 0.08, z);
  // Corniche lumineuse au plafond, dorée côté vitre, magenta sur les côtés.
  box(g, 20.4, 0.06, 0.06, led, 0, 4.6, -6.35);
  for (const x of [-10.25, 10.25]) box(g, 0.06, 0.06, 12.4, glow(magenta, 2.2), x, 4.6, 0);
  // Bureau tout en or : sol en marbre doré, cloisons et meubles dorés ; écrans, clavier et plantes gardent leurs couleurs.
  const goldTex = marbleTexture("#c9a13b", "rgba(255,236,170,0.35)", "rgba(120,84,20,0.5)").texture;
  goldTex.repeat.set(2, 4);
  const b = P(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2), bx0 = P(BOSS.x, 0).x - 0.1;
  // Or peu métallique et légèrement lumineux : sans reflets autour, un or très métallique paraîtrait brun foncé.
  const officeGold = mat("#e2b84a", { metalness: 0.55, roughness: 0.28, emissive: "#5a3f0c", emissiveIntensity: 0.55 });
  box(g, BOSS.w * S, 0.004, BOSS.h * S, new THREE.MeshStandardMaterial({ map: goldTex, metalness: 0.45, roughness: 0.2, emissive: "#3a2808", emissiveIntensity: 0.6 }), b.x, 0.078, b.z);
  const keep = new Set(["computerScreen", "computerKeyboard", "pottedPlant", "plantSmall1", "televisionModern"]);
  // Tout ce qui est posé dans le bureau passe à l'or, sauf les écrans, textures, lumières et éléments transparents.
  const toGold = m => m.isMeshStandardMaterial && !m.map && !m.transparent && !(m.emissiveIntensity > 0 && m.emissive.getHex());
  for (const o of [...g.children]) {
    if (o.position.x < bx0 || keep.has(o.userData.model)) continue;
    o.traverse(m => {
      if (!m.isMesh || m.geometry.type === "PlaneGeometry") return;
      if (Array.isArray(m.material)) m.material = m.material.map(x => toGold(x) ? officeGold : x);
      else if (toGold(m.material)) m.material = officeGold;
    });
  }
  // Colonnes en marbre à chapiteaux dorés, éclairées par le bas.
  for (const [x, z] of [[-9.7, -5.7], [-9.7, 5.7], [9.7, -5.7], [9.7, 5.7], [3, -5.7], [3, 5.7]]) {
    cyl(g, 0.28, 4.4, marbleM, x, 2.27, z, 24);
    cyl(g, 0.36, 0.14, gold, x, 0.14, z, 24);
    cyl(g, 0.36, 0.14, gold, x, 4.4, z, 24);
    cyl(g, 0.3, 0.04, led, x, 1.6, z, 24);
  }
  // Lustres en cristal.
  const crystal = new THREE.MeshStandardMaterial({ color: "#fff6dd", emissive: "#ffe2a0", emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.1 });
  for (const [x, z] of [[-6.5, 0], [-1, 0], [6.4, 0]]) {
    cyl(g, 0.02, 0.6, gold, x, 4.4, z, 8);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 32), gold);
    ring.position.set(x, 4.05, z); ring.rotation.x = Math.PI / 2; g.add(ring);
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2, drop = new THREE.Mesh(hugoatGeo.ball, crystal);
      drop.scale.set(0.05, 0.09, 0.05); drop.position.set(x + Math.cos(a) * 0.5, 3.9, z + Math.sin(a) * 0.5); g.add(drop);
    }
    
  }
  // Billets de 100 $ éparpillés au sol, et des liasses empilées près du bureau.
  const billM = new THREE.MeshStandardMaterial({ map: billTexture(), roughness: 0.8, side: THREE.DoubleSide });
  const billGeo = new THREE.PlaneGeometry(0.34, 0.15).rotateX(-Math.PI / 2);
  const bills = new THREE.InstancedMesh(billGeo, billM, 220), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  for (let k = 0; k < 220; k++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    const onBalcony = k >= 180;
    const pos = onBalcony ? new THREE.Vector3(10.8 + Math.random() * 4.6, 0.085 + k * 0.00002, 3 + Math.random() * 3)
      : new THREE.Vector3(-10 + Math.random() * 20, 0.08 + k * 0.00002, -6 + Math.random() * 12);
    bills.setMatrixAt(k, m4.compose(pos, q, one));
  }
  g.add(bills);
  const stackM = [mat("#cfdcc0"), mat("#cfdcc0"), billM, billM, mat("#cfdcc0"), mat("#cfdcc0")];
  for (let k = 0; k < 14; k++) {
    const p = P(700 + (k % 4) * 22, 470 + Math.floor(k / 4) * 14), stack = new THREE.Mesh(boxGeometry, stackM);
    stack.scale.set(0.34, 0.1, 0.15); stack.position.set(p.x, 0.13 + (k % 3) * 0.1, p.z); stack.rotation.y = (k % 3) * 0.2; g.add(stack);
  }
  // Seau à champagne doré.
  const bucket = P(720, 560);
  cyl(g, 0.16, 0.3, gold, bucket.x, 0.95, bucket.z, 20);
  cyl(g, 0.02, 0.8, gold, bucket.x, 0.45, bucket.z, 8);
  for (let k = 0; k < 3; k++) cyl(g, 0.035, 0.36, mat("#0f3d1e", { metalness: 0.4, roughness: 0.2 }), bucket.x - 0.06 + k * 0.06, 1.18, bucket.z + (k - 1) * 0.04, 10);

  // Balcon piscine accroché à la façade est.
  const bx = 13.2;
  const deck = nero.clone(); deck.repeat.set(2, 4);
  box(g, 5.6, 0.5, 12.8, new THREE.MeshStandardMaterial({ map: deck, roughness: 0.08, metalness: 0.25 }), bx, -0.25, 0);
  box(g, 0.05, 0.03, 12.8, glow(magenta, 2.4), bx + 2.75, 0.02, 0);
  box(g, 5.6, 0.12, 0.12, gold, bx, -0.44, 6.45);
  for (const [w, d, x, z] of [[0.06, 12.8, bx + 2.77, 0], [5.6, 0.06, bx, -6.37], [5.6, 0.06, bx, 6.37]]) {
    box(g, w, 0.05, d, gold, x, 1.05, z);
    box(g, w, 1, d, new THREE.MeshPhysicalMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false }), x, 0.55, z);
  }
  box(g, 3.6, 0.3, 7, marbleM, bx, 0.15, -1.8);
  box(g, 3.64, 0.04, 7.04, led, bx, 0.02, -1.8);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.6).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: "#2fc8ff", emissive: "#0aa7e0", emissiveIntensity: 0.55, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.88 }));
  water.position.set(bx, 0.31, -1.8); g.add(water);
  const poolLight = new LightSpot("#3fd0ff", 9, 9, 1.4, 1); poolLight.position.set(bx, 0.8, -1.8); g.add(poolLight);
    // Transats, parasol et palmiers.
  const lounger = mat("#ffffff", { roughness: 0.5 }), cushion = mat("#f2e2c4");
  const loungers = [[11.6, 3.6], [13.2, 3.6], [14.8, 3.6]];
  for (const [x, z] of loungers) {
    box(g, 0.7, 0.3, 1.9, lounger, x, 0.15, z + 0.2);
    box(g, 0.66, 0.08, 1.85, cushion, x, 0.34, z + 0.2);
  }
  cyl(g, 0.03, 2.4, gold, 13.2, 1.2, 5.4, 8);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.5, 16), mat("#f6efe2", { side: THREE.DoubleSide }));
  shade.position.set(13.2, 2.4, 5.4); g.add(shade);
  for (const [x, z] of [[15.4, -5.8], [15.4, 2.2], [11, 6]]) put(g, "pottedPlant", x, z, 0, 3.2);

  // Terrasse showroom devant l'étage, côté balcon : la supercar noire tourne sur son plateau doré.
  const sx = 7.8, sz = 8.9;
  box(g, 8.4, 0.5, 4.6, new THREE.MeshStandardMaterial({ map: deck, roughness: 0.08, metalness: 0.25 }), sx, -0.25, sz);
  box(g, 8.4, 0.03, 0.05, led, sx, 0.02, sz + 2.28);
  for (const [w, d, x, z] of [[8.4, 0.06, sx, sz + 2.27], [0.06, 4.6, sx - 4.17, sz], [0.06, 4.6, sx + 4.17, sz]]) box(g, w, 0.05, d, gold, x, 1.05, z);
  const turntable = new THREE.Group(); turntable.position.set(sx, 0, sz); g.add(turntable);
  cyl(turntable, 2.7, 0.12, gold, 0, 0.06, 0, 48);
  cyl(turntable, 2.74, 0.03, led, 0, 0.02, 0, 48);
  turntable.add(supercar());
  const spot = new LightSpot("#fff1dc", 12, 9, 1.4, 2); spot.position.set(sx, 4.2, sz); g.add(spot);

  // Les invitées : sur le balcon, dans l'open space et dans le bureau.
  const guests = [
    woman(g, 11.6, 3.6, Math.PI, 0, "allongee"), woman(g, 14.8, 3.6, Math.PI, 1, "allongee"),
    woman(g, 11, -4.6, Math.PI / 2, 2), woman(g, 15.4, -0.8, -Math.PI / 2, 3), woman(g, 13.2, 2.1, 0.4, 4),
    woman(g, P(150, LANE).x, P(150, LANE).z, 0.5, 5), woman(g, P(345, LANE).x, P(345, LANE).z, -0.4, 6),
    woman(g, P(560, LANE).x, P(560, LANE).z, 0.9, 7), woman(g, P(760, 140).x, P(760, 140).z, 0.6, 8),
    woman(g, P(880, 540).x, P(880, 540).z, -2.4, 9),
  ];
  // Les invitées et le plateau bougent : ils restent hors de la fusion des objets fixes (finishFloor).
  live(...guests.map(w => w.children[0]), turntable);
  f.tick = (dt, t, reduced) => {
    if (reduced) return;
    turntable.rotation.y = t * 0.25;
    guests.forEach((w, k) => { if (k > 1) w.children[0].rotation.y = Math.sin(t * 0.8 + k) * 0.25; });
    water.material.emissiveIntensity = 0.5 + Math.sin(t * 1.7) * 0.08;
    poolLight.intensity = 9 + Math.sin(t * 1.3) * 1.5;
    crystal.emissiveIntensity = 1.6 + Math.sin(t * 6) * 0.4;
  };
}

export { hugoat };
