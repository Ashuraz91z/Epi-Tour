// Le penthouse en 3D : une tour de verre dans la ville. Sur le toit, la terrasse fumeurs ; puis un étage de travail
// par résident ; puis le Salon (café, repos, tabac, toilettes) et le Club, où les agents de tout le monde se
// retrouvent quand ils ne travaillent pas. Ils voyagent par l'ascenseur. Seul l'étage regardé est ouvert :
// les autres font partie de la tour (moins à dessiner, rien entre la caméra et l'étage).
import * as THREE from "three";
import { breakVisit, assignPauseSlots } from "./break-motion.js";
import { approvalState } from "./approval-alert.js";
import { spectatorStep } from "./spectator-tour.js";
import { assignDeskSlots } from "./desk-slots.js";
import {
  activityLeaderboard, applyKioskFromUrl, historyCsv, historyEntries, machineStatusRows,
  pushApprovalNotifications, quotaAlerts, saveProfile, startStateStream, todayBadges,
} from "./penthouse-extras.js";
import { badgesHtml, missionsHtml, postGame, showCelebrations, spaceActionsHtml, wingActionsHtml, xpBarHtml } from "./gamify-ui.js";
import { homeFloor, parseFloorKey, wingsOf } from "./wings-client.js";
import { officePanelHtml, officeTierForLevel } from "./upgrades-client.js";
import {
  agentRoleText, createEconomyUi, decorKeyOf, eventChipHtml, fortuneLeaders, freshTipsIn, money, residentEconomyLine, staffOf, walletChipHtml,
} from "./economy-ui.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
const hm = t => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const ME = "penthouse.moi";

function myApt() {
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  return data?.apartments.find(a => a.slug === me?.slug);
}
function agentsOnFloor(floorKey) {
  return [...agents.values()].filter(g => g.userData.target === floorKey).length;
}
async function runGameAction(action, floor, agentsHere = 0) {
  const token = sessionStorage.getItem("penthouse.cle");
  if (!token) throw new Error("Clé requise : ouvre Relier mes agents.");
  const j = await postGame("/api/game/action", token, { action, floor, agentsHere });
  showCelebrations(j.toasts);
  const me = myApt();
  if (me && j.game) me.game = j.game;
  render();
  return j;
}
async function runGameClaim(questId) {
  const token = sessionStorage.getItem("penthouse.cle");
  if (!token) throw new Error("Clé requise.");
  const j = await postGame("/api/game/claim", token, { questId });
  showCelebrations(j.toasts);
  const me = myApt();
  if (me && j.game) me.game = j.game;
  render();
  refreshMissionsDlg();
}

const TOOLS = {
  claude: { name: "Claude Code", color: "#e0814f", acc: "#ffc29e" },
  codex: { name: "Codex", color: "#2fb898", acc: "#9ff5df" },
  hermes: { name: "Hermes", color: "#9a6cf0", acc: "#e2d4ff" },
  grok: { name: "Grok Bot", color: "#789bb2", acc: "#c9e8fb" },
  cursor: { name: "Cursor", color: "#6b9cff", acc: "#c5d8ff" },
  n8n: { name: "n8n", color: "#ff6f9e", acc: "#ffd0e0" },
};
const STATE_FR = { travaille: "au travail", autorisation: "attend ton accord", attend: "attend la suite", fini: "en pause", erreur: "en erreur", silencieux: "silencieux" };
const STATE_COLOR = { travaille: "#4ade80", autorisation: "#ff4d4d", attend: "#fbbf24", fini: "#8b93a7", erreur: "#ff4d4d", silencieux: "#5b6275" };

// Étages communs : le toit au-dessus des résidents, le Salon, le Club et le Casino en dessous.
const SHARED = [
  { id: "roof", name: "Terrasse fumeurs", kicker: "Toit-terrasse", icon: "🚬", floor: "#262a33", top: true },
  { id: "lounge", name: "Salon", kicker: "Café · repos · tabac · toilettes", icon: "☕", floor: "#22202a" },
  { id: "club", name: "Club", kicker: "Étage commun", icon: "🪩", floor: "#160c22" },
  { id: "casino", name: "Casino", kicker: "Jeux · bar · détente", icon: "🎰", floor: "#2d1810" },
];
const FLOOR_OF = { smoke: "roof", cafe: "lounge", rest: "lounge", tabac: "lounge", wc: "lounge", club: "club", casino: "casino" };
const PLACE_FR = { open: "Open space", boss: "Bureau du résident", smoke: "Terrasse fumeurs", cafe: "Café", rest: "Salle de repos",
  tabac: "Bureau de tabac", wc: "Toilettes", club: "Club", casino: "Casino" };

// ---------- géométrie (plan de 1000 × 620 unités, 1 unité = 2 cm) ----------
const S = 0.02, FLOOR_H = 5.2, LIFT = 22;
const P = (x, y, h = 0) => new THREE.Vector3(x * S - 10, h, y * S - 6.2);
const LANE = 310;               // l'allée centrale (y du plan) relie l'ascenseur à toutes les portes
const ELEV = P(8, LANE);         // porte de l'ascenseur, sur la façade ouest

// Étage d'un résident : open space de 12 postes (à gauche) et son bureau (à droite).
const OPEN = { x: 20, y: 20, w: 620, h: 580 }, BOSS = { x: 660, y: 20, w: 320, h: 580 };
const DESKS = [100, 215, 400, 515].flatMap(r => [90, 260, 430].map(c => ({ cx: c + 75, cy: r + 28 })));
// Places : [x, y, orientation, animation, approche] (orientation 0 = face à la caméra, π = vers le fond). L'approche liste
// les points de passage depuis l'allée centrale, pour contourner les meubles au lieu de marcher dessus.
const RES_SLOTS = {
  open: DESKS.map(d => [d.cx, d.cy - 52, 0, "Sitting", [[d.cx - 85, d.cy - 52]]]), // par l'allée à gauche du poste
  boss: [[760, 300], [820, 310], [880, 300], [780, 360], [860, 360], [820, 405]].map(([x, y]) => [x, y, Math.PI, "Wave"]),
};
const around = (cx, cy, r, n, start = 0, anim = "Idle") => [...Array(n)].map((_, k) => {
  const a = start + (k / n) * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
  return [x, y, Math.atan2(cx - x, cy - y), anim];
});
// Salon : café à gauche, salle de repos au centre, bureau de tabac (au fond) et toilettes (devant) à droite.
const CAFE_TABLES = [[110, 200], [290, 200], [110, 440], [290, 440]];
const REST_GROUPS = [[560, 170], [560, 440]];
const STALLS = [790, 865, 940];
// Toit : une terrasse en bois plus petite que le toit, quatre cendriers.
const DECK = { x: 300, y: 230, w: 440, h: 370 };
const ASHTRAYS = [[390, 300], [610, 300], [430, 470], [650, 470]];
// Répartition fixe mais irrégulière : ne change pas au rafraîchissement et laisse les vrais agents s’installer.
const CLUB_NPCS = [[335, 215], [470, 245], [650, 210], [375, 345], [530, 365], [675, 345]];
const CLUB_EMOTES = ["Wave", "ThumbsUp", "Yes", "Jump"];
const clubAnimation = (t, seed) => {
  const phase = t + seed * 17;
  return phase % 12 < 2 ? CLUB_EMOTES[Math.floor(phase / 12) % CLUB_EMOTES.length] : "Dance";
};
// Casino : tables, machines à sous, bar
// Mêmes positions que les meubles dessinés dans buildShared (tables de jeu et machines à sous).
const CASINO_TABLES = [[150, 120], [350, 120], [550, 120], [150, 350], [350, 350], [550, 350]];
const CASINO_MACHINES = [
  [150, 420], [350, 420], [550, 420], [750, 420],
  [200, 500], [400, 500], [600, 500], [800, 500],
  [280, 580], [520, 580], [760, 580],
];
// Le joueur se tient devant l'écran (côté caméra), tourné vers la machine ; il arrive par le côté pour ne pas la traverser.
const CASINO_SLOT_MACHINES = CASINO_MACHINES.map(([x, y]) => [x, y + 36, y > 560 ? -48 : 48]);
const CASINO_SLOTS = [
  ...CASINO_TABLES.flatMap(([cx, cy]) => around(cx, cy, 60, 5, Math.PI / 5, "Idle")),
  ...CASINO_SLOT_MACHINES.map(([x, y, side]) => [x, y, Math.PI, "Idle", [[x + side, y]]]),
  ...[150, 250, 350, 450, 550, 650].map(x => [x, 550, Math.PI, "Idle"]),
  ...[300, 400, 500].map(x => [x, 100, 0, "Idle"]),
];
const SHARED_SLOTS = {
  // Café : les chaises du côté opposé à l'allée se rejoignent par l'allée entre les tables.
  cafe: [...CAFE_TABLES.flatMap(([cx, cy]) => around(cx, cy, 52, 4, Math.PI / 4, "Sitting").map(c =>
      (cy < LANE) === (c[1] < cy) ? [...c, [[c[0] < cx ? cx - 90 : cx + 90, c[1]]]] : c)),
    ...[100, 180, 260, 340].map(x => [x, 135, Math.PI, "Idle", [[200, 135]]])], // comptoir : par l'allée entre les tables
  // Repos : on passe à gauche du salon, puis entre la table basse et le canapé.
  rest: REST_GROUPS.flatMap(([x, y]) => [
    ...[x - 25, x + 25].map(sx => [sx, y + 50, Math.PI, "Sitting", [[x - 125, y + 40], [sx, y + 40]]]),
    // Fauteuil : par devant, entre la table basse et lui (le salon du fond contourne d'abord son canapé)
    [x + 100, y, -Math.PI / 2, "Sitting", y < LANE ? [[x - 125, y + 40], [x + 50, y + 40], [x + 50, y]] : [[x + 50, y]]]]),
  tabac: [[790, 190], [850, 200], [910, 190], [820, 250], [880, 250]].map(([x, y]) => [x, y, Math.PI]),
  wc: [...STALLS.map(x => [x, 540, Math.PI, "Sitting"]), [790, 430, Math.PI / 2], [850, 420, Math.PI / 2], [790, 380, Math.PI / 2]],
  // Les places des agents évitent les PNJ, répartis sur toute la piste.
  club: [0, 1, 2, 3].flatMap(r => [0, 1, 2, 3, 4, 5, 6].map(c => [325 + c * 55, 200 + r * 60, Math.PI, "Dance"]))
    .filter(([x, y]) => CLUB_NPCS.every(([nx, ny]) => Math.hypot(nx - x, ny - y) >= 48)),
  smoke: [...ASHTRAYS.flatMap(([x, y]) => around(x, y, 42, 3, Math.PI / 6)), ...[440, 600].map(x => [x, 560, 0])],
  casino: CASINO_SLOTS,
};
function slotOf(list, k) {
  if (list[k]) return list[k];
  const j = k - list.length; // au-delà des places prévues : debout, en rangées sur le devant
  return [80 + (j * 61) % 840, 590 - Math.floor((j * 61) / 840) * 40, 0, "Idle"];
}

const stateOf = (s, now) => s.state === "travaille" && now - s.updated > 600 ? "silencieux" : s.state;
const keyOf = (slug, s) => `${slug}:${s.src}:${s.host}:${s.sid}`;
// Où va l'agent : son poste quand il travaille, le bureau du résident pour une autorisation, la terrasse quand
// il attend la suite, le café quand il vient de finir, puis le Club et les pauses variées.
function placeOf(s, now) {
  const st = stateOf(s, now);
  if (st === "autorisation") return "boss";
  if (st === "travaille" || st === "erreur") return "open";
  if (st === "attend") return "smoke";
  return breakVisit(hash(`${s.src}:${s.host}:${s.sid}`), now - s.updated, st === "silencieux").place;
}

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
function textTexture(text, { font = "700 72px Sora, sans-serif", color = "#ff6fd8", w = 512, h = 128, blur = 28 } = {}) {
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

// ---------- la ville autour ----------
// Les fenêtres sont calculées par le shader d'après la position dans le monde : toute la ville tient en un seul
// maillage instancié (un appel de dessin), et les fenêtres de la tour s'alignent sur ses étages.
function cityMaterial(cellW, cellH, lit) {
  const m = new THREE.MeshStandardMaterial({ color: "#0d1120", roughness: 0.9 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uCell: { value: new THREE.Vector2(cellW, cellH) }, uLit: { value: lit } });
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vCityP;\nvarying vec3 vCityN;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        mat4 cityM = modelMatrix;
        #ifdef USE_INSTANCING
          cityM = modelMatrix * instanceMatrix;
        #endif
        vCityP = (cityM * vec4(transformed, 1.0)).xyz;
        vCityN = normalize(mat3(cityM) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vCityP;\nvarying vec3 vCityN;\nuniform vec2 uCell;\nuniform float uLit;")
      .replace("#include <emissivemap_fragment>", `
        vec2 cw = vec2(abs(vCityN.x) > 0.5 ? vCityP.z : vCityP.x, vCityP.y) / uCell;
        vec2 cid = floor(cw), cf = fract(cw);
        float rr = fract(sin(dot(cid, vec2(12.9898, 78.233))) * 43758.5453);
        float win = step(0.22, cf.x) * step(cf.x, 0.78) * step(0.28, cf.y) * step(cf.y, 0.82) * step(rr, uLit) * step(abs(vCityN.y), 0.5);
        totalEmissiveRadiance += win * mix(vec3(1.0, 0.78, 0.45), vec3(0.62, 0.78, 1.0), step(0.78, rr / uLit)) * 0.7;`);
  };
  return m;
}
const GROUND = -150, CELL = 18;
const AD_SITE = { x: -2 * CELL, z: -3 * CELL }, USAGE_SITE = { x: 18, z: -54 };
const beacons = new THREE.MeshBasicMaterial({ color: "#ff3030", fog: false });
(function city() {
  let r = 42;
  const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // Un immeuble par îlot sur une grille de rues, avec un parvis dégagé autour de la tour.
  const spots = [];
  for (let i = -14; i <= 14; i++) for (let j = -14; j <= 14; j++) {
    const x = i * CELL, z = j * CELL, d = Math.hypot(x, z);
    if (d < 72 || d > 255 || [AD_SITE, USAGE_SITE].some(site => site.x === x && site.z === z)) continue;
    spots.push([x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2, 8 + rnd() * 2, 8 + rnd() * 2, 45 + rnd() ** 1.6 * 175]);
  }
  const m4 = new THREE.Matrix4();
  const town = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), cityMaterial(1.2, 2.4, 0.33), spots.length);
  spots.forEach(([x, z, w, d, h], k) => town.setMatrixAt(k, m4.makeScale(w, h, d).setPosition(x, GROUND, z)));
  scene.add(town);
  // Feux rouges sur les plus hauts toits
  const tall = spots.filter(s => GROUND + s[4] > -45);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), beacons, tall.length);
  tall.forEach(([x, z, , , h], k) => lights.setMatrixAt(k, m4.makeTranslation(x, GROUND + h + 0.6, z)));
  scene.add(lights);
  // Le sol et ses rues éclairées, entre les îlots
  box(scene, 560, 1, 560, mat("#05070d"), 0, GROUND - 0.5, 0);
  // Même grille que les voitures : chaussées pleines, trottoirs et marquage, au niveau du sol.
  const roads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat("#303644"), 58);
  const sidewalks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat("#555966"), 58);
  const markings = [];
  for (let i = -14; i <= 14; i++) {
    const lane = i * CELL + CELL / 2, k = (i + 14) * 2;
    roads.setMatrixAt(k, m4.makeScale(540, 0.12, 5).setPosition(0, GROUND + 0.12, lane));
    roads.setMatrixAt(k + 1, m4.makeScale(5, 0.12, 540).setPosition(lane, GROUND + 0.12, 0));
    sidewalks.setMatrixAt(k, m4.makeScale(540, 0.12, 7).setPosition(0, GROUND + 0.02, lane));
    sidewalks.setMatrixAt(k + 1, m4.makeScale(7, 0.12, 540).setPosition(lane, GROUND + 0.02, 0));
    for (let j = -44; j <= 44; j++) {
      const p = j * 6;
      // Laisser les carrefours libres de pointillés.
      if (Math.abs(((p % CELL) + CELL) % CELL - CELL / 2) < 4) continue;
      markings.push(p - 1, GROUND + 0.19, lane, p + 1, GROUND + 0.19, lane,
        lane, GROUND + 0.19, p - 1, lane, GROUND + 0.19, p + 1);
    }
  }
  scene.add(sidewalks, roads);
  const roadLines = new THREE.BufferGeometry();
  roadLines.setAttribute("position", new THREE.Float32BufferAttribute(markings, 3));
  scene.add(new THREE.LineSegments(roadLines, new THREE.LineBasicMaterial({ color: "#c7bfa3" })));
  const stars = new THREE.BufferGeometry(), pts = [];
  for (let i = 0; i < 700; i++) {
    const a = rnd() * Math.PI * 2, e = 0.15 + rnd() * 1.2, R = 400;
    pts.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R - 60, Math.sin(a) * Math.cos(e) * R);
  }
  stars.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: "#cfd8ff", size: 1.2, sizeAttenuation: false, fog: false })));
  const moonBall = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: "#f3efe0", fog: false }));
  moonBall.position.set(-160, 120, -260);
  scene.add(moonBall);
})();

// Les îlots dégagés autour de la tour deviennent des jardins, plutôt que des cases noires.
(function parksAndStreetlights() {
  const gardens = [], trees = [], lamps = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    if ((!i && !j) || [AD_SITE, USAGE_SITE].some(site => site.x === i * CELL && site.z === j * CELL) || Math.hypot(i * CELL, j * CELL) >= 72) continue;
    const x = i * CELL, z = j * CELL, kind = (i * i + j * j + i + 12) % 4;
    if (kind) {
      box(scene, 12, 0.2, 12, mat(kind === 1 ? "#77756b" : kind === 2 ? "#263f50" : "#30343c"), x, GROUND + 0.16, z);
      if (kind === 1) {
        cyl(scene, 2.8, 0.6, mat("#9b9d9b"), x, GROUND + 0.5, z);
        cyl(scene, 2.4, 0.08, glow("#4b9db0", 0.5), x, GROUND + 0.84, z);
        cyl(scene, 0.25, 1.5, mat("#b6b9b4"), x, GROUND + 1.3, z);
        for (const dx of [-4, 4]) box(scene, 0.8, 0.5, 3, mat("#96724c"), x + dx, GROUND + 0.6, z);
      } else if (kind === 2) {
        for (const dx of [-5, 0, 5]) box(scene, 0.12, 0.04, 10, glow("#c5d8cb", 0.4), x + dx, GROUND + 0.3, z);
        for (const dz of [-5, 5]) {
          box(scene, 10, 0.04, 0.12, glow("#c5d8cb", 0.4), x, GROUND + 0.3, z + dz);
          box(scene, 0.12, 3, 0.12, mat("#a5abb2"), x, GROUND + 1.7, z + dz);
          box(scene, 1.8, 1, 0.1, mat("#dbdcd2"), x, GROUND + 3, z + dz);
        }
      } else {
        for (const dx of [-4, 0, 4]) {
          box(scene, 0.1, 0.04, 10, mat("#b2b1a1"), x + dx, GROUND + 0.3, z);
          box(scene, 1.5, 0.8, 3, mat(dx ? "#687d91" : "#974b45"), x + dx + 1, GROUND + 0.7, z + 2);
          box(scene, 1.2, 0.4, 1.5, mat("#152537"), x + dx + 1, GROUND + 1.25, z + 2);
        }
      }
      continue;
    }
    gardens.push([x, z]);
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) trees.push([i * CELL + dx, j * CELL + dz]);
  }
  const m = new THREE.Matrix4();
  const grass = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 0.2, 12), glow("#204b36", 0.3), gardens.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), mat("#6d513c"), trees.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.8, 1), glow("#356b47", 0.25), trees.length);
  gardens.forEach(([x, z], k) => {
    grass.setMatrixAt(k, m.makeTranslation(x, GROUND + 0.16, z));
    box(scene, 1.1, 0.05, 12, mat("#958a70"), x, GROUND + 0.3, z);
    box(scene, 12, 0.05, 1.1, mat("#958a70"), x, GROUND + 0.31, z);
    for (const dx of [-2, 2]) {
      box(scene, 0.7, 0.5, 2, mat("#96724c"), x + dx, GROUND + 0.6, z + 2);
      box(scene, 0.15, 0.9, 2, mat("#96724c"), x + dx + Math.sign(dx) * 0.3, GROUND + 0.8, z + 2);
    }
  });
  trees.forEach(([x, z], k) => {
    trunks.setMatrixAt(k, m.makeTranslation(x, GROUND + 1.2, z));
    crowns.setMatrixAt(k, m.makeTranslation(x, GROUND + 3, z));
  });
  for (let i = -7; i <= 7; i++) for (let j = -7; j <= 7; j++)
    lamps.push([i * CELL + 6, j * CELL]);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.15, 4, 5), mat("#6c737e"), lamps.length);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: "#ffe0a0" }), lamps.length);
  const lightCanvas = document.createElement("canvas"); lightCanvas.width = lightCanvas.height = 64;
  const ctx = lightCanvas.getContext("2d"), gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,210,125,0.45)"); gradient.addColorStop(1, "rgba(255,210,125,0)");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  // Halos au sol instanciés : rues lisibles sans des centaines de lumières dynamiques.
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lightCanvas), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), lamps.length);
  const transform = new THREE.Object3D(); transform.rotation.x = -Math.PI / 2;
  lamps.forEach(([x, z], k) => {
    poles.setMatrixAt(k, m.makeTranslation(x, GROUND + 2.2, z));
    bulbs.setMatrixAt(k, m.makeTranslation(x, GROUND + 4.3, z));
    transform.position.set(x + 2, GROUND + 0.22, z); transform.updateMatrix(); pools.setMatrixAt(k, transform.matrix);
  });
  scene.add(grass, trunks, crowns, poles, bulbs, pools);
})();

