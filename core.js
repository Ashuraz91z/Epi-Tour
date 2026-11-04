// Données de la tour de contrôle : traduit les événements bruts des agents en sessions, quotas et compteurs.
// Repris de la v1 Python (srv/tour/tour.py), sans l'interface.
import { createGame, publicGame } from "./gamify.js";
import { createEconomy, publicEconomy } from "./economy.js";

export function createStore() {
  // sessions : par clé "src:machine:session" ; usage : quotas par fournisseur ;
  // seen : dernier signe de vie par machine ; stats : compteurs par jour ; health : services d'Hermes.
  return { sessions: {}, feed: [], usage: {}, seen: {}, stats: {}, health: {},
    profile: { accent: "#e8c27a", tagline: "", theme: "classique", screens: [] }, game: createGame(), economy: createEconomy() };
}

const ACCENT = /^#[0-9a-fA-F]{6}$/;
export const THEMES = ["classique", "cyberpunk"];
export function sanitizeProfile(raw, previous = {}) {
  const accent = typeof raw?.accent === "string" && ACCENT.test(raw.accent) ? raw.accent.toLowerCase() : (previous.accent ?? "#e8c27a");
  const tagline = typeof raw?.tagline === "string" ? raw.tagline.trim().slice(0, 80) : (previous.tagline ?? "");
  const theme = THEMES.includes(raw?.theme) ? raw.theme : THEMES.includes(previous.theme) ? previous.theme : "classique";
  // Textes des écrans du bureau : « TikTok Shop / Toksy » depuis le formulaire, ou une liste ; 3 au plus, courts.
  const list = typeof raw?.screens === "string" ? raw.screens.split("/") : Array.isArray(raw?.screens) ? raw.screens : null;
  const screens = list ? list.filter(s => typeof s === "string").map(s => s.trim().slice(0, 24)).filter(Boolean).slice(0, 3)
    : Array.isArray(previous.screens) ? previous.screens : [];
  // Télé géante de l'étage : déjà normalisée par le serveur (parseTvLink) ; null l'éteint.
  const tv = raw && "tv" in raw ? cleanTv(raw.tv) : cleanTv(previous.tv);
  return { accent, tagline, theme, screens, tv };
}
const cleanTv = tv => tv?.kind === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(tv.id ?? "") ? { kind: "youtube", id: tv.id }
  : tv?.kind === "twitch" && /^[a-z0-9_]{3,25}$/.test(tv.channel ?? "") ? { kind: "twitch", channel: tv.channel } : null;

