// Studio de la salle en 3D : sols, cloisons, lumière et objets choisis par le résident (catalogue : ../../room-data.js).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LANE, P, S } from "../base.js";
import { box, cyl, glow, mat } from "../engine.js";
import { ballGeometry, drawnTexture, orbGeometry } from "../kit.js";
import { chandelier, prestigeMaterials } from "./prestige.js";

// ---------- studio de la salle ----------
// Choix du résident (profile.room, voir room-data.js) posés sur son ambiance : sols de l'open space et du bureau,
// cloisons, bureaux, couleur de la lumière et quelques objets gratuits. « auto » garde ce que l'ambiance fait.
// Textures dessinées une fois, matériaux partagés par tous les étages : l'étage fusionné reste aussi léger.
// Guirlande : fil et ampoules partagés par tous les étages (l'aperçu du studio reconstruit l'étage à chaque choix).
const GARLAND_WIRE = new THREE.LineBasicMaterial({ color: "#2a2620" }), GARLAND_BULB = new THREE.MeshBasicMaterial({ color: "#ffd47e" });
// Géométries propres à un étage : libérées avec lui (disposeFloor).
const own = geometry => { geometry.userData.baked = true; return geometry; };
const ROOM_LIGHTS = { chaude: "#ffc98a", naturelle: "#fff3e0", froide: "#bcd6ff", neon: "#ff5fd9", coucher: "#ff9255", aurore: "#6ff0c4" };
// Taille réelle (m) d'une répétition de chaque texture de sol.
const ROOM_TILE = { chene: 1.6, chevrons: 2.8, marbre: 1.6, beton: 3, tatami: 1.8, damier: 1.2, gazon: 2 };
let roomKit = null;
function roomTextures() {
  if (roomKit) return roomKit;
  const rand = (() => { let r = 11; return () => (r = (r * 16807) % 2147483647) / 2147483647; })();
  const PM = prestigeMaterials();
  roomKit = {
    // Lames de chêne clair, longueurs décalées, fil du bois.
    chene: drawnTexture(512, 512, (x, W, H) => {
      const tones = ["#c8a06e", "#bf9563", "#d1aa79", "#b88b58", "#c49a66"];
      for (let row = 0; row < 8; row++) {
        let at = -rand() * 200;
        while (at < W) {
          const len = 160 + rand() * 180;
          x.fillStyle = tones[Math.floor(rand() * tones.length)]; x.fillRect(at, row * 64, len, 64);
          x.strokeStyle = "rgba(110,72,38,0.18)"; x.lineWidth = 1;
          for (let k = 0; k < 5; k++) { const y = row * 64 + 8 + rand() * 48; x.beginPath(); x.moveTo(at, y); x.bezierCurveTo(at + len / 3, y + rand() * 6 - 3, at + len * 2 / 3, y + rand() * 6 - 3, at + len, y); x.stroke(); }
          x.fillStyle = "rgba(70,44,22,0.45)"; x.fillRect(at, row * 64, 2, 64);
          at += len;
        }
        x.fillStyle = "rgba(70,44,22,0.5)"; x.fillRect(0, row * 64, W, 2);
      }
    }),
    // Béton ciré : gris nuancé, taches douces et joints de coulage.
    beton: drawnTexture(512, 512, (x, W, H) => {
      x.fillStyle = "#8a8c8f"; x.fillRect(0, 0, W, H);
      for (let k = 0; k < 40; k++) {
        const gx = rand() * W, gy = rand() * H, r = 30 + rand() * 90, gr = x.createRadialGradient(gx, gy, 0, gx, gy, r);
        gr.addColorStop(0, rand() > 0.5 ? "rgba(255,255,255,0.08)" : "rgba(30,30,34,0.1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = gr; x.fillRect(gx - r, gy - r, r * 2, r * 2);
      }
      for (let k = 0; k < 2500; k++) { x.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "20,20,24"},${(0.04 + rand() * 0.08).toFixed(2)})`; x.fillRect(rand() * W, rand() * H, 1.5, 1.5); }
      x.fillStyle = "rgba(40,40,44,0.5)"; x.fillRect(0, 0, W, 3); x.fillRect(0, 0, 3, H);
    }),
    // Tatamis : deux nattes paille, tressage fin, bordures de tissu sombre sur les grands côtés.
    tatami: drawnTexture(512, 512, (x, W, H) => {
      for (const y0 of [0, H / 2]) {
        x.fillStyle = "#c9c58d"; x.fillRect(0, y0, W, H / 2);
        for (let k = 0; k < H / 2; k += 4) { x.fillStyle = k % 8 ? "rgba(120,118,60,0.16)" : "rgba(255,255,220,0.12)"; x.fillRect(0, y0 + k, W, 2); }
        x.fillStyle = "#2c3a2a"; x.fillRect(0, y0, W, 14); x.fillRect(0, y0 + H / 2 - 14, W, 14);
        x.fillStyle = "rgba(90,80,40,0.45)"; x.fillRect(0, y0, 3, H / 2);
      }
    }),
    // Damier noir et crème, joints fins.
    damier: drawnTexture(256, 256, (x, W) => {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? "#151515" : "#e6dfcf"; x.fillRect(i * W / 2, j * W / 2, W / 2, W / 2); }
      x.strokeStyle = "rgba(90,84,74,0.6)"; x.lineWidth = 2; x.strokeRect(0, 0, W, W); x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W / 2, W); x.moveTo(0, W / 2); x.lineTo(W, W / 2); x.stroke();
    }),
    chevrons: PM.parquet.map, marbre: PM.marble.map, gazon: PM.green.map,
    floors: new Map(),
  };
  return roomKit;
}
const ROOM_FLOOR_FINISH = { chene: { roughness: 0.55 }, chevrons: { roughness: 0.42, metalness: 0.05 }, marbre: { roughness: 0.24, metalness: 0.05 },
  beton: { roughness: 0.7 }, tatami: { roughness: 0.9 }, damier: { roughness: 0.3, metalness: 0.05 }, gazon: { roughness: 0.95 } };
// Matériau d'un sol pour une pièce (open space ou bureau) : la texture garde sa taille réelle quelle que soit la pièce.
function roomFloor(kind, r) {
  if (kind === "resine") return mat("#0b0c10", { roughness: 0.12, metalness: 0.3 });
  const K = roomTextures(), w = r.w * S, h = r.h * S, key = `${kind}:${w}:${h}`;
  if (!K.floors.has(key)) {
    const t = K[kind].clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / ROOM_TILE[kind], h / ROOM_TILE[kind]); t.needsUpdate = true;
    K.floors.set(key, new THREE.MeshStandardMaterial({ map: t, ...ROOM_FLOOR_FINISH[kind] }));
  }
  return K.floors.get(key);
}
// Cloisons : matériau et liseré (comme la boiserie Prestige), null pour garder ceux de l'ambiance.
function roomWalls(kind, accent) {
  const PM = kind === "noyer" || kind === "noir" ? prestigeMaterials() : null;
  switch (kind) {
    case "ardoise": return { m: mat("#39415a") };
    case "noyer": return { m: PM.walnut, trim: PM.gold };
    case "blanc": return { m: mat("#e7e3db", { roughness: 0.65 }), trim: mat("#b8b3a8", { roughness: 0.5 }) };
    case "beton": return { m: mat("#7c7e81", { roughness: 0.95 }) };
    case "noir": return { m: mat("#141518", { roughness: 0.4 }), trim: PM.brass };
    case "neon": return { m: mat("#0d0b1c", { roughness: 0.5 }), trim: glow(accent, 2.2) };
    default: return null;
  }
}
// Objets gratuits du studio, dans des places libres : jamais sur un poste, l'allée, le décor acheté ni les enseignes.
function roomObjects(f, g, room, accent, bulbs, drops, prestige) {
  const has = new Set(room.objets);
  if (has.has("lustres") && !prestige) {
    const PM = prestigeMaterials();
    for (const x of [250, 420]) chandelier(g, PM, P(x, LANE).x, P(x, LANE).z, 0.55, bulbs, drops);
  }
  if (has.has("guirlande")) {
    // Guirlande guinguette le long de la vitre du fond, au-dessus du nom : quatre arcs, ampoules en une série d'instances.
    const points = [], spans = 4, per = 9;
    for (let s = 0; s < spans; s++) for (let k = 0; k <= per; k++) {
      if (s && !k) continue;
      const u = k / per, x = -10.2 + (s + u) * 20.4 / spans;
      points.push(new THREE.Vector3(x, 4.66 - Math.sin(u * Math.PI) * 0.22, -6.18));
    }
    g.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(points)), GARLAND_WIRE));
    const garland = new THREE.InstancedMesh(orbGeometry, GARLAND_BULB, points.length), m4 = new THREE.Matrix4();
    points.forEach((p, i) => garland.setMatrixAt(i, m4.makeScale(0.75, 1, 0.75).setPosition(p.x, p.y - 0.07, p.z)));
    g.add(garland);
  }
  if (has.has("bambous")) {
    // Deux jardinières de bambous contre la cloison du fond de l'open space, entre les colonnes de postes.
    const stone = mat("#2b2d30", { roughness: 0.8 }), stalk = mat("#8fae4f", { roughness: 0.6 }), node = mat("#6c8a37"), leaf = mat("#4f8f3e", { roughness: 0.8 });
    for (const px of [250, 420]) {
      const p = P(px, 33);
      box(g, 0.95, 0.34, 0.3, stone, p.x, 0.17, p.z);
      box(g, 0.9, 0.02, 0.25, mat("#3b2a1c"), p.x, 0.34, p.z);
      for (let k = 0; k < 6; k++) {
        const x = p.x - 0.36 + k * 0.145, hgt = 1.7 + ((k * 7) % 5) * 0.16;
        cyl(g, 0.022, hgt, stalk, x, 0.34 + hgt / 2, p.z + ((k % 2) - 0.5) * 0.08, 6);
        for (let y = 0.7; y < hgt; y += 0.42) cyl(g, 0.027, 0.02, node, x, 0.34 + y, p.z + ((k % 2) - 0.5) * 0.08, 6);
        for (let j = 0; j < 3; j++) {
          const l = new THREE.Mesh(ballGeometry, leaf); l.scale.set(0.16, 0.035, 0.06);
          l.position.set(x + (j - 1) * 0.08, 0.34 + hgt - j * 0.18, p.z + ((k + j) % 2 - 0.5) * 0.12); l.rotation.y = k + j * 1.7; l.rotation.z = (j - 1) * 0.5; g.add(l);
        }
      }
    }
  }
  if (has.has("affiches")) {
    // Trois affiches rétro encadrées sur la vitre du fond de l'open space, à gauche du nom de l'étage.
    const PM = prestigeMaterials(), planes = [];
    [-9.35, -8.45, -7.55].forEach((x, i) => {
      const plane = new THREE.PlaneGeometry(0.76, 1.0), uv = plane.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
      planes.push(plane.translate(x, 3.75, -6.37));
      box(g, 0.82, 1.06, 0.03, mat("#1a1a1d", { roughness: 0.5 }), x, 3.75, -6.4);
    });
    g.add(new THREE.Mesh(own(mergeGeometries(planes)), PM.posters));
  }
  if (has.has("neons")) {
    // Néons à la couleur du résident : au pied et en haut des vitres, et le long des cloisons de l'open space.
    const tube = glow(accent, 2.2);
    box(g, 20.4, 0.04, 0.04, tube, 0, 0.06, -6.3);
    box(g, 20.4, 0.04, 0.04, tube, 0, 4.62, -6.3);
    for (const x of [-10.25, 10.25]) { box(g, 0.04, 0.04, 12.4, tube, x, 0.06, 0); box(g, 0.04, 0.04, 12.4, tube, x, 4.62, 0); }
  }
}

export { ROOM_LIGHTS, roomFloor, roomObjects, roomWalls };
