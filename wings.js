// Ailes privées : plusieurs étages par résident, débloquées par niveau.
export const WING_DEFS = [
  { id: "work", name: "Bureau", icon: "💼", minLevel: 1, accent: "#232a39", floor: "#232a39", sign: null },
  { id: "lab", name: "Labo IA", icon: "🧪", minLevel: 4, accent: "#5b7cfa", floor: "#1a2240", sign: "LABO" },
  { id: "ops", name: "Salle ops", icon: "🖥️", minLevel: 7, accent: "#2fb898", floor: "#152822", sign: "OPS" },
  { id: "studio", name: "Studio", icon: "🎛️", minLevel: 12, accent: "#6b9cff", floor: "#221a38", sign: "STUDIO" },
];

export const WING_ACTIVITIES = {
  work_standup: { wing: "work", title: "Stand-up d'équipe", blurb: "Alignement rapide avec tes agents.", xp: 22, cooldown: 7200 },
  lab_calibrate: { wing: "lab", title: "Calibrer les modèles", blurb: "Vérifier Hermes / Grok sur le banc.", xp: 28, cooldown: 5400 },
  lab_notebook: { wing: "lab", title: "Carnet d'expériences", blurb: "Noter une hypothèse (sans données privées).", xp: 20, daily: true },
  ops_deploy: { wing: "ops", title: "Déploiement", blurb: "Simuler un passage prod n8n.", xp: 30, cooldown: 3600 },
  ops_monitor: { wing: "ops", title: "Monitoring", blurb: "Tour de salle des automates.", xp: 18, daily: true },
  studio_focus: { wing: "studio", title: "Focus Cursor", blurb: "Bloc deep work sans interruption.", xp: 26, cooldown: 5400 },
  studio_mix: { wing: "studio", title: "Mix créatif", blurb: "Alterner code et design.", xp: 24, daily: true },
};

export const SHARED_EXTRAS = {
  roof_stargaze: { floor: "roof", title: "Observer les étoiles", blurb: "La ville s'éteint, la tour brille.", xp: 35, daily: true },
  lounge_fridge: { floor: "lounge", title: "Raid frigo", blurb: "Pause Red Bull entre deux agents.", xp: 15, cooldown: 3600 },
  club_laser: { floor: "club", title: "Show laser", blurb: "Lumières synchronisées au beat.", xp: 40, cooldown: 7200 },
};

export function wingsForLevel(level) {
  return WING_DEFS.filter(w => level >= w.minLevel);
}

export function wingForSource(level, src) {
  const map = { n8n: "ops", hermes: "lab", grok: "lab", cursor: "studio" };
  const want = map[src] ?? "work";
  return wingsForLevel(level).some(w => w.id === want) ? want : "work";
}

export function parseFloorKey(key) {
  const i = key.lastIndexOf(":");
  if (i <= 0) return { slug: key, wing: null };
  return { slug: key.slice(0, i), wing: key.slice(i + 1) };
}

export function residentFloorKey(slug, level, src, place) {
  if (place === "boss") return `${slug}:work`;
  if (place === "open") return `${slug}:${wingForSource(level, src)}`;
  return null;
}
