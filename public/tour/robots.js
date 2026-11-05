// Les personnages : robot animé recoloré selon l’outil, fusion de ses pièces, raquettes et clubs tenus en main,
// agent complet (anneau d’état, bulle, fumée, tasse) et chemins sur un étage.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { LANE, P, TOOLS, hash } from "./base.js";
import { box, cyl, glow, mat } from "./engine.js";
import { drawnTexture, hitMaterial, orbGeometry, puffGeometry, ringGeometry } from "./kit.js";
import { MODELS } from "./models.js";

// ---------- les personnages : le robot animé de Quaternius (CC0), recoloré selon l'outil ----------
const ONCE = new Set(["Sitting", "Standing", "Death"]);
function makeRobot(color) {
  const t = MODELS.robot;
  const g = new THREE.Group();
  const r = cloneSkinned(t.scene);
  r.scale.setScalar(t.scale);
  // Une seule teinte par robot (corps et tête la partagent) ; les maillages fusionnés du corps partagent un squelette.
  let main = null, skeleton = null;
  r.traverse(o => {
    if (o.isMesh && o.material?.name === "Main") {
      o.material = main ??= o.material.clone(); main.color.set(color); o.userData.tourMaterial = true;
    }
    if (o.isSkinnedMesh && o.userData.robotBody) { if (skeleton) o.skeleton = skeleton; else skeleton = o.skeleton; }
    if (o.isMesh) o.frustumCulled = false; // les maillages animés sortent de leur boîte d'origine
  });
  // L'os de la paume droite porte raquette et club ; au premier robot, sa pose de repos (orientation, échelle ×100 du
  // squelette) est mesurée une fois pour toutes, avant toute animation.
  let hand = null;
  r.traverse(o => { if (o.isBone && HAND_BONE.test(o.name)) hand = o; });
  if (hand && !handRest) {
    r.updateMatrixWorld(true);
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    hand.matrixWorld.decompose(new THREE.Vector3(), q, s);
    handRest = { q: q.invert(), s: s.x };
  }
  g.add(r);
  const mixer = new THREE.AnimationMixer(r);
  // « Putt » : le coup de poing à mi-amplitude (mêlé à la pose de repos), pour un swing de green plus court qu'au practice.
  t.putt ??= Object.assign(t.animations.find(clip => clip.name === "Punch")?.clone() ?? new THREE.AnimationClip("Putt", 0, []), { name: "Putt" });
  const actions = Object.fromEntries([...t.animations, t.putt].map(clip => {
    const a = mixer.clipAction(clip);
    if (ONCE.has(clip.name)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    if (clip === t.putt) a.weight = 0.5;
    return [clip.name, a];
  }));
  Object.assign(g.userData, { mixer, actions, anim: null, hand, held: null });
  play(g, "Idle");
  return g;
}

// Le robot du modèle compte 19 maillages (un par pièce, chacun accroché à son os) : 19 appels de dessin par agent.
// Au chargement, toutes les pièces rigides et les deux mains (déformées) deviennent un maillage déformé par matériau,
// lié au même squelette : chaque vertex suit l'os de sa pièce (poids 1), les mains gardent leurs poids. Seule la tête
// reste à part, ses expressions (morphs) étant animées. 19 appels deviennent 5, sans rien changer à l'image.
function mergeRobotParts(root) {
  root.updateMatrixWorld(true);
  const bones = [];
  root.traverse(o => { if (o.isBone) bones.push(o); });
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  let host = null;
  root.traverse(o => { if (!host && o.isSkinnedMesh) host = o.parent; });
  if (!host || !bones.length) return;
  const hostInverse = host.matrixWorld.clone().invert();
  const groups = new Map(), done = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), M = new THREE.Matrix4(), S = new THREE.Matrix4(), B = new THREE.Matrix4(), N3 = new THREE.Matrix3();
  root.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material) || o.geometry.morphAttributes.position) return;
    let bone = null;
    for (let p = o.parent; p && !bone; p = p.parent) if (p.isBone) bone = p;
    if (!o.isSkinnedMesh && !bone) return;
    const geo = o.geometry, pos = geo.attributes.position, nor = geo.attributes.normal;
    if (!pos || !nor) return;
    const count = pos.count, P = new Float32Array(count * 3), Nn = new Float32Array(count * 3), SI = new Uint16Array(count * 4), SW = new Float32Array(count * 4);
    if (!o.isSkinnedMesh) M.multiplyMatrices(hostInverse, o.matrixWorld), N3.getNormalMatrix(M);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
      if (o.isSkinnedMesh) {
        // Pose de repos de la main : somme pondérée des matrices de ses os, comme le fait le shader.
        const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, e = S.elements.fill(0);
        for (let c = 0; c < 4; c++) {
          const w = sw.getComponent(i, c);
          if (!w) continue;
          const j = si.getComponent(i, c), b = o.skeleton.bones[j];
          B.multiplyMatrices(b.matrixWorld, o.skeleton.boneInverses[j]);
          for (let k = 0; k < 16; k++) e[k] += w * B.elements[k];
          SI[i * 4 + c] = boneIndex.get(b) ?? 0; SW[i * 4 + c] = w;
        }
        M.multiplyMatrices(hostInverse, o.matrixWorld).multiply(o.bindMatrixInverse).multiply(S).multiply(o.bindMatrix);
        N3.getNormalMatrix(M);
      } else { SI[i * 4] = boneIndex.get(bone); SW[i * 4] = 1; }
      v.applyMatrix4(M); n.applyMatrix3(N3).normalize();
      P.set([v.x, v.y, v.z], i * 3); Nn.set([n.x, n.y, n.z], i * 3);
    }
    const index = geo.index ? Array.from(geo.index.array) : Array.from({ length: count }, (_, i) => i);
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push({ P, Nn, SI, SW, index });
    done.push(o);
  });
  const skeleton = new THREE.Skeleton(bones);
  for (const [material, parts] of groups) {
    const total = parts.reduce((t, q) => t + q.P.length / 3, 0);
    const P = new Float32Array(total * 3), Nn = new Float32Array(total * 3), SI = new Uint16Array(total * 4), SW = new Float32Array(total * 4), index = [];
    let at = 0;
    for (const q of parts) {
      P.set(q.P, at * 3); Nn.set(q.Nn, at * 3); SI.set(q.SI, at * 4); SW.set(q.SW, at * 4);
      for (const k of q.index) index.push(k + at);
      at += q.P.length / 3;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(Nn, 3));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(SI, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(SW, 4));
    geometry.setIndex(index);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = "Corps." + material.name;
    mesh.userData.robotBody = true;
    host.add(mesh);
    mesh.bind(skeleton);
  }
  for (const o of done) {
    const parent = o.parent;
    o.removeFromParent();
    if (parent && !parent.isBone && parent !== host && !parent.children.length) parent.removeFromParent(); // nœud de pièce vidé
  }
}

