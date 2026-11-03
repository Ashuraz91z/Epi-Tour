// Une boucle complète : usages de tous les résidents, chaque étage, puis les deux panneaux.
export function spectatorStep(elapsed, floors, residents, pageSize = 6) {
  const pages = Math.max(1, Math.ceil(residents / pageSize));
  const phases = [
    ...Array.from({ length: pages }, (_, page) => ({ kind: "dashboard", page, seconds: 14 })),
    ...floors.map((floor, index) => ({ kind: "floor", floor, index, seconds: 12 })),
    { kind: "agents", seconds: 10 },
    { kind: "usage", seconds: Math.max(10, residents * 8) },
  ];
  const duration = phases.reduce((total, phase) => total + phase.seconds, 0);
  let cursor = Math.max(0, elapsed) % duration;
  for (const phase of phases) {
    if (cursor < phase.seconds) return { ...phase, remaining: Math.ceil(phase.seconds - cursor), duration, pages, pageSize };
    cursor -= phase.seconds;
  }
}
