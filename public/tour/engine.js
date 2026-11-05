// Moteur 3D : rendu WebGL, étiquettes et écrans HTML, scène, caméra, lumières, matériaux partagés, briques (box, cyl,
// sign, label), lampes prêtées aux étages, fusion des maillages immobiles. Registres des étages et des agents, horloge.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { $ } from "./base.js";

// ---------- moteur ----------
const stage = $("#stage");
// L'écran de la salle de repos est une vraie page (le direct d'OTPLOL, l'esport LoL en français) posée en 3D par-dessus la scène :
// Twitch ne lance pas un lecteur recouvert. Il ne reçoit ni clic ni geste (sinon un pincement zoome la page au lieu de la caméra) ;
// un clic sur l'écran ouvre le direct avec le son dans un nouvel onglet.
const screens = new CSS3DRenderer();
screens.domElement.className = "screens";
stage.appendChild(screens.domElement);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
stage.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.className = "labels";
stage.appendChild(labels.domElement);

const scene = new THREE.Scene();
// Les matrices du monde sont recalculées une seule fois par image (voir animate), pas une fois par moteur de rendu
// (WebGL, étiquettes, écrans) : trois passes sur toute la scène à chaque image coûtaient plus que le dessin lui-même.
scene.matrixWorldAutoUpdate = false;
scene.background = new THREE.Color("#060812");
scene.fog = new THREE.Fog("#060812", 90, 330);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 900);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 7;
controls.maxDistance = 60; // la ville commence à 72 : la caméra n'entre jamais dans un immeuble
controls.target.set(0, 0.6, 0);

scene.add(new THREE.HemisphereLight("#8ea6ff", "#20160f", 0.9));
scene.add(new THREE.AmbientLight("#ffffff", 0.25));
const moon = new THREE.DirectionalLight("#c9d6ff", 1.1);
moon.position.set(-30, 60, 20);
scene.add(moon);

