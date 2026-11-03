// Réserver d’abord les bureaux occupés, puis attribuer les places libres aux nouveaux arrivants.
export function assignDeskSlots(keys, previous) {
  const slots = new Map(), used = new Set();
  for (const key of keys) {
    const index = previous.get(key);
    if (Number.isInteger(index) && index >= 0 && !used.has(index)) {
      slots.set(key, index); used.add(index);
    }
  }
  for (const key of keys) if (!slots.has(key)) {
    let index = 0;
    while (used.has(index)) index++;
    slots.set(key, index); used.add(index);
  }
  return slots;
}