// Immeuble voisin : une vraie enseigne sur le toit, avec le classement issu du direct.
const neighbour = new THREE.Group(); neighbour.position.set(AD_SITE.x, 0, AD_SITE.z); scene.add(neighbour);
box(neighbour, 13, 135, 13, cityMaterial(1.2, 2.4, 0.4), 0, -82.5, 0);
box(neighbour, 14, 0.4, 14, mat("#343b49"), 0, -15, 0);
for (const x of [-5, 5]) box(neighbour, 0.4, 5, 0.4, mat("#7d8591"), x, -12.5, 3);
box(neighbour, 20.6, 10.6, 0.5, mat("#b49a65", { metalness: 0.6 }), 0, -5, 3);
const adCanvas = document.createElement("canvas"); adCanvas.width = 1200; adCanvas.height = 600;
const adTexture = new THREE.CanvasTexture(adCanvas); adTexture.colorSpace = THREE.SRGBColorSpace;
const billboard = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.MeshBasicMaterial({ map: adTexture, side: THREE.DoubleSide }));
billboard.position.set(0, -5, 3.3); billboard.name = "billboard"; neighbour.add(billboard);
const usageNeighbour = neighbour.clone(true); usageNeighbour.position.set(USAGE_SITE.x, 0, USAGE_SITE.z); scene.add(usageNeighbour);
const usageCanvas = document.createElement("canvas"); usageCanvas.width = 1200; usageCanvas.height = 600;
const usageTexture = new THREE.CanvasTexture(usageCanvas); usageTexture.colorSpace = THREE.SRGBColorSpace;
usageNeighbour.getObjectByName("billboard").material = new THREE.MeshBasicMaterial({ map: usageTexture, side: THREE.DoubleSide });
let usageContent = "";
function quotaRemaining(window, now) {
  if (!window || !Number.isFinite(window.pct) || (window.resets_at && now >= window.resets_at)) return null;
  return Math.round(100 - Math.max(0, Math.min(100, window.pct)));
}
function quotaRows(usage, now) {
  return ["claude", "chatgpt"].flatMap(provider =>
    [["five_hour", "5 HEURES"], ["seven_day", "SEMAINE"]].map(([key, label]) => {
      const q = usage?.[provider]?.[key];
      if (!q || !Number.isFinite(q.pct)) return { label, remaining: null, reset: "Données non reçues" };
      if (q.resets_at && now >= q.resets_at) return { label, remaining: null, reset: "Nouvelle mesure attendue" };
      const remaining = quotaRemaining(q, now);
      const reset = q.resets_at ? "Reset " + new Date(q.resets_at * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "Reset inconnu";
      return { label, remaining, reset };
    }));
}
function updateUsageBoard(apartments, now) {
  const residents = [...apartments].sort((a, b) => a.created - b.created || a.name.localeCompare(b.name, "fr"));
  const page = residents.length ? Math.floor(now / 8) % residents.length : 0, resident = residents[page];
  const rows = quotaRows(resident?.usage, now);
  const stamps = [resident?.usage?.claude?.ts, resident?.usage?.chatgpt?.ts];
  const content = JSON.stringify([resident?.name, rows, stamps, page, residents.length]);
  if (content === usageContent) return;
  usageContent = content;
  const c = usageCanvas.getContext("2d");
  const bg = c.createLinearGradient(0, 0, 1200, 600); bg.addColorStop(0, "#0a1423"); bg.addColorStop(1, "#17273a");
  c.fillStyle = bg; c.fillRect(0, 0, 1200, 600);
  c.fillStyle = "#91a9c3"; c.font = "600 28px Sora, sans-serif"; c.fillText("PENTHOUSE   /   CAPACITÉ DISPONIBLE", 48, 48);
  c.fillStyle = "#f3f5f8"; c.font = "700 64px Sora, sans-serif";
  c.fillText(resident?.name ?? "En attente des résidents", 48, 120, 850);
  c.textAlign = "right"; c.font = "500 28px Sora, sans-serif"; c.fillStyle = "#a8bacd";
  c.fillText(`${residents.length ? page + 1 : 0} / ${residents.length}`, 1152, 110); c.textAlign = "left";
  const card = (x, y, w, h, color) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, 20); c.fill(); };
  ["Claude", "ChatGPT"].forEach((provider, k) => {
    const x = 48 + k * 564, accent = k ? "#75e0c1" : "#efb18b";
    card(x, 157, 540, 366, "#1b2b3d");
    c.fillStyle = accent; c.beginPath(); c.arc(x + 30, 194, 6, 0, Math.PI * 2); c.fill();
    c.font = "600 36px Sora, sans-serif"; c.fillText(provider, x + 50, 206);
    rows.slice(k * 2, k * 2 + 2).forEach((row, i) => {
      const y = 247 + i * 132;
      c.fillStyle = "#b6c4d3"; c.font = "600 26px Sora, sans-serif"; c.fillText(row.label, x + 24, y);
      c.fillStyle = row.remaining !== null && row.remaining < 15 ? "#ffb18f" : "#f6f8fa";
      c.textAlign = "right"; c.font = "700 52px Sora, sans-serif";
      c.fillText(row.remaining === null ? "—" : `${row.remaining} %`, x + 516, y + 6); c.textAlign = "left";
      card(x + 24, y + 25, 492, 10, "#0e1b2a");
      if (row.remaining > 0) card(x + 24, y + 25, 492 * row.remaining / 100, 10, accent);
      c.fillStyle = "#bdcbd9"; c.font = "400 26px Sora, sans-serif"; c.fillText(row.reset, x + 24, y + 65, 492);
    });
  });
  c.fillStyle = "#9eb1c7"; c.font = "400 26px Sora, sans-serif";
  c.fillText("Quota restant · horaires de Paris", 48, 565);
  c.textAlign = "right";
  const measured = stamps.filter(Number.isFinite);
  c.fillText(measured.length ? "Dernière réception " + new Date(Math.max(...measured) * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "En attente des sondes", 1152, 565);
  c.textAlign = "left";
  usageTexture.needsUpdate = true;
}
updateUsageBoard([], 0);
let adContent = "";
function agentRanking(apartments, now) {
  return apartments.map(a => ({ name: a.name, active: a.sessions.filter(s => stateOf(s, now) === "travaille").length }))
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, "fr")).slice(0, 3);
}
function updateBillboard(apartments, now) {
  const ranking = agentRanking(apartments, now), content = JSON.stringify(ranking);
  if (content === adContent) return;
  adContent = content;
  const c = adCanvas.getContext("2d");
  c.fillStyle = "#0a1720"; c.fillRect(0, 0, 1200, 600);
  c.fillStyle = "#6de4b3"; c.font = "600 30px Sora, sans-serif"; c.fillText("PENTHOUSE  /  EN DIRECT", 60, 65);
  c.fillStyle = "#fff0cf"; c.font = "700 52px Sora, sans-serif"; c.fillText("QUI FAIT TOURNER LES AGENTS ?", 60, 145, 1080);
  if (!ranking.length) { c.font = "36px Sora, sans-serif"; c.fillText("En attente des résidents", 60, 285); }
  ranking.forEach((row, i) => {
    const y = 245 + i * 105;
    c.fillStyle = i ? "#d4dce3" : "#ffe0a0"; c.font = "600 48px Sora, sans-serif";
    c.fillText(`${i + 1}. ${row.name}`, 60, y, 810);
    c.textAlign = "right"; c.fillText(String(row.active), 1130, y); c.textAlign = "left";
    c.fillStyle = "#263b46"; c.fillRect(60, y + 25, 1080, 2);
  });
  c.fillStyle = "#8ea6b5"; c.font = "26px Sora, sans-serif"; c.fillText("Agents au travail maintenant · pas un classement de consommation", 60, 565, 1080);
  adTexture.needsUpdate = true;
}
updateBillboard([], 0);

// Un peu de vie à l'extérieur : circulation sur les rues entre les îlots et avions lointains.
const outside = new THREE.Group();
scene.add(outside);
const reducedOutsideMotion = matchMedia("(prefers-reduced-motion: reduce)");
const traffic = [];
for (let i = 0; i < 24; i++) {
  const car = new THREE.Group(), direction = i % 2 ? 1 : -1;
  const axis = i % 3 ? "x" : "z", lane = (Math.floor(i / 3) - 6) * CELL + CELL / 2;
  box(car, 1.1, 0.6, 2.5, mat(["#344b65", "#a58b62", "#713d45"][i % 3]), 0, 0.5, 0);
  box(car, 0.85, 0.45, 1.2, mat("#172337"), 0, 1, 0);
  for (const x of [-0.38, 0.38]) {
    box(car, 0.22, 0.18, 0.08, glow("#fff0ce"), x, 0.6, 1.28);
    box(car, 0.22, 0.16, 0.08, glow("#e34d48"), x, 0.6, -1.28);
  }
  car.rotation.y = axis === "x" ? direction * Math.PI / 2 : direction < 0 ? Math.PI : 0;
  car.position.y = GROUND + 0.18;
  car.position[axis === "x" ? "z" : "x"] = lane + direction * 1.1;
  outside.add(car);
  traffic.push({ car, axis, direction, start: i * 14, speed: 5 + i % 5 });
}
const planes = [];
for (let i = 0; i < 2; i++) {
  const plane = new THREE.Group();
  box(plane, 0.5, 0.4, 4, mat("#7c879b"), 0, 0, 0);
  box(plane, 5, 0.12, 0.8, mat("#7c879b"), 0, 0, 0);
  box(plane, 0.2, 0.2, 0.2, glow("#e85858"), -2.5, 0, 0);
  box(plane, 0.2, 0.2, 0.2, glow("#74d9ad"), 2.5, 0, 0);
  plane.rotation.y = Math.PI / 2;
  plane.position.set(0, 75 + i * 24, -160 - i * 65);
  outside.add(plane);
  planes.push(plane);
}
const birds = [];
for (let i = 0; i < 6; i++) {
  const bird = new THREE.Group();
  const wings = [-1, 1].map(side => box(bird, 0.45, 0.04, 0.15, mat("#a8b1c6"), side * 0.22, 0, 0));
  outside.add(bird);
  birds.push({ bird, wings });
}
function animateOutside(t) {
  // Le temps est figé si le visiteur demande moins de mouvement.
  const time = reducedOutsideMotion.matches ? 0 : t;
  for (const { car, axis, direction, start, speed } of traffic)
    car.position[axis] = direction * ((start + time * speed) % 500 - 250);
  birds.forEach(({ bird, wings }, i) => {
    const angle = time * 0.12 + i * 0.16;
    bird.position.set(Math.cos(angle) * (29 + i), 5 + Math.sin(angle * 2 + i) * 1.2, Math.sin(angle) * (29 + i));
    bird.rotation.y = -angle;
    wings.forEach((wing, k) => { wing.rotation.z = (k ? 1 : -1) * Math.sin(time * 5 + i) * 0.5; });
  });
  planes.forEach((plane, i) => { plane.position.x = (time * (3 + i) + i * 260) % 640 - 320; });
}

// La tour sous l'étage regardé, jusqu'au sol : ses fenêtres tombent sur les étages.
const tower = new THREE.Mesh(new THREE.BoxGeometry(20.6, 1, 12.8).translate(0, -0.5, 0), cityMaterial(1.3, FLOOR_H / 2, 0.45));
scene.add(tower);
let towerTop = -0.5;

