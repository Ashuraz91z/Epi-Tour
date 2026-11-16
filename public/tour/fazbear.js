// Équipe Fazbear de Briac : ses agents Hermes deviennent des sprites (panneaux toujours face à la caméra).
// Ne touche qu'à l'étage de Briac ; les autres résidents gardent les robots.
import * as THREE from "three";

const OWNER = "briac";
const HEIGHT = 1.7;
const TEAM = {
  freddy: { name: "Freddy - Chef de Projet", sprite: "/assets/fazbearFreddy.webp" },
  chica: { name: "Chica - Designer", sprite: "/assets/fazbearChica.webp" },
  bonnie: { name: "Bonnie - Développeur", sprite: "/assets/fazbearBonnie.webp" },
  foxy: { name: "Foxy - Relecteur", sprite: "/assets/fazbearFoxy.webp" },
  // Pas de sprite fourni pour le manager : il garde le robot, seul le nom change.
  "golden-freddy": { name: "Golden Freddy - Manager" },
};

const textures = new Map(), waiting = new Map();
const loader = new THREE.TextureLoader();
const ratioOf = t => t.image?.width && t.image?.height ? t.image.width / t.image.height : 0.6;
const textureOf = url => {
  if (!textures.has(url)) {
    waiting.set(url, new Set());
    const t = loader.load(url, () => {
      for (const sprite of waiting.get(url)) sprite.scale.set(HEIGHT * ratioOf(t), HEIGHT, 1);
      waiting.delete(url);
    });
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(url, t);
  }
  return textures.get(url);
};

// Le personnage Fazbear d'une session, seulement chez Briac.
const fazbearOf = (apt, s) => apt?.slug === OWNER && s?.src === "hermes" ? TEAM[s.persona] ?? null : null;

// Remplace le robot par le sprite du personnage (anneau d'état, bulle et zone de clic conservés).
function dressAgent(g, member) {
  if (!member?.sprite || g.userData.fazbear) return;
  const u = g.userData;
  g.children[0].visible = false;
  u.orb.visible = false;
  u.cup.scale.setScalar(0); // la boucle d'animation repilote sa visibilité
  const texture = textureOf(member.sprite);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1 });
  material.userData.fazbear = true;
  const sprite = new THREE.Sprite(material);
  sprite.userData.tourMaterial = true; // libéré avec l'agent
  sprite.scale.set(HEIGHT * ratioOf(texture), HEIGHT, 1);
  waiting.get(member.sprite)?.add(sprite);
  sprite.position.y = HEIGHT / 2;
  g.add(sprite);
  u.fazbear = sprite;
}

export { TEAM, dressAgent, fazbearOf };
