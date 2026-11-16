// Équipe Fazbear de Briac : Freddy, Chica, Bonnie et Foxy vivent en permanence sur son étage de travail, en sprites
// (panneaux toujours face à la caméra) animés, avec leur nom dans la bulle. Une session Hermes de leur profil ne crée
// plus de robot : le personnage va à son poste et sa bulle ajoute la demande (titre de tâche) ou l'action.
// Ne touche qu'à l'étage de Briac ; les autres résidents gardent les robots.
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { world } from "./state.js";
import { P, RES_SLOTS, stateOf } from "./base.js";

const OWNER = "briac", FLOOR = `${OWNER}:work`;
const HEIGHT = 1.7;
const TEAM = {
  freddy: { name: "Freddy - Chef de Projet", sprite: "/assets/fazbearFreddy.webp" },
  chica: { name: "Chica - Designer", sprite: "/assets/fazbearChica.webp" },
  bonnie: { name: "Bonnie - Développeur", sprite: "/assets/fazbearBonnie.webp" },
  foxy: { name: "Foxy - Relecteur", sprite: "/assets/fazbearFoxy.webp" },
  // Pas de sprite fourni pour le manager : il garde le robot, seul le nom change.
  "golden-freddy": { name: "Golden Freddy - Manager" },
};
const CREW = ["freddy", "chica", "bonnie", "foxy"];

// Les .webp fournis sont animés (8 images) : WebGL n'en lit que la première, alors on les décode image par image
// (ImageDecoder) et on les rejoue dans une texture-canvas. Sans ImageDecoder, l'image fixe reste, animée par le code.
const sheets = new Map();
function sheetOf(url) {
  if (sheets.has(url)) return sheets.get(url);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sheet = { canvas, texture, frames: [], total: 0, ratio: 0.6, users: new Set(), shown: -1 };
  sheets.set(url, sheet);
  (async () => {
    const data = await (await fetch(url)).arrayBuffer();
    if ("ImageDecoder" in window) {
      const dec = new ImageDecoder({ data, type: "image/webp" });
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack?.frameCount || 1;
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const bmp = await createImageBitmap(image);
        sheet.frames.push({ bmp, ms: Math.max(60, (image.duration ?? 120000) / 1000) });
        image.close();
      }
    } else {
      sheet.frames.push({ bmp: await createImageBitmap(new Blob([data])), ms: 1e9 });
    }
    sheet.total = sheet.frames.reduce((s, f) => s + f.ms, 0);
    const { bmp } = sheet.frames[0];
    canvas.width = bmp.width; canvas.height = bmp.height;
    texture.dispose(); // nouvelle taille de canvas : la texture GPU est recréée
    sheet.ratio = bmp.width / bmp.height;
    for (const sp of sheet.users) sp.scale.set(HEIGHT * sheet.ratio, HEIGHT, 1);
    drawFrame(sheet, 0);
  })().catch(() => {});
  return sheet;
}
function drawFrame(sheet, i) {
  if (sheet.shown === i || !sheet.frames[i]) return;
  const ctx = sheet.canvas.getContext("2d");
  ctx.clearRect(0, 0, sheet.canvas.width, sheet.canvas.height);
  ctx.drawImage(sheet.frames[i].bmp, 0, 0);
  sheet.texture.needsUpdate = true;
  sheet.shown = i;
}
function tickSheet(sheet, t) {
  if (!sheet.total) return;
  let ms = (t * 1000) % sheet.total, i = 0;
  while (ms > sheet.frames[i].ms) { ms -= sheet.frames[i].ms; i++; }
  drawFrame(sheet, i);
}

// Le personnage Fazbear d'une session, seulement chez Briac.
const fazbearOf = (apt, s) => apt?.slug === OWNER && s?.src === "hermes" ? TEAM[s.persona] ?? null : null;
// Session portée par un membre permanent de l'équipe : pas de robot, elle anime le personnage.
const crewSession = (apt, s) => apt?.slug === OWNER && s?.src === "hermes" && CREW.includes(s.persona);

// Texte de la bulle : le nom en permanence, plus la demande ou l'action quand une session tourne.
function crewText(name, s, st) {
  if (st === "autorisation") return `${name} · Autorise-moi ?`;
  if (st === "erreur") return `${name} · Erreur`;
  if (st !== "travaille") return name;
  const what = [s.task, s.action].filter(Boolean).join(" — ");
  return `${name} · ${what || "au travail"}`;
}

