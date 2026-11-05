// Coque commune d’un étage (dalle, vitres, ascenseur, lumière), pose des modèles et cloisons.

import * as THREE from "three";
import { FLOOR_H, LANE, P, S } from "../base.js";
import { LightSpot, box, glow, label, mat, scene } from "../engine.js";
import { MODELS } from "../models.js";

// ---------- un étage : la coque commune (dalle, vitres, ascenseur) ----------
// Vitres, porte d'ascenseur et alarme : matériaux et géométries communs à tous les étages, créés une fois.
const GLASS = new THREE.MeshStandardMaterial({ color: "#8fb6ff", transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
const GLASS_BACK = new THREE.PlaneGeometry(20.8, FLOOR_H - 0.5), GLASS_SIDE = new THREE.PlaneGeometry(13, FLOOR_H - 0.5);
const ELEV_OFF = mat("#2a3042", { metalness: 0.6, roughness: 0.25 }), ELEV_ON = glow("#f1cd85", 0.9);
const ALARM_OFF = mat("#3a3f52"), ALARM_ON = glow("#ff3b3b", 3);
function shell(floorColor, { glass = true } = {}) {
  const g = new THREE.Group();
  const f = { group: g, baseY: 0, links: [] };
  box(g, 20.8, 0.5, 13, mat("#151924"), 0, -0.25, 0);
  box(g, 20.8, 0.12, 0.12, mat("#c9a86a", { metalness: 0.6, roughness: 0.35 }), 0, -0.44, 6.5); // liseré doré du nez de dalle
  box(g, 20.4, 0.04, 12.4, mat(floorColor), 0, 0.02, 0);
  if (glass) {
    for (const [w, x, z, ry] of [[20.8, 0, -6.5, 0], [13, -10.4, 0, Math.PI / 2], [13, 10.4, 0, Math.PI / 2]]) {
      const p = new THREE.Mesh(w > 20 ? GLASS_BACK : GLASS_SIDE, GLASS);
      p.position.set(x, (FLOOR_H - 0.5) / 2, z);
      p.rotation.y = ry;
      g.add(p);
    }
    for (let x = -10.4; x <= 10.5; x += 2.6) box(g, 0.08, FLOOR_H - 0.5, 0.08, mat("#2b3142", { metalness: 0.5 }), x, (FLOOR_H - 0.5) / 2, -6.5);
  }
  // Ascenseur : cadre doré et portes lumineuses sur la façade ouest
  box(g, 0.2, 2.6, 1.7, mat("#c9a86a", { metalness: 0.7, roughness: 0.3 }), -10.2, 1.3, 0);
  f.elevDoor = box(g, 0.06, 2.3, 1.4, ELEV_OFF, -10.08, 1.2, 0);
  box(g, 0.05, 0.12, 0.5, glow("#f1cd85", 1.2), -10.08, 2.48, 0);
  const warm = f.warmSpot = new LightSpot("#ffd9a0", 14, 24, 1.4, 0);
  warm.position.set(0, 3.6, 0);
  g.add(warm);
  f.tag = label(g, "", "floor-tag", -10.4, 0.2, 6.6);
  scene.add(g);
  return f;
}

// Pose un modèle Kenney (CC0) par le centre de sa base ; ils sont à l'échelle 1/2, d'où k = 2 par défaut.
function put(g, name, x, z, ry = 0, k = 2, y = 0) {
  const t = MODELS[name];
  if (!t) return null;
  const o = t.clone();
  o.userData.model = name;
  o.scale.setScalar(k);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  g.add(o);
  return o;
}

function walls(g, r, doors, style = null) {
  // Cloisons basses autour d'une pièce, ouvertes sur l'allée centrale ; le mur côté caméra reste bas.
  // style (ambiance Prestige) : boiserie et liseré doré sur le dessus de chaque pan.
  const m = style?.m ?? mat("#39415a"), T = 0.12;
  const x0 = r.x * S - 10, x1 = (r.x + r.w) * S - 10, z0 = r.y * S - 6.2, z1 = (r.y + r.h) * S - 6.2, laneZ = P(0, LANE).z, gap = 1.6;
  const pan = (w, h, d, x, y, z) => {
    box(g, w, h, d, m, x, y, z);
    if (style?.trim) box(g, w + 0.02, 0.035, d + 0.02, style.trim, x, y + h / 2 + 0.017, z);
  };
  pan(x1 - x0, 1.05, T, (x0 + x1) / 2, 0.52, z0);
  pan(x1 - x0, 0.35, T, (x0 + x1) / 2, 0.17, z1);
  for (const [x, side] of [[x0, "w"], [x1, "e"]]) {
    if (!doors.includes(side)) { pan(T, 1.05, z1 - z0, x, 0.52, (z0 + z1) / 2); continue; }
    const a = laneZ - gap / 2 - z0, b = z1 - laneZ - gap / 2;
    pan(T, 1.05, a, x, 0.52, z0 + a / 2);
    pan(T, 1.05, b, x, 0.52, z1 - b / 2);
  }
}

export { ALARM_OFF, ALARM_ON, ELEV_OFF, ELEV_ON, put, shell, walls };
