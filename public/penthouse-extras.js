// Panneaux, alertes et flux temps réel (complément à app.js).

export function machineStatusRows(apt, now, tools, esc, hm) {
  const seen = Object.entries(apt?.seen ?? {});
  if (!seen.length) return `<p class="extras-muted">Aucune machine reçue pour l'instant.</p>`;
  return seen.map(([name, m]) => {
    const age = now - (m.t ?? 0);
    const level = age < 120 ? "ok" : age < 900 ? "warn" : "off";
    const toolBits = Object.entries(tools).map(([src, t]) => {
      const last = Math.max(m.events?.[src] ?? 0, 0);
      if (!last) return "";
      return `<span class="tool-pill ${age < 3600 ? "on" : ""}">${esc(t.name)} · ${hm(last)}</span>`;
    }).filter(Boolean).join("") || `<span class="extras-muted">sync ${hm(m.t)}</span>`;
    return `<div class="machine-row ${level}"><b>${esc(name)}</b><span>${level === "ok" ? "En ligne" : level === "warn" ? "Sync récente" : "Silencieuse"}</span><div class="machine-tools">${toolBits}</div></div>`;
  }).join("");
}

export function quotaAlerts(usage, now, quotaRemaining) {
  const lines = [];
  for (const [provider, label] of [["claude", "Claude"], ["chatgpt", "ChatGPT"]]) {
    for (const [key, short] of [["five_hour", "5 h"], ["seven_day", "semaine"]]) {
      const w = usage?.[provider]?.[key];
      const left = w ? quotaRemaining(w, now) : null;
      if (left !== null && left <= 20) lines.push(`${label} (${short}) : ${left} % restants`);
    }
  }
  return lines;
}

export function todayBadges(today) {
  if (!today || !Object.keys(today).length) return "";
  const parts = Object.entries(today).map(([src, d]) => `${src} ${d.sessions ?? 0}s / ${d.actions ?? 0} act.`);
  return parts.join(" · ");
}

export function activityLeaderboard(apartments) {
  const rows = apartments.map(a => {
    const actions = Object.values(a.today ?? {}).reduce((n, d) => n + (d.actions ?? 0), 0);
    const sessions = Object.values(a.today ?? {}).reduce((n, d) => n + (d.sessions ?? 0), 0);
    return { name: a.name, slug: a.slug, actions, sessions, score: actions * 2 + sessions };
  }).filter(r => r.score > 0).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, "fr")).slice(0, 5);
  return rows;
}

export function historyEntries(apt, tools, esc, hm) {
  const sessions = [...(apt.sessions ?? [])].sort((a, b) => b.updated - a.updated).slice(0, 20);
  const feed = [...(apt.feed ?? [])].slice(0, 40);
  const sessionRows = sessions.map(s => `<tr><td>${hm(s.updated)}</td><td>${esc(tools[s.src]?.name ?? s.src)}</td><td>${esc(s.project ?? "—")}</td><td>${esc(s.state)}</td><td class="m">${esc(s.action ?? "")}</td></tr>`).join("");
  const feedRows = feed.map(e => `<tr><td>${hm(e.t)}</td><td>${esc(tools[e.src]?.name ?? e.src)}</td><td>${esc(e.project ?? "—")}</td><td colspan="2">${esc(e.action ?? "")}</td></tr>`).join("");
  return { sessionRows, feedRows };
}

export function historyCsv(apt) {
  const lines = ["type,time,source,project,state,action"];
  for (const s of apt.sessions ?? []) {
    lines.push(["session", s.updated, s.src, s.project ?? "", s.state, (s.action ?? "").replace(/"/g, '""')].map(v => `"${v}"`).join(","));
  }
  for (const e of apt.feed ?? []) {
    lines.push(["feed", e.t, e.src, e.project ?? "", e.state ?? "", (e.action ?? "").replace(/"/g, '""')].map(v => `"${v}"`).join(","));
  }
  return lines.join("\n");
}

let notifiedKeys = new Set();
export function pushApprovalNotifications(fresh, tools) {
  if (!fresh.length || typeof Notification === "undefined") return;
  if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
  if (Notification.permission !== "granted") return;
  for (const item of fresh) {
    if (notifiedKeys.has(item.key)) continue;
    notifiedKeys.add(item.key);
    const s = item.session;
    const title = "Autorisation requise";
    const body = `${tools[s.src]?.name ?? s.src}${s.project ? " · " + s.project : ""}`;
    try { new Notification(title, { body, tag: item.key }); } catch { /* navigateur restrictif */ }
  }
  if (notifiedKeys.size > 200) notifiedKeys = new Set([...notifiedKeys].slice(-80));
}

export function applyKioskFromUrl() {
  const kiosk = new URLSearchParams(location.search).get("kiosk") === "1";
  document.body.classList.toggle("kiosk-mode", kiosk);
  return kiosk;
}

export function startStateStream(onPayload) {
  if (typeof EventSource === "undefined") return null;
  const es = new EventSource("/api/stream");
  es.onmessage = ev => {
    try { onPayload(JSON.parse(ev.data)); } catch { /* frame invalide */ }
  };
  es.onerror = () => { es.close(); };
  return es;
}

export async function saveProfile(token, profile) {
  const r = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tour-Token": token },
    body: JSON.stringify({ profile }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Enregistrement refusé.");
  return j.profile;
}
