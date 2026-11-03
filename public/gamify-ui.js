// Interface de gamification : barre XP, missions, activités communes, célébrations.

export const BADGE_LABELS = {
  rookie: "Rookie",
  regular: "Résident",
  veteran: "Vétéran",
  streak3: "Régulier",
  streak7: "Pilier",
  social: "Social",
  architect: "Architecte",
};

export function xpBarHtml(game, esc) {
  if (!game) return "";
  const bar = game.xpBar ?? { current: 0, need: 100, next: 2 };
  const pct = bar.need ? Math.round((bar.current / bar.need) * 100) : 0;
  return `<div class="xp-bar" aria-label="Niveau ${game.level}, ${game.xp} points">
    <div class="xp-meta"><span class="xp-level">Nv. <b>${game.level}</b></span><span class="xp-streak">${game.streak ? "🔥 " + game.streak + " j" : ""}</span><span class="xp-num">${esc(String(game.xp))} XP</span></div>
    <div class="xp-track"><i style="width:${pct}%"></i></div></div>`;
}

export function missionsHtml(game, esc) {
  if (!game?.quests?.length) return "<p class=\"extras-muted\">Aucune mission pour l'instant.</p>";
  return `<div class="quest-grid">${game.quests.map(q => {
    const pct = q.target ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
    const state = q.claimed ? "claimed" : q.done ? "done" : "";
    const btn = q.done && !q.claimed ? `<button type="button" class="quest-claim" data-quest="${esc(q.id)}">Récupérer +${q.xp} XP</button>` : "";
    return `<article class="quest-card ${state}"><h4>${esc(q.title)}</h4><p>${esc(q.desc)}</p>
      <div class="quest-track"><i style="width:${pct}%"></i></div>
      <footer><span>${q.progress}/${q.target}</span>${btn || (q.claimed ? "<span class=\"quest-done\">✓</span>" : "")}</footer></article>`;
  }).join("")}</div>`;
}

export function wingActionsHtml(game, floorKey, esc) {
  const wing = floorKey.split(":").pop();
  const list = (game?.spaces ?? []).filter(s => s.wing === wing);
  if (!list.length) return "";
  return `<div class="space-actions wing-actions"><h4>Activités · aile privée</h4><div class="space-grid">${list.map(s => {
    const disabled = !s.ready && s.cooldownSec > 0;
    const hint = !s.ready && s.cooldownSec > 0 ? `${Math.ceil(s.cooldownSec / 60)} min` : s.daily && !s.ready ? "Fait" : `+${s.xp} XP`;
    return `<button type="button" class="space-act wing-act" data-action="${esc(s.id)}" data-floor="${esc(floorKey)}" ${disabled ? "disabled" : ""}>
      <strong>${esc(s.title)}</strong><span>${esc(s.blurb)}</span><em>${hint}</em></button>`;
  }).join("")}</div></div>`;
}

export function spaceActionsHtml(game, floorId, agentsHere, esc) {
  const list = (game?.spaces ?? []).filter(s => s.floor === floorId);
  if (!list.length) return "";
  return `<div class="space-actions"><h4>À faire ici</h4><div class="space-grid">${list.map(s => {
    const disabled = !s.ready && s.cooldownSec > 0;
    const hint = !s.ready && s.cooldownSec > 0 ? `${Math.ceil(s.cooldownSec / 60)} min` : s.daily && !s.ready ? "Fait" : `+${s.xp} XP`;
    return `<button type="button" class="space-act" data-action="${esc(s.id)}" data-floor="${esc(floorId)}" data-agents="${agentsHere}" ${disabled ? "disabled" : ""}>
      <strong>${esc(s.title)}</strong><span>${esc(s.blurb)}</span><em>${hint}</em></button>`;
  }).join("")}</div></div>`;
}

export function badgesHtml(game, esc) {
  const ids = game?.badges ?? [];
  if (!ids.length) return "<p class=\"extras-muted\">Aucun badge pour l'instant — joue les missions !</p>";
  return `<div class="badge-row">${ids.map(id => `<span class="badge" title="${esc(BADGE_LABELS[id] ?? id)}">${esc(BADGE_LABELS[id] ?? id)}</span>`).join("")}</div>`;
}

export function showCelebrations(toasts) {
  const root = document.getElementById("gameCelebrations");
  if (!root || !toasts?.length) return;
  for (const t of toasts) {
    const el = document.createElement("div");
    el.className = "game-toast";
    el.innerHTML = `<strong>${t.title}</strong><span>${t.body ?? ""}</span>`;
    root.appendChild(el);
    setTimeout(() => el.classList.add("on"), 20);
    setTimeout(() => { el.classList.remove("on"); setTimeout(() => el.remove(), 400); }, 4200);
  }
}

export async function postGame(path, token, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tour-Token": token },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Action impossible.");
  return j;
}
