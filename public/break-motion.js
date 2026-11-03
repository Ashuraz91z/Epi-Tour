import { assignDeskSlots } from './desk-slots.js';

const mix = (seed, visit) => {
  let value = (seed ^ Math.imul(visit + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  return (value ^ (value >>> 13)) >>> 0;
};

// Choix stable pendant une visite : le polling ne tire pas une nouvelle destination toutes les 2 s.
export function breakVisit(seed, age, silent = false) {
  const duration = 75 + mix(seed, 0) % 76;
  const visit = Math.floor((Math.max(0, age) + seed % duration) / duration);
  if (!silent && age < 300) return { place: 'cafe', visit };
  if (!silent && age < 900) return { place: 'club', visit };
  const places = ['rest', 'club', 'cafe', 'tabac', 'wc'];
  return { place: places[(seed % 5 + visit * (1 + (seed >>> 5) % 4)) % 5], visit };
}

export function assignPauseSlots(entries, previous, capacity) {
  const retained = entries.filter(e => previous.has(e.key) && (e.moving || previous.get(e.key).visit === e.visit));
  const slots = assignDeskSlots(retained.map(e => e.key), new Map(retained.map(e => [e.key, previous.get(e.key).index])));
  const used = new Set(slots.values());
  for (const entry of entries) if (!slots.has(entry.key)) {
    let free = Array.from({ length: capacity }, (_, i) => i).filter(i => !used.has(i));
    if (free.length > 1) free = free.filter(i => i !== previous.get(entry.key)?.index);
    let index;
    if (free.length) index = free[mix(entry.seed, entry.visit) % free.length];
    else { index = capacity; while (used.has(index)) index++; }
    slots.set(entry.key, index); used.add(index);
  }
  return slots;
}