export function short(v, n = 140) {
  const s = (typeof v === "string" ? v : JSON.stringify(v) ?? "").split(/\s+/).filter(Boolean).join(" ");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function describeTool(name, inp) {
  // Un événement mal formé (nombre, objet) ne doit jamais faire tomber le serveur.
  name = typeof name === "string" ? name : name == null ? "" : String(name);
  if (name.startsWith("mcp__")) name = name.split("__").slice(1, 3).join(" · ");
  if (inp && typeof inp === "object") {
    for (const k of ["command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "goal"])
      if (inp[k]) return `${name} · ${short(inp[k], 90)}`;
  }
  return name || "outil";
}

// Événement brut -> { sid, state, task, action }, ou null si l'événement ne dit rien de la session.
export function normalize(p) {
  const extra = p.extra ?? {};
  const table = {
    // Claude Code et Codex (hooks)
    SessionStart: ["attend", null, "session ouverte"],
    UserPromptSubmit: ["travaille", p.prompt, "réfléchit"],
    PreToolUse: ["travaille", null, "tool"],
    PermissionRequest: ["autorisation", null, "accord requis · " + describeTool(p.tool_name, p.tool_input)],
    PostToolUse: ["travaille", null, "tool"],
    SubagentStart: ["travaille", null, "sous-agent " + (p.agent_type ?? "")],
    // Une demande d'autorisation fait venir l'agent au bureau du résident ; sinon il attend la suite.
    Notification: [/permission|autoris|approv/i.test(p.message ?? "") ? "autorisation" : "attend", null, p.message || "attend une réponse"],
    Stop: ["fini", null, "tour terminé, attend la suite"],
    SessionEnd: ["fermé", null, "session fermée"],
    // Hermes, webhooks sortants (CLI, passerelle, profils du Kanban)
    on_session_start: ["travaille", null, "démarre"],
    pre_tool_call: ["travaille", null, "tool"],
    subagent_start: ["travaille", null, "délègue · " + short(extra.goal || extra.task || "", 80)],
    on_session_end: ["fini", null, "terminé"],
    // Hermes, hooks de la passerelle (Telegram) : seuls à donner le message
    "agent:start": ["travaille", p.message, "réfléchit"],
    "agent:end": ["fini", null, "réponse envoyée"],
    // États déclarés explicitement par Grok Bot via le pont MCP.
    "grok:working": ["travaille", null, "travaille · signalé par Grok Bot"],
    "grok:idle": ["attend", null, "attend la suite"],
    "grok:finished": ["fini", null, "tâche terminée"],
    "grok:approval": ["autorisation", null, "demande ton accord"],
    "grok:error": ["erreur", null, "erreur signalée"],
    // Cursor (pont HTTP ou script local)
    "cursor:working": ["travaille", p.prompt ?? p.task, "réfléchit · Cursor"],
    "cursor:idle": ["attend", null, "attend la suite · Cursor"],
    "cursor:finished": ["fini", null, "tâche terminée · Cursor"],
    "cursor:approval": ["autorisation", null, "demande ton accord · Cursor"],
    "cursor:error": ["erreur", null, "erreur signalée · Cursor"],
    // n8n (relais)
    "n8n:running": ["travaille", p.workflow, "workflow en cours"],
    "n8n:success": ["fini", p.workflow, "workflow réussi"],
    "n8n:error": ["erreur", p.workflow, "workflow en erreur"],
  };
  const row = table[p.hook_event_name];
  if (!row) return null;
  let [state, task, action] = row;
  if (action === "tool") action = describeTool(p.tool_name, p.tool_input);
  return { sid: String(p.session_id ?? "?"), state, task: task ? short(task, 240) : null, action: short(action, 140) };
}

const dayOf = t => new Date(t * 1000).toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale

// Objets libres envoyés par les collecteurs (info machine, santé des services) : bornés, sinon ignorés.
// Ils repartent vers tous les résidents toutes les 2 s : un relais bavard ne doit pas alourdir tout le penthouse.
function smallObject(v, maxBytes) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  try { return JSON.stringify(v).length <= maxBytes ? v : null; } catch { return null; }
}
const PLAN = /^[a-z0-9_ +-]{1,24}$/i;
// Fenêtre de quota : seuls le pourcentage et la date de reset sont gardés.
function usageWindow(w) {
  if (!w || typeof w !== "object" || !Number.isFinite(w.pct)) return undefined;
  return { pct: w.pct, ...(Number.isFinite(w.resets_at) ? { resets_at: w.resets_at } : {}) };
}
const MAX_MACHINES = 24;

export function ingest(store, src, host, p, now = Date.now() / 1000) {
  const machine = host.split("/")[0], previous = store.seen[machine] ?? {};
  store.seen[machine] = { ...previous, ...(smallObject(p.info, 2048) ?? {}), t: now,
    events: { ...previous.events, ...(normalize(p) && ["claude", "codex", "hermes", "n8n", "grok", "cursor"].includes(src) ? { [src]: now } : {}) } };
  // Machines muettes depuis 30 jours oubliées ; au plus 24 machines par étage.
  const machines = Object.entries(store.seen).filter(([, m]) => now - (m?.t ?? 0) < 30 * 86400).sort((a, b) => b[1].t - a[1].t);
  if (machines.length !== Object.keys(store.seen).length || machines.length > MAX_MACHINES) store.seen = Object.fromEntries(machines.slice(0, MAX_MACHINES));
  // État des services, mesuré sur place par la tour locale (v1) et relayé ici.
  const health = p.hook_event_name === "health" ? smallObject(p.health, 8192) : null;
  if (health) store.health = { ...health, t: now };
  const usage = p.usage && typeof p.usage === "object" && !Array.isArray(p.usage) ? p.usage : {};
  for (const [provider, u] of Object.entries(usage)) {
    // Une mesure vide/partielle ne doit pas effacer une fenêtre déjà connue.
    if (!["claude", "chatgpt"].includes(provider) || !u || typeof u !== "object") continue;
    const ts = u.ts ?? now, previous = store.usage[provider] ?? {};
    if (!Number.isFinite(ts) || ts < (previous.ts ?? 0)) continue;
    const windows = Object.fromEntries(["five_hour", "seven_day"].map(key => [key, usageWindow(u[key])]).filter(([, w]) => w));
    if (!Object.keys(windows).length) continue;
    store.usage[provider] = { ...previous, ...(typeof u.plan === "string" && PLAN.test(u.plan) ? { plan: u.plan.toLowerCase() } : {}),
      ...Object.fromEntries(["five_hour", "seven_day"].map(key => [key, windows[key] ?? previous[key]]).filter(([, w]) => w)), ts };
  }
  const n = normalize(p);
  if (!n) return;
  const observed = p.sync && Number.isFinite(p.observed_at) ? Math.min(now, p.observed_at) : now;
  if (p.sync && (!Number.isFinite(p.observed_at) || now - observed > 3600)) return;
  if (p.profile && p.profile !== "default") host = `${host}/${p.profile}`;
  const key = `${src}:${host}:${n.sid}`;
  // Un journal rejoué ne doit pas remplacer une autorisation ou un événement de hook plus récent.
  if (p.sync && store.sessions[key]?.updated >= observed) return;
  // Une fin d’outil remet une session connue au travail, sans créer de robot supplémentaire.
  if (p.hook_event_name === "PostToolUse" && !(key in store.sessions)) return;
  const day = ((store.stats[dayOf(now)] ??= {})[src] ??= { sessions: 0, actions: 0 });
  day.sessions += key in store.sessions ? 0 : 1;
  day.actions += !p.sync && ["PreToolUse", "pre_tool_call"].includes(p.hook_event_name) ? 1 : 0;
  const s = (store.sessions[key] ??= { src, host, sid: n.sid.slice(0, 8), started: observed, task: "" });
  Object.assign(s, { state: n.state, action: n.action, updated: observed });
  if (n.task) s.task = n.task;
  if (typeof p.cwd === "string" && p.cwd) s.project = (p.cwd.replace(/\/+$/, "").split("/").pop() || p.cwd).slice(0, 80);
  const model = p.model || p.extra?.model;
  if (typeof model === "string" && model) s.model = model.slice(0, 40);
  store.feed.push({ t: observed, src, host, project: s.project ?? "", state: n.state, action: n.action });
  store.feed.splice(0, store.feed.length - 150);
}

// Vue publique ; fait aussi le ménage des sessions finies ou oubliées.
export function snapshot(store, now = Date.now() / 1000) {
  for (const [k, s] of Object.entries(store.sessions)) {
    const age = now - s.updated;
    if ((s.src === "hermes" && s.state !== "autorisation" && age > 3600) || age > 12 * 3600 || (["fermé", "fini", "erreur"].includes(s.state) && age > 3600) || (s.state === "fermé" && age > 300))
      delete store.sessions[k];
  }
  for (const d of Object.keys(store.stats).sort().slice(0, -7)) delete store.stats[d];
  // Cinq Hermes visibles par résident ; les autres sessions actives restent suivies en arrière-plan.
  const sessions = Object.values(store.sessions);
  const priority = s => s.state === "autorisation" ? 2 : s.state === "travaille" ? 1 : 0;
  const hermes = sessions.filter(s => s.src === "hermes")
    .sort((a, b) => priority(b) - priority(a) || b.updated - a.updated).slice(0, 5);
  return {
    now, sessions: sessions.filter(s => s.src !== "hermes" || hermes.includes(s)), feed: store.feed.slice(-60).reverse(),
    usage: store.usage, seen: store.seen, today: store.stats[dayOf(now)] ?? {}, health: store.health,
    profile: sanitizeProfile(store.profile),
    // L'économie avant le jeu : la mission « Jour de paie » lit les salaires du jour.
    economy: publicEconomy(store, now),
    game: publicGame(store, now),
  };
}
