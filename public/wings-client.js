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