// ---------- un étage : la coque commune (dalle, vitres, ascenseur) ----------
function shell(floorColor, { glass = true } = {}) {
  const g = new THREE.Group();
  const f = { group: g, baseY: 0, links: [] };
  box(g, 20.8, 0.5, 13, mat("#151924"), 0, -0.25, 0);
  box(g, 20.8, 0.12, 0.12, mat("#c9a86a", { metalness: 0.6, roughness: 0.35 }), 0, -0.44, 6.5); // liseré doré du nez de dalle
  box(g, 20.4, 0.04, 12.4, mat(floorColor), 0, 0.02, 0);
  if (glass) {
    const glassM = new THREE.MeshPhysicalMaterial({ color: "#8fb6ff", transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    for (const [w, x, z, ry] of [[20.8, 0, -6.5, 0], [13, -10.4, 0, Math.PI / 2], [13, 10.4, 0, Math.PI / 2]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, FLOOR_H - 0.5), glassM);
      p.position.set(x, (FLOOR_H - 0.5) / 2, z);
      p.rotation.y = ry;
      g.add(p);
    }
    for (let x = -10.4; x <= 10.5; x += 2.6) box(g, 0.08, FLOOR_H - 0.5, 0.08, mat("#2b3142", { metalness: 0.5 }), x, (FLOOR_H - 0.5) / 2, -6.5);
  }
  // Ascenseur : cadre doré et portes lumineuses sur la façade ouest
  box(g, 0.2, 2.6, 1.7, mat("#c9a86a", { metalness: 0.7, roughness: 0.3 }), -10.2, 1.3, 0);
  f.elevDoor = box(g, 0.06, 2.3, 1.4, mat("#2a3042", { metalness: 0.6, roughness: 0.25 }), -10.08, 1.2, 0);
  box(g, 0.05, 0.12, 0.5, glow("#f1cd85", 1.2), -10.08, 2.48, 0);
  const warm = new THREE.PointLight("#ffd9a0", 14, 24, 1.4);
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

function walls(g, r, doors) {
  // Cloisons basses autour d'une pièce, ouvertes sur l'allée centrale ; le mur côté caméra reste bas.
  const m = mat("#39415a"), T = 0.12;
  const x0 = r.x * S - 10, x1 = (r.x + r.w) * S - 10, z0 = r.y * S - 6.2, z1 = (r.y + r.h) * S - 6.2, laneZ = P(0, LANE).z, gap = 1.6;
  box(g, x1 - x0, 1.05, T, m, (x0 + x1) / 2, 0.52, z0);
  box(g, x1 - x0, 0.35, T, m, (x0 + x1) / 2, 0.17, z1);
  for (const [x, side] of [[x0, "w"], [x1, "e"]]) {
    if (!doors.includes(side)) { box(g, T, 1.05, z1 - z0, m, x, 0.52, (z0 + z1) / 2); continue; }
    const a = laneZ - gap / 2 - z0, b = z1 - laneZ - gap / 2;
    box(g, T, 1.05, a, m, x, 0.52, z0 + a / 2);
    box(g, T, 1.05, b, m, x, 0.52, z1 - b / 2);
  }
}

// ---------- étage d'un résident ----------
function removeFloor(k) {
  const f = floors.get(k);
  if (!f) return;
  f.group.traverse(o => (o.isCSS2DObject || o.isCSS3DObject) && o.element.remove());
  scene.remove(f.group);
  floors.delete(k);
}

function buildResident(apt, wing, officeTier) {
  officeTier = officeTier ?? { id: 1, open: "#2a3142", boss: "#3a3029", wood: "#573d2e", metal: "#b7a27b", deskScale: 2, chairScale: 1 };
  // Ambiance choisie par le résident : elle habille son aile principale.
  const cyber = (wing.id ?? "work") === "work" && apt.profile?.theme === "cyberpunk";
  const f = shell(cyber ? CYBER.floor : wing.floor ?? officeTier.open ?? "#232a39");
  const g = f.group;
  const wingId = wing.id ?? "work";
  Object.assign(f, {
    key: `${apt.slug}:${wingId}`, kind: "resident", residentSlug: apt.slug, wingId, wing,
    name: wingId === "work" ? apt.name : `${apt.name} · ${wing.name ?? wingId}`,
    officeTierId: officeTier.id, buildSlug: apt.slug, themeKey: themeKey(apt),
  });
  const openMat = cyber ? CYBER.open : wingId === "work" ? officeTier.open : "#2a3142";
  const bossMat = cyber ? CYBER.boss : wingId === "work" ? officeTier.boss : "#3a3029";
  const c = P(OPEN.x + OPEN.w / 2, OPEN.y + OPEN.h / 2), b = P(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2);
  box(g, OPEN.w * S, 0.03, OPEN.h * S, mat(openMat), c.x, 0.05, c.z);
  box(g, BOSS.w * S, 0.03, BOSS.h * S, mat(bossMat), b.x, 0.05, b.z);
  walls(g, OPEN, ["w", "e"]);
  walls(g, BOSS, ["w"]);
  f.roomTags = [label(g, "Open space", "room-tag", P(OPEN.x, 0).x + 0.25, 0.08, P(0, OPEN.y).z + 0.4),
    label(g, `Bureau de ${esc(apt.name)}`, "room-tag", P(BOSS.x, 0).x + 0.25, 0.08, P(0, BOSS.y).z + 0.4)];
  // Le nom du résident en grand sur l'aile principale ; les autres ailes affichent leur enseigne.
  if (wingId === "work") {
    sign(g, apt.name.toUpperCase(), 11, 1.7, { color: apt.profile?.accent ?? "#f1cd85", font: "700 130px Sora, sans-serif", w: 1024, h: 160 }, 0, 3.55, -6.42);
  } else if (wing.sign) {
    sign(g, wing.sign, 5, 1.1, { color: wing.accent ?? "#9ab4ff", font: "700 90px Sora, sans-serif", w: 720, h: 140 }, 0, 3.35, -6.35);
  }
  const accent = apt.profile?.accent ?? wing.accent ?? "#f1cd85";
  f.accentGlow = box(g, 7, 0.06, 0.06, glow(accent, 0.75 + officeTier.id * 0.12), 0, 2.6, -6.42);
  f.profileAccent = accent;
  if (wingId === "ops") {
    for (const [cx, cy] of [[720, 120], [820, 280], [740, 440]]) {
      const p = P(cx, cy);
      box(g, 1.2, 1.8, 0.8, mat("#1a2e28"), p.x, 0.9, p.z);
      for (let r = 0; r < 3; r++) box(g, 0.08, 0.08, 0.08, glow("#2fb898", 1.2), p.x - 0.3 + r * 0.3, 1.5 + (r % 2) * 0.12, p.z + 0.35);
    }
  }
  if (wingId === "lab") {
    for (const [cx, cy] of [[140, 140], [520, 480]]) {
      const p = P(cx, cy);
      cyl(g, 0.35, 0.05, glow(wing.accent ?? "#5b7cfa", 1.5), p.x, 1.05, p.z, 14);
    }
  }
  if (wingId === "studio") {
    sign(g, "FOCUS", 2.2, 0.35, { color: "#6b9cff", font: "700 48px Sora, sans-serif", blur: 8 }, P(820, 300).x, 2.8, P(820, 300).z);
  }

  // Open space : 12 postes. L'agent s'assoit au nord du bureau, face à son écran (vers la caméra).
  f.screens = DESKS.map(d => {
    const dc = P(d.cx, d.cy), ch = P(d.cx, d.cy - 52);
    const ds = wingId === "work" ? officeTier.deskScale : 2;
    const cs = wingId === "work" ? officeTier.chairScale : 1;
    put(g, "desk", dc.x, dc.z, Math.PI, ds);
    put(g, "computerScreen", dc.x - 0.15, dc.z - 0.05, Math.PI, 2, 0.76);
    if (officeTier.dualScreen && wingId === "work") put(g, "computerScreen", dc.x + 0.22, dc.z - 0.05, Math.PI, 1.85, 0.76);
    put(g, "computerKeyboard", dc.x - 0.15, dc.z - 0.35, Math.PI, 2, 0.76);
    put(g, "chairDesk", ch.x, ch.z, 0, cs);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.42), mat("#1d2433"));
    screen.position.set(dc.x - 0.15, 1.06, dc.z - 0.17);
    screen.rotation.y = Math.PI;
    g.add(screen);
    return screen;
  });
  if (officeTier.openRug && wingId === "work") put(g, "rugRound", c.x, c.z, 0, 5.5);
  const plantSpots = [[620, 40], [40, 580], [620, 580], [320, 40], [320, 580], [40, 40]];
  for (const [x, y] of plantSpots.slice(0, Math.min(plantSpots.length, 2 + officeTier.id))) put(g, "pottedPlant", P(x, y).x, P(x, y).z, 0, 2.4);
  if (officeTier.bookcase && wingId === "work") {
    put(g, "bookcaseOpen", P(40, 120).x, P(40, 120).z, Math.PI / 2, 2.8);
    put(g, "bookcaseOpen", P(600, 520).x, P(600, 520).z, -Math.PI / 2, 2.8);
  }

  // Poste de direction : plateau et finitions selon le tier XP.
  const bd = P(820, 220), leather = mat("#222c30", { roughness: 0.8 });
  const wood = mat(officeTier.wood), metal = mat(officeTier.metal, { metalness: 0.7, roughness: 0.35 });
  put(g, "rugRectangle", bd.x, bd.z + 0.1, 0, 4);
  box(g, 4.2, 0.12, 1.55, wood, bd.x, 0.9, bd.z);
  box(g, 4.24, 0.025, 1.59, metal, bd.x, 0.83, bd.z);
  // Deux caissons et un voile de façade laissent la place aux jambes au centre.
  for (const dx of [-1.65, 1.65]) {
    box(g, 0.65, 0.79, 1.3, wood, bd.x + dx, 0.435, bd.z);
    for (const y of [0.27, 0.5, 0.73]) box(g, 0.26, 0.025, 0.035, metal, bd.x + dx, y, bd.z - 0.67);
  }
  box(g, 2.65, 0.42, 0.06, wood, bd.x, 0.56, bd.z + 0.59);
  box(g, 2.2, 0.015, 0.62, leather, bd.x, 0.97, bd.z - 0.28);
  // Trois écrans incurvés vers le chef ; les tableaux affichés sont décoratifs.
  for (let k = 0; k < 3; k++) {
    const monitor = new THREE.Group();
    monitor.position.set(bd.x + (k - 1) * 1.02, 0.97, bd.z + (k === 1 ? 0.25 : 0.1));
    monitor.rotation.y = Math.PI + (k - 1) * 0.32;
    g.add(monitor);
    box(monitor, 0.32, 0.03, 0.25, mat("#171c24"), 0, 0.015, 0);
    cyl(monitor, 0.025, 0.22, metal, 0, 0.13, 0, 8);
    box(monitor, 1.02, 0.62, 0.055, mat("#111822"), 0, 0.49, 0);
    const c = document.createElement("canvas"); c.width = 1024; c.height = 640;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#0c1520"; ctx.fillRect(0, 0, 1024, 640);
    ctx.fillStyle = "#d3e1eb"; ctx.font = "bold 34px sans-serif";
    ctx.fillText(["MARCHÉS", "XAUUSD · M5", "CARNET D’ORDRES"][k], 32, 52);
    ctx.fillStyle = "#8298aa"; ctx.font = "22px monospace"; ctx.fillText("DÉMO · DONNÉES FICTIVES", 32, 92);
    if (k === 0) {
      ctx.fillStyle = "#8298aa"; ctx.fillText("SYMBOLE       PRIX       VAR.", 36, 152);
      ["XAUUSD", "EURUSD", "GBPUSD", "BTCUSD", "ETHUSD", "NASDAQ"].forEach((name, r) => {
        const y = 210 + r * 64;
        ctx.fillStyle = r % 2 ? "#152433" : "#101e2c"; ctx.fillRect(24, y - 35, 976, 56);
        ctx.fillStyle = "#d3e1eb"; ctx.font = "bold 28px monospace"; ctx.fillText(name, 42, y);
        ctx.fillText(["2 450,50", "1,0852", "1,2714", "68 250", "3 420", "19 850"][r], 310, y);
        ctx.fillStyle = r % 3 ? "#57c9ab" : "#ec7d87";
        ctx.fillText(r % 3 ? "+0,84 %" : "−0,32 %", 660, y);
      });
    } else if (k === 1) {
      ctx.strokeStyle = "#233342"; ctx.lineWidth = 2;
      for (let r = 0; r < 6; r++) { ctx.beginPath(); ctx.moveTo(30, 145 + r * 65); ctx.lineTo(990, 145 + r * 65); ctx.stroke(); }
      for (let i = 0; i < 36; i++) {
        const x = 44 + i * 26, mid = 360 - i * 3 + Math.sin(i * 0.7) * 55;
        const up = Math.sin(i * 1.7) > -0.2;
        ctx.fillStyle = ctx.strokeStyle = up ? "#57c9ab" : "#ec7d87";
        ctx.beginPath(); ctx.moveTo(x, mid - 30); ctx.lineTo(x, mid + 42); ctx.stroke();
        ctx.fillRect(x - 7, mid - (up ? 15 : 2), 14, 22 + i % 4 * 4);
        ctx.globalAlpha = 0.5; ctx.fillRect(x - 7, 570 - (i * 17 % 65), 14, 20 + i * 17 % 65); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = "#e3bf78"; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < 36; i++) { const x = 44 + i * 26, y = 385 - i * 3 + Math.sin(i * 0.23) * 18; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    } else {
      ctx.font = "25px monospace"; ctx.fillStyle = "#8298aa"; ctx.fillText("VOLUME       PRIX       VOLUME", 34, 145);
      for (let r = 0; r < 10; r++) {
        const y = 195 + r * 37;
        ctx.globalAlpha = 0.22; ctx.fillStyle = r < 5 ? "#ec7d87" : "#57c9ab";
        ctx.fillRect(40, y - 25, 200 + (r * 67 % 580), 31); ctx.globalAlpha = 1;
        ctx.fillStyle = r < 5 ? "#ec7d87" : "#57c9ab";
        ctx.fillText(`${(r + 1) * 12}          ${(2451 - r * 0.1).toFixed(2)}          ${(10 - r) * 8}`, 50, y);
      }
    }
    if (cyber) neonScreen(c, screenTexts(apt)[k], k);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.54), new THREE.MeshBasicMaterial({ map: texture }));
    screen.position.set(0, 0.49, 0.03); monitor.add(screen);
    if (cyber) (f.bossScreens ??= []).push({ c, texture, k });
  }
  put(g, "computerKeyboard", bd.x - 0.15, bd.z - 0.38, Math.PI, 2, 0.98);
  box(g, 0.09, 0.04, 0.14, mat("#303b42"), bd.x + 0.65, 1.0, bd.z - 0.4);
  // Téléphone, porte-stylos, dossiers, mug et lampe de travail.
  box(g, 0.3, 0.06, 0.22, mat("#172029"), bd.x - 1.6, 0.99, bd.z - 0.35);
  box(g, 0.26, 0.08, 0.065, mat("#38464f"), bd.x - 1.6, 1.05, bd.z - 0.35);
  cyl(g, 0.07, 0.14, metal, bd.x + 1.65, 1.04, bd.z - 0.42, 12);
  for (let k = 0; k < 3; k++) cyl(g, 0.008, 0.23, mat("#203344"), bd.x + 1.62 + k * 0.03, 1.14, bd.z - 0.42, 5);
  for (let k = 0; k < 3; k++) box(g, 0.42, 0.025, 0.3, mat(["#36555a", "#e0cfaa", "#80514c"][k]), bd.x + 1.5, 0.98 + k * 0.03, bd.z + 0.2);
  cyl(g, 0.065, 0.13, mat("#eee2ca"), bd.x + 1.04, 1.04, bd.z - 0.42, 12);
  cyl(g, 0.12, 0.025, metal, bd.x - 1.75, 0.98, bd.z + 0.2);
  cyl(g, 0.015, 0.48, metal, bd.x - 1.75, 1.23, bd.z + 0.2, 8);
  box(g, 0.42, 0.05, 0.16, glow("#ffe0aa", 0.8), bd.x - 1.6, 1.48, bd.z + 0.2);
  box(g, 0.9, 0.17, 0.07, leather, bd.x + 0.9, 1.05, bd.z + 0.65);
  sign(g, "DIRECTION", 0.8, 0.13, { color: "#efcf91", font: "700 64px Sora, sans-serif", blur: 1 }, bd.x + 0.9, 1.05, bd.z + 0.69);
  // Fauteuil de patron construit autour du bassin assis, sans dossier au milieu du robot.
  const chair = P(820, 165);
  cyl(g, 0.055, 0.4, metal, chair.x, 0.28, chair.z, 12);
  for (let k = 0; k < 5; k++) {
    const leg = new THREE.Group(); leg.position.set(chair.x, 0.08, chair.z); leg.rotation.y = k * Math.PI * 2 / 5; g.add(leg);
    box(leg, 0.055, 0.05, 0.43, metal, 0, 0, 0.16);
    cyl(leg, 0.055, 0.05, mat("#151b22"), 0, -0.02, 0.37, 10).rotation.z = Math.PI / 2;
  }
  box(g, 0.85, 0.13, 0.7, leather, chair.x, 0.545, chair.z);
  box(g, 0.85, 0.88, 0.14, leather, chair.x, 1.02, chair.z - 0.4);
  box(g, 0.53, 0.22, 0.17, leather, chair.x, 1.5, chair.z - 0.39);
  for (const dx of [-0.48, 0.48]) {
    box(g, 0.04, 0.32, 0.04, metal, chair.x + dx, 0.71, chair.z + 0.05);
    box(g, 0.14, 0.07, 0.46, leather, chair.x + dx, 0.89, chair.z);
  }
  if (officeTier.execChair) put(g, "loungeChairRelax", P(760, 165).x, P(760, 165).z, Math.PI / 2, 2.2);
  if (officeTier.bossLamp) put(g, "lampSquareFloor", bd.x - 1.2, bd.z + 0.55, Math.PI / 4, 2.2);
  if (officeTier.bossTv) put(g, "televisionModern", bd.x + 1.55, bd.z - 0.15, Math.PI, 2.4);
  if (officeTier.coatRack) put(g, "coatRackStanding", P(700, 80).x, P(700, 80).z, 0, 2.5);
  if (officeTier.speaker) put(g, "speaker", bd.x + 1.9, bd.z + 0.45, -Math.PI / 2, 2.2);
  f.owner = makeRobot("#e8c27a");
  // Fauteuil : coussin à 0,61 m ; bassin Sitting à 0,24 m.
  f.owner.position.copy(P(820, 175, 0.37));
  g.add(f.owner);
  f.ownerTag = label(g, `<b>${esc(apt.name)}</b>`, "owner-tag", f.owner.position.x, 2.0, f.owner.position.z);
  // Livres et rétroéclairage discret des bibliothèques du chef.
  for (const x of [700, 760]) {
    const shelf = P(x, 34);
    put(g, "bookcaseOpen", shelf.x, shelf.z, 0, 2.6);
    for (const h of [0.36, 0.98, 1.61]) {
      for (let k = 0; k < 5; k++)
        box(g, 0.09, 0.24 + (k % 2) * 0.07, 0.18,
          mat(["#36555a", "#c9a86a", "#70433f", "#d2c4ac", "#273543"][k]),
          shelf.x - 0.27 + k * 0.13, h + 0.13, shelf.z + 0.12);
      box(g, 0.74, 0.025, 0.025, glow("#ffd8a0", 0.9), shelf.x, h + 0.4, shelf.z - 0.16);
      // Halo diffus derrière les livres, sans ajouter de lumière dynamique.
      box(g, 0.74, 0.33, 0.01, new THREE.MeshBasicMaterial({ color: "#ffd8a0", transparent: true, opacity: 0.12, depthWrite: false }),
        shelf.x, h + 0.2, shelf.z - 0.18);
    }
  }
  // Console de récompenses : chaque objet repose sur un support, à la place de la télé suspendue.
  const awardSpot = P(930, 52);
  const awardMetal = mat("#c4a465", { metalness: 0.85, roughness: 0.25 });
  const awardStone = mat("#192025", { roughness: 0.25 });
  for (const dx of [-0.72, 0.72]) for (const dz of [-0.22, 0.22])
    cyl(g, 0.025, 0.18, awardMetal, awardSpot.x + dx, 0.15, awardSpot.z + dz, 10);
  box(g, 1.7, 0.62, 0.64, wood, awardSpot.x, 0.54, awardSpot.z);
  box(g, 1.76, 0.07, 0.7, awardStone, awardSpot.x, 0.885, awardSpot.z);
  for (const dx of [-0.42, 0.42]) {
    box(g, 0.8, 0.54, 0.025, wood, awardSpot.x + dx, 0.55, awardSpot.z + 0.333);
    box(g, 0.12, 0.02, 0.025, awardMetal, awardSpot.x + dx, 0.66, awardSpot.z + 0.353);
  }
  // Coupe ouverte, anses, pied et socle en pierre.
  box(g, 0.48, 0.11, 0.36, awardStone, awardSpot.x, 0.975, awardSpot.z);
  cyl(g, 0.13, 0.045, awardMetal, awardSpot.x, 1.055, awardSpot.z, 24);
  cyl(g, 0.045, 0.23, awardMetal, awardSpot.x, 1.185, awardSpot.z, 16);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.07, 0.28, 32, 1, true),
    mat("#c4a465", { metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide }));
  cup.position.set(awardSpot.x, 1.43, awardSpot.z); g.add(cup);
  for (const dx of [-0.23, 0.23]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 24), awardMetal);
    handle.position.set(awardSpot.x + dx, 1.44, awardSpot.z); g.add(handle);
  }
  sign(g, "EXCELLENCE", 0.38, 0.065, { color: "#e6ca91", font: "700 64px Sora, sans-serif", blur: 0 }, awardSpot.x, 0.98, awardSpot.z + 0.185);
  // Livres de collection et petit objet de collection sur le même plateau.
  for (let k = 0; k < 2; k++) box(g, 0.28, 0.045, 0.34, mat(k ? "#52615b" : "#b09a75"), awardSpot.x - 0.58, 0.945 + k * 0.045, awardSpot.z);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.12),
    mat("#bbd8d7", { metalness: 0.2, roughness: 0.15 }));
  crystal.position.set(awardSpot.x - 0.58, 1.13, awardSpot.z); g.add(crystal);
  cyl(g, 0.1, 0.025, awardStone, awardSpot.x + 0.58, 0.935, awardSpot.z, 20);
  cyl(g, 0.065, 0.14, mat("#eee2c8", { emissive: "#e8b56a", emissiveIntensity: 0.15 }), awardSpot.x + 0.58, 1.017, awardSpot.z, 20);
  box(g, 1.5, 0.018, 0.025, glow("#ffdda4", 0.6), awardSpot.x, 0.845, awardSpot.z + 0.34);
  // Grand frigo vitré entre la bibliothèque et le trophée, en retrait du bureau.
  const fridge = new THREE.Group(); fridge.position.copy(P(835, 55)); g.add(fridge);
  const fridgeBlue = mat("#133b86", { metalness: 0.45, roughness: 0.35 });
  const fridgeSilver = mat("#c6cfda", { metalness: 0.7, roughness: 0.3 });
  for (const x of [-0.5, 0.5]) for (const z of [-0.34, 0.34]) cyl(fridge, 0.055, 0.06, fridgeSilver, x, 0.08, z, 8);
  box(fridge, 1.24, 0.15, 0.95, fridgeBlue, 0, 0.16, 0);
  box(fridge, 1.24, 0.12, 0.95, fridgeBlue, 0, 2.62, 0);
  box(fridge, 1.12, 2.3, 0.06, mat("#d4e1ea"), 0, 1.4, -0.44);
  for (const x of [-0.59, 0.59]) box(fridge, 0.08, 2.4, 0.95, fridgeBlue, x, 1.4, 0);
  box(fridge, 1.12, 0.36, 0.08, mat("#eaf0f5"), 0, 2.4, 0.47);
  sign(fridge, "Red Bull", 1.02, 0.29, { color: "#df233e", font: "700 80px Sora, sans-serif", blur: 0 }, 0, 2.4, 0.52);
  const fridgeGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.96), new THREE.MeshBasicMaterial({ color: "#c7e8ff", transparent: true, opacity: 0.035, depthWrite: false }));
  fridgeGlass.position.set(0, 1.26, 0.49); fridge.add(fridgeGlass);
  for (const x of [-0.55, 0.55]) {
    box(fridge, 0.035, 2.05, 0.035, fridgeSilver, x, 1.26, 0.5);
    box(fridge, 0.018, 1.92, 0.018, glow("#d4edff", 1.2), x * 0.91, 1.26, 0.4);
  }
  for (const y of [0.24, 2.27]) box(fridge, 1.12, 0.035, 0.035, fridgeSilver, 0, y, 0.5);
  box(fridge, 0.035, 0.64, 0.055, fridgeSilver, 0.44, 1.24, 0.55);
  for (let k = 0; k < 7; k++) box(fridge, 0.78, 0.012, 0.02, mat("#101d36"), 0, 0.09 + k * 0.018, 0.49);
  const cans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 16), mat("#ffffff", { metalness: 0.1, roughness: 0.5 }), 40);
  const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.061, 0.061, 0.012, 16), fridgeSilver, 40);
  const canMatrix = new THREE.Matrix4();
  for (let row = 0; row < 5; row++) {
    const shelfY = 0.33 + row * 0.37, edition = redBullEditions[row];
    box(fridge, 1.03, 0.018, 0.78, mat("#536777"), 0, shelfY, 0);
    sign(fridge, edition.label, 0.87, 0.07, { color: "#d9ecff", font: "600 34px Sora, sans-serif", w: 256, h: 32, blur: 0 }, 0, shelfY - 0.025, 0.405);
    const photo = redBullTextures.get(edition.image);
    const faces = photo ? new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.305), new THREE.MeshBasicMaterial({ map: photo, transparent: true, alphaTest: 0.08, toneMapped: false }), 8) : null;
    for (let column = 0; column < 4; column++) for (let depth = 0; depth < 2; depth++) {
      const index = row * 8 + column * 2 + depth, x = -0.36 + column * 0.24, z = -0.17 + depth * 0.4;
      cans.setMatrixAt(index, canMatrix.makeTranslation(x, shelfY + 0.165, z));
      cans.setColorAt(index, new THREE.Color(edition.color));
      caps.setMatrixAt(index, canMatrix.makeTranslation(x, shelfY + 0.307, z));
      faces?.setMatrixAt(column * 2 + depth, canMatrix.makeTranslation(x, shelfY + 0.165, z + 0.061));
    }
    if (faces) fridge.add(faces);
  }
  fridge.add(cans, caps);

  // Salon privé : cuir, marbre noir et laiton ; meubles bas sur un tapis épais.
  const salon = P(820, 520), cognac = mat("#70432e", { roughness: 0.55 });
  const velvet = mat("#1c3734", { roughness: 0.85 });
  const gold = mat("#bba16b", { metalness: 0.8, roughness: 0.28 });
  const plush = (parent, w, h, d, material, x, y, z, radius = 0.08) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  // Tapis ivoire et charbon à double bordure, sans éclat métallique sur le textile.
  plush(g, 5.0, 0.055, 3.05, mat("#b0a58c"), salon.x, 0.09, salon.z, 0.025);
  box(g, 4.82, 0.006, 2.87, mat("#4c4a43"), salon.x, 0.121, salon.z);
  box(g, 4.69, 0.006, 2.74, mat("#242e30"), salon.x, 0.126, salon.z);
  for (let k = 0; k < 28; k++) box(g, 4.55, 0.003, 0.008, mat("#354041"), salon.x, 0.131, salon.z - 1.25 + k * 0.092);
  const seating = (x, y, angle, wide, upholstery) => {
    const seat = new THREE.Group(); seat.position.copy(P(x, y)); seat.rotation.y = angle; g.add(seat);
    const width = wide ? 2.9 : 0.95;
    for (const dx of [-width / 2 + 0.16, width / 2 - 0.16]) for (const dz of [-0.31, 0.31])
      cyl(seat, 0.035, 0.2, gold, dx, 0.22, dz, 10);
    plush(seat, width, 0.15, 0.9, upholstery, 0, 0.35, 0);
    box(seat, width - 0.1, 0.035, 0.83, gold, 0, 0.265, 0);
    const cushions = wide ? 3 : 1, inner = width - 0.32;
    for (let k = 0; k < cushions; k++) {
      const cx = -inner / 2 + inner / cushions * (k + 0.5);
      plush(seat, inner / cushions - 0.025, 0.17, 0.69, upholstery, cx, 0.49, 0.04, 0.06);
      plush(seat, inner / cushions - 0.025, 0.47, 0.18, upholstery, cx, 0.77, -0.34, 0.065);
    }
    for (const dx of [-width / 2 + 0.07, width / 2 - 0.07])
      plush(seat, 0.18, 0.37, 0.9, upholstery, dx, 0.56, 0, 0.065);
    // Petits coussins sombres, discrets et assortis aux fauteuils.
    if (wide) for (const dx of [-0.96, 0.96]) {
      const cushion = plush(seat, 0.35, 0.3, 0.12, velvet, dx, 0.73, -0.17, 0.045);
      cushion.rotation.z = dx < 0 ? -0.18 : 0.18;
    }
  };
  seating(820, 568, Math.PI, true, cognac);
  seating(710, 510, Math.PI / 2, false, velvet);
  seating(930, 510, -Math.PI / 2, false, velvet);
  // Table monolithique à plateau de marbre veiné, pied central en laiton.
  const stone = document.createElement("canvas"); stone.width = stone.height = 512;
  const paint = stone.getContext("2d"); paint.fillStyle = "#161c20"; paint.fillRect(0, 0, 512, 512);
  for (let v = 0; v < 12; v++) {
    paint.strokeStyle = v % 3 ? "#58605f" : "#ac9b78"; paint.globalAlpha = 0.45;
    paint.lineWidth = v % 3 ? 1 : 2; paint.beginPath();
    for (let y = 0; y <= 512; y += 8) {
      const x = v * 64 - 130 + y * 0.4 + Math.sin(y * 0.023 + v * 2.7) * 30;
      y ? paint.lineTo(x, y) : paint.moveTo(x, y);
    }
    paint.stroke();
  }
  const marbleTexture = new THREE.CanvasTexture(stone); marbleTexture.colorSpace = THREE.SRGBColorSpace;
  const marble = new THREE.MeshStandardMaterial({ map: marbleTexture, roughness: 0.25, metalness: 0.08 });
  const coffee = P(820, 510);
  plush(g, 1.0, 0.4, 0.48, gold, coffee.x, 0.36, coffee.z);
  plush(g, 1.85, 0.12, 0.85, marble, coffee.x, 0.62, coffee.z, 0.055);
  // Plateau de service, tasses, livre relié et petite sculpture.
  box(g, 0.64, 0.025, 0.4, gold, coffee.x + 0.36, 0.695, coffee.z);
  for (const dx of [0.2, 0.5]) {
    cyl(g, 0.085, 0.014, mat("#d9d1bb"), coffee.x + dx, 0.72, coffee.z, 20);
    cyl(g, 0.05, 0.075, mat("#eee4ce"), coffee.x + dx, 0.765, coffee.z, 16);
  }
  box(g, 0.35, 0.055, 0.45, cognac, coffee.x - 0.48, 0.715, coffee.z, 0.12);
  box(g, 0.31, 0.025, 0.4, mat("#d8cdb2"), coffee.x - 0.48, 0.755, coffee.z, 0.12);
  // Guéridon et lampadaire cylindrique à lumière chaude.
  const lamp = P(700, 580);
  cyl(g, 0.2, 0.035, marble, lamp.x, 0.15, lamp.z);
  cyl(g, 0.025, 1.85, gold, lamp.x, 1.08, lamp.z, 12);
  cyl(g, 0.28, 0.46, mat("#c8b58d", { emissive: "#e6bf7e", emissiveIntensity: 0.3, roughness: 0.9 }), lamp.x, 1.9, lamp.z, 32);
  cyl(g, 0.29, 0.025, gold, lamp.x, 1.67, lamp.z, 32);
  const salonLight = new THREE.PointLight("#ffd5a1", 5, 7, 2);
  salonLight.position.set(salon.x, 2.3, salon.z); g.add(salonLight);
  const side = P(960, 455);
  cyl(g, 0.045, 0.58, gold, side.x, 0.43, side.z, 12);
  cyl(g, 0.28, 0.05, marble, side.x, 0.75, side.z, 32);
  put(g, "plantSmall1", side.x, side.z, 0, 1.6, 0.78);
  put(g, "lampSquareFloor", P(960, 120).x, P(960, 120).z, 0, 2.2);
  put(g, "pottedPlant", P(970, 585).x, P(970, 585).z, 0, 2.3);
  f.alarm = box(g, 0.3, 0.3, 0.3, mat("#3a3f52"), P(965, 40).x, 2.2, P(965, 40).z);
  f.alarmLight = new THREE.PointLight("#ff3b3b", 0, 10, 1.6);
  f.alarmLight.position.set(bd.x, 2.4, bd.z);
  g.add(f.alarmLight);
  if (wingId === "work") placeDecor(g, f, apt);
  if (wingId === "work" && apt.profile?.tv) giantTv(f, apt.profile.tv);
  if (cyber) cyberpunk(f, apt);
  return f;
}