// Postes de travail (4 premiers bureaux) et coins où l'équipe flâne au repos.
const DESK = k => { const [x, y] = RES_SLOTS.open[k]; return P(x, y + 30); };
const SPOTS = [...RES_SLOTS.boss.map(([x, y]) => P(x, y)), ...RES_SLOTS.open.slice(4, 9).map(([x, y]) => P(x, y + 30))];

const crew = new Map();
let crewFloor = null;

function makeMember(id, k) {
  const m = TEAM[id], sheet = sheetOf(m.sprite);
  const g = new THREE.Group();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sheet.texture, transparent: true, alphaTest: 0.1 }));
  sprite.scale.set(HEIGHT * sheet.ratio, HEIGHT, 1);
  sprite.center.set(0.5, 0);
  sheet.users.add(sprite);
  g.add(sprite);
  const el = document.createElement("div");
  el.className = "bubble3d who";
  el.textContent = m.name;
  const bubble = new CSS2DObject(el);
  bubble.position.set(0, HEIGHT + 0.25, 0);
  g.add(bubble);
  g.position.copy(SPOTS[(k * 3) % SPOTS.length]);
  g.userData = { id, k, sheet, sprite, bubble, target: null, wait: 1 + k, state: null, phase: k * 1.7 };
  return g;
}

// À chaque état reçu : l'équipe rejoint l'étage de Briac (même reconstruit) et la bulle suit sa session Hermes.
function syncCrew(floors, now) {
  const f = floors.get(FLOOR);
  if (!f) return;
  const apt = world.residents.find(a => a.slug === OWNER);
  if (crewFloor !== f) {
    if (!crew.size) CREW.forEach((id, k) => crew.set(id, makeMember(id, k)));
    for (const g of crew.values()) f.group.add(g);
    crewFloor = f;
  }
  for (const g of crew.values()) {
    const u = g.userData;
    const s = (apt?.sessions ?? []).filter(x => crewSession(apt, x) && x.persona === u.id).sort((a, b) => b.updated - a.updated)[0];
    u.state = s ? stateOf(s, now) : null;
    const text = crewText(TEAM[u.id].name, s, u.state);
    const cls = "bubble3d" + (u.state === "autorisation" ? " auth" : u.state === "travaille" || u.state === "erreur" ? "" : " who");
    if (u.bubble.element.textContent !== text) u.bubble.element.textContent = text;
    if (u.bubble.element.className !== cls) u.bubble.element.className = cls;
  }
}

const tmp = new THREE.Vector3();
// Au repos : flâne d'un coin à l'autre et se balance. Session en cours : marche jusqu'à son bureau et y saute.
function animateCrew(dt, t, focusKey) {
  if (!crew.size) return;
  const shown = focusKey === FLOOR;
  if (!shown) {
    // Étage non regardé : on cache les bulles et on ne calcule rien d'autre.
    for (const g of crew.values()) g.userData.bubble.visible = false;
    return;
  }
  for (const g of crew.values()) {
    const u = g.userData;
    u.bubble.visible = true;
    const busy = u.state === "travaille" || u.state === "autorisation";
    if (busy) u.target = DESK(u.k);
    else if (u.target === u.desk || (!u.target && (u.wait -= dt) <= 0)) u.target = SPOTS[Math.floor(Math.random() * SPOTS.length)];
    u.desk = busy ? u.target : null;
    let walking = false;
    if (u.target) {
      tmp.subVectors(u.target, g.position); tmp.y = 0;
      const d = tmp.length(), step = dt * 1.6;
      if (d <= step) { g.position.x = u.target.x; g.position.z = u.target.z; if (!busy) { u.target = null; u.wait = 3 + Math.random() * 5; } }
      else { tmp.normalize(); g.position.x += tmp.x * step; g.position.z += tmp.z * step; walking = true; u.flip = tmp.x < 0; }
    }
    if (!shown) continue;
    tickSheet(u.sheet, t + u.phase);
    const p = t * (walking ? 9 : busy ? 6 : 2) + u.phase;
    u.sprite.position.y = walking ? Math.abs(Math.sin(p)) * 0.08 : busy ? Math.max(0, Math.sin(p)) * 0.35 : 0;
    u.sprite.material.rotation = busy && !walking ? 0 : Math.sin(p) * (walking ? 0.06 : 0.05);
    u.sprite.scale.set(HEIGHT * u.sheet.ratio * (u.flip ? -1 : 1), HEIGHT, 1);
  }
}

// Plus de robot habillé : l'équipe permanente remplace les sessions de ses profils (voir crewSession).
function dressAgent() {}

export { TEAM, animateCrew, crewSession, crewText, dressAgent, fazbearOf, syncCrew };
