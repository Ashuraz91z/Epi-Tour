// Kit commun des étages : géométries et matériaux partagés (disque, balle, anneau, zone de clic), textures dessinées
// à la main, panneaux redessinés seulement quand ils changent, zones de jeu cliquables, préférence « moins d'animations ».

import * as THREE from "three";
import { box, renderer } from "./engine.js";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Créés une seule fois ; chaque matériau animé appartient à son objet (rien de partagé n'est modifié).
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false }); // zones de clic : jamais dessinées, mais touchées par le rayon
const discGeometry = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const ballGeometry = new THREE.SphereGeometry(1, 14, 10);
const mod1 = v => v - Math.floor(v);
const easeOut = k => 1 - (1 - k) ** 3;
// Texture dessinée une fois (casino, tennis, golf) ; à ne pas confondre avec canvasTexture de l'étage cyberpunk.
function drawnTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
// Panneau dessiné à la main : sa texture n'est renvoyée à la carte graphique que quand son contenu change (clé comparée).
function canvasPanel(parent, w, h, pxW, pxH, x, y, z, ry = 0) {
  const tex = drawnTexture(pxW, pxH, () => {});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  parent.add(mesh);
  return { ctx: tex.image.getContext("2d"), tex, mesh, w: pxW, h: pxH, key: "" };
}
// Zone de clic : « casino » ouvre cet onglet du dialogue Entreprise ; « tennis » et « golf », le mini-jeu.
function playTarget(f, parent, w, h, d, x, y, z, tab, ry = 0) {
  const m = box(parent, w, h, d, hitMaterial, x, y, z, ry);
  m.userData.tab = tab;
  (f.playTargets ??= []).push(m);
  return m;
}
const agoText = s => s < 90 ? "à l'instant" : s < 3600 ? `il y a ${Math.round(s / 60)} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`;

const ringGeometry = new THREE.TorusGeometry(0.42, 0.035, 8, 36);
const orbGeometry = new THREE.SphereGeometry(0.07, 12, 8);
const puffGeometry = new THREE.SphereGeometry(0.08, 8, 6);

export {
  agoText, ballGeometry, canvasPanel, discGeometry, drawnTexture, easeOut, hitMaterial, mod1, orbGeometry,
  playTarget, puffGeometry, reducedMotion, ringGeometry,
};