// Décor acheté à la boutique (economy.decor), posé dans les coins libres du bureau du résident :
// mur est (borne d'arcade, trophée, aquarium, plante), côté ouest (statue au nord, piano au sud de l'allée), néon sur la vitre du fond.
function placeDecor(g, f, apt) {
  f.decorKey = decorKeyOf(apt);
  const owned = new Set(apt.economy?.decor ?? []);
  if (!owned.size) return;
  const gold = mat("#d4af37", { metalness: 0.9, roughness: 0.22 });
  const steel = mat("#9aa3ad", { metalness: 0.8, roughness: 0.3 });
  if (owned.has("plante_xl")) {
    const p = P(958, 418);
    put(g, "pottedPlant", p.x, p.z, 0.7, 3.6);
    put(g, "pottedPlant", p.x - 0.55, p.z + 0.05, 2.1, 2.2); // une plus petite au pied, pour le coin de jungle
  }
  if (owned.has("arcade")) {
    // Borne d'arcade contre le mur est, écran tourné vers la pièce.
    const a = new THREE.Group(); a.position.copy(P(956, 215)); a.rotation.y = -Math.PI / 2; g.add(a);
    const body = mat("#2a1745", { roughness: 0.5 }), dark = mat("#120a1e");
    box(a, 0.72, 1.0, 0.62, body, 0, 0.5, 0);
    box(a, 0.72, 0.8, 0.38, body, 0, 1.4, -0.12);
    box(a, 0.76, 0.28, 0.5, body, 0, 1.94, -0.06);
    sign(a, "ARCADE", 0.68, 0.22, { color: "#ffd84a", font: "900 90px Sora, sans-serif", blur: 16 }, 0, 1.94, 0.195);
    const panel = box(a, 0.72, 0.07, 0.3, dark, 0, 1.03, 0.24); panel.rotation.x = 0.2;
    cyl(a, 0.012, 0.09, steel, -0.16, 1.11, 0.25, 8);
    const knob = new THREE.Mesh(orbGeometry, glow("#ff3b6b", 1.2)); knob.scale.setScalar(0.45); knob.position.set(-0.16, 1.16, 0.25); a.add(knob);
    ["#3ee6ff", "#ffd84a", "#ff4fd8"].forEach((c, k) => cyl(a, 0.028, 0.02, glow(c, 1.3), 0.04 + k * 0.09, 1.07, 0.24, 12));
    for (const x of [-0.37, 0.37]) box(a, 0.02, 1.95, 0.02, glow(x < 0 ? "#ff4fd8" : "#3ee6ff", 1.3), x, 1.0, 0.31);
    box(a, 0.22, 0.26, 0.01, mat("#3b2a10", { metalness: 0.6 }), 0, 0.5, 0.315);
    box(a, 0.04, 0.012, 0.012, glow("#ff9a3c", 1.5), 0, 0.55, 0.322);
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 200;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.47), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(0, 1.42, 0.075); screen.rotation.x = -0.12; a.add(screen);
    f.arcade = { ctx: canvas.getContext("2d"), tex, frame: -1 };
    drawArcade(f.arcade, 0);
  }
  if (owned.has("trophee")) {
    // Trophée doré sur une colonne de pierre, plaque tournée vers la pièce.
    const t = P(958, 263), stone = mat("#1d2228", { roughness: 0.3 });
    box(g, 0.46, 0.9, 0.46, stone, t.x, 0.45, t.z);
    box(g, 0.52, 0.05, 0.52, gold, t.x, 0.925, t.z);
    cyl(g, 0.15, 0.06, gold, t.x, 0.98, t.z, 24);
    cyl(g, 0.045, 0.3, gold, t.x, 1.16, t.z, 16);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.08, 0.4, 32, 1, true), mat("#d4af37", { metalness: 0.9, roughness: 0.22, side: THREE.DoubleSide }));
    cup.position.set(t.x, 1.5, t.z); g.add(cup);
    for (const dz of [-0.29, 0.29]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 24), gold);
      handle.position.set(t.x, 1.52, t.z + dz); handle.rotation.y = Math.PI / 2; g.add(handle);
    }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), glow("#ffe9a8", 1.4));
    star.position.set(t.x, 1.82, t.z); g.add(star);
    sign(g, "N° 1", 0.3, 0.12, { color: "#e6ca91", font: "700 72px Sora, sans-serif", blur: 2 }, t.x - 0.235, 0.66, t.z, -Math.PI / 2);
  }
  if (owned.has("aquarium")) {
    // Aquarium sur son meuble, dans la longueur du mur est ; les poissons nagent d'un bout à l'autre.
    const q = new THREE.Group(); q.position.copy(P(957, 330)); g.add(q);
    box(q, 0.52, 0.72, 1.52, mat("#2b1d16", { roughness: 0.6 }), 0, 0.36, 0);
    box(q, 0.54, 0.04, 1.54, steel, 0, 0.74, 0);
    box(q, 0.44, 0.05, 1.44, mat("#d8c38f"), 0, 0.79, 0);
    for (const [x, z, r] of [[0.08, -0.45, 0.07], [-0.1, 0.2, 0.05], [0.05, 0.5, 0.06]]) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat("#6b6f78")); rock.position.set(x, 0.84, z); q.add(rock);
    }
    for (const [x, z, h] of [[-0.12, -0.55, 0.4], [0.1, -0.2, 0.3], [-0.08, 0.35, 0.45], [0.12, 0.6, 0.28]]) cyl(q, 0.015, h, glow("#3fae5a", 0.5), x, 0.82 + h / 2, z, 6);
    const water = new THREE.MeshStandardMaterial({ color: "#1d6fa5", emissive: "#0d4a7a", emissiveIntensity: 0.7, transparent: true, opacity: 0.4, depthWrite: false });
    box(q, 0.44, 0.54, 1.44, water, 0, 1.08, 0);
    const glass = new THREE.MeshPhysicalMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    box(q, 0.5, 0.64, 1.5, glass, 0, 1.08, 0);
    box(q, 0.52, 0.05, 1.52, mat("#1a1d24"), 0, 1.42, 0);
    box(q, 0.06, 0.012, 1.3, glow("#bfe9ff", 1.4), 0, 1.39, 0);
    f.fish = ["#ff8a3c", "#ffd84a", "#4fc3ff", "#ff5d8f", "#9dff7a"].map((c, k) => {
      const fish = new THREE.Group(), m = glow(c, 0.5);
      const body = new THREE.Mesh(orbGeometry, m); body.scale.set(0.35, 0.55, 1.0); fish.add(body);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), m); tail.rotation.x = Math.PI / 2; tail.position.z = -0.085; fish.add(tail);
      q.add(fish);
      return { fish, x: -0.12 + (k % 3) * 0.12, y: 0.92 + k * 0.08, phase: k * 1.7, speed: 0.35 + k * 0.07 };
    });
  }
  if (owned.has("statue")) {
    // Statue du meilleur agent : le robot en or, figé dans un salut, sur un socle de marbre.
    const s = P(694, 135);
    box(g, 0.62, 0.5, 0.62, mat("#e8e2d4", { roughness: 0.35 }), s.x, 0.25, s.z);
    box(g, 0.68, 0.05, 0.68, gold, s.x, 0.525, s.z);
    sign(g, "MEILLEUR AGENT", 0.52, 0.08, { color: "#8a6a2a", font: "700 56px Sora, sans-serif", blur: 0, w: 512, h: 80 }, s.x, 0.3, s.z + 0.315);
    if (MODELS.robot) {
      const r = makeRobot("#d4af37"), u = r.userData;
      r.traverse(o => { if (o.isMesh) o.material = gold; });
      u.mixer.stopAllAction();
      (u.actions.Wave ?? u.actions.ThumbsUp ?? u.actions.Idle)?.reset().play();
      u.mixer.update(0.9); // pose figée : ce mélangeur n'est plus jamais avancé
      r.scale.setScalar(0.85); r.position.set(s.x, 0.55, s.z); r.rotation.y = 0.35;
      g.add(r);
    }
  }
  if (owned.has("piano")) {
    // Piano à queue au sud de l'allée, clavier vers la caméra, couvercle levé côté pièce.
    const pg = new THREE.Group(); pg.position.copy(P(707, 395)); g.add(pg);
    const lacquer = mat("#0b0b0e", { roughness: 0.18, metalness: 0.3 });
    // Contour vu de dessus (x, -z) : côté gauche droit, éclisse courbe à droite, queue arrondie.
    const outline = new THREE.Shape();
    outline.moveTo(-0.6, -0.35); outline.lineTo(0.6, -0.35); outline.lineTo(0.6, -0.05);
    outline.bezierCurveTo(0.6, 0.35, 0.1, 0.3, 0.02, 0.62);
    outline.bezierCurveTo(-0.05, 0.95, -0.6, 1.05, -0.6, 0.8);
    outline.lineTo(-0.6, -0.35);
    const caseMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.3, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 24 }), lacquer);
    caseMesh.rotation.x = -Math.PI / 2; caseMesh.position.y = 0.62; pg.add(caseMesh);
    const lidPivot = new THREE.Group(); lidPivot.position.set(-0.6, 0.95, 0); lidPivot.rotation.z = 0.5; pg.add(lidPivot);
    const lid = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.02, bevelEnabled: false, curveSegments: 24 }).translate(0.6, 0, 0), lacquer);
    lid.rotation.x = -Math.PI / 2; lidPivot.add(lid);
    const prop = cyl(pg, 0.01, 0.62, steel, 0.25, 1.2, -0.25, 6); prop.rotation.z = 0.35;
    box(pg, 1.22, 0.08, 0.26, lacquer, 0, 0.8, 0.47);
    box(pg, 1.12, 0.03, 0.17, mat("#f4f1e8", { roughness: 0.4 }), 0, 0.855, 0.48);
    const blackKeys = new THREE.InstancedMesh(boxGeometry, mat("#111114"), 36), keyMatrix = new THREE.Matrix4();
    for (let k = 0, n = 0; k < 52 && n < 36; k++) if ([0, 1, 3, 4, 5].includes(k % 7)) {
      keyMatrix.makeScale(0.012, 0.02, 0.1).setPosition(-0.56 + (k + 1) * (1.12 / 52), 0.875, 0.45);
      blackKeys.setMatrixAt(n++, keyMatrix);
    }
    pg.add(blackKeys);
    const stand = box(pg, 0.9, 0.24, 0.02, lacquer, 0, 1.08, 0.3); stand.rotation.x = -0.25;
    const sheet = box(pg, 0.36, 0.2, 0.005, mat("#f4f1e8"), 0, 1.09, 0.315); sheet.rotation.x = -0.25;
    for (const [x, z] of [[-0.5, 0.25], [0.5, 0.25], [-0.35, -0.75]]) {
      cyl(pg, 0.05, 0.62, lacquer, x, 0.31, z, 12);
      cyl(pg, 0.06, 0.04, gold, x, 0.02, z, 12);
    }
    box(pg, 0.14, 0.45, 0.06, lacquer, 0, 0.3, 0.22);
    for (const x of [-0.05, 0, 0.05]) box(pg, 0.03, 0.015, 0.08, gold, x, 0.06, 0.27);
    box(pg, 0.75, 0.07, 0.34, lacquer, 0, 0.48, 0.85);
    box(pg, 0.72, 0.05, 0.31, mat("#2b1d16", { roughness: 0.8 }), 0, 0.535, 0.85);
    for (const x of [-0.32, 0.32]) for (const z of [0.72, 0.98]) box(pg, 0.04, 0.45, 0.04, lacquer, x, 0.225, z);
  }
  if (owned.has("neon")) {
    // Néon au nom du résident, à sa couleur, sur la vitre du fond au-dessus de la console des récompenses.
    const accent = apt.profile?.accent ?? "#ff6fd8", x = 8.6, y = 2.95, z = -6.36, line = glow(accent, 2.2);
    box(g, 2.5, 0.78, 0.04, mat("#0c0e16", { roughness: 0.4 }), x, y, z - 0.03);
    for (const dy of [-0.37, 0.37]) box(g, 2.46, 0.025, 0.025, line, x, y + dy, z);
    for (const dx of [-1.23, 1.23]) box(g, 0.025, 0.76, 0.025, line, x + dx, y, z);
    sign(g, apt.name, 2.3, 0.6, { color: accent, font: "italic 700 120px Sora, sans-serif", w: 768, h: 200, blur: 36 }, x, y, z + 0.01);
  }
}

// Écran de la borne : des envahisseurs en pixels, redessinés deux fois par seconde.
function drawArcade(arcade, frame) {
  const { ctx, tex } = arcade;
  ctx.fillStyle = "#05030c"; ctx.fillRect(0, 0, 256, 200);
  const sprite = ["0011100", "0111110", "1101011", "1111111", "0101010", "1000001"];
  const shift = (frame % 8) - 4;
  ["#ff4fd8", "#3ee6ff", "#ffd84a"].forEach((c, row) => {
    ctx.fillStyle = c;
    for (let col = 0; col < 5; col++) sprite.forEach((line, sy) => [...line].forEach((bit, sx) => {
      if (bit === "1") ctx.fillRect(28 + col * 42 + shift * 3 + sx * 4, 22 + row * 34 + sy * 4, 4, 4);
    }));
  });
  ctx.fillStyle = "#4ade80"; ctx.fillRect(112 + Math.sin(frame) * 60, 172, 28, 10);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 14px monospace"; ctx.fillText(`SCORE ${String(1200 + frame * 10).padStart(5, "0")}`, 10, 196);
  tex.needsUpdate = true;
}

// ---------- télé géante ----------
// Liens normalisés par le serveur : identifiant YouTube ou chaîne Twitch, jamais une URL saisie.
function tvLinks(tv) {
  if (tv.kind === "youtube") return { url: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(tv.id)}?autoplay=1&mute=1&rel=0&loop=1&playlist=${encodeURIComponent(tv.id)}`, page: `https://www.youtube.com/watch?v=${encodeURIComponent(tv.id)}` };
  return { url: streamUrl(tv.channel), page: `https://www.twitch.tv/${encodeURIComponent(tv.channel)}` };
}
// Écran 16:9 de 4,9 m sur la vitre ouest, côté nord de l'ascenseur, cadre néon ; muet, un clic l'ouvre avec le son.
function giantTv(f, tv) {
  const g = f.group, w = 4.9, h = w * 9 / 16, y = 2.9, z = -3.42, x = -10.28, edge = glow("#ff2bd6", 1.8);
  const frame = box(g, 0.12, h + 0.24, w + 0.24, mat("#0b0d14", { metalness: 0.6, roughness: 0.3 }), x, y, z);
  box(g, 0.04, 0.04, w + 0.3, edge, x + 0.08, y + h / 2 + 0.14, z);
  box(g, 0.04, 0.04, w + 0.3, edge, x + 0.08, y - h / 2 - 0.14, z);
  for (const dz of [-1, 1]) box(g, 0.04, h + 0.32, 0.04, glow("#00e5ff", 1.8), x + 0.08, y, z + dz * (w / 2 + 0.14));
  sign(g, "ON AIR", 0.9, 0.22, { color: "#ff3b5c", font: "800 72px Sora, sans-serif", blur: 16 }, x + 0.1, y + h / 2 + 0.38, z, Math.PI / 2);
  const iframe = Object.assign(document.createElement("iframe"), { title: "Télé géante", allow: "autoplay; fullscreen; encrypted-media; picture-in-picture" });
  Object.assign(iframe.style, { width: "1280px", height: "720px", border: "0", background: "#000", backfaceVisibility: "hidden" });
  const view = new CSS3DObject(iframe);
  // Le lecteur laisse passer les clics vers la 3D (CSS3DObject les réactive) : c'est l'écran qui ouvre le réglage ou la vidéo.
  iframe.style.pointerEvents = "none";
  view.position.set(x + 0.07, y, z); view.rotation.y = Math.PI / 2; view.scale.setScalar(w / 1280);
  g.add(view);
  f.tv = { frame, iframe, view, shown: "", ...tvLinks(tv) };
}

// ---------- ambiance cyberpunk ----------
// Néons magenta et cyan, sol à grille, salle serveurs, borne d'arcade et hologramme ; les écrans affichent les textes du résident.
const CYBER = { floor: "#07060f", open: "#0d0b1c", boss: "#150c24", pink: "#ff2bd6", cyan: "#00e5ff", violet: "#8b5cff" };
const themeKey = a => JSON.stringify([a.profile?.theme ?? "classique", a.profile?.screens ?? [], a.profile?.tv ?? null]);
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
    neonScreen(c, texts[0], 1);
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
    const light = new THREE.PointLight(tint, 9, 14, 1.6);
    light.position.copy(P(x, y, 3.4)); g.add(light);
    return light;
  });
  const boss = f.bossScreens ?? [];
  const target = new THREE.Vector3(), toDrone = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);

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
      const a = residents.find(x => x.slug === f.residentSlug), dnow = data?.now ?? now;

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
      fx.waves = fx.waves.filter(w => now - w < 3.2);
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
      scanBar.material = scanning ? glow(pink, 3) : glow(cyan, 2);

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

