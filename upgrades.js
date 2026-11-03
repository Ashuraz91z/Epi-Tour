// Aménagement des bureaux débloqué par le niveau (XP).
export const OFFICE_TIERS = [
  { id: 1, minLevel: 1, name: "Starter", open: "#2a3142", boss: "#3a3029", wood: "#573d2e", metal: "#b7a27b", deskScale: 2, chairScale: 1, perks: ["Postes d’entrée", "Chaise standard"] },
  { id: 2, minLevel: 3, name: "Confort", open: "#2e364a", boss: "#40352d", wood: "#634832", metal: "#c9ae84", deskScale: 2.05, chairScale: 1.05, perks: ["Tapis open space", "Plantes supplémentaires"], openRug: true },
  { id: 3, minLevel: 6, name: "Pro", open: "#303952", boss: "#453928", wood: "#6d5238", metal: "#dcc99a", deskScale: 2.12, chairScale: 1.08, perks: ["Bibliothèque", "Lampe de bureau"], bookcase: true, bossLamp: true },
  { id: 4, minLevel: 10, name: "Executive", open: "#33405a", boss: "#4a3d32", wood: "#7a5c3f", metal: "#e8d4a8", deskScale: 2.18, chairScale: 1.12, perks: ["Fauteuil direction", "Écran salon"], execChair: true, bossTv: true },
  { id: 5, minLevel: 15, name: "Penthouse", open: "#364662", boss: "#504235", wood: "#8a6848", metal: "#f1deaa", deskScale: 2.25, chairScale: 1.15, perks: ["Double écran décoratif", "Porte-manteau · enceinte"], dualScreen: true, coatRack: true, speaker: true },
];

export function officeTierForLevel(level) {
  let best = OFFICE_TIERS[0];
  for (const tier of OFFICE_TIERS) if (level >= tier.minLevel) best = tier;
  return best;
}

export function nextOfficeTier(level) {
  return OFFICE_TIERS.find(t => t.minLevel > level) ?? null;
}

export function officePublic(level) {
  const current = officeTierForLevel(level);
  const next = nextOfficeTier(level);
  return {
    id: current.id,
    name: current.name,
    minLevel: current.minLevel,
    perks: current.perks,
    next: next ? { name: next.name, minLevel: next.minLevel, perks: next.perks } : null,
  };
}
