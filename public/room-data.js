// Studio de la salle : ce que chaque résident peut choisir pour son étage, et les presets prêts à l'emploi.
// Partagé par le serveur (core.js vérifie chaque valeur) et par l'interface (formulaire « Mon étage », rendu 3D).
// « auto » laisse l'ambiance de base (classique, cyberpunk, Prestige) décider ; les objets sont gratuits et ne
// remplacent ni les paliers d'aménagement (XP) ni le décor de la boutique.

export const ROOM_OPTIONS = {
  sol: [
    ["auto", "Selon l'ambiance"], ["chene", "Parquet chêne clair"], ["chevrons", "Parquet à chevrons"], ["marbre", "Marbre clair"],
    ["beton", "Béton ciré"], ["tatami", "Tatamis"], ["damier", "Damier noir et blanc"], ["resine", "Résine noire brillante"], ["gazon", "Gazon de golf"],
  ],
  murs: [
    ["auto", "Selon l'ambiance"], ["ardoise", "Ardoise"], ["noyer", "Noyer et liseré doré"], ["blanc", "Blanc mat"],
    ["beton", "Béton brut"], ["noir", "Noir et laiton"], ["neon", "Néon à ta couleur"],
  ],
  bureaux: [["auto", "Selon l'ambiance"], ["moderne", "Modernes"], ["ministre", "Bureaux de ministre"]],
  lumiere: [
    ["auto", "Selon l'ambiance"], ["chaude", "Chaude"], ["naturelle", "Lumière du jour"], ["froide", "Froide"],
    ["neon", "Néon magenta"], ["coucher", "Coucher de soleil"], ["aurore", "Aurore boréale"],
  ],
  objets: [
    ["lustres", "Lustres de cristal"], ["guirlande", "Guirlande lumineuse"], ["bambous", "Bambous"],
    ["affiches", "Affiches rétro"], ["neons", "Néons le long des murs"],
  ],
};

export const ROOM_DEFAULT = { sol: "auto", solBureau: "auto", murs: "auto", bureaux: "auto", lumiere: "auto", objets: [] };

// Presets : une ambiance de base et des choix de salle, appliqués d'un clic dans le formulaire (rien n'est enregistré
// avant « Enregistrer »). Prestige est l'étage de Paul-Adrien, proposé à tous.
export const ROOM_PRESETS = [
  { id: "classique", icon: "🏢", name: "Classique", desc: "L'étage d'origine, qui s'équipe avec ton niveau.", theme: "classique", room: {} },
  { id: "cyberpunk", icon: "🌃", name: "Cyberpunk", desc: "Néons, grille au sol, salle serveurs et drone.", theme: "cyberpunk", room: {} },
  { id: "prestige", icon: "🏎️", name: "Prestige", desc: "L'étage de Paul-Adrien : chevrons, marbre, lustres, spider.", theme: "prestige", room: {} },
  { id: "zen", icon: "🎋", name: "Zen", desc: "Tatamis, bois clair, bambous et lumière douce.", theme: "classique",
    room: { sol: "tatami", solBureau: "chene", murs: "blanc", bureaux: "moderne", lumiere: "chaude", objets: ["bambous", "guirlande"] } },
  { id: "loft", icon: "🧱", name: "Loft", desc: "Béton ciré, murs noirs, affiches et guirlande.", theme: "classique",
    room: { sol: "beton", solBureau: "beton", murs: "noir", bureaux: "moderne", lumiere: "naturelle", objets: ["affiches", "guirlande"] } },
  { id: "minimal", icon: "🤍", name: "Minimal", desc: "Marbre clair et murs blancs, rien de trop.", theme: "classique",
    room: { sol: "marbre", solBureau: "marbre", murs: "blanc", bureaux: "moderne", lumiere: "naturelle", objets: [] } },
  { id: "fumoir", icon: "🥃", name: "Club privé", desc: "Damier, noyer, bureaux de ministre et lustres.", theme: "classique",
    room: { sol: "damier", solBureau: "chevrons", murs: "noyer", bureaux: "ministre", lumiere: "coucher", objets: ["lustres", "affiches"] } },
  { id: "tokyo", icon: "🏮", name: "Néon Tokyo", desc: "Résine noire, néons à ta couleur, lumière magenta.", theme: "cyberpunk",
    room: { sol: "resine", solBureau: "resine", murs: "neon", lumiere: "neon", objets: ["neons", "guirlande"] } },
];

const valid = (key, v) => ROOM_OPTIONS[key].some(([id]) => id === v);

// Vérifie une salle reçue : chaque valeur inconnue garde la précédente (ou « auto »), objets connus et sans doublon.
export function cleanRoom(raw, previous = ROOM_DEFAULT) {
  const prev = { ...ROOM_DEFAULT, ...(previous && typeof previous === "object" ? previous : {}) };
  const room = {};
  for (const key of ["sol", "solBureau", "murs", "bureaux", "lumiere"]) {
    const list = key === "solBureau" ? "sol" : key, v = raw?.[key];
    room[key] = valid(list, v) ? v : valid(list, prev[key]) ? prev[key] : "auto";
  }
  const objets = Array.isArray(raw?.objets) ? raw.objets : Array.isArray(prev.objets) ? prev.objets : [];
  room.objets = [...new Set(objets.filter(o => typeof o === "string" && valid("objets", o)))];
  return room;
}

// Preset qui correspond exactement à une ambiance et une salle (pour le surligner dans le formulaire), sinon null.
export function presetOf(theme, room) {
  const r = cleanRoom(room);
  return ROOM_PRESETS.find(p => {
    if (p.theme !== theme) return false;
    const want = cleanRoom({ ...ROOM_DEFAULT, ...p.room });
    return Object.keys(want).every(k => k === "objets" ? [...want.objets].sort().join() === [...r.objets].sort().join() : want[k] === r[k]);
  })?.id ?? null;
}