// ---------- étages communs ----------
// La télécommande : « Auto » met la première chaîne en direct de la liste (Lofi Girl, en direct 24 h/24, en dernier recours).
// La chaîne est commune à tout le penthouse : le serveur la garde, et chacun voit la même télé.
const CHANNEL_NAMES = { otplol_: "OTPLOL", lec: "LEC", riotgames: "Riot Games", kamet0: "Kameto", caedrel: "Caedrel", zerator: "ZeratoR", eslcs: "ESL CS", lofigirl: "Lofi Girl · 24 h/24" };
let liveNow = {}, tvChoice = "auto", tvBy = "", tvMine = 0; // tvMine : on ignore l'état du serveur 3 s après son propre clic
// Lien perso (idée de la branche de Quentin) : le serveur ne garde qu'une vidéo YouTube ou une chaîne Twitch normalisées.
let tvCustom = null, tvLinkOpen = false, tvLinkDraft = "", tvLinkError = "";
const tvChannel = () => tvChoice !== "auto" && tvChoice !== "custom" ? tvChoice : Object.keys(liveNow).find(c => liveNow[c]) ?? "lofigirl";
const streamUrl = c => `https://player.twitch.tv/?channel=${encodeURIComponent(c)}&parent=${location.hostname}&muted=true&autoplay=true`;
// Lien perso valide : seulement les champs normalisés (identifiant YouTube, nom de chaîne Twitch), jamais une URL saisie.
const tvCustomNow = () => {
  if (tvChoice !== "custom") return null;
  if (tvCustom?.kind === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(tvCustom.id ?? "")) return tvCustom;
  if (tvCustom?.kind === "twitch" && /^[a-z0-9_]{3,25}$/i.test(tvCustom.channel ?? "")) return tvCustom;
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
let shownUrl = "", tvFrame = null;
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
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

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
    f.fireGlow = new THREE.PointLight("#ff9c4a", 3, 5, 2);
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
    const night = new THREE.PointLight("#ffd38a", 10, 16, 1.5);
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
    tvFrame = box(g, 3.24, 1.9, 0.08, mat("#0b0d14", { metalness: 0.6, roughness: 0.3 }), tv.x, 1.75, tv.z);
    const view = new CSS3DObject(stream);
    view.position.set(tv.x, 1.75, tv.z + 0.05);
    view.scale.setScalar(3.0 / 1280);
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
    const packGeometry = new THREE.BoxGeometry(0.16, 0.29, 0.10);
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
      const side = mat(paper);
      const materials = [side, side, side, side, face, side];
      const x = pc.x - 0.285 + (i % 4) * 0.19, y = [1.59, 0.96, 0.34][Math.floor(i / 4)] + 0.145;
      for (let stock = 0; stock < 2; stock++) {
        const pack = new THREE.Mesh(packGeometry, materials);
        pack.position.set(x, y, pc.z + 0.24 - stock * 0.12); g.add(pack);
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
    for (const y of [420, 530]) put(g, "loungeDesignSofa", at(70, y).x, at(70, y).z, Math.PI / 2, 2.2);
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
  if (def.id === "casino") {
    // Casino : tables de jeu, machines à sous, bar, zone VIP - un seul espace unifié sans murs
    const carpet = mat("#4a1830");
    zone(20, 20, 980, 580, "#1a0f15");

    tag("Tables de jeu", 20, 20);
    tag("Machines à sous", 20, 300);
    tag("Bar", 800, 20);
    tag("VIP", 800, 300);
  
    // Tables de jeu (Blackjack, Roulette, Poker)
    const tablePositions = [
      [150, 120, "Blackjack"], [350, 120, "Roulette"], [550, 120, "Poker"],
      [150, 350, "Blackjack"], [350, 350, "Baccarat"], [550, 350, "Poker"]
    ];
  
    for (const [x, y, type] of tablePositions) {
      const t = at(x, y);
      // Table - base en bois
      box(g, 1.8, 0.9, 1.2, mat("#1a3a2e"), t.x, 0.45, t.z);
      // Contour doré du tapis (sous le tapis, pas glow)
      box(g, 1.85, 0.04, 1.25, mat("#b8860b", { metalness: 0.7, roughness: 0.3 }), t.x, 0.92, t.z);
      // Tapis de jeu vert (surface principale)
      box(g, 1.65, 0.025, 1.15, mat("#0d5a1f", { roughness: 0.9 }), t.x, 0.945, t.z);
      // Lignes de mise (marquages blanc discret)
      box(g, 1.4, 0.005, 0.02, mat("#ffffff", { opacity: 0.4, transparent: true }), t.x, 0.96, t.z - 0.45);
      box(g, 1.4, 0.005, 0.02, mat("#ffffff", { opacity: 0.4, transparent: true }), t.x, 0.96, t.z + 0.45);
      box(g, 0.02, 0.005, 0.9, mat("#ffffff", { opacity: 0.4, transparent: true }), t.x - 0.7, 0.96, t.z);
      box(g, 0.02, 0.005, 0.9, mat("#ffffff", { opacity: 0.4, transparent: true }), t.x + 0.7, 0.96, t.z);
      // Jetons sur la table
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        cyl(g, 0.08, 0.03, mat(i % 3 === 0 ? "#c0392b" : i % 3 === 1 ? "#27ae60" : "#2980b9"),
          t.x + Math.cos(angle) * 0.6, 0.98, t.z + Math.sin(angle) * 0.6, 12);
      }
      // Croupier
      staff(["#c98a3e", "#d9dde8", "#a37cf0", "#ff6fd8"][tablePositions.findIndex(([tx, ty]) => tx === x && ty === y) % 4], x, y + 80, Math.PI);
      // Étiquette
      sign(g, type, 1.2, 0.3, { color: "#ffd700", font: "700 60px Sora, sans-serif", blur: 8 }, t.x, 1.3, back + 0.05);
    }
  
    // Machines à sous diversifiées - moins nombreuses, différents types
    f.slotMachines = [];

    // Configuration des machines : [x, y, type, nom, themeColor]
    const machineConfigs = [
      // Rangée 1 : machines classiques (3 rouleaux)
      [150, 420, "classic", "LUCKY 7", "#ffd700"],
      [350, 420, "classic", "DIAMOND", "#44ffff"],
      [550, 420, "classic", "CHERRY", "#ff4444"],
      [750, 420, "classic", "BELL", "#ffaa00"],
      // Rangée 2 : vidéo poker / machines modernes
      [200, 500, "video", "JACKS OR BETTER", "#44ff44"],
      [400, 500, "video", "DEUCES WILD", "#ff44ff"],
      [600, 500, "video", "BONUS POKER", "#4488ff"],
      [800, 500, "video", "MEGA JACKPOT", "#ff6fd8"],
      // Rangée 3 : machines à thème (plus espacées)
      [280, 580, "themed", "PHARAOH'S GOLD", "#ffd700"],
      [520, 580, "themed", "DRAGON'S FORTUNE", "#ff4444"],
      [760, 580, "themed", "COSMIC QUEST", "#4444ff"],
    ];

    for (const [x, y, type, name, themeColor] of machineConfigs) {
      const p = at(x, y);
      const isVideo = type === "video";
      const isThemed = type === "themed";
      const height = isThemed ? 2.1 : isVideo ? 1.95 : 1.9;
      const screenH = isThemed ? 1.1 : isVideo ? 1.0 : 0.9;

      // Armoire principale selon le type
      const cabinetMat = mat("#0d0a10", { metalness: 0.3, roughness: 0.7 });
      box(g, 0.75, height, 0.55, cabinetMat, p.x, height / 2, p.z);

      // Panneau supérieur (top box)
      const topBoxH = isThemed ? 0.5 : 0.4;
      box(g, 0.78, topBoxH, 0.58, mat("#1a1020", { metalness: 0.5 }), p.x, height - topBoxH / 2, p.z);
      box(g, 0.7, 0.3, 0.04, glow(themeColor, 0.3), p.x, height - 0.05, p.z + 0.31);
      sign(g, name, 0.6, 0.2, { color: themeColor, font: "700 48px Sora, sans-serif", blur: 4 }, p.x, height - 0.05, p.z + 0.33);

      // Écran principal
      const screenY = height - topBoxH - screenH / 2 - 0.05;
      // Matériau propre à chaque machine : son écran s'allume seul quand un agent y joue.
      const screenBase = new THREE.MeshStandardMaterial({ color: "#050515", roughness: 0.1, emissive: themeColor, emissiveIntensity: 0 });
      const screen = box(g, 0.6, screenH, 0.03, screenBase, p.x, screenY, p.z + 0.29);
      box(g, 0.62, screenH + 0.02, 0.02, mat("#b8860b", { metalness: 0.8, roughness: 0.2 }), p.x, screenY, p.z + 0.28);

      // Contenu de l'écran selon le type
      const reels = [];
      const symbols = ["🍒", "🔔", "7️⃣", "⭐", "💎", "🍋", "🍊", "💰", "A♠", "K♥", "Q♦", "J♣"];
      const numReels = isVideo ? 5 : 3;
      const reelWidth = isVideo ? 0.11 : 0.15;
      const startX = p.x - (numReels - 1) * reelWidth / 2;

      for (let s = 0; s < numReels; s++) {
        const reelX = startX + s * reelWidth;
        const reelY = screenY;
        const reelZ = p.z + 0.30;
        box(g, reelWidth, screenH - 0.1, 0.015, mat("#0a0a2a"), reelX, reelY, reelZ);
        const reelSymbols = [];
        const visibleSymbols = isVideo ? 4 : 3;
        for (let v = 0; v < visibleSymbols; v++) {
          const symY = reelY + (screenH - 0.1) / 2 - 0.1 - v * (screenH - 0.1) / visibleSymbols;
          const sym = symbols[Math.floor(Math.random() * symbols.length)];
          const symMesh = sign(g, sym, reelWidth * 0.8, 0.12,
            { color: ["#ffd700", "#ff4444", "#44ff44", "#4444ff", "#ff8800", "#ff44ff"][Math.floor(Math.random() * 6)],
              font: `600 ${isVideo ? 36 : 48}px Sora, sans-serif` }, reelX, symY, reelZ + 0.01);
          reelSymbols.push(symMesh);
        }
        reels.push({ x: reelX, y: reelY, z: reelZ, symbols: reelSymbols, height: screenH - 0.1 });
      }

      // Panneau boutons
      const buttonY = 0.7;
      box(g, 0.7, 0.35, 0.05, mat("#1a1020", { metalness: 0.4 }), p.x, buttonY, p.z + 0.3);
      const btnLabels = isVideo ? ["DEAL", "HOLD", "CASH"] : ["SPIN", "BET", "CASH"];
      for (let b = 0; b < 3; b++) {
        const btnX = p.x - 0.15 + b * 0.15;
        cyl(g, 0.045, 0.06, glow(b === 0 ? "#ff4444" : b === 1 ? "#ffd700" : "#44ff44", 0.8), btnX, buttonY + 0.03, p.z + 0.33, 16);
        sign(g, btnLabels[b], 0.12, 0.05, { color: "#fff", font: "600 24px Sora, sans-serif" }, btnX, buttonY + 0.03, p.z + 0.34);
      }

      // Levier latéral (seulement pour classic)
      let leverArm = null, handle = null;
      if (!isVideo) {
        const leverBase = p.x + 0.38;
        cyl(g, 0.02, 0.05, mat("#b8860b", { metalness: 0.9 }), leverBase, 1.15, p.z + 0.05, 8);
        leverArm = cyl(g, 0.025, 0.45, mat("#c0392b", { metalness: 0.8 }), leverBase, 1.35, p.z + 0.05, 8);
        handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 8, 16), mat("#b8860b", { metalness: 0.9 }));
        handle.position.set(leverBase, 1.58, p.z + 0.05);
        handle.rotation.x = Math.PI / 2;
        g.add(handle);
      }

      // Bac à pièces
      box(g, 0.5, 0.08, 0.15, mat("#b8860b", { metalness: 0.7, roughness: 0.3 }), p.x, 0.12, p.z + 0.35);
      box(g, 0.45, 0.03, 0.1, mat("#0d0a10"), p.x, 0.18, p.z + 0.35);

      // Éclairage d'ambiance
      box(g, 0.7, 0.02, 0.5, glow(themeColor, 0.15), p.x, 0.03, p.z);

      // Décoration thème pour machines thématiques
      if (isThemed) {
        // Éléments décoratifs sur les côtés
        for (const side of [-1, 1]) {
          const decoX = p.x + side * 0.4;
          const deco = new THREE.Group();
          deco.position.set(decoX, 1.2, p.z + 0.1);
          g.add(deco);
          // Petit élément 3D décoratif
          box(deco, 0.15, 0.6, 0.15, mat(themeColor, { metalness: 0.5, emissive: themeColor, emissiveIntensity: 0.3 }), 0, 0.3, 0);
          box(deco, 0.2, 0.2, 0.2, glow(themeColor, 0.8), 0, 0.7, 0);
        }
      }

      // Stocker la machine pour animation
      f.slotMachines.push({
        pos: { x: p.x, z: p.z },
        screen,
        reels,
        lever: leverArm,
        handle,
        isPlaying: false,
        playTimer: 0,
        spinSpeed: 0,
        type,
        themeColor
      });
    }
  
    // Bar
    const bar = at(880, 150);
    box(g, 3.0, 1.1, 0.7, mat("#2a1018"), bar.x, 0.55, bar.z);
    box(g, 3.2, 0.08, 0.8, glow("#ffd700", 0.5), bar.x, 1.12, bar.z);
    // 3 tabourets centrés sur le bar (bar à x=880, largeur 3.0 -> 865 à 895)
    // at(880) = 7.6, on veut 3 tabourets vers 7.1, 7.6, 8.1 -> map: 855, 880, 905
    for (const x of [855, 880, 905]) {
      put(g, "stoolBar", at(x, 100).x, at(x, 100).z, Math.PI / 2);
    }
    staff("#2b2f3a", 940, 150, -Math.PI / 2);
    // Bouteilles
    box(g, 0.25, 0.04, 5.5, mat("#1a0a10"), at(950, 150).x, 1.6, at(950, 150).z);
    box(g, 0.25, 0.04, 5.5, mat("#1a0a10"), at(950, 150).x, 2.1, at(950, 150).z);
    for (let k = 0; k < 20; k++) {
      const p = at(950, 80 + (k % 10) * 50);
      const colors = ["#ffd700", "#c0392b", "#27ae60", "#2980b9", "#8e44ad", "#e67e22", "#1abc9c", "#34495e", "#f39c12", "#e74c3c"];
      cyl(g, 0.04, 0.3, glow(colors[k % colors.length], 0.6), p.x, k < 10 ? 1.75 : 2.25, p.z, 8);
    }
  
    // Zone VIP - au fond, sans séparation (décalée pour éviter les machines)
    for (const y of [360, 520]) put(g, "loungeDesignSofa", at(960, y).x, at(960, y).z, 0, 2.2);
    put(g, "tableCoffee", at(960, 440).x, at(960, 440).z, 0, 2);
    sign(g, "VIP", 1.4, 0.5, { color: "#ffd700", font: "700 90px Sora, sans-serif", w: 256 }, at(970, 300).x, 2.2, at(0, 300).z);
  
    // Champagne et cocktails
    const champagne = at(960, 440);
    cyl(g, 0.14, 0.22, mat("#8995a7", { metalness: 0.8, roughness: 0.25 }), champagne.x, 0.85, champagne.z);
    cyl(g, 0.055, 0.4, mat("#294a36"), champagne.x, 1.02, champagne.z, 12);
    for (const dx of [-0.3, 0.3]) {
      cyl(g, 0.015, 0.18, mat("#c5dfeb"), champagne.x + dx, 0.87, champagne.z);
      cyl(g, 0.06, 0.12, mat("#eed18a"), champagne.x + dx, 1.02, champagne.z, 12);
    }
  
    // Cocktails sur le bar
    for (const y of [80, 180, 280, 380, 480]) {
      const p = at(880, y);
      cyl(g, 0.06, 0.18, mat("#b8dce8", { transparent: true, opacity: 0.6 }), p.x, 1.24, p.z, 12);
      cyl(g, 0.05, 0.09, glow(y % 2 === 0 ? "#ee966e" : "#9fd67b", 0.4), p.x, 1.22, p.z, 12);
      box(g, 0.015, 0.2, 0.015, mat("#f3e5c4"), p.x + 0.025, 1.35, p.z).rotation.z = 0.25;
    }
  
    // Lumières d'ambiance néon
    f.neons = [];
    for (let i = 0; i < 8; i++) {
      const colors = ["#ff6fd8", "#7ec3f0", "#ffd36e", "#4ade80", "#ff4d6d", "#a37cf0", "#ff8800", "#44ff44"];
      const neon = box(g, 4, 0.15, 0.05, glow(colors[i], 1.2), 400, 1.5 + i * 0.4, -5.9);
      neon.rotation.y = Math.PI / 2;
      f.neons.push({ mesh: neon, color: colors[i], phase: i * 0.5 });
    }
  
    // Machines à fumée
    f.haze = [200, 700].map(x => {
      const p = at(x, 80);
      box(g, 0.45, 0.25, 0.6, mat("#181b29"), p.x, 0.23, p.z);
      return ambientSmoke(g, P(x, 90, 0.4), "#ae92d1", 20, 1.0, 1.2);
    });
  
    // Vigile à l'entrée
    staff("#15171f", 100, 240, Math.PI / 2);
  
    // Pas de garde-corps : espace casino entièrement ouvert pour dégager machines à sous et ascenseur
  
    // Panneau d'entrée
    sign(g, "CASINO", 4, 1, { color: "#ffd700", font: "900 120px Sora, sans-serif", blur: 20 }, 0, 3.5, -5.8);
  }
  return f;
}

// ---------- les personnages : le robot animé de Quaternius (CC0), recoloré selon l'outil ----------
const ONCE = new Set(["Sitting", "Standing", "Death"]);
function makeRobot(color) {
  const t = MODELS.robot;
  const g = new THREE.Group();
  const r = cloneSkinned(t.scene);
  r.scale.setScalar(t.scale);
  r.traverse(o => {
    if (o.isMesh && o.material?.name === "Main") { o.material = o.material.clone(); o.material.color.set(color); o.userData.tourMaterial = true; }
    if (o.isMesh) o.frustumCulled = false; // les maillages animés sortent de leur boîte d'origine
  });
  g.add(r);
  const mixer = new THREE.AnimationMixer(r);
  const actions = Object.fromEntries(t.animations.map(clip => {
    const a = mixer.clipAction(clip);
    if (ONCE.has(clip.name)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    return [clip.name, a];
  }));
  Object.assign(g.userData, { mixer, actions, anim: null });
  play(g, "Idle");
  return g;
}

// Passe d'une animation à l'autre en fondu.
function play(g, name) {
  const u = g.userData;
  if (u.anim === name || !u.actions[name]) return;
  u.actions[name].reset().fadeIn(0.35).play();
  if (u.anim) u.actions[u.anim].fadeOut(0.35);
  u.anim = name;
}

const ringGeometry = new THREE.TorusGeometry(0.42, 0.035, 8, 36);
const orbGeometry = new THREE.SphereGeometry(0.07, 12, 8);
const puffGeometry = new THREE.SphereGeometry(0.08, 8, 6);
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
  const el = document.createElement("div");
  el.className = "bubble3d";
  const bubble = new CSS2DObject(el);
  bubble.position.set(0, 2.1, 0);
  g.add(bubble);
  Object.assign(g.userData, { key, ring, orb, puffs, cup, bubble, path: [], floor: null, place: null, slot: null, dir: 0, wait: 0, seed: (hash(key) % 1000) / 1000 });
  return g;
}

// Chemin sur un étage : rejoindre l'allée centrale, la suivre, puis gagner sa place.
// Chemin sur un étage : ressortir par l'approche de sa place, suivre l'allée centrale, entrer par l'approche de la nouvelle.
const lane = x => new THREE.Vector3(x, 0, P(0, LANE).z);
const leave = (from, way) => { const back = [...way].reverse(); return [...back, lane((back.at(-1) ?? from).x)]; };
const enter = (to, way) => [lane((way[0] ?? to).x), ...way, to];

// ---------- la tour ----------
const floors = new Map(); // clé (slug du résident ou id d'étage commun) -> étage
const agents = new Map(); // clé d'agent -> robot
let order = [], focus = 0, data = null, residents = [];
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();

function syncFloors(list) {
  residents = list;
  const residentKeys = list.flatMap(a => wingsOf(a).map(w => `${a.slug}:${w.id}`));
  order = [...SHARED.filter(d => d.top).map(d => d.id), ...residentKeys, ...SHARED.filter(d => !d.top).map(d => d.id)];
  for (const a of list) {
    for (const w of wingsOf(a)) {
      const k = `${a.slug}:${w.id}`;
      const tier = w.id === "work" ? officeTierForLevel(a.game?.level ?? 1) : null;
      const prev = floors.get(k);
      if (!prev) {
        floors.set(k, buildResident(a, w, tier ?? undefined));
      } else if (w.id === "work" && (prev.officeTierId !== tier.id || prev.decorKey !== decorKeyOf(a) || prev.themeKey !== themeKey(a))) {
        // Palier d'aménagement, décor acheté ou ambiance : l'étage est reconstruit, ses agents passent dans le nouveau.
        for (const [, g] of agents) if (g.userData.floor === k) prev.group.remove(g);
        removeFloor(k);
        floors.set(k, buildResident(a, w, tier));
        floors.get(k).group.position.y = prev.group.position.y; // reste en place, sans glisser depuis le haut
        for (const [, g] of agents) if (g.userData.floor === k) floors.get(k).group.add(g);
      }
    }
  }
  for (const d of SHARED) if (!floors.has(d.id)) floors.set(d.id, buildShared(d));
  for (const [k, f] of floors) if (!order.includes(k)) {
    f.group.traverse(o => (o.isCSS2DObject || o.isCSS3DObject) && o.element.remove());
    scene.remove(f.group);
    floors.delete(k);
  }
  order.forEach((k, i) => { floors.get(k).baseY = -i * FLOOR_H; });
  focus = Math.max(0, Math.min(focus, order.length - 1));
}

function floorLabel(i) {
  const f = floors.get(order[i]);
  if (f.kind === "shared") return f.def.icon;
  if (f.wingId === "work" && f.residentSlug === residents[0]?.slug) return "PH";
  return f.wing?.icon ?? "🏢";
}

