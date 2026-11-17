export function parseFloorKey(key) {
  const i = key.lastIndexOf(":");
  if (i <= 0) return { slug: key, wing: null };
  return { slug: key.slice(0, i), wing: key.slice(i + 1) };
}

export function wingForSource(wings, src) {
  const map = { n8n: "ops", hermes: "lab", grok: "lab", cursor: "studio" };
  const want = map[src] ?? "work";
  return wings.some(w => w.id === want) ? want : "work";
}

export function wingsOf(apartment) {
  return apartment?.game?.wings ?? [{ id: "work", name: "Bureau", icon: "💼", floor: "#232a39", accent: "#232a39", sign: null }];
}

export function homeFloor(apartment, session, place, FLOOR_OF) {
  if (FLOOR_OF[place]) return FLOOR_OF[place];
  const wings = wingsOf(apartment);
  const wingId = place === "boss" ? "work" : wingForSource(wings, session.src);
  return `${apartment.slug}:${wingId}`;
}

// Bureau plein : les agents au travail en trop montent dans les autres ailes débloquées du résident (Labo IA, Salle ops,
// Studio, dans cet ordre), sur les postes libres. Au-delà, ils restent debout au Bureau. Stable d'un état à l'autre :
// restent au Bureau ceux qui y sont déjà, puis les nouveaux venus ; un agent déjà installé dans une aile y reste tant
// qu'elle a de la place (pas d'aller-retour en ascenseur quand un poste se libère).
// rows : [{ key, started, current }] (current : étage visé jusqu'ici), counts : agents déjà prévus par aile (Map),
// capacity : postes par étage. Renvoie Map clé d'agent → étage d'accueil, pour ceux qui changent d'étage.
export function spillOver(slug, rows, wings, counts, capacity) {
  const work = `${slug}:work`, moves = new Map();
  if (rows.length <= capacity) return moves;
  const extra = wings.filter(w => w.id !== "work").map(w => `${slug}:${w.id}`);
  const free = new Map(extra.map(k => [k, Math.max(0, capacity - (counts.get(k) ?? 0))]));
  if (![...free.values()].some(n => n > 0)) return moves;
  const rank = r => (r.current === work ? 0 : free.has(r.current) ? 2 : 1);
  const out = [...rows].sort((x, y) => rank(x) - rank(y) || x.started - y.started || (x.key < y.key ? -1 : 1)).slice(capacity);
  const rest = [];
  for (const r of out) {
    if (free.get(r.current) > 0) { moves.set(r.key, r.current); free.set(r.current, free.get(r.current) - 1); } else rest.push(r);
  }
  for (const r of rest) {
    const k = extra.find(x => free.get(x) > 0);
    if (!k) break;
    moves.set(r.key, k);
    free.set(k, free.get(k) - 1);
  }
  return moves;
}