const mats = new Map();
const mat = (color, o = {}) => {
  const k = color + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o }));
  return mats.get(k);
};
const glow = (color, i = 1.6) => mat(color, { emissive: color, emissiveIntensity: i });
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometries = new Map();
const redBullEditions = [
  { image: "redbullPeach", label: "Pêche blanche", color: "#edc6bf" },
  { image: "redbullApricot", label: "Abricot · fraise", color: "#f2a02c" },
  { image: "redbullRed", label: "Pastèque", color: "#c93244" },
  { image: "redbullSeaBlue", label: "Juneberry", color: "#50a8bd" },
  { image: "redbullBlue", label: "Myrtille", color: "#264c9c" },
];
const redBullTextures = new Map();
function box(parent, w, h, d, m, x, y, z, ry = 0) {
  const mesh = new THREE.Mesh(boxGeometry, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}
function cyl(parent, r, h, m, x, y, z, seg = 20) {
  if (!cylinderGeometries.has(seg)) cylinderGeometries.set(seg, new THREE.CylinderGeometry(1, 1, 1, seg));
  const mesh = new THREE.Mesh(cylinderGeometries.get(seg), m);
  mesh.scale.set(r, h, r);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
const textTextures = new Map();
function textTexture(text, { font = "700 72px Sora, sans-serif", color = "#ff6fd8", w = 512, h = 128, blur = 28 } = {}) {
  // Une enseigne identique (mêmes texte et style) partage sa texture : les étages reconstruits et les panneaux répétés
  // (« DIRECTION », les étiquettes du frigo…) n'envoient plus chacun la leur à la carte graphique.
  const key = JSON.stringify([text, font, color, w, h, blur]);
  if (textTextures.has(key)) return textTextures.get(key);
  // Dessiné en double résolution, avec filtrage anisotrope : les enseignes restent nettes de près et de biais.
  const c = document.createElement("canvas");
  c.width = w * 2; c.height = h * 2;
  const x = c.getContext("2d");
  x.scale(2, 2);
  x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = color; x.shadowBlur = blur; x.fillStyle = color;
  // Un texte trop long (un nom de résident) est rétréci pour tenir dans le panneau.
  const k = Math.min(1, (w - blur * 2) / x.measureText(text).width);
  x.translate(w / 2, h / 2); x.scale(k, k);
  x.fillText(text, 0, 0);
  x.shadowBlur = 0; x.fillText(text, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  textTextures.set(key, t);
  return t;
}
function sign(parent, text, w, h, opts, x, y, z, ry = 0) {
  const m = new THREE.MeshBasicMaterial({ map: textTexture(text, opts), transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}
function label(parent, html, cls, x, y, z) {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  const o = new CSS2DObject(el);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

// ---------- performances : lumières fixes, maillages fusionnés, étages hors scène ----------
// Lumière d'un étage : un simple repère (position, couleur, intensité) que l'étage anime comme avant. Les vraies lampes
// sont trois PointLight toujours présentes dans la scène, prêtées chaque image aux repères de l'étage regardé (puis
// de celui qui s'envole), par priorité : leur nombre ne change jamais, donc changer d'étage ne recompile aucun shader,
// et chaque pixel ne calcule que trois lampes (jusqu'à cinq avant, sur un étage cyberpunk). Seule la lampe du salon
// privé d'un étage cyberpunk, noyée dans ses néons, n'a plus de place.
class LightSpot extends THREE.Object3D {
  constructor(color, intensity, distance, decay, priority = 2) {
    super();
    this.isLightSpot = true;
    this.color = new THREE.Color(color);
    Object.assign(this, { intensity, distance, decay, priority });
  }
}
const LIGHT_RIG = Array.from({ length: 3 }, () => { const l = new THREE.PointLight("#ffffff", 0, 1, 2); scene.add(l); return l; });
function lendLights(main, leaving) {
  const k = lendFrom(leaving, lendFrom(main, 0));
  for (let i = k; i < LIGHT_RIG.length; i++) LIGHT_RIG[i].intensity = 0;
}
function lendFrom(f, k) {
  if (!f?.lights) return k;
  f.group.updateMatrix();
  for (const s of f.lights) {
    if (k >= LIGHT_RIG.length) break;
    if (!(s.intensity > 0)) continue;
    const l = LIGHT_RIG[k++];
    l.color.copy(s.color); l.intensity = s.intensity; l.distance = s.distance; l.decay = s.decay;
    l.position.copy(s.position).applyMatrix4(f.group.matrix); // repères posés directement sur l'étage
  }
  return k;
}

// Objets animés, cliqués ou dont on remplace le matériau : marqués « live », ils ne sont jamais fusionnés (et servent
// d'ancre à leurs pièces immobiles, qui bougent avec eux). Les champs d'un étage (f.screens, f.casino…) sont parcourus :
// tout objet 3D qui y est rangé est supposé vivant ; un conteneur immobile peut s'en exclure par userData.fixed.
const live = (...objects) => { for (const o of objects) if (o?.isObject3D) o.userData.live = true; return objects[0]; };
function markLive(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return;
  if (value.isObject3D) { if (!value.userData.fixed) value.userData.live = true; return; }
  if (Array.isArray(value)) { for (const v of value) markLive(v, depth + 1); return; }
  if (Object.getPrototypeOf(value) === Object.prototype) for (const k in value) markLive(value[k], depth + 1);
}
// Attributs entrelacés (certains modèles glTF) : recopiés à plat pour pouvoir fusionner.
function flatAttributes(geometry) {
  for (const [name, a] of Object.entries(geometry.attributes)) {
    if (!a.isInterleavedBufferAttribute) continue;
    const out = new a.array.constructor(a.count * a.itemSize), src = a.data.array, stride = a.data.stride;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = src[i * stride + a.offset + c];
    geometry.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
  }
  return geometry;
}
const geometrySignature = g => (g.index ? "i" : "n") + Object.entries(g.attributes).map(([k, a]) =>
  `${k}:${a.itemSize}:${a.normalized}:${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name}`).sort().join(",");
// Fusionne les maillages immobiles d'un sous-arbre, par matériau, en un maillage par ancre (la racine ou le premier
// parent « live ») : des centaines d'appels de dessin et d'objets à parcourir deviennent quelques dizaines.
// Restent tels quels : maillages instanciés ou animés par squelette, transparents, invisibles (zones de clic),
// multi-matériaux, retournés (échelle négative) et tout ce qui est live ou porté par un robot.
function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const batches = new Map(), inverse = new Map();
  root.traverse(o => {
    if (!o.isMesh || o === root || o.isInstancedMesh || o.isSkinnedMesh || o.userData.live || !o.visible || o.renderOrder) return;
    const m = o.material;
    if (Array.isArray(m) || !m.visible || m.transparent || o.geometry.morphAttributes.position) return;
    if (o.geometry.attributes.position?.array.constructor !== Float32Array && !o.geometry.attributes.position?.isInterleavedBufferAttribute) return;
    let anchor = root;
    for (let p = o.parent; p && p !== root; p = p.parent) {
      if (p.userData.mixer || p.isBone || p.isSkinnedMesh || !p.visible) return;
      if (p.userData.live) { anchor = p; break; }
    }
    if (!inverse.has(anchor)) inverse.set(anchor, anchor.matrixWorld.clone().invert());
    const rel = new THREE.Matrix4().multiplyMatrices(inverse.get(anchor), o.matrixWorld);
    if (rel.determinant() <= 0) return;
    const key = `${anchor.uuid}|${m.uuid}|${geometrySignature(o.geometry)}`;
    if (!batches.has(key)) batches.set(key, { anchor, material: m, items: [] });
    batches.get(key).items.push([o, rel]);
  });
  for (const { anchor, material, items } of batches.values()) {
    if (items.length < 2) continue;
    const parts = items.map(([o, rel]) => flatAttributes(o.geometry.clone()).applyMatrix4(rel));
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    merged.userData.baked = true;
    const mesh = new THREE.Mesh(merged, material);
    mesh.matrixAutoUpdate = false;
    anchor.add(mesh);
    for (const [o] of items) o.removeFromParent();
  }
  // Groupes vidés par la fusion : retirés, il reste moins d'objets à parcourir à chaque image.
  const prune = o => {
    for (let i = o.children.length - 1; i >= 0; i--) prune(o.children[i]);
    if (o !== root && !o.children.length && !o.userData.live && (o.type === "Group" || o.type === "Object3D") && !o.isLightSpot) o.removeFromParent();
  };
  prune(root);
}
// Fin de construction d'un étage : ses repères de lumière (par priorité), ses objets vivants, puis la fusion.
function finishFloor(f) {
  f.lights = [];
  f.group.traverse(o => { if (o.isLightSpot) f.lights.push(o); });
  f.lights.sort((a, b) => a.priority - b.priority);
  const { group, ...fields } = f;
  markLive(fields);
  bakeStatic(group);
  f.hasCss3d = false;
  group.traverse(o => { if (o.isCSS3DObject) f.hasCss3d = true; });
  return f;
}
// Petits groupes animés (avions, oiseaux) : leurs pièces sont dessinées en instances, une série par matériau.
// Les groupes eux-mêmes restent hors de la scène et gardent leur animation ; sync() recopie leurs matrices.
function instancedCrowd(groups, parent) {
  const byMaterial = new Map();
  for (const gr of groups) for (const part of gr.children) {
    if (!byMaterial.has(part.material)) byMaterial.set(part.material, []);
    byMaterial.get(part.material).push([gr, part]);
  }
  const sets = [...byMaterial].map(([material, list]) => {
    const mesh = new THREE.InstancedMesh(list[0][1].geometry, material, list.length);
    mesh.frustumCulled = false; // les instances se déplacent : la boîte englobante calculée une fois serait fausse
    parent.add(mesh);
    return { mesh, list };
  });
  const m = new THREE.Matrix4();
  return () => {
    for (const gr of groups) gr.updateMatrix();
    for (const { mesh, list } of sets) {
      for (let k = 0; k < list.length; k++) { const [gr, part] = list[k]; part.updateMatrix(); mesh.setMatrixAt(k, m.multiplyMatrices(gr.matrix, part.matrix)); }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
}

// ---------- la tour ----------
const floors = new Map(); // clé (slug du résident ou id d'étage commun) -> étage
const agents = new Map(); // clé d'agent -> robot
const clock = new THREE.Clock();

export {
  LightSpot, agents, box, boxGeometry, camera, clock, controls, cyl, finishFloor, floors, glow, instancedCrowd,
  label, labels, lendLights, live, mat, redBullEditions, redBullTextures, renderer, scene, screens, sign,
  textTexture,
};