function update(now) {
  // Placement : chaque (étage, pièce) remplit ses places dans l'ordre d'arrivée des agents, tous résidents confondus.
  const want = new Map(), groups = new Map();
  for (const a of residents) for (const s of a.sessions) {
    const key = keyOf(a.slug, s), u = agents.get(key)?.userData, state = stateOf(s, now);
    const paused = ["fini", "fermé", "silencieux"].includes(state), seed = hash(key);
    let place = placeOf(s, now), visit = paused ? breakVisit(hash(`${s.src}:${s.host}:${s.sid}`), now - s.updated, state === "silencieux").visit : null;
    // Un agent termine son trajet de pause avant de choisir une autre destination.
    if (paused && u?.path.length && u.state === state && u.s.updated === s.updated) { place = u.place; visit = u.pauseVisit; }
    const floor = homeFloor(a, s, place, FLOOR_OF);
    const k = floor + "/" + place;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ a, s, key, floor, place, paused, seed, visit });
  }
  for (const list of groups.values()) {
    list.sort((x, y) => x.s.started - y.s.started);
    const deskSlots = list[0]?.place === "open" ? assignDeskSlots(list.map(w => w.key),
      new Map(list.flatMap(w => {
        const u = agents.get(w.key)?.userData;
        return u?.place === "open" && u.target === w.floor ? [[w.key, u.index]] : [];
      }))) : null;
    const pauseSlots = list[0]?.paused ? assignPauseSlots(list.map(w => ({ key: w.key, seed: w.seed, visit: w.visit, moving: !!agents.get(w.key)?.userData.path.length })),
      new Map(list.flatMap(w => {
        const u = agents.get(w.key)?.userData;
        return u?.place === w.place && u.target === w.floor ? [[w.key, { index: u.index, visit: u.pauseVisit }]] : [];
      })), SHARED_SLOTS[list[0].place].length) : null;
    list.forEach((w, position) => {
      const k = deskSlots?.get(w.key) ?? pauseSlots?.get(w.key) ?? position;
      const [x, y, facing, anim, way = []] = slotOf(RES_SLOTS[w.place] ?? SHARED_SLOTS[w.place], k);
      const slot = P(x, y, w.place === "rest" && k % 3 < 2 ? 0.36 : 0);
      if (w.place === "open" && anim === "Sitting") {
        // Chaise de bureau ×2 : coussin à 0,47 m ; bassin Sitting à 0,24 m.
        slot.y = 0.23;
        slot.z += 0.20;
      }
      if (w.place === "cafe" && anim === "Sitting") {
        // Coussin à 0,48 m, bassin Sitting à 0,24 m ; la racine est 0,20 m devant le bassin.
        slot.y = 0.24;
        slot.x += Math.sin(facing) * 0.20;
        slot.z += Math.cos(facing) * 0.20;
      }
      want.set(w.key, { ...w, slot, facing, anim, way: way.map(([wx, wy]) => P(wx, wy)), index: k });
    });
  }

  for (const [key, w] of want) {
    let g = agents.get(key);
    const u0 = g?.userData;
    if (!g) {
      // Un nouvel agent sort de l'ascenseur de son étage.
      g = makeAgent(key, w.s);
      floors.get(w.floor).group.add(g);
      g.position.copy(ELEV);
      Object.assign(g.userData, { floor: w.floor, path: enter(w.slot, w.way) });
      agents.set(key, g);
    } else if (u0.target !== w.floor || u0.place !== w.place || !u0.slot.equals(w.slot)) {
      // Même étage : il marche jusqu'à sa nouvelle place. Sinon : ascenseur, changement d'étage, puis sa place.
      u0.path = u0.floor === w.floor ? [...leave(g.position, u0.way), ...enter(w.slot, w.way)]
        : [...leave(g.position, u0.way), ELEV.clone(), { toFloor: w.floor }, ...enter(w.slot, w.way)];
    }
    const u = g.userData, st = stateOf(w.s, now);
    Object.assign(u, { s: w.s, apt: w.a, state: st, place: w.place, pauseVisit: w.visit, slot: w.slot, slotFacing: w.facing, slotAnim: w.anim, way: w.way, index: w.index, target: w.floor });
    u.ring.material.color.set(STATE_COLOR[st] ?? "#8b93a7");
    // Bulle : l'action au poste, la demande d'accord chez le résident, sinon à qui appartient l'agent.
    // Au repos, l'icône du grade de l'employé (économie du résident) précède son nom.
    const T = TOOLS[w.s.src] ?? { name: w.s.src }, grade = staffOf(w.a, w.s.src)?.grade?.icon;
    const text = st === "travaille" ? w.s.action : st === "autorisation" ? "Autorise-moi ?" : st === "erreur" ? "Erreur"
      : `${grade ? grade + " " : ""}${w.a.name} · ${T.name}`;
    u.bubble.element.textContent = text;
    u.bubble.element.className = "bubble3d" + (st === "autorisation" ? " auth" : "") + (st === "travaille" || st === "autorisation" || st === "erreur" ? "" : " who");
  }
  for (const [key, g] of agents) if (!want.has(key)) {
    const u = g.userData, materials = new Set([u.ring.material, ...u.puffs.map(p => p.material)]), skeletons = new Set();
    g.traverse(o => { if (o.userData.tourMaterial) materials.add(o.material); if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    for (const material of materials) material.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    u.mixer.stopAllAction(); u.mixer.uncacheRoot(g.children[0]);
    u.bubble.element.remove(); g.remove(u.bubble);
    g.parent?.remove(g);
    agents.delete(key);
  }

  // Écrans allumés aux postes occupés, alarme chez le résident quand un agent attend son accord
  for (const a of residents) {
    for (const w of wingsOf(a)) {
      const fk = `${a.slug}:${w.id}`;
      const f = floors.get(fk);
      if (!f?.screens) continue;
      const busy = new Set();
      for (const row of groups.get(`${fk}/open`) ?? []) {
        const wnt = want.get(row.key);
        if (wnt) busy.add(wnt.index);
      }
      f.screens.forEach((sc, k) => { sc.material = busy.has(k) ? f.busyScreen ?? glow("#4fb6ff", 1.4) : f.idleScreen ?? mat("#1d2433"); });
    }
    const fw = floors.get(`${a.slug}:work`);
    if (fw) fw.alert = (groups.get(`${a.slug}:work/boss`) ?? []).length > 0;
  }


}

// ---------- animation ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let lastFrameAt = 0;
const tourTarget = new THREE.Vector3(), tourPosition = new THREE.Vector3();
const palette = ["#ff6fd8", "#7ec3f0", "#ffd36e", "#4ade80", "#a37cf0"].map(c => new THREE.Color(c));

function animate(frameTime = performance.now()) {
  requestAnimationFrame(animate);
  if (document.hidden) { clock.getDelta(); return; }
  // Les écrans 120/144 Hz gardent la fluidité à 60 images/s sans doubler le travail 3D.
  if (frameTime - lastFrameAt < 1000 / 60) return;
  lastFrameAt = frameTime - (frameTime - lastFrameAt) % (1000 / 60);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  animateOutside(t);
  const focusKey = order[focus];
  order.forEach((key, i) => {
    const f = floors.get(key), y = f.baseY + (i < focus ? LIFT : 0);
    f.group.position.y += (y - f.group.position.y) * Math.min(1, dt * 4);
    // Seul l'étage regardé est ouvert : ceux du dessus s'envolent puis disparaissent, ceux du dessous sont la tour.
    const near = i === focus;
    f.group.visible = near || (i < focus && Math.abs(y - f.group.position.y) > 0.5);
    if (!f.group.visible) return;
    // Les étiquettes HTML ignorent les murs : seules celles de l'étage regardé s'affichent.
    f.tag.visible = near;
    f.roomTags?.forEach(l => { l.visible = near; });
    if (f.kind === "resident") {
      f.ownerTag.visible = near;
      f.alarmLight.intensity = f.alert ? 6 + Math.sin(t * 9) * 5 : 0;
      f.alarm.material = f.alert && Math.sin(t * 9) > 0 ? glow("#ff3b3b", 3) : mat("#3a3f52");
      play(f.owner, "Sitting");
      f.owner.userData.mixer.update(dt);
    }
    f.staff?.forEach(r => r.userData.mixer.update(dt));
    f.dancers?.forEach((r, k) => {
      play(r, clubAnimation(t, k * 0.37));
      r.rotation.y = k * 1.1 + Math.sin(t * 1.2 + k * 1.7) * 0.5;
    });
    const decorTime = reducedMotion.matches ? 0 : t;
    f.records?.forEach(d => { d.rotation.y = decorTime * 1.8; });
    f.cyber?.tick(dt, near);
    if (f.tv) { f.tv.view.visible = near; const want = near ? f.tv.url : "about:blank"; if (f.tv.shown !== want) { f.tv.shown = want; f.tv.iframe.src = want; } }
    f.flames?.forEach((flame, k) => {
      flame.scale.set(1, 0.8 + Math.sin(decorTime * 5 + k * 2) * 0.3, 1);
    });
    if (f.fireGlow) f.fireGlow.intensity = 2.8 + Math.sin(decorTime * 4) * 0.3;
    if (f.windSock) { f.windSock.rotation.y = 0.25 + Math.sin(decorTime * 0.6) * 0.25; f.windSock.rotation.z = Math.sin(decorTime * 2) * 0.07; }
    f.haze?.forEach(cloud => {
      const { spread, rise, count } = cloud.userData, pos = cloud.geometry.attributes.position;
      for (let k = 0; k < count; k++) {
        const phase = (decorTime * 0.12 + k / count) % 1;
        pos.setXYZ(k, phase * spread * 1.4 + Math.sin(k * 2.4) * spread * 0.25,
          phase * rise, Math.cos(k * 2.4) * spread * 0.4 + Math.sin(decorTime * 0.4 + k) * phase * 0.2);
      }
      pos.needsUpdate = true;
    });
    f.discos?.forEach(d => { d.rotation.y += dt * 1.2; });
    // Décor acheté : poissons de l'aquarium et écran de la borne d'arcade (immobiles si les animations sont réduites).
    f.fish?.forEach(p => {
      const k = decorTime * p.speed + p.phase;
      p.fish.position.set(p.x + Math.sin(k * 1.3) * 0.04, p.y + Math.sin(k * 2.1) * 0.03, Math.sin(k) * 0.55);
      p.fish.rotation.y = Math.cos(k) >= 0 ? 0 : Math.PI;
    });
    if (f.arcade && Math.floor(decorTime * 2) !== f.arcade.frame) { f.arcade.frame = Math.floor(decorTime * 2); drawArcade(f.arcade, f.arcade.frame); }
    f.steam?.forEach(p => {
      const k = (t * 0.35 + p.userData.phase) % 1;
      p.position.set(p.userData.x + Math.sin(k * 6) * 0.03, 0.86 + k * 0.45, p.userData.z);
      p.scale.setScalar(0.6 + k * 1.4);
      p.material.opacity = 0.35 * Math.sin(k * Math.PI);
    });
    f.spots?.forEach((c, k) => { c.rotation.z = Math.sin(t * 1.3 + k * 2) * 0.4; c.rotation.x = Math.cos(t * 0.9 + k) * 0.25; });
    f.lasers?.forEach((l, k) => { l.rotation.y = Math.sin(t * (0.7 + k * 0.13) + k) * 0.9; l.rotation.x = 0.12 + Math.sin(t * 1.1 + k * 2) * 0.1; });
    f.tiles?.forEach(tile => { tile.material.emissive.copy(palette[(tile.userData.k + Math.floor(t * 2)) % palette.length]); tile.material.emissiveIntensity = 0.35 + 0.35 * Math.abs(Math.sin(t * 3 + tile.userData.k)); });
    if (f.eq) {
      // Mur de LED : un égaliseur qui suit un rythme à 124 BPM
      const { ctx, tex } = f.eq, beat = Math.pow(1 - ((t * 124 / 60) % 1), 3);
      ctx.fillStyle = "#07040c"; ctx.fillRect(0, 0, 128, 48);
      for (let b = 0; b < 32; b++) {
        const h = 6 + (0.5 + 0.5 * Math.sin(t * (3 + (b % 5)) + b * 1.7)) * 26 * (0.55 + 0.45 * beat);
        ctx.fillStyle = `hsl(${(b * 9 + t * 40) % 360} 90% 60%)`;
        ctx.fillRect(b * 4, 48 - h, 3, h);
      }
      tex.needsUpdate = true;
    }
    // La porte de l'ascenseur s'illumine quand quelqu'un l'emprunte
    f.elevDoor.material = [...agents.values()].some(g => g.userData.floor === key && g.position.distanceTo(ELEV) < 1.2) ? glow("#f1cd85", 0.9) : mat("#2a3042", { metalness: 0.6, roughness: 0.25 });
  });
  beacons.color.set(Math.sin(t * 2.5) > 0.6 ? "#ff3030" : "#3a0808");
  // Le haut de la tour suit l'étage regardé.
  if (order.length) {
    towerTop += (floors.get(order[focus]).baseY - 0.5 - towerTop) * Math.min(1, dt * 4);
    tower.position.y = towerTop;
    tower.scale.y = towerTop - GROUND;
  }

  for (const g of agents.values()) {
    const u = g.userData;
    u.bubble.visible = u.floor === focusKey;
    let walking = false;
    if (u.wait > 0) { u.wait -= dt; g.visible = u.wait <= 0; }
    else if (u.path.length) {
      const next = u.path[0];
      // (« toFloor » et non « floor » : les vecteurs de Three.js ont déjà une méthode floor())
      if (next.toFloor) {
        // Dans l'ascenseur : l'agent passe d'un étage à l'autre et ressort par la porte.
        floors.get(next.toFloor).group.add(g);
        g.position.copy(ELEV);
        u.floor = next.toFloor;
        u.path.shift();
        u.wait = 0.8;
        g.visible = false;
      } else {
        tmp.subVectors(next, g.position);
        tmp.y = 0;
        const d = tmp.length(), step = dt * 2.6;
        if (d <= step) { g.position.x = next.x; g.position.z = next.z; u.path.shift(); }
        else { tmp.normalize(); g.position.x += tmp.x * step; g.position.z += tmp.z * step; u.dir = Math.atan2(tmp.x, tmp.z); walking = true; }
      }
    }
    const settled = !walking && !u.path.length;
    // Chaque assise fournit sa hauteur ; revenir au sol pendant la marche.
    g.position.y += ((settled ? u.slot.y : 0) - g.position.y) * Math.min(1, dt * 8);
    const facing = !settled ? (u.dir ?? 0) : u.slotAnim === "Dance" ? Math.PI + Math.sin(t * 3 + u.seed * 6) * 0.6 : (u.slotFacing ?? 0);
    const turn = ((facing - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += turn * Math.min(1, dt * 8);
    // Animation selon le lieu : marche, assis au poste / au salon / aux toilettes, danse au Club, signe chez le résident.
    play(g, !settled ? "Walking" : u.slotAnim === "Dance" ? clubAnimation(t, u.seed) : u.slotAnim ?? "Idle");
    if (g.parent?.visible) u.mixer.update(dt); // les agents des étages fermés avancent sans être animés
    u.orb.position.y = 1.78 + Math.sin(t * 2 + u.seed * 6) * 0.04;
    u.cup.visible = settled && u.place === "cafe";
    u.puffs.forEach(p => {
      const k = (t * 0.45 + p.userData.phase + u.seed) % 1;
      p.visible = settled && (u.place === "smoke" || u.place === "tabac"); // au tabac, ils goûtent une puff
      p.position.set(0.18 + k * 0.25, 1.35 + k * 1.1, 0.25);
      p.scale.setScalar(0.6 + k * 1.8);
      p.material.opacity = 0.45 * Math.sin(k * Math.PI);
    });
    u.ring.position.y = 0.03 - g.position.y; // le repère reste au sol quand le robot est sur une assise
    u.ring.visible = u.state !== "autorisation" || Math.sin(t * 10) > -0.3;
  }

  // Animation des machines à sous du casino (seulement quand un agent est dessus)
  const casinoFloor = floors.get("casino");
  if (casinoFloor && casinoFloor.slotMachines) {
    for (const machine of casinoFloor.slotMachines) {
      // Vérifier si un agent est assis sur cette machine (proximité < 0.6)
      let agentPlaying = false;
      for (const g of agents.values()) {
        const u = g.userData;
        if (u.floor === "casino" && u.place === "casino" && u.slot) {
          const dx = u.slot.x - machine.pos.x;
          const dz = u.slot.z - machine.pos.z;
          if (Math.abs(dx) < 0.3 && dz > 0 && dz < 1.2 && u.state === "fini" && !u.path.length) {
            agentPlaying = true;
            break;
          }
        }
      }

      if (agentPlaying && !machine.isPlaying) {
        // Démarrer l'animation
        machine.isPlaying = true;
        machine.playTimer = 3 + Math.random() * 2; // 3-5 secondes
        machine.spinSpeed = 15 + Math.random() * 10;
      }

      if (machine.isPlaying) {
        machine.playTimer -= dt;

        // Faire tourner les rouleaux - adaptatif selon le nombre de symboles visibles
        for (const reel of machine.reels) {
          const symbolSpacing = reel.height / reel.symbols.length;
          const resetThreshold = reel.y - reel.height / 2 - symbolSpacing;
          const resetOffset = symbolSpacing * reel.symbols.length;

          for (const symMesh of reel.symbols) {
            symMesh.position.y -= machine.spinSpeed * dt;
            // Reboucler le symbole quand il sort de l'écran
            if (symMesh.position.y < resetThreshold) {
              symMesh.position.y += resetOffset;
              // Changer le symbole aléatoirement
              const symbols = ["🍒", "🔔", "7️⃣", "⭐", "💎", "🍋", "🍊", "💰", "A♠", "K♥", "Q♦", "J♣"];
              const newSym = symbols[Math.floor(Math.random() * symbols.length)];
              const newColor = ["#ffd700", "#ff4444", "#44ff44", "#4444ff", "#ff8800", "#ff44ff"][Math.floor(Math.random() * 6)];
              if (symMesh.element) {
                symMesh.element.textContent = newSym;
                symMesh.element.style.color = newColor;
              }
            }
          }
        }

        // Animer le levier (seulement pour machines classic)
        if (machine.lever && machine.handle) {
          const swing = Math.sin(t * machine.spinSpeed * 0.5) * 0.15;
          machine.lever.rotation.z = swing;
          machine.handle.rotation.z = swing;
        }

        // Effet lumineux sur l'écran
        if (machine.screen && machine.screen.material) {
          const pulse = Math.sin(t * 20) * 0.3 + 0.7;
          machine.screen.material.emissiveIntensity = pulse * 0.5;
        }

        // Arrêter après le timer
        if (machine.playTimer <= 0) {
          machine.isPlaying = false;
          machine.spinSpeed = 0;
          if (machine.lever) machine.lever.rotation.z = 0;
          if (machine.handle) machine.handle.rotation.z = 0;
          if (machine.screen && machine.screen.material) {
            machine.screen.material.emissiveIntensity = 0;
          }
          // Résultat final - aligner les symboles (jackpot occasionnel)
          const jackpot = Math.random() < 0.15;
          const jackpotSym = machine.type === "video" ? "A♠" : "7️⃣";
          const normalSymbols = machine.type === "video"
            ? ["A♠", "K♥", "Q♦", "J♣", "10♠", "9♥", "8♦"]
            : ["🍒", "🔔", "⭐", "💎", "🍋", "🍊", "💰"];
          for (let s = 0; s < machine.reels.length; s++) {
            const reel = machine.reels[s];
            const finalSym = jackpot ? jackpotSym : normalSymbols[Math.floor(Math.random() * normalSymbols.length)];
            const finalColor = jackpot ? "#ffd700" : ["#ffd700", "#ff4444", "#44ff44", "#4444ff", "#ff8800", "#ff44ff"][Math.floor(Math.random() * 6)];
            for (let v = 0; v < reel.symbols.length; v++) {
              if (reel.symbols[v] && reel.symbols[v].element) {
                reel.symbols[v].element.textContent = finalSym;
                reel.symbols[v].element.style.color = finalColor;
              }
            }
          }
        }
      }
    }
  }

  // La caméra suit l'étage choisi ; le toit coiffe le penthouse.
  const visiting = data?.viewer?.role === "spectator" && !tourPaused;
  if (visiting) {
    const step = spectatorStep(t - tourStarted, order, data.apartments.length, innerWidth < 760 ? 1 : innerWidth < 1100 ? 2 : Math.max(1, Math.min(6, Math.floor((innerHeight - 350) / 132))));
    const desiredFocus = step.kind === "floor" ? step.index : 0;
    if (focus !== desiredFocus) { focus = desiredFocus; render(); }
    const viewKey = `${step.kind}:${step.page}:${step.floor}:${step.remaining}`;
    if (viewKey !== lastTourViewKey || data !== lastTourData) {
      updateSpectatorView(step); lastTourViewKey = viewKey; lastTourData = data;
    }
    const board = step.kind === "agents" ? AD_SITE : step.kind === "usage" ? USAGE_SITE : null;
    const fy = floors.get(order[focus])?.baseY ?? 0;
    const wide = innerWidth < innerHeight ? 1.8 : 1;
    const target = board ? tourTarget.set(board.x, -5, board.z + 3.3) : tourTarget.set(0, fy + 0.6, 0);
    const position = tourPosition.copy(target);
    if (board) { position.y += 4 * wide; position.z += 30 * wide; }
    else { position.x += 14 * wide; position.y += 15 * wide; position.z += 22 * wide; }
    const smoothing = reducedMotion.matches ? 1 : Math.min(1, dt * 2);
    controls.target.lerp(target, smoothing); camera.position.lerp(position, smoothing);
  } else {
    const fy = order.length ? floors.get(order[focus]).baseY : 0;
    const dy = (fy + 0.6 - controls.target.y) * Math.min(1, dt * 3);
    controls.target.y += dy; camera.position.y += dy;
    if (autoTour && data?.viewer?.role !== "spectator" && t - lastMove > 25) { setFocus((focus + 1) % Math.max(order.length, 1)); lastMove = t; }
  }
  controls.autoRotate = autoTour && data?.viewer?.role !== "spectator";
  controls.autoRotateSpeed = 0.4;
  controls.update();
  // Le direct ne se charge que quand on regarde le Salon.
  const url = focusKey === "lounge" ? tvUrl() : "about:blank";
  if (url !== shownUrl) { shownUrl = url; stream.src = url; }
  renderer.render(scene, camera);
  screens.render(scene, camera);
  labels.render(scene, camera);
}

let framed = false;
function resize() {
  const w = innerWidth, h = innerHeight;
  // Premier cadrage : plus de recul sur un écran en hauteur (téléphone) pour voir l'étage entier.
  if (!framed) { const k = w / h < 1 ? 1.9 : 1; camera.position.set(14 * k, 15 * k, 22 * k); framed = true; }
  // Pleine résolution de l'écran (Retina), multipliée par le zoom de la page s'il y en a un : l'image est recalculée, pas étirée.
  renderer.setPixelRatio(Math.min(devicePixelRatio * (visualViewport?.scale ?? 1), 3));
  renderer.setSize(w, h);
  screens.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
visualViewport?.addEventListener("resize", resize);
resize();

// Mode écran (?ecran) : tourne doucement et change d'étage toutes les 25 s.
const autoTour = new URLSearchParams(location.search).has("ecran");
let lastMove = 0;
let lastTourViewKey = "", lastTourData = null;
let tourStarted = 0, tourPaused = false, tourPausedAt = 0, dashboardContent = "", captionContent = "", activeTourStep = null;
function updateSpectatorView(step) {
  activeTourStep = step;
  $("#spectatorDashboard").hidden = step.kind !== "dashboard";
  const title = step.kind === "dashboard" ? `Usages de tous · ${step.page + 1}/${step.pages}`
    : step.kind === "floor" ? floors.get(step.floor)?.name ?? "Étage" : step.kind === "agents" ? "Écran des agents" : "Écran des usages";
  const caption = `${title} · suite dans ${step.remaining} s`;
  if (caption !== captionContent) { $("#tourCaption").textContent = caption; captionContent = caption; }
  if (step.kind !== "dashboard") return;
  const list = [...data.apartments].sort((a, b) => a.created - b.created || a.name.localeCompare(b.name, "fr")).slice(step.page * step.pageSize, (step.page + 1) * step.pageSize);
  const rows = list.map(a => ({ name: a.name, active: a.sessions.filter(s => stateOf(s, data.now) === "travaille").length, quotas: quotaRows(a.usage, data.now) }));
  const content = JSON.stringify([rows, step.page, step.pages]);
  if (content === dashboardContent) return;
  dashboardContent = content;
  $("#spectatorDashboard").innerHTML = `<div class="dashboard-heading"><div><p class="kicker">Penthouse · vue d’ensemble</p><h1>Les usages de chacun</h1><p class="dashboard-lead">Quotas restants, par résident et par outil</p></div><span class="dashboard-page">${step.page + 1} / ${step.pages}</span></div>
    <div class="usage-grid">${rows.map(a => `<article class="usage-card"><header><span class="resident-avatar" aria-hidden="true">${esc(a.name.slice(0, 1).toUpperCase())}</span><div><h2>${esc(a.name)}</h2><span>${a.active} agent${a.active > 1 ? "s" : ""} au travail</span></div></header>${a.quotas.map((q, i) => `<div class="quota-row ${i < 2 ? "claude" : "chatgpt"}"><div><span>${i < 2 ? "Claude" : "ChatGPT"} · ${q.label === "5 HEURES" ? "5 h" : "semaine"}</span><b>${q.remaining === null ? "—" : q.remaining + " %"}</b></div><div class="quota-track"><i style="width:${q.remaining ?? 0}%"></i></div><small>${esc(q.reset)}</small></div>`).join("")}</article>`).join("") || '<p>Aucun résident pour le moment.</p>'}</div>`;
}
$("#tourPause").addEventListener("click", () => {
  tourPaused = !tourPaused;
  if (tourPaused) tourPausedAt = clock.elapsedTime;
  else tourStarted += clock.elapsedTime - tourPausedAt;
  $("#tourPause").textContent = tourPaused ? "Reprendre la visite" : "Pause visite";
  $("#tourPause").setAttribute("aria-pressed", String(tourPaused));
  document.body.classList.toggle("spectator-presentation", !tourPaused);
  $("#tourCaption").hidden = tourPaused;
});

function setFocus(i) {
  focus = Math.max(0, Math.min(order.length - 1, i));
  lastMove = clock.elapsedTime;
  const key = order[focus];
  const me = JSON.parse(localStorage.getItem(ME) ?? "null")?.slug;
  const { slug, wing } = parseFloorKey(key);
  const token = sessionStorage.getItem("penthouse.cle");
  if (token && me && slug === me && wing && wing !== "work") {
    postGame("/api/game/visit", token, { floor: key }).then(j => {
      showCelebrations(j.toasts);
      const apt = myApt();
      if (apt && j.game) apt.game = j.game;
      if (data) render();
    }).catch(() => {});
  }
  if (data) render();
}
addEventListener("keydown", e => {
  if (e.target.closest?.("input, dialog")) return;
  if (e.key === "ArrowDown") { e.preventDefault(); setFocus(focus + 1); }
  if (e.key === "ArrowUp") { e.preventDefault(); setFocus(focus - 1); }
});

// Clic sur un agent : sa fiche.
const onFocus = () => [...agents.values()].filter(g => g.userData.floor === order[focus] && g.visible);
const onGiantTv = () => { const t = floors.get(order[focus])?.tv; return t && ray.intersectObject(t.frame).length ? t : null; };
const onByte = () => { const c = floors.get(order[focus])?.cyber; return c && ray.intersectObject(c.hit, true).length ? c : null; };
const onTv = () => order[focus] === "lounge" && tvFrame && ray.intersectObject(tvFrame).length > 0;
// Le pincement du pavé tactile ne zoome jamais la page entière (seulement la caméra, sur la 3D).
addEventListener("wheel", e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
addEventListener("gesturestart", e => e.preventDefault());
renderer.domElement.addEventListener("pointerdown", e => { renderer.domElement.dataset.down = `${e.clientX},${e.clientY}`; });
renderer.domElement.addEventListener("pointerup", e => {
  const [x, y] = (renderer.domElement.dataset.down ?? "").split(",").map(Number);
  if (Math.hypot(e.clientX - x, e.clientY - y) > 6) return; // c'était un glisser, pas un clic
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  let o = ray.intersectObjects(onFocus(), true)[0]?.object;
  while (o && !o.userData.key) o = o.parent;
  if (o) return showAgent(o.userData.apt, o.userData.s);
  const byte = onByte(), giant = onGiantTv();
  // Sa propre télé : le clic ouvre le réglage du lien ; celle d'un autre résident s'ouvre avec le son.
  if (giant && floors.get(order[focus])?.residentSlug === JSON.parse(localStorage.getItem(ME) ?? "null")?.slug) {
    showCustomize();
    return $("#customizeForm").tv.select();
  }
  if (giant) return open(giant.page, "_blank", "noopener");
  if (byte) return byte.poke();
  if (onTv()) open(tvPageUrl(), "_blank", "noopener");
});
renderer.domElement.addEventListener("pointermove", e => {
  if (e.buttons) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  renderer.domElement.style.cursor = ray.intersectObjects(onFocus(), true).length || onTv() || onByte() || onGiantTv() ? "pointer" : "";
});

// ---------- interface ----------
function meter(label, w, color, now) {
  if (!w) return "";
  const pct = quotaRemaining(w, now);
  const c = pct !== null && pct <= 10 ? "var(--auth)" : pct !== null && pct <= 30 ? "var(--wait)" : color;
  const reset = w.resets_at && now >= w.resets_at ? "Nouvelle mesure attendue" : w.resets_at ? "Reset " + new Date(w.resets_at * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "Reset inconnu";
  return `<div class="meter"><div class="l"><span>${label}</span><b>${pct === null ? "—" : pct + " % restants"}</b></div><div class="bar" style="--c:${c}"><i style="width:${pct ?? 0}%"></i></div><div class="r">${reset}</div></div>`;
}

let previousApprovals = new Map(), activeApproval = null, lastApprovalPulse = 0;
function updateApprovalAlerts(slug) {
  const { pending, current, fresh } = approvalState(data.apartments, previousApprovals, slug);
  previousApprovals = current;
  if (slug) pushApprovalNotifications(fresh, TOOLS);
  activeApproval = fresh[0] ?? pending[0] ?? null;
  $("#permissionBanner").hidden = !pending.length;
  $("#permissionGlow").hidden = !pending.length;
  if (!activeApproval) { $("#permissionFlash").getAnimations().forEach(animation => animation.cancel()); return; }
  const { session } = activeApproval;
  const message = `${TOOLS[session.src]?.name ?? session.src}${session.project ? " · " + session.project : ""}${pending.length > 1 ? " · " + pending.length + " demandes en attente" : " attend ton accord"}`;
  if ($("#permissionMessage").textContent !== message) $("#permissionMessage").textContent = message;
  // Les demandes simultanées sont regroupées : une seule impulsion lente, au plus toutes les 5 secondes.
  if (fresh.length && !reducedMotion.matches && Date.now() - lastApprovalPulse >= 5000) {
    lastApprovalPulse = Date.now();
    $("#permissionFlash").animate([{ opacity: 0.48 }, { opacity: 0 }], { duration: 1600, easing: "ease-out" });
  }
}
$("#showPermission").addEventListener("click", () => {
  if (!activeApproval) return;
  const { apartment, session } = activeApproval;
  setFocus(order.indexOf(`${apartment.slug}:work`) >= 0 ? order.indexOf(`${apartment.slug}:work`) : order.findIndex(k => k.startsWith(apartment.slug + ":"))); showAgent(apartment, session);
});

// Panneau latéral : pas de redessin sous les doigts de quelqu'un qui saisit (lien perso de la télé).
// Le HTML n'est réécrit que s'il a changé : un bouton n'est pas remplacé sous le pointeur toutes les deux secondes.
let panelHtml = "";
function setPanel(html) {
  const panel = $("#aptPanel"), typing = panel.contains(document.activeElement) && document.activeElement.matches("input, textarea");
  if (typing || html === panelHtml) return;
  panel.innerHTML = html;
  panelHtml = html;
}

// En-tête : portefeuille, titre et événement du jour ; bouton Entreprise ; primes reçues d'un autre résident.
let ecoHeaderHtml = "", tipWatch = { slug: null, seen: null };
function renderEconomyHeader(mine, spectator) {
  const eco = spectator ? null : mine?.economy;
  const html = eco ? walletChipHtml(eco, esc, economyUi.shownWallet(eco)) + eventChipHtml(eco.event, esc) : "";
  // Comparé avant d'écrire : l'infobulle de l'événement reste ouverte sous la souris ou le focus.
  if (html !== ecoHeaderHtml) { $("#ecoHost").innerHTML = html; ecoHeaderHtml = html; }
  $("#ecoBtn").hidden = !eco;
  if (!eco) return;
  if (tipWatch.slug !== mine.slug) tipWatch = { slug: mine.slug, seen: null };
  const { fresh, seen } = freshTipsIn(eco, tipWatch.seen);
  tipWatch.seen = seen;
  if (fresh.length) showCelebrations(fresh.map(e => ({ title: `💌 ${e.label}`, body: `+${money(e.amount)} sur ton compte` })));
  economyUi.refresh();
}

function render() {
  updateBillboard(data.apartments, data.now);
  updateUsageBoard(data.apartments, data.now);
  const now = data.now, spectator = data.viewer?.role === "spectator", me = spectator ? null : JSON.parse(localStorage.getItem(ME) ?? "null")?.slug;
  updateApprovalAlerts(me);
  // Le premier résident occupe le penthouse, sous le toit ; les suivants descendent d'un étage chacun ; le Salon et le Club suivent.
  const list = [...data.apartments].sort((x, y) => x.created - y.created);
  const first = !order.length;
  syncFloors(list);
  if (first) focus = me && order.includes(`${me}:work`) ? order.indexOf(`${me}:work`) : Math.min(1, order.length - 1);
  update(now);
  order.forEach((key, i) => {
    const f = floors.get(key), apt = list.find(x => x.slug === f.residentSlug);
    const lvl = apt?.game?.level && f.residentSlug === me && f.wingId === "work" ? `<span class="lvl-game">· ${apt.game.level}</span>` : "";
    f.tag.element.innerHTML = `<span>${floorLabel(i)}${lvl}</span> ${esc(f.name)}`;
  });

  let xpHost = $("#xpHost");
  if (!xpHost) {
    xpHost = document.createElement("div");
    xpHost.id = "xpHost";
    $(".brandline").appendChild(xpHost);
  }
  const mine = me ? list.find(x => x.slug === me) : null;
  xpHost.innerHTML = mine?.game && !spectator ? xpBarHtml(mine.game, esc) : "";
  renderEconomyHeader(mine, spectator);

  const by = (ss, st) => ss.filter(s => stateOf(s, now) === st).length;
  const present = key => [...agents.values()].filter(g => g.userData.target === key);
  $("#floorNav").innerHTML = order.map((key, i) => {
    const f = floors.get(key), a = f.residentSlug ? list.find(x => x.slug === f.residentSlug) : null, here = present(key);
    const busy = a ? by(a.sessions, "travaille") : here.length, alert = a && by(a.sessions, "autorisation");
    const isMe = f.residentSlug === me;
    return `<button type="button" data-floor="${i}" class="${i === focus ? "on" : ""}${isMe ? " me" : ""}${f.kind === "shared" ? " shared" : ""}${f.wingId && f.wingId !== "work" ? " wing-extra" : ""}" aria-current="${i === focus}">
      <span class="lvl">${floorLabel(i)}</span><span class="nm">${esc(f.name)}</span><span class="ct">${alert && f.wingId === "work" ? '<i class="d auth"></i>' : ""}${busy}</span></button>`;
  }).join("");

  const f = floors.get(order[focus]);
  if (f?.kind === "resident") {
    const a = list.find(x => x.slug === f.residentSlug), u = a.usage ?? {}, svcs = a.health?.services ?? [];
    const machines = Object.entries(a.seen ?? {}).filter(([m]) => m !== "?").map(([m, v]) => `${esc(m)} ${now - v.t < 900 ? "●" : "○"}`);
    const mine = a.slug === me;
    const alerts = mine ? quotaAlerts(u, now, quotaRemaining) : [];
    $("#quotaBanner").hidden = !alerts.length;
    $("#quotaBanner").textContent = alerts.length ? "Quota bas · " + alerts.join(" · ") : "";
    const tagline = a.profile?.tagline ? `<p class="tagline-line">${esc(a.profile.tagline)}</p>` : "";
    const machineBlock = mine && f.wingId === "work" ? `<div class="machine-block"><h4>Machines reliées</h4>${machineStatusRows(a, now, TOOLS, esc, hm)}</div>` : "";
    const todayLine = mine && todayBadges(a.today) ? `<p class="extras-muted">Aujourd’hui · ${esc(todayBadges(a.today))}</p>` : "";
    const wingLine = `<p class="kicker">${esc(f.wing?.icon ?? "")} ${esc(f.wing?.name ?? "Aile")}${f.wing?.minLevel ? ` · dès nv. ${f.wing.minLevel}` : ""}</p>`;
    const wingPlay = mine && a.game ? wingActionsHtml(a.game, f.key, esc) : "";
    const wingHint = mine && (a.game?.wings?.length ?? 1) < 4 ? `<p class="extras-muted">Monte de niveau pour débloquer Labo (4), Ops (7), Studio (12).</p>` : "";
    const officeBlock = f.wingId === "work" && a.game?.office ? officePanelHtml(a.game.office, esc) : "";
    const ecoLine = residentEconomyLine(a.economy, esc);
    setPanel(`${wingLine}<p class="kicker">${a.slug === list[0].slug && f.wingId === "work" ? "Penthouse" : esc(f.name)}${mine ? " · chez toi" : ""}</p><h2>${esc(a.name)}</h2>${tagline}${ecoLine}${officeBlock}${wingHint}${wingPlay}
      <div class="apt-c"><span><i class="d" style="background:var(--work)"></i><b>${by(a.sessions, "travaille")}</b> au travail</span>
      <span><i class="d" style="background:var(--auth)"></i><b>${by(a.sessions, "autorisation")}</b> ${spectator ? "attend un accord" : "attend ton accord"}</span>
      <span><i class="d" style="background:var(--wait)"></i><b>${by(a.sessions, "attend")}</b> sur le toit, attend la suite</span>
      <span><i class="d" style="background:var(--pause)"></i><b>${by(a.sessions, "fini") + by(a.sessions, "silencieux")}</b> en pause dans les étages communs</span></div>
      <div class="meters">${meter("Claude 5 h", u.claude?.five_hour, "var(--claude)", now)}${meter("Claude semaine", u.claude?.seven_day, "var(--claude)", now)}
      ${meter("ChatGPT 5 h", u.chatgpt?.five_hour, "var(--codex)", now)}${meter("ChatGPT semaine", u.chatgpt?.seven_day, "var(--codex)", now)}</div>
      <div class="svcs">${svcs.length ? `Services <b style="color:${svcs.every(s => s.ok) ? "var(--work)" : "var(--auth)"}">${svcs.filter(s => s.ok).length}/${svcs.length}</b>` : ""}
      ${svcs.filter(s => !s.ok).map(s => `<span style="color:var(--auth)">${esc(s.label)} arrêté</span>`).join("")}
      ${machines.length ? `<span>Machines : ${machines.join(" · ")}</span>` : ""}</div>
      ${todayLine}${machineBlock}
      ${a.sessions.length ? "" : '<p class="none">Aucun agent relié pour l\'instant.</p>'}`);
  } else if (f?.kind === "shared") {
    const here = present(f.key), byRes = new Map();
    for (const g of here) { const n = g.userData.apt.name; byRes.set(n, [...(byRes.get(n) ?? []), g.userData]); }
    const myGame = myApt();
    const myAgentsHere = here.filter(g => g.userData.apt.slug === me).length;
    const spacePlay = me && myGame?.game && !spectator ? spaceActionsHtml(myGame.game, f.key, myAgentsHere, esc) : "";
    // Casino : les vrais jeux (en P$) s'ouvrent dans le dialogue Entreprise.
    const casinoPlay = f.key === "casino" && !spectator && myGame?.economy
      ? `<div class="space-actions"><h4>Tables de jeu</h4><button type="button" class="space-act eco-casino-btn" data-eco-open="casino"><strong>🎰 Jouer</strong><span>Machine à sous, roulette, course de robots · solde ${esc(money(economyUi.shownWallet(myGame.economy)))}</span></button></div>` : "";
    setPanel(`<p class="kicker">${esc(f.def.kicker)}</p><h2>${f.def.icon} ${esc(f.name)}</h2>
      ${f.key === "lounge" ? remote() : ""}${casinoPlay}
      <div class="apt-c"><span><b>${here.length}</b> agent(s) ici, de <b>${byRes.size}</b> résident(s)</span></div>
      ${spacePlay}
      ${[...byRes].map(([n, ss]) => `<div class="who-row"><b>${esc(n)}</b><span>${ss.map(u => `${esc(TOOLS[u.s.src]?.name ?? u.s.src)} · ${f.key === "lounge" ? esc(PLACE_FR[u.place]) : esc(u.s.project ?? "")}`).join("<br>")}</span></div>`).join("")
        || '<p class="none">Personne pour l\'instant.</p>'}`);
  }

  const all = list.flatMap(x => x.sessions);
  const board = activityLeaderboard(list);
  const lb = $("#leaderboardDlg"), rich = fortuneLeaders(list);
  if ((board.length || rich.length) && !spectator) {
    lb.hidden = false;
    lb.innerHTML = (board.length ? `<h4>Activité du jour</h4><ol>${board.map((r, i) => `<li><b>${esc(r.name)}</b> · ${r.actions} act. / ${r.sessions} sess.</li>`).join("")}</ol>` : "")
      + (rich.length ? `<h4>Fortune</h4><ol>${rich.map(a => `<li><b>${esc(a.name)}</b> · ${esc(a.economy.title?.icon ?? "")} ${esc(money(a.slug === me ? economyUi.shownWallet(a.economy) : a.economy.wallet))}</li>`).join("")}</ol>` : "");
  } else lb.hidden = true;
  // Libellés masquables : sur un écran moyen, l'en-tête ne garde que les pastilles et les nombres.
  $("#totals").innerHTML = `<span title="Résidents"><span aria-hidden="true" class="ico">🏢</span><b>${list.length}</b><span class="lbl"> résident(s)</span></span><span title="Au travail"><i class="d" style="background:var(--work)"></i><b>${by(all, "travaille")}</b><span class="lbl"> au travail</span></span>`
    + `<span title="Attendent un accord"><i class="d" style="background:var(--auth)"></i><b>${by(all, "autorisation")}</b><span class="lbl"> attendent un accord</span></span>`;
  const feed = list.flatMap(x => x.feed.map(e => ({ ...e, who: x.name }))).sort((x, y) => y.t - x.t).slice(0, 14);
  $("#ticker").innerHTML = feed.map(e => `<span>${hm(e.t)} <b>${esc(e.who)}</b> · ${esc(TOOLS[e.src]?.name ?? e.src)}${e.project ? " · " + esc(e.project) : ""} — ${esc(e.action)}</span>`).join("")
    || "<span>En attente d'activité…</span>";
  const waiting = by(all, "autorisation");
  document.title = (waiting ? `(${waiting} !) ` : "") + "Penthouse";
  if (spectator && tourPaused && activeTourStep?.kind === "dashboard") updateSpectatorView(activeTourStep);
}
function remote() {
  const now = tvChannel(), name = c => esc(CHANNEL_NAMES[c] ?? c), spectator = data?.viewer?.role === "spectator", custom = tvCustomNow();
  const showing = custom ? (custom.kind === "youtube" ? "Lien perso · vidéo YouTube" : `Lien perso · Twitch ${esc(custom.channel)}`)
    : `${name(now)}${liveNow[now] === false ? " · hors ligne" : ""}`;
  const form = tvLinkOpen && !spectator ? `<form class="tv-link" id="tvLinkForm" autocomplete="off">
      <label>Lien YouTube (vidéo ou live) ou chaîne Twitch<input name="url" type="url" inputmode="url" required maxlength="500" placeholder="https://www.youtube.com/watch?v=…" value="${esc(tvLinkDraft)}"></label>
      <button type="submit">Mettre à l’écran</button><p class="err" role="alert">${esc(tvLinkError)}</p></form>` : "";
  return `<p class="kicker tv-k">Télé du salon</p><div class="tv">${["auto", ...Object.keys(liveNow)].map(c => `<button type="button" ${spectator ? "disabled" : ""} data-tv="${esc(c)}" class="${c === tvChoice ? "on" : ""}">${
    c === "auto" ? "Auto" : `<i class="d" style="background:${liveNow[c] ? "var(--auth)" : "#3a3f52"}"></i>${name(c)}`}</button>`).join("")}<button type="button" ${spectator ? "disabled" : ""} data-tv-link aria-expanded="${tvLinkOpen && !spectator}" aria-controls="tvLinkForm" class="${tvChoice === "custom" ? "on" : ""}">🔗 Lien perso</button></div>${form}
    <p class="tv-now">À l'écran : <b>${showing}</b>${tvBy ? ` · choisi par ${esc(tvBy)}` : ""}</p>`;
}
// Choix de la télé : la clé de l'étage accompagne la demande quand elle est connue (le nom affiché vient alors du serveur).
async function postTv(body) {
  const token = sessionStorage.getItem("penthouse.cle");
  const r = await fetch("/api/tv", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-Tour-Token": token } : {}) }, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch { /* réponse vide */ }
  if (!r.ok) throw new Error(j.error ?? "Choix refusé.");
  return j;
}
$("#aptPanel").addEventListener("click", e => {
  if (data?.viewer?.role === "spectator") return;
  const act = e.target.closest(".space-act[data-action], .wing-act[data-action]"); // le bouton « Jouer » du casino ouvre le dialogue
  if (act && !act.disabled) {
    runGameAction(act.dataset.action, act.dataset.floor, Number(act.dataset.agents)).catch(err => alert(err.message));
    return;
  }
  if (e.target.closest("[data-tv-link]")) {
    tvLinkOpen = !tvLinkOpen; tvLinkError = "";
    render();
    if (tvLinkOpen) $("#tvLinkForm input")?.focus();
    return;
  }
  const b = e.target.closest("[data-tv]");
  if (!b) return;
  tvChoice = b.dataset.tv;
  tvMine = Date.now() + 3000;
  tvBy = JSON.parse(localStorage.getItem(ME) ?? "null")?.name ?? "";
  render();
  postTv({ channel: tvChoice, by: tvBy }).catch(() => {});
  if (order[focus] === "lounge") runGameAction("lounge_tv", "lounge", 0).catch(() => {});
});
$("#aptPanel").addEventListener("input", e => { if (e.target.closest("#tvLinkForm")) tvLinkDraft = e.target.value; });
$("#aptPanel").addEventListener("submit", async e => {
  const form = e.target.closest("#tvLinkForm");
  if (!form || data?.viewer?.role === "spectator") return;
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const tv = await postTv({ channel: "custom", url: form.url.value.trim(), by: JSON.parse(localStorage.getItem(ME) ?? "null")?.name ?? "" });
    tvChoice = "custom"; tvCustom = tv.custom ?? null; tvBy = tv.by ?? ""; tvMine = Date.now() + 3000;
    tvLinkOpen = false; tvLinkDraft = ""; tvLinkError = "";
    form.url.blur();
    if (order[focus] === "lounge") runGameAction("lounge_tv", "lounge", 0).catch(() => {});
  } catch (error) {
    tvLinkError = error.message;
    form.querySelector(".err").textContent = error.message; // affichée tout de suite, même champ actif
  } finally { button.disabled = false; }
  render();
});
$("#floorNav").addEventListener("click", e => { const b = e.target.closest("[data-floor]"); if (b) setFocus(Number(b.dataset.floor)); });

function showAgent(a, s) {
  const T = TOOLS[s.src] ?? { name: s.src, color: "#888" }, now = data.now;
  const currentPlace = agents.get(keyOf(a.slug, s))?.userData.place ?? placeOf(s, now);
  const row = (l, v, mono) => v ? `<dt>${l}</dt><dd${mono ? ' class="m"' : ""}>${esc(v)}</dd>` : "";
  $("#agentBody").innerHTML = `<div class="who"><i class="d" style="width:12px;height:12px;background:${T.color}"></i>${esc(T.name)}</div>
    <dl>${row("Résident", a.name)}${row("Rôle", agentRoleText(staffOf(a, s.src), data.viewer?.role === "spectator"))}${row("Machine", data.viewer?.role === "spectator" ? null : s.host)}${row("Projet", s.project)}${row("Modèle", s.model, true)}
    ${row("État", `${STATE_FR[stateOf(s, now)] ?? s.state} · ${PLACE_FR[currentPlace]}`)}${row("Demande", data.viewer?.role === "spectator" ? null : s.task || "(pas de demande connue)")}
    ${row("Action", s.action, true)}${row("Arrivé à", hm(s.started))}${row("Dernier signe", hm(s.updated))}</dl>`;
  $("#agentDlg").showModal();
}

function installBlock(token) {
  const cmd = `curl -fsSL ${location.origin}/install.sh | sh -s -- ${token}`;
  return `<p class="connect-intro"><strong>Une commande, et c’est connecté.</strong></p>
    <p>Colle cette commande dans le terminal de ton Mac ou de ta machine Linux. Les sessions Claude Code et Codex de la dernière heure arrivent sur ton étage, puis se mettent à jour automatiquement.</p>
    <div class="code"><span>${esc(cmd)}</span><button type="button" data-copy="${esc(cmd)}">Copier</button></div>
    <p>Pas de <code>/hooks</code>, pas d’outil à relancer. Le suivi lit les journaux locaux et les quotas disponibles, sans lancer de modèle. Il transmet le nom du projet, le modèle et l’état de la session, pas le contenu des conversations.</p>
    <p>Répète la même commande sur une autre machine pour la relier au même étage.</p>
    <details><summary>Diagnostic et clé</summary><p>Pour revérifier la connexion :</p><div class="code"><span>python3 "$HOME/.config/tour/tour-check"</span><button type="button" data-copy='python3 "$HOME/.config/tour/tour-check"'>Copier</button></div>
    <p>La clé reste dans cet onglet et dans <code>~/.config/tour/secret</code> sur tes machines. Garde-la privée.</p>
    <p>Mac : suivi toutes les 15 secondes. Linux : toutes les minutes via cron. Les hooks existants restent compatibles et donnent les autorisations plus précises.</p></details>`;
}
function refreshConnectionStatus() {
  const target = $("#connectionStatus");
  if (!target) return;
  const me = JSON.parse(localStorage.getItem(ME) ?? "null"), apt = data?.apartments.find(a => a.slug === me?.slug);
  const seen = Object.entries(apt?.seen ?? {});
  const tools = Object.entries(TOOLS).map(([src, tool]) => {
    const received = seen.filter(([, machine]) => machine.events?.[src]);
    // Les anciens collecteurs n'avaient pas de diagnostic ; leurs sessions sont aussi une preuve de réception.
    const sessions = (apt?.sessions ?? []).filter(s => s.src === src);
    const last = Math.max(0, ...received.map(([, m]) => m.events[src]), ...sessions.map(s => s.updated));
    const installed = seen.filter(([, m]) => m.readers?.[src] || m.tools?.[src]);
    const state = last ? `Événement reçu à ${hm(last)}` : installed.length ? "Suivi prêt · aucun événement reçu" : "Aucun événement reçu";
    return `<div class="connect-row"><b>${esc(tool.name)}</b><span class="${last ? "received" : ""}">${state}</span></div>`;
  }).join("");
  const machines = seen.map(([name, m]) => `<span>${esc(name)} · reçu à ${hm(m.t)}</span>`).join("");
  const quotas = ["claude", "chatgpt"].map(provider => {
    const u = apt?.usage?.[provider];
    return `${provider === "claude" ? "Claude" : "ChatGPT"} : ${u?.ts && [u.five_hour?.pct, u.seven_day?.pct].some(Number.isFinite) ? "mesure reçue à " + hm(u.ts) : "aucune mesure reçue"}`;
  }).join(" · ");
  target.innerHTML = `<h4>Réception des outils</h4>${tools}<div class="connect-machines">${machines || "Aucune machine reçue pour le moment."}</div><p><b>Quotas</b> · ${quotas}</p><p>Ces horaires indiquent la dernière réception, pas une connexion permanente. Les quotas sont séparés de l’activité des agents. Une session sans journal récent peut ne pas apparaître.</p>`;
}
function grokSetupPrompt() {
  return `Connecte Grok Bot à mon penthouse (${location.origin}). Sur ton ordinateur cloud, crée /workspace/penthouse et télécharge ${location.origin}/grok-mcp.py et ${location.origin}/tour_http.py dans ce dossier. Python 3 et curl sont nécessaires.
Demande ma clé d’étage via la saisie sécurisée pour secrets, jamais dans un message normal (ce n’est pas le code d’entrée de la salle). Enregistre-la dans /workspace/penthouse/grok-connection.json avec les permissions 600 : {"site":"${location.origin}","key":"LA_CLE_SAISIE_EN_SECURISÉ"}. Ne l’affiche pas.
Ajoute un serveur MCP par commande : python3 /workspace/penthouse/grok-mcp.py. Le pont expose penthouse_status(bot, session, state, project facultatif). Donne un nom stable à chaque Bot et un identifiant stable à chaque tâche. États : working au début, idle en attente, approval si mon accord est requis, error en cas d’échec, finished à la fin. Garde le même identifiant jusqu’à la fin de la tâche. Ne transmets aucun contenu de conversation ni secret.
Teste l’envoi avec une tâche de vérification clairement identifiée, puis signale sa fin avec le même identifiant. Annonce la connexion seulement si le serveur confirme la réception. Enregistre ces étapes comme compétence réutilisable pour les tâches que je te confie. Ce suivi repose sur tes appels explicites : ne promets pas une surveillance automatique ni des quotas que tu ne peux pas mesurer.`;
}

function showLink() {
  if (data?.viewer?.role === "spectator") return;
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  const fresh = sessionStorage.getItem("penthouse.cle");
  $("#linkBody").innerHTML = `<p class="connect-intro">Ton étage : <b>${esc(me?.name ?? "")}</b>. Une commande par machine suffit. La réception s’affiche ci-dessous.</p>` +
    (fresh ? installBlock(fresh) : `<form class="reuse-key"><label>Clé de ton étage<input name="token" type="password" required autocomplete="off"></label>
    <button type="submit">Préparer la connexion</button><p class="err" role="alert"></p></form>
    <p>Sur une machine déjà reliée, retrouve ta clé dans <code>~/.config/tour/secret</code> ou dans ton gestionnaire de mots de passe. Réutilise-la pour ajouter une machine.</p>`)
    + `<section id="connectionStatus" aria-live="polite"></section>
    <details><summary>Grok Bot</summary><p>Grok Bot travaille sur son ordinateur cloud. Copie ces instructions dans Grok Bot pour ajouter le connecteur MCP ; il te demandera la clé de ton étage dans une saisie sécurisée.</p>
    <div class="code"><span>Instructions de connexion pour Grok Bot</span><button type="button" data-copy="${esc(grokSetupPrompt())}">Copier</button></div>
    <p>Suivi déclaré par le Bot : début, attente, autorisation, erreur, fin. Ce n’est pas une détection automatique depuis ton Mac. Les quotas Grok ne sont pas remontés par ce connecteur.</p></details>
    <details><summary>Cursor (Composer / Agent)</summary><p>Signale manuellement ou via un hook local l’état de tes sessions Cursor, sans envoyer le contenu du chat.</p>
    <div class="code"><span>python3 "$HOME/.config/tour/cursor-notify.py" working --session demo --project MonProjet</span><button type="button" data-copy='python3 "$HOME/.config/tour/cursor-notify.py" working --session demo --project MonProjet'>Copier</button></div>
    <p>Télécharge le script depuis <a href="/cursor-notify.py" download="cursor-notify.py">cursor-notify.py</a> dans <code>~/.config/tour/</code> après <code>install.sh</code>. États : <code>working</code>, <code>idle</code>, <code>finished</code>, <code>approval</code>, <code>error</code>.</p></details>
    <details><summary>Webhook générique</summary><p>POST JSON sur <code>${esc(location.origin)}/e?src=custom&amp;host=mon-service</code> avec l’en-tête <code>X-Tour-Token</code>. Corps minimal :</p>
    <div class="code"><span>{"hook_event_name":"cursor:working","session_id":"tache-1","cwd":"mon-projet"}</span><button type="button" data-copy='{"hook_event_name":"cursor:working","session_id":"tache-1","cwd":"mon-projet"}'>Copier</button></div>
    <p>Remplace <code>src=custom</code> par un nom court (20 caractères max). Mappe tes événements vers les états connus (<code>cursor:*</code>, <code>n8n:*</code>, <code>grok:*</code>) ou les hooks Claude/Codex.</p></details>
    <details><summary>Hermes et n8n</summary><p>La commande ci-dessus suit les journaux de Claude Code et Codex. Hermes et n8n se relient sur la machine ou le serveur qui les exécute ; ils ne sont pas installés automatiquement.</p>
    <p><b>Hermes</b> : si tes agents passent déjà par une tour locale, conserve ce pont. Pour une nouvelle installation de passerelle, récupère le <a href="/hermes-handler.py" download="handler.py">handler</a> et son <a href="/hermes-hook.yaml" download="HOOK.yaml">manifeste</a>, puis active ce hook dans Hermes. Le handler lit l’adresse et la clé dans <code>~/.config/tour/</code>.</p>
    <p><b>n8n</b> : ajoute un nœud HTTP Request aux étapes début, réussite et erreur. Méthode POST ; URL <code>${esc(location.origin)}/e?src=n8n&amp;host=n8n</code> ; en-tête <code>X-Tour-Token</code> avec la clé de ton étage dans un credential n8n.</p>
    <p>Corps JSON : <code>{"hook_event_name":"n8n:running","session_id":"ID de l’exécution","workflow":"Nom du workflow"}</code>. Utilise <code>n8n:success</code> ou <code>n8n:error</code> à la fin avec le même ID.</p></details>
    <details><summary>Pourquoi un quota peut manquer ?</summary><p>ChatGPT remonte automatiquement depuis les journaux Codex, si une mesure y est disponible. La commande n’installe pas la sonde Claude historique : elle lance une requête de modèle et doit être configurée séparément. Aucun quota n’est inventé et aucun appel payant n’est ajouté.</p></details>
    <details><summary>Remplacer une clé compromise</summary><p class="warn">Cette action déconnecte toutes les machines de cet étage, y compris un éventuel pont Hermes. Pour ajouter une machine, réutilise plutôt la clé actuelle.</p>
    <form class="key"><label>Ton nom<input name="name" value="${esc(me?.name ?? "")}" required></label>
    <label>Code du penthouse<input name="code" type="password" required></label>
    <label>Clé actuelle<input name="token" type="password" required autocomplete="off"></label><button>Remplacer la clé de toutes mes machines</button><p class="err" role="alert"></p></form></details>`;
  $("#linkBody .reuse-key")?.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.currentTarget, token = new FormData(form).get("token").trim();
    try {
      const r = await fetch("/api/connection", { headers: { "X-Tour-Token": token } }), j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Clé refusée.");
      if (j.slug !== me?.slug) throw new Error("Cette clé appartient à un autre étage.");
      sessionStorage.setItem("penthouse.cle", token); showLink();
    } catch (error) { form.querySelector(".err").textContent = error.message; }
  });
  $("#linkBody .key").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.currentTarget, fields = Object.fromEntries(new FormData(form));
    try {
      const r = await fetch("/api/key", { method: "POST", headers: { "X-Tour-Token": fields.token }, body: JSON.stringify({ name: fields.name, code: fields.code }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Remplacement refusé.");
      localStorage.setItem(ME, JSON.stringify({ slug: j.slug, name: j.name }));
      sessionStorage.setItem("penthouse.cle", j.token); showLink();
    } catch (error) { form.querySelector(".err").textContent = error.message; }
  });
  refreshConnectionStatus();
  if (!$("#linkDlg").open) $("#linkDlg").showModal();
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-spectate]")) { $("#spectatorDlg").showModal(); return; }
  const b = e.target.closest("[data-copy]");
  if (b) {
    if (!navigator.clipboard) { b.textContent = "Copie manuelle"; return; }
    navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = "Copié"; }).catch(() => { b.textContent = "Copie manuelle"; });
  }
});
$("#linkBtn").addEventListener("click", showLink);

function showHistory() {
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  const apt = data?.apartments.find(a => a.slug === me?.slug);
  if (!apt) return;
  const { sessionRows, feedRows } = historyEntries(apt, TOOLS, esc, hm);
  $("#historyBody").innerHTML = `<h4>Sessions</h4><table class="history-table"><thead><tr><th>Heure</th><th>Outil</th><th>Projet</th><th>État</th><th>Action</th></tr></thead><tbody>${sessionRows || "<tr><td colspan='5'>Rien pour l'instant.</td></tr>"}</tbody></table>
    <h4>Fil récent</h4><table class="history-table"><thead><tr><th>Heure</th><th>Outil</th><th>Projet</th><th colspan="2">Action</th></tr></thead><tbody>${feedRows || "<tr><td colspan='5'>Rien pour l'instant.</td></tr>"}</tbody></table>`;
  $("#historyDlg").showModal();
  $("#historyCsvBtn").onclick = () => {
    const blob = new Blob([historyCsv(apt)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `penthouse-${apt.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
}
function refreshMissionsDlg() {
  const apt = myApt();
  if (!apt?.game) return;
  $("#missionsXp").innerHTML = xpBarHtml(apt.game, esc);
  $("#missionsBadges").innerHTML = badgesHtml(apt.game, esc);
  const wings = (apt.game.wings ?? []).map(w => `<span class="badge">${esc(w.icon)} ${esc(w.name)}</span>`).join("");
  $("#missionsBody").innerHTML = (wings ? `<p class="extras-muted">Ailes débloquées</p><div class="badge-row">${wings}</div>` : "") + missionsHtml(apt.game, esc);
}
function showMissions() {
  refreshMissionsDlg();
  $("#missionsDlg").showModal();
}
$("#missionsBtn").addEventListener("click", showMissions);
$("#missionsBody").addEventListener("click", e => {
  const b = e.target.closest(".quest-claim");
  if (!b) return;
  runGameClaim(b.dataset.quest).catch(err => alert(err.message));
});

$("#historyBtn").addEventListener("click", showHistory);

// Entreprise : équipe et paie, boutique, casino, classements, banque (economy-ui.js).
const economyUi = createEconomyUi({
  dialog: $("#economyDlg"), body: $("#economyBody"), esc, tools: TOOLS,
  getData: () => data, getMine: () => myApt(), getToken: () => sessionStorage.getItem("penthouse.cle"),
  onEconomy: eco => { const me = myApt(); if (me && eco) me.economy = eco; if (data) render(); },
  celebrate: showCelebrations,
});
$("#ecoBtn").addEventListener("click", () => economyUi.open());
document.addEventListener("click", e => {
  const b = e.target.closest("[data-eco-open]");
  if (b && data?.viewer?.role !== "spectator") economyUi.open(b.dataset.ecoOpen);
});

// Menu « ⋯ » de l'en-tête : les actions moins fréquentes, pour un en-tête sur une ligne.
function setMoreMenu(open) {
  $("#moreMenu").hidden = !open;
  $("#moreBtn").setAttribute("aria-expanded", String(open));
}
$("#moreBtn").addEventListener("click", () => {
  setMoreMenu($("#moreMenu").hidden);
  if (!$("#moreMenu").hidden) [...$("#moreMenu").children].find(b => !b.hidden)?.focus();
});
$("#moreMenu").addEventListener("click", e => { if (e.target.closest("button")) setMoreMenu(false); });
document.addEventListener("click", e => { if (!e.target.closest("#moreWrap")) setMoreMenu(false); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || $("#moreMenu").hidden) return;
  setMoreMenu(false); $("#moreBtn").focus();
});
$("#moreWrap").addEventListener("focusout", e => { if (!$("#moreWrap").contains(e.relatedTarget)) setMoreMenu(false); });
// Hauteur réelle de l'en-tête (une ou deux lignes) : les panneaux se placent juste dessous.
new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", `${$("#topBar").offsetHeight}px`)).observe($("#topBar"));

function showCustomize() {
  const me = JSON.parse(localStorage.getItem(ME) ?? "null");
  const apt = data?.apartments.find(a => a.slug === me?.slug);
  if (!apt) return;
  const form = $("#customizeForm");
  form.accent.value = apt.profile?.accent ?? "#e8c27a";
  form.tagline.value = apt.profile?.tagline ?? "";
  form.theme.value = apt.profile?.theme ?? "classique";
  form.screens.value = (apt.profile?.screens ?? []).join(" / ");
  form.tv.value = apt.profile?.tv ? tvLinks(apt.profile.tv).page : "";
  $("#customizeDlg").showModal();
}
$("#customizeBtn").addEventListener("click", showCustomize);
$("#customizeForm").addEventListener("submit", async e => {
  e.preventDefault();
  const token = sessionStorage.getItem("penthouse.cle");
  if (!token) { $("#customizeErr").textContent = "Clé requise : ouvre Relier mes agents."; return; }
  const fields = Object.fromEntries(new FormData(e.currentTarget));
  $("#customizeErr").textContent = "";
  try {
    await saveProfile(token, { accent: fields.accent, tagline: fields.tagline, theme: fields.theme, screens: fields.screens, tv: fields.tv });
    $("#customizeDlg").close();
    await tick();
  } catch (error) { $("#customizeErr").textContent = error.message; }
});

$("#notifyBtn").addEventListener("click", async () => {
  if (typeof Notification === "undefined") { alert("Notifications non supportées par ce navigateur."); return; }
  const p = await Notification.requestPermission();
  $("#notifyBtn").textContent = p === "granted" ? "Alertes activées" : "Alertes refusées";
});

applyKioskFromUrl();
// Flux temps réel : ouvert une fois l'entrée acceptée et les modèles 3D chargés (sinon les étages se construiraient
// sans robot) ; rouvert après un changement de rôle (entrée résident, mode spectateur).
let stateStream = null;
function ensureStream(restart = false) {
  if (!modelsReady) return;
  if (!stateStream) stateStream = startStateStream(payload => { lastStreamAt = Date.now(); data = payload; applyLoadedState(); });
  else if (restart) stateStream.restart();
}

$("#spectate").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget, button = form.querySelector("button");
  button.disabled = true; $("#spectateErr").textContent = "";
  try {
    const r = await fetch("/api/spectate", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }), j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Salle inaccessible.");
    sessionStorage.removeItem("penthouse.cle"); order = [];
    $("#spectatorDlg").close();
    lastStreamAt = 0;
    await tick();
    ensureStream(true);
  } catch (error) { $("#spectateErr").textContent = error.message; }
  finally { button.disabled = false; }
});
$("#exitSpectator").addEventListener("click", async () => {
  try {
    const r = await fetch("/api/exit-spectator", { method: "POST", body: "{}" });
    if (!r.ok) return;
    location.reload();
  } catch { $("#exitSpectator").textContent = "Réessayer de quitter"; }
});

$("#join").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget, button = form.querySelector("button");
  button.disabled = true; $("#joinErr").textContent = "";
  try {
    const r = await fetch("/api/join", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Entrée impossible.");
    localStorage.setItem(ME, JSON.stringify({ slug: j.slug, name: j.name }));
    if (j.token) sessionStorage.setItem("penthouse.cle", j.token);
    else sessionStorage.removeItem("penthouse.cle");
    order = [];
    lastStreamAt = 0;
    await tick();
    ensureStream(true);
    if (j.token) showLink();
  } catch (error) { $("#joinErr").textContent = error.message || "Serveur injoignable. Réessaie."; }
  finally { button.disabled = false; }
});

let tickPending = false, lastStreamAt = 0;
function applyLoadedState() {
  if (!data) return;
  const spectator = data.viewer?.role === "spectator";
  if (spectator && !document.body.dataset.spectating) {
    tourStarted = clock.elapsedTime; tourPaused = false;
    document.body.dataset.spectating = "true";
  }
  if (!spectator) delete document.body.dataset.spectating;
  $("#tourPause").hidden = !spectator;
  $("#tourCaption").hidden = !spectator || tourPaused;
  document.body.classList.toggle("spectator-presentation", spectator && !tourPaused);
  if (!spectator) $("#spectatorDashboard").hidden = true;
  $("#viewerBadge").hidden = !spectator;
  $("#exitSpectator").hidden = !spectator;
  const resident = !spectator;
  $("#linkBtn").hidden = spectator;
  $("#spectatorBtn").hidden = spectator;
  $("#historyBtn").hidden = !resident;
  $("#customizeBtn").hidden = !resident;
  $("#notifyBtn").hidden = !resident;
  $("#missionsBtn").hidden = !resident;
  $("#moreWrap").hidden = [...$("#moreMenu").children].every(b => b.hidden);
  if (spectator && $("#linkDlg").open) $("#linkDlg").close();
  if (Date.now() > tvMine) ({ channel: tvChoice = "auto", by: tvBy = "", custom: tvCustom = null } = data.tv ?? {});
  $("#lobby").hidden = true;
  $("#app").hidden = false;
  render();
  refreshConnectionStatus();
}
async function tick() {
  if (document.hidden || tickPending) return;
  if (lastStreamAt && Date.now() - lastStreamAt < 4500) return;
  tickPending = true;
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.status === 401) {
      stateStream?.close(); stateStream = null; lastStreamAt = 0;
      $("#lobby").hidden = false; $("#app").hidden = true;
      $("#permissionBanner").hidden = true; $("#permissionGlow").hidden = true;
      previousApprovals.clear(); activeApproval = null;
      $("#permissionFlash").getAnimations().forEach(animation => animation.cancel());
      return;
    }
    if (!r.ok) throw new Error("État indisponible (HTTP " + r.status + ").");
    data = await r.json();
    applyLoadedState();
    ensureStream();
  } catch (e) { console.warn("tour : nouvel essai au prochain tour", e); }
  finally { tickPending = false; }
}

// Modèles 3D : meubles Kenney et robot de Quaternius, tous CC0 (voir /assets/CREDITS.txt).
const FURNITURE = ["desk", "chairDesk", "computerScreen", "computerKeyboard", "pottedPlant", "bookcaseOpen", "lampSquareFloor", "rugRectangle",
  "televisionModern", "kitchenBar", "kitchenCoffeeMachine", "kitchenFridgeSmall", "tableRound", "stoolBar", "trashcan", "bench", "loungeSofa",
  "loungeChairRelax", "rugRound", "lampRoundFloor", "tableCoffee", "speaker", "loungeDesignSofa", "toilet", "bathroomSink",
  "chairCushion", "kitchenBlender", "toaster", "plantSmall1", "coatRackStanding"];
const MODELS = {};
async function loadModels() {
  const loader = new GLTFLoader();
  await Promise.all([...FURNITURE.map(async name => {
    try {
      const gltf = await loader.loadAsync(`assets/${name}.glb`);
      // Recentrage : le modèle se pose par le centre de sa base.
      const box3 = new THREE.Box3().setFromObject(gltf.scene), c = box3.getCenter(new THREE.Vector3());
      gltf.scene.position.set(-c.x, -box3.min.y, -c.z);
      MODELS[name] = new THREE.Group().add(gltf.scene);
    } catch { /* meuble manquant : l'étage s'en passe */ }
  }), ...redBullEditions.map(async edition => {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(`assets/${edition.image}.png`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      redBullTextures.set(edition.image, texture);
    } catch { /* La canette garde sa couleur si le visuel n'est pas disponible. */ }
  })]);
  const robot = await loader.loadAsync("assets/robot.glb");
  const h = new THREE.Box3().setFromObject(robot.scene).getSize(new THREE.Vector3()).y;
  MODELS.robot = { scene: robot.scene, animations: robot.animations, scale: 1.45 / h };
}

var modelsReady = false; // var : lu par ensureStream, défini plus haut, avant la fin du chargement
document.addEventListener("visibilitychange", () => { if (modelsReady && !document.hidden) { tick(); refreshLive(); } });
setInterval(() => { if (document.hidden) return; $("#clock").textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }, 1000);
await Promise.all([document.fonts.ready, loadModels()]);
modelsReady = true;
async function refreshLive() {
  if (document.hidden) return;
  try { const r = await fetch("/api/live"); if (r.ok) { liveNow = await r.json(); if (data) render(); } } catch { /* nouvel essai dans une minute */ }
}
tick();
setInterval(tick, 2000);
refreshLive();
setInterval(refreshLive, 60_000);
animate();
