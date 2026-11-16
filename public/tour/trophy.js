// Trophée de la Ligue de la semaine : une coupe dorée sur socle, à côté du nom de l'étage du ou de la champion·ne de
// la semaine passée, avec une plaque « Champion · semaine N ». Posé après la construction de l'étage (donc jamais
// fusionné par bakeStatic) et déplacé si l'étage est reconstruit ou si le titre change de main. Élément de jeu : caché
// en mode productif. Il ne tourne que sur l'étage regardé.
import * as THREE from "three";
import { world } from "./state.js";
import { box, glow, mat, sign } from "./engine.js";
import { productive } from "./mode.js";

const POS = new THREE.Vector3(-7.25, 2.75, -6.1); // à gauche du nom de l'étage, contre la vitre du fond
let trophy = null, onFloor = null, plaqueText = "";

function cupGeometry() {
  // Profil de la coupe (rayon, hauteur) tourné autour de l'axe : pied, tige, vasque évasée.
  const p = [[0, 0], [0.34, 0], [0.34, 0.06], [0.14, 0.12], [0.07, 0.2], [0.07, 0.42], [0.16, 0.5], [0.34, 0.62],
    [0.44, 0.86], [0.46, 1.02], [0.42, 1.04], [0.38, 0.88], [0.28, 0.7], [0.1, 0.58], [0, 0.56]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(p, 28);
}

function build() {
  const g = new THREE.Group(), cup = new THREE.Group();
  const gold = mat("#e8c27a", { metalness: 0.85, roughness: 0.22, emissive: "#6b4a10", emissiveIntensity: 0.55 });
  const marble = mat("#14161d", { roughness: 0.35, metalness: 0.1 });
  box(g, 0.95, 0.42, 0.95, marble, 0, 0.21, 0);
  box(g, 1.0, 0.05, 1.0, gold, 0, 0.44, 0);
  box(g, 1.0, 0.05, 1.0, gold, 0, 0.0, 0);
  cup.add(new THREE.Mesh(cupGeometry(), gold));
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 10, 20, Math.PI * 1.25), gold);
    handle.position.set(side * 0.44, 0.84, 0);
    handle.rotation.z = side > 0 ? -Math.PI * 0.62 : Math.PI * 0.38;
    cup.add(handle);
  }
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), glow("#ffe6a8", 2.2));
  star.position.y = 1.24;
  cup.add(star);
  cup.position.y = 0.47;
  cup.scale.setScalar(1.15);
  g.add(cup);
  g.position.copy(POS);
  g.userData = { cup, star, plaque: null };
  return g;
}

function setPlaque(g, text) {
  if (plaqueText === text) return;
  plaqueText = text;
  if (g.userData.plaque) { g.remove(g.userData.plaque); g.userData.plaque.material.map?.dispose(); g.userData.plaque.material.dispose(); }
  g.userData.plaque = sign(g, text, 1.25, 0.32, { color: "#e8c27a", font: "700 64px Sora, sans-serif", w: 512, h: 128, blur: 14 }, 0, 0.22, 0.49);
}

// À chaque état reçu : le trophée rejoint l'étage de travail du champion de la semaine passée, ou disparaît.
export function syncTrophy(floors) {
  const league = world.data?.league, slug = league?.last?.champion;
  const f = slug && !productive() ? floors.get(`${slug}:work`) : null;
  if (!f) { if (trophy) trophy.visible = false; return; }
  trophy ??= build();
  if (onFloor !== f) { f.group.add(trophy); onFloor = f; } // étage reconstruit ou nouveau champion
  trophy.visible = true;
  const n = league.titles?.[slug] ?? 1;
  setPlaque(trophy, `CHAMPION · S${league.last.number}${n > 1 ? ` · ×${n}` : ""}`);
}

// Rotation lente de la coupe et scintillement de l'étoile, seulement sur l'étage regardé.
export function animateTrophy(dt, t, focusKey) {
  if (!trophy?.visible || !onFloor || focusKey !== `${onFloor.residentSlug}:work`) return;
  const { cup, star } = trophy.userData;
  cup.rotation.y += dt * 0.6;
  star.rotation.y -= dt * 2;
  star.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
}