// Passe d'une animation à l'autre en fondu.
function play(g, name) {
  const u = g.userData;
  if (u.anim === name || !u.actions[name]) return;
  u.actions[name].reset().fadeIn(0.35).play();
  if (u.anim) u.actions[u.anim].fadeOut(0.35);
  u.anim = name;
}

// ---------- raquettes et clubs ----------
// Raquette de tennis, putter (green) et fer (practice) : modèles construits une fois, puis clonés pour chaque robot qui
// joue. Un clone ne copie que les nœuds (géométries, matériaux et textures restent communs) : un agent qui part ne
// libère donc rien de partagé (seuls ses matériaux marqués tourMaterial le sont). Le robot les tient dans la main
// droite : « Hand.R » est un maillage déformé, pas un os ; l'os de la paume qui le porte est Palm2.R (« Palm2R » pour three.js).
const HAND_BONE = /^Palm2\.?R$/;
// Creux du poing dans le repère de cet os (en mètres) : entre les jointures et le bout des doigts repliés.
const FIST = new THREE.Vector3(-0.04, 0.095, 0);
// Bras au repos (bras ballants, ce que garde l'animation Idle), dans le repère du robot (face à +z, sa gauche vers +x) :
// où pointe le manche depuis le poing (aim) et où regarde la face. Le reste suit la main : le coup (Punch) devient une
// volée au tennis ; au golf, le robot se tient de profil, la cible à sa gauche, et le même geste devient un swing
// (montée à droite, traversée vers la cible). Quand les bras balancent (course, marche), l'objet garde plutôt
// l'orientation « carry » pour ne pas racler le sol, les mains du robot étant à hauteur de genou.
const HELD_POSE = {
  racket: { aim: [0.3, 0.4, 0.87], face: [-1, 0, 0], carry: [0.05, 0.9, 0.42] }, // en garde : tête devant, relevée, cordage de côté
  putter: { aim: [0.5, -0.08, 0.86], face: [0, 1, 0], carry: [0.45, 0.12, 0.88] }, // tête posée au sol devant le robot
  iron: { aim: [0.5, -0.06, 0.86], face: [0, 1, 0], carry: [0.45, 0.12, 0.88] },
};
const HELD_OF_SLOT = { Tennis: "racket", Golf: "putter", Practice: "iron" };
const HELD_STEADY = new Set(["Running", "Walking", "WalkJump"]);
const RACKET_COLORS = [["#1c1f26", "#e63946"], ["#f1f0ea", "#2a6df4"], ["#ffd23f", "#1c1f26"], ["#2a2f3a", "#7ee0b0"]];
// Ovale du cadre, un peu plus large en haut comme une vraie tête de raquette.
class OvalCurve extends THREE.Curve {
  constructor(a, b, egg) { super(); Object.assign(this, { a, b, egg }); }
  getPoint(k, target = new THREE.Vector3()) {
    const u = k * Math.PI * 2, s = Math.sin(u);
    return target.set(Math.cos(u) * this.a * (1 + this.egg * s), s * this.b, 0);
  }
}
let heldModels = null, handRest = null;
// Ruban enroulé en spirale (grip) : une bande diagonale par tour, répétée le long du manche.
function wrapTexture(base, band, turns) {
  const t = drawnTexture(64, 64, x => {
    x.fillStyle = base; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = band; x.lineWidth = 9;
    for (const o of [-64, 0, 64]) { x.beginPath(); x.moveTo(o, 0); x.lineTo(o + 64, 64); x.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, turns);
  return t;
}
// Orientation d'un objet tenu, dans le repère du robot : son axe y suit le manche (vers la tête pour la raquette,
// vers le poing pour un club), son axe z la face.
function heldRotation(kind, carry = false) {
  const { aim, face } = HELD_POSE[kind];
  const y = new THREE.Vector3(...carry ? HELD_POSE[kind].carry : aim).normalize();
  if (kind !== "racket") y.negate();
  const z = new THREE.Vector3(...face);
  z.addScaledVector(y, -z.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
}
function buildHeldModels() {
  // Raquette (0,69 m) : origine au milieu du grip, manche selon +y, cordage dans le plan xy.
  const frameGeo = new THREE.TubeGeometry(new OvalCurve(0.118, 0.152, 0.05), 72, 0.0075, 6, true).scale(1, 1, 1.45);
  const bed = new THREE.CircleGeometry(1, 40), pos = bed.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setXY(i, x * 0.113 * (1 + 0.05 * y), y * 0.147); }
  const strings = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, roughness: 0.6,
    map: drawnTexture(128, 128, x => {
      x.strokeStyle = "rgba(244,240,226,0.95)"; x.lineWidth = 1.6;
      for (let k = 1; k < 16; k++) { x.beginPath(); x.moveTo(k * 8, 0); x.lineTo(k * 8, 128); x.stroke(); }
      for (let k = 1; k < 19; k++) { x.beginPath(); x.moveTo(0, k * 6.74); x.lineTo(128, k * 6.74); x.stroke(); }
    }) });
  const overgrip = new THREE.MeshStandardMaterial({ map: wrapTexture("#f4f2ec", "#b9bcc4", 9), roughness: 0.9 });
  const racket = ([frameColor, accentColor]) => {
    const g = new THREE.Group(), frame = mat(frameColor, { roughness: 0.35, metalness: 0.3 }), accent = mat(accentColor, { roughness: 0.4, metalness: 0.2 });
    cyl(g, 0.0165, 0.2, overgrip, 0, 0, 0, 8); // grip à huit pans
    cyl(g, 0.019, 0.014, frame, 0, -0.105, 0, 8); // capuchon
    box(g, 0.026, 0.05, 0.02, frame, 0, 0.125, 0); // cœur, puis la gorge en V jusqu'au cadre
    for (const s of [-1, 1]) box(g, 0.013, 0.152, 0.019, accent, s * 0.0346, 0.2212, 0).rotation.z = -s * 0.357;
    const head = new THREE.Mesh(frameGeo, frame);
    head.position.y = 0.425;
    const bedMesh = new THREE.Mesh(bed, strings);
    bedMesh.position.y = 0.425;
    g.add(head, bedMesh);
    return g;
  };
  // Clubs (0,9 m) : origine au poing, manche selon −y, grip au-dessus. Bras au repos, la tête est posée à plat, la pointe
  // vers l'avant du robot et la face vers sa gauche (la cible) : le manche entre au talon.
  const rubber = new THREE.MeshStandardMaterial({ map: wrapTexture("#1e2126", "#3a3f48", 12), roughness: 0.85 });
  const steel = mat("#d4d8e0", { metalness: 0.45, roughness: 0.3 }), dark = mat("#2a2e35", { metalness: 0.4, roughness: 0.45 });
  const club = (kind, build) => {
    const g = new THREE.Group();
    cyl(g, 0.0125, 0.25, rubber, 0, -0.035, 0, 12);
    cyl(g, 0.0055, 0.62, steel, 0, -0.47, 0, 8);
    cyl(g, 0.0075, 0.03, dark, 0, -0.785, 0, 8); // bague du col
    const head = new THREE.Group();
    head.position.y = -0.8;
    head.quaternion.copy(heldRotation(kind)).invert();
    build(head);
    g.add(head);
    return g;
  };
  const putter = club("putter", h => {
    box(h, 0.026, 0.026, 0.11, dark, 0, -0.02, 0.045); // lame
    box(h, 0.003, 0.022, 0.1, steel, 0.0145, -0.02, 0.045); // face fraisée
    box(h, 0.02, 0.002, 0.003, mat("#f4f1e8"), 0, -0.006, 0.045); // ligne de visée
    cyl(h, 0.006, 0.03, steel, 0, -0.006, 0, 8); // col
  });
  const iron = club("iron", h => {
    box(h, 0.014, 0.045, 0.08, steel, 0, -0.018, 0.04).rotation.z = 0.4; // lame ouverte (loft)
    box(h, 0.024, 0.014, 0.08, steel, -0.004, -0.036, 0.04); // semelle
    box(h, 0.006, 0.02, 0.06, dark, -0.012, -0.018, 0.04); // cavité au dos
    cyl(h, 0.007, 0.04, steel, 0, -0.004, 0, 8); // col
  });
  return { racket: RACKET_COLORS.map(racket), putter: [putter], iron: [iron] };
}
// Met l'objet (ou rien) dans la main droite. Sans changement, ne fait rien : appelé à chaque image sans rien allouer.
function holdProp(g, kind, style = 0) {
  const u = g.userData;
  if (u.held === kind) return;
  u.held = kind;
  for (const k in u.props) u.props[k].visible = k === kind;
  if (!kind || !u.hand || !handRest || u.props?.[kind]) return;
  heldModels ??= buildHeldModels();
  const list = heldModels[kind], m = list[Math.floor(Math.abs(style) * list.length) % list.length].clone();
  m.quaternion.copy(handRest.q).multiply(heldRotation(kind));
  m.position.copy(FIST).divideScalar(handRest.s);
  m.scale.setScalar(1 / handRest.s);
  m.userData.rest = m.quaternion.clone();
  m.userData.carry = heldRotation(kind, true);
  u.hand.add(m);
  (u.props ??= {})[kind] = m;
}
// Après l'animation de l'image : l'objet suit la main (frappe comprise) ; bras qui balancent, il garde l'orientation de
// port dans le repère du robot (os de la main → robot : produit des rotations des parents, sans rien allouer).
const heldTarget = new THREE.Quaternion();
function steadyProp(g, dt) {
  const u = g.userData, m = u.held && u.props?.[u.held];
  if (!m) return;
  if (HELD_STEADY.has(u.anim)) {
    heldTarget.copy(u.hand.quaternion);
    for (let o = u.hand.parent; o && o !== g; o = o.parent) heldTarget.premultiply(o.quaternion);
    heldTarget.invert().multiply(m.userData.carry);
  } else heldTarget.copy(m.userData.rest);
  m.quaternion.slerp(heldTarget, Math.min(1, dt * 7));
}
function makeAgent(key, s) {
  const T = TOOLS[s.src] ?? { color: "#888888", acc: "#ffffff" };
  const g = makeRobot(T.color);
  const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: "#8b93a7" }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  const orb = new THREE.Mesh(orbGeometry, glow(T.acc, 2.5));
  orb.position.y = 1.78;
  g.add(orb);
  const puffs = [0, 1, 2].map(i => {
    const p = new THREE.Mesh(puffGeometry, new THREE.MeshBasicMaterial({ color: "#d9dde8", transparent: true, opacity: 0, depthWrite: false }));
    p.userData.phase = i / 3;
    g.add(p);
    return p;
  });
  const cup = cyl(g, 0.06, 0.13, mat("#e9e2d4"), 0.3, 0.95, 0.15, 10);
  // Zone de clic invisible : le rayon de la souris teste une boîte, pas chaque triangle du robot déformé.
  const hit = box(g, 0.75, 1.75, 0.75, hitMaterial, 0, 0.88, 0);
  const el = document.createElement("div");
  el.className = "bubble3d";
  const bubble = new CSS2DObject(el);
  bubble.position.set(0, 2.1, 0);
  g.add(bubble);
  Object.assign(g.userData, { key, ring, orb, puffs, cup, bubble, hit, path: [], floor: null, place: null, slot: null, dir: 0, wait: 0, seed: (hash(key) % 1000) / 1000 });
  return g;
}

// Chemin sur un étage : rejoindre l'allée centrale, la suivre, puis gagner sa place.
// Chemin sur un étage : ressortir par l'approche de sa place, suivre l'allée centrale, entrer par l'approche de la nouvelle.
const lane = x => new THREE.Vector3(x, 0, P(0, LANE).z);
const leave = (from, way) => { const back = [...way].reverse(); return [...back, lane((back.at(-1) ?? from).x)]; };
const enter = (to, way) => [lane((way[0] ?? to).x), ...way, to];

export { HELD_OF_SLOT, enter, holdProp, leave, makeAgent, makeRobot, mergeRobotParts, play, steadyProp };
