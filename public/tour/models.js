// Modèles glTF (Kenney, Quaternius) : chargés une fois au démarrage, puis clonés par put() et makeRobot().

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { world } from "./state.js";
import { redBullEditions, redBullTextures, renderer } from "./engine.js";
import { mergeRobotParts } from "./robots.js";

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
  const robotHeight = new THREE.Box3().setFromObject(robot.scene).getSize(new THREE.Vector3()).y;
  try { mergeRobotParts(robot.scene); } catch (error) { console.warn("3D : robot gardé en pièces détachées", error); }
  MODELS.robot = { scene: robot.scene, animations: robot.animations, scale: 1.45 / robotHeight };
}

export { MODELS, loadModels };
