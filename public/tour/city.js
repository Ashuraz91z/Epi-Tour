// La ville autour de la tour : immeubles instanciés et leur shader de fenêtres, rues, ciel, panneaux sur les
// immeubles voisins (classement, quotas), avions et oiseaux, fût de la tour sous l’étage regardé.

import * as THREE from "three";
import { world } from "./state.js";
import { FLOOR_H, claudeTracked, quotaRows, stateOf } from "./base.js";
import { box, glow, instancedCrowd, mat, scene } from "./engine.js";

// ---------- la ville autour ----------
// Les fenêtres sont calculées par le shader d'après la position dans le monde : toute la ville tient en un seul
// maillage instancié (un appel de dessin), et les fenêtres de la tour s'alignent sur ses étages.
// Les immeubles ne reçoivent que le ciel, l'ambiance et la lune : sur une face plate, cette lumière est la même en
// chaque point. Elle est donc calculée une fois par sommet (matériau de base, sans éclairage par pixel), au lieu de
// faire passer chaque pixel de la ville, qui couvre la moitié de l'écran, par le modèle physique et les lampes des
// étages, qui ne l'atteignent pas. Même rendu (ciel, sol, lune et ambiance de la scène), bien moins de calcul.
const SKY_LIGHT = { sky: "#8ea6ff", ground: "#20160f", hemi: 0.9, ambient: "#ffffff", ambientI: 0.25, moon: "#c9d6ff", moonI: 1.1, moonAt: [-30, 60, 20] };
const cityLightUniforms = (() => {
  const lin = (c, k) => new THREE.Color(c).multiplyScalar(k / Math.PI); // BRDF de Lambert, comme le matériau standard
  return {
    uSky: { value: lin(SKY_LIGHT.sky, SKY_LIGHT.hemi) }, uGround: { value: lin(SKY_LIGHT.ground, SKY_LIGHT.hemi) },
    uAmb: { value: lin(SKY_LIGHT.ambient, SKY_LIGHT.ambientI) }, uMoon: { value: lin(SKY_LIGHT.moon, SKY_LIGHT.moonI) },
    uMoonDir: { value: new THREE.Vector3(...SKY_LIGHT.moonAt).normalize() },
  };
})();
// Sans fenêtres (cellW nul) : sol, chaussées et trottoirs, éclairés de la même façon.
function cityMaterial(cellW, cellH, lit, color = "#0d1120") {
  const m = new THREE.MeshBasicMaterial({ color });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, cityLightUniforms, { uCell: { value: new THREE.Vector2(cellW, cellH) }, uLit: { value: lit } });
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
        varying vec3 vCityP;\nvarying vec3 vCityN;\nvarying vec3 vCityL;
        uniform vec3 uSky, uGround, uAmb, uMoon, uMoonDir;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
        mat4 cityM = modelMatrix;
        #ifdef USE_INSTANCING
          cityM = modelMatrix * instanceMatrix;
        #endif
        vCityP = (cityM * vec4(transformed, 1.0)).xyz;
        vCityN = normalize(mat3(cityM) * normal);
        vCityL = uAmb + mix(uGround, uSky, 0.5 * vCityN.y + 0.5) + uMoon * max(dot(vCityN, uMoonDir), 0.0);`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vCityP;\nvarying vec3 vCityN;\nvarying vec3 vCityL;\nuniform vec2 uCell;\nuniform float uLit;")
      .replace("#include <aomap_fragment>", "reflectedLight.indirectDiffuse *= vCityL;")
      .replace("#include <envmap_fragment>", !cellW ? "" : `
        vec2 cw = vec2(abs(vCityN.x) > 0.5 ? vCityP.z : vCityP.x, vCityP.y) / uCell;
        vec2 cid = floor(cw), cf = fract(cw);
        float rr = fract(sin(dot(cid, vec2(12.9898, 78.233))) * 43758.5453);
        float win = step(0.22, cf.x) * step(cf.x, 0.78) * step(0.28, cf.y) * step(cf.y, 0.82) * step(rr, uLit) * step(abs(vCityN.y), 0.5);
        outgoingLight += win * mix(vec3(1.0, 0.78, 0.45), vec3(0.62, 0.78, 1.0), step(0.78, rr / uLit)) * 0.7;`);
  };
  return m;
}
// Boîte d'immeuble sans sa face du dessous (jamais vue), posée sur sa base.
const CITY_BOX = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), index = g.index.array;
  g.setIndex([...index].filter((_, i) => Math.floor(i / 6) !== 3)); // faces : +x, -x, +y, -y, +z, -z
  g.clearGroups();
  return g;
})();
// La ville est dessinée après les étages (renderOrder) : ce que l'étage regardé cache n'est plus calculé du tout.
const BEHIND = 1;
const GROUND = -150, CELL = 18;
const AD_SITE = { x: -2 * CELL, z: -3 * CELL }, USAGE_SITE = { x: 18, z: -54 };
const beacons = new THREE.MeshBasicMaterial({ color: "#ff3030", fog: false });
const BEACON_ON = new THREE.Color("#ff3030"), BEACON_OFF = new THREE.Color("#3a0808");
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
  // Les plus proches d'abord : ils cachent ceux de derrière, dont les pixels sont alors écartés avant d'être calculés.
  spots.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  const m4 = new THREE.Matrix4();
  const town = new THREE.InstancedMesh(CITY_BOX, cityMaterial(1.2, 2.4, 0.33), spots.length);
  spots.forEach(([x, z, w, d, h], k) => town.setMatrixAt(k, m4.makeScale(w, h, d).setPosition(x, GROUND, z)));
  town.renderOrder = BEHIND;
  scene.add(town);
  // Feux rouges sur les plus hauts toits
  const tall = spots.filter(s => GROUND + s[4] > -45);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), beacons, tall.length);
  tall.forEach(([x, z, , , h], k) => lights.setMatrixAt(k, m4.makeTranslation(x, GROUND + h + 0.6, z)));
  lights.renderOrder = BEHIND;
  scene.add(lights);
  // Le sol et ses rues, entre les îlots : presque entièrement caché par les immeubles, dessiné en dernier.
  box(scene, 560, 1, 560, cityMaterial(0, 0, 0, "#05070d"), 0, GROUND - 0.5, 0).renderOrder = BEHIND + 2;
  // Chaussées pleines, trottoirs et marquage, au niveau du sol.
  const roads = new THREE.InstancedMesh(CITY_BOX, cityMaterial(0, 0, 0, "#303644"), 58);
  const sidewalks = new THREE.InstancedMesh(CITY_BOX, cityMaterial(0, 0, 0, "#555966"), 58);
  const markings = [];
  for (let i = -14; i <= 14; i++) {
    const lane = i * CELL + CELL / 2, k = (i + 14) * 2;
    roads.setMatrixAt(k, m4.makeScale(540, 0.12, 5).setPosition(0, GROUND + 0.06, lane));
    roads.setMatrixAt(k + 1, m4.makeScale(5, 0.12, 540).setPosition(lane, GROUND + 0.06, 0));
    sidewalks.setMatrixAt(k, m4.makeScale(540, 0.12, 7).setPosition(0, GROUND - 0.04, lane));
    sidewalks.setMatrixAt(k + 1, m4.makeScale(7, 0.12, 540).setPosition(lane, GROUND - 0.04, 0));
    for (let j = -44; j <= 44; j++) {
      const p = j * 6;
      // Laisser les carrefours libres de pointillés.
      if (Math.abs(((p % CELL) + CELL) % CELL - CELL / 2) < 4) continue;
      markings.push(p - 1, GROUND + 0.19, lane, p + 1, GROUND + 0.19, lane,
        lane, GROUND + 0.19, p - 1, lane, GROUND + 0.19, p + 1);
    }
  }
  sidewalks.renderOrder = roads.renderOrder = BEHIND + 1;
  scene.add(sidewalks, roads);
  const roadLines = new THREE.BufferGeometry();
  roadLines.setAttribute("position", new THREE.Float32BufferAttribute(markings, 3));
  const lines = new THREE.LineSegments(roadLines, new THREE.LineBasicMaterial({ color: "#c7bfa3" }));
  lines.renderOrder = BEHIND + 1;
  scene.add(lines);
  const stars = new THREE.BufferGeometry(), pts = [];
  for (let i = 0; i < 700; i++) {
    const a = rnd() * Math.PI * 2, e = 0.15 + rnd() * 1.2, R = 400;
    pts.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R - 60, Math.sin(a) * Math.cos(e) * R);
  }
  stars.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const sky = new THREE.Points(stars, new THREE.PointsMaterial({ color: "#cfd8ff", size: 1.2, sizeAttenuation: false, fog: false }));
  const moonBall = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: "#f3efe0", fog: false }));
  moonBall.position.set(-160, 120, -260);
  sky.renderOrder = moonBall.renderOrder = BEHIND + 3;
  scene.add(sky, moonBall);
  // Rien de tout cela ne bouge : leurs matrices sont calculées une fois.
  for (const o of [town, lights, roads, sidewalks, lines, sky, moonBall]) { o.updateMatrix(); o.matrixAutoUpdate = false; }
})();

// Immeuble voisin : une vraie enseigne sur le toit, avec le classement issu du direct.
const neighbour = new THREE.Group(); neighbour.position.set(AD_SITE.x, 0, AD_SITE.z); scene.add(neighbour);
box(neighbour, 13, 135, 13, cityMaterial(1.2, 2.4, 0.4), 0, -82.5, 0).renderOrder = BEHIND;
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
    // Claude sans aucune mesure reçue : le dire, plutôt que deux jauges vides.
    if (!k && !claudeTracked(resident?.usage)) {
      c.fillStyle = "#f6f8fa"; c.font = "700 48px Sora, sans-serif"; c.fillText("Quota non suivi", x + 24, 320, 492);
      c.fillStyle = "#bdcbd9"; c.font = "400 26px Sora, sans-serif";
      c.fillText("Mesuré automatiquement après avoir", x + 24, 380, 492);
      c.fillText("relancé la commande de l’étage.", x + 24, 416, 492);
      return;
    }
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

// Un peu de vie à l'extérieur : avions lointains et oiseaux autour de la tour (les voitures, les parcs et les lampadaires
// du pied de la tour ont été retirés : invisibles depuis l'étage regardé, ils coûtaient une dizaine d'appels de dessin).
const outside = new THREE.Group();
scene.add(outside);
const reducedOutsideMotion = matchMedia("(prefers-reduced-motion: reduce)");
const planes = [];
for (let i = 0; i < 2; i++) {
  const plane = new THREE.Group();
  box(plane, 0.5, 0.4, 4, mat("#7c879b"), 0, 0, 0);
  box(plane, 5, 0.12, 0.8, mat("#7c879b"), 0, 0, 0);
  box(plane, 0.2, 0.2, 0.2, glow("#e85858"), -2.5, 0, 0);
  box(plane, 0.2, 0.2, 0.2, glow("#74d9ad"), 2.5, 0, 0);
  plane.rotation.y = Math.PI / 2;
  plane.position.set(0, 75 + i * 24, -160 - i * 65);
  planes.push(plane);
}
const birds = [];
for (let i = 0; i < 6; i++) {
  const bird = new THREE.Group();
  const wings = [-1, 1].map(side => box(bird, 0.45, 0.04, 0.15, mat("#a8b1c6"), side * 0.22, 0, 0));
  birds.push({ bird, wings });
}
// Avions et oiseaux restent des groupes animés hors scène ; on en dessine les pièces en instances.
const outsideCrowds = [instancedCrowd(planes, outside), instancedCrowd(birds.map(b => b.bird), outside)];
const syncOutside = () => { for (const sync of outsideCrowds) sync(); };
function animateOutside(t) {
  // Le temps est figé si le visiteur demande moins de mouvement.
  const time = reducedOutsideMotion.matches ? 0 : t;
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
tower.renderOrder = BEHIND;
scene.add(tower);

export {
  AD_SITE, BEACON_OFF, BEACON_ON, GROUND, USAGE_SITE, animateOutside, beacons, syncOutside, tower,
  updateBillboard, updateUsageBoard,
};
