// Le penthouse : un site où chacun entre avec son nom, reçoit un appartement et y relie ses agents.
// Les collecteurs envoient leurs événements sur POST /e avec la clé de l'appartement (même format que la v1).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ingest, sanitizeProfile } from "./core.js";
import { CASINO } from "./public/economy-data.js";
import { DAILY_QUESTS, claimQuest, onIngestGame, performSpaceAction, pullToasts, publicGame, visitWing } from "./gamify.js";
import { buyItem, onIngestEconomy, playCasino, questReward, setSubscription, spectatorEconomy, tip } from "./economy.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 256 * 1024;
const MAX_APARTMENTS = 50;
const acceptsGzip = req => /(?:^|,)\s*gzip\s*(?:,|$)/i.test(req.headers["accept-encoding"] ?? "");
const FILES = {
  "/break-motion.js": ["public/break-motion.js", "text/javascript"],
  "/approval-alert.js": ["public/approval-alert.js", "text/javascript"],
  "/spectator-tour.js": ["public/spectator-tour.js", "text/javascript"],
  "/desk-slots.js": ["public/desk-slots.js", "text/javascript"],
  "/": ["public/index.html", "text/html"], "/app.js": ["public/app.js", "text/javascript"],
  "/penthouse-extras.js": ["public/penthouse-extras.js", "text/javascript"],
  "/gamify-ui.js": ["public/gamify-ui.js", "text/javascript"],
  "/upgrades-client.js": ["public/upgrades-client.js", "text/javascript"],
  "/wings-client.js": ["public/wings-client.js", "text/javascript"],
  "/economy-data.js": ["public/economy-data.js", "text/javascript"],
  "/economy-ui.js": ["public/economy-ui.js", "text/javascript"],
  "/style.css": ["public/style.css", "text/css"],
  "/tour-hook": ["collecteurs/tour-hook", "text/plain"], "/install-hook.py": ["collecteurs/install-hook.py", "text/plain"],
  "/hermes-handler.py": ["collecteurs/hermes-hook/handler.py", "text/plain"],
  "/hermes-hook.yaml": ["collecteurs/hermes-hook/HOOK.yaml", "text/plain"],
  "/grok-mcp.py": ["collecteurs/grok-mcp.py", "text/plain"],
  "/tour_http.py": ["collecteurs/tour_http.py", "text/plain"],
  "/tour-sync": ["collecteurs/tour-sync", "text/plain"],
  "/install-sync.py": ["collecteurs/install-sync.py", "text/plain"],
  "/tour-check": ["collecteurs/tour-check", "text/plain"],
  "/cursor-notify.py": ["collecteurs/cursor-notify.py", "text/plain"],
  "/install.sh": ["public/install.sh", "text/plain"], "/assets/CREDITS.txt": ["public/assets/CREDITS.txt", "text/plain"],
};

// Ressources immuables pendant la vie du processus ; le déploiement redémarre l'application.
const staticCache = new Map();
function staticResource(file, type) {
  if (!staticCache.has(file)) {
    const body = readFileSync(join(ROOT, file));
    const etag = '"' + createHash("sha256").update(body).digest("hex") + '"';
    staticCache.set(file, { body, etag, gzip: /^(text\/|application\/javascript)/.test(type) ? gzipSync(body) : null });
  }
  return staticCache.get(file);
}

const sha = s => createHash("sha256").update(s).digest("hex");
const same = (a, b) => typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const slugify = name => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

// Chaînes Twitch de la télé du Salon. Lofi Girl diffuse 24 h/24 : il y a toujours quelque chose à regarder.
const CHANNELS = ["otplol_", "lec", "riotgames", "kamet0", "caedrel", "zerator", "eslcs", "lofigirl"];
// Qui est en direct, d'après la page publique de chaque chaîne ; gardé une minute (par copie du serveur).
let live = { at: 0, value: {} }, livePending = null;
async function liveChannels() {
  if (Date.now() - live.at < 60_000) return live.value;
  if (livePending) return livePending;
  livePending = (async () => {
    const page = c => fetch(`https://www.twitch.tv/${c}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(5000) }).then(r => r.text());
    const pages = await Promise.all(CHANNELS.map(c => page(c).catch(() => "")));
    live = { at: Date.now(), value: Object.fromEntries(CHANNELS.map((c, i) => [c, pages[i].includes('"isLiveBroadcast":true')])) };
    return live.value;
  })();
  try { return await livePending; } finally { livePending = null; }
}

// Limite les essais du code d'entrée : 10 par adresse et par 10 minutes.
const attempts = new Map();
function tooMany(ip, now = Date.now()) {
  // Ménage des adresses anciennes : la table ne grossit pas indéfiniment.
  if (attempts.size > 5000) for (const [k, v] of attempts) if (!v.some(t => now - t < 600_000)) attempts.delete(k);
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 600_000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 10;
}
// Derrière le proxy de l'hébergeur (par défaut), la dernière adresse de X-Forwarded-For est la vraie.
// Serveur exposé directement : TRUST_PROXY=0, sinon un visiteur choisirait son adresse et contournerait la limite.
const trustProxy = () => process.env.TRUST_PROXY !== "0";

// Lien perso de la télé (idée de la branche de Quentin) : seulement une vidéo YouTube ou une chaîne Twitch,
// normalisées ici. Jamais d'URL arbitraire dans l'iframe que tout le penthouse regarde.
export function parseTvLink(raw) {
  let u;
  try { u = new URL(String(raw ?? "").trim().slice(0, 500)); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, ""), video = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtu.be") {
    const id = u.pathname.split("/")[1];
    return video.test(id ?? "") ? { kind: "youtube", id } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = u.searchParams.get("v") ?? /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)?.[1];
    return id && video.test(id) ? { kind: "youtube", id } : null;
  }
  if (host === "twitch.tv") {
    const channel = (u.pathname.split("/")[1] ?? "").toLowerCase();
    return /^[a-z0-9_]{3,25}$/.test(channel) && !["directory", "videos", "settings", "downloads", "search"].includes(channel)
      ? { kind: "twitch", channel } : null;
  }
  return null;
}
export const publicTv = tv => ({ channel: tv?.channel ?? "auto", ...(tv?.custom ? { custom: tv.custom } : {}) });

// Vue publique : activité et quotas autorisés, sans conversations, machines ni détails de compte.
export function spectatorSnapshot(a) {
  const usage = {};
  for (const provider of ["claude", "chatgpt"]) {
    const source = a.usage?.[provider];
    if (!source || typeof source !== "object") continue;
    usage[provider] = { ts: Number.isFinite(source.ts) ? source.ts : undefined };
    for (const key of ["five_hour", "seven_day"]) {
      const window = source[key];
      if (window && Number.isFinite(window.pct)) usage[provider][key] = {
        pct: Math.max(0, Math.min(100, window.pct)),
        resets_at: Number.isFinite(window.resets_at) ? window.resets_at : undefined,
      };
    }
  }
  return { slug: a.slug, name: a.name, created: a.created,
    profile: { accent: sanitizeProfile(a.profile).accent, tagline: sanitizeProfile(a.profile).tagline },
    game: a.game ? { level: a.game.level, xp: a.game.xp, streak: a.game.streak, badges: a.game.badges ?? [] } : { level: 1, xp: 0, streak: 0, badges: [] },
    sessions: a.sessions.map(s => ({ src: s.src, host: sha(s.host).slice(0, 12), sid: s.sid,
      state: s.state, started: s.started, updated: s.updated, task: "", action: "" })),
    economy: spectatorEconomy(a.economy),
    feed: [], usage, seen: {}, today: {}, health: {} };
}

export function createApp({ code, db }) {
  // Le cookie d'entrée est dérivé du code : changer le code met tout le monde dehors.
  const pass = createHmac("sha256", code).update("penthouse").digest("hex");
  const spectatorPass = createHmac("sha256", code).update("spectator").digest("hex");
  const roomName = () => db.setting("roomName") ?? "Penthouse";
  // Seule l'empreinte de la clé est gardée ; on cherche l'étage par empreinte.
  const byToken = token => typeof token === "string" && token ? db.byTokenHash(sha(token)) : null;
  const newToken = () => randomBytes(24).toString("base64url");

  // État complet envoyé aux résidents, ou filtré pour les spectateurs. Un seul calcul des étages pour les deux.
  const payloads = (now = Date.now() / 1000) => {
    const apartments = db.snapshots(now);
    const tv = db.setting("tv") ?? { channel: "auto" };
    const room = roomName();
    // Jackpot commun du casino : visible de tous, résidents comme spectateurs.
    const jackpot = db.setting("jackpot") ?? { pool: CASINO.jackpot.seed, lastWinner: null };
    const casino = { jackpot: Math.floor(jackpot.pool), lastWinner: jackpot.lastWinner ?? null };
    let resident, spectator;
    return {
      resident: () => resident ??= { now, viewer: { role: "resident", room }, tv, casino, apartments },
      spectator: () => spectator ??= { now, viewer: { role: "spectator", room }, tv: publicTv(tv), casino, apartments: apartments.map(spectatorSnapshot) },
    };
  };
  // Flux SSE : un seul minuteur pour tous les onglets ouverts, l'état est calculé une fois toutes les 2 s.
  const streams = new Set();
  let streamTimer = null;
  const broadcast = () => {
    if (!streams.size) return;
    let built;
    try { built = payloads(); } catch { return; }
    const text = { resident: null, spectator: null };
    for (const client of streams) {
      const role = client.spectator ? "spectator" : "resident";
      try { client.res.write(text[role] ??= `data: ${JSON.stringify(built[role]())}\n\n`); } catch { streams.delete(client); }
    }
  };

  const server = createServer((req, res) => {
    const send = (status, body = "", type = "text/plain; charset=utf-8", headers = {}) =>
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers }).end(body);
    const json = (status, obj, headers = {}) => {
      const body = JSON.stringify(obj);
      if (body.length > 1024 && acceptsGzip(req)) {
        const compressed = gzipSync(body, { level: 1 });
        return send(status, compressed, "application/json", { ...headers, "Vary": "Accept-Encoding", "Content-Encoding": "gzip", "Content-Length": compressed.length });
      }
      return send(status, body, "application/json", headers);
    };
    const url = new URL(req.url, "http://x");
    const cookieFor = value => `penthouse=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;
    if (req.method === "GET" && url.pathname === "/spectateur") {
      return send(302, "", "text/plain; charset=utf-8", { Location: "/", "Set-Cookie": cookieFor(spectatorPass) });
    }
    // Dernière adresse de X-Forwarded-For : celle ajoutée par le proxy de l'hébergeur, que le visiteur ne choisit pas.
    const ip = String((trustProxy() ? req.headers["x-forwarded-for"] : null) ?? req.socket.remoteAddress ?? "").split(",").pop().trim();

    const serve = (file, type, cache = "public, max-age=0, must-revalidate") => {
      let resource;
      try { resource = staticResource(file, type); } catch { return send(404); }
      const compressed = resource.gzip && acceptsGzip(req);
      const etag = compressed ? '"gzip-' + resource.etag.slice(1) : resource.etag;
      const headers = { "Cache-Control": cache, "ETag": etag, "Vary": "Accept-Encoding", "X-Content-Type-Options": "nosniff" };
      if (req.headers["if-none-match"] === etag) return res.writeHead(304, headers).end();
      return res.writeHead(200, { ...headers, "Content-Type": type,
        "Content-Length": (compressed ? resource.gzip : resource.body).length,
        ...(compressed ? { "Content-Encoding": "gzip" } : {}) }).end(compressed ? resource.gzip : resource.body);
    };
    // Modèles 3D CC0 et visuels produits crédités : noms simples, cache navigateur.
    const asset = /^\/assets\/([A-Za-z0-9]+\.(glb|png))$/.exec(url.pathname);
    if (req.method === "GET" && asset) {
      return serve("public/assets/" + asset[1], asset[2] === "png" ? "image/png" : "model/gltf-binary", "public, max-age=86400");
    }
    if (req.method === "GET" && FILES[url.pathname]) {
      const [file, type] = FILES[url.pathname];
      return serve(file, `${type}; charset=utf-8`);
    }
    if (req.method === "GET" && url.pathname === "/api/connection") {
      const apt = byToken(req.headers["x-tour-token"]);
      if (!apt) return json(401, { error: "Clé invalide." });
      return json(200, { slug: apt.slug, name: apt.name });
    }
    const cookie = /(?:^|;\s*)penthouse=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
    const isSpectator = same(cookie, spectatorPass);
    const canView = same(cookie, pass) || isSpectator;
    if (req.method === "GET" && url.pathname === "/api/live") {
      if (!canView) return json(401, { error: "entrée requise" });
      return liveChannels().then(v => json(200, v));
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      if (!canView) return json(401, { error: "entrée requise" });
      const built = payloads();
      return json(200, isSpectator ? built.spectator() : built.resident());
    }
    if (req.method === "GET" && url.pathname === "/api/stream") {
      if (!canView) return json(401, { error: "entrée requise" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff",
      });
      // Reconnexion conseillée au navigateur après 5 s si le flux tombe.
      res.write("retry: 5000\n: connected\n\n");
      const client = { res, spectator: isSpectator };
      try {
        const built = payloads();
        res.write(`data: ${JSON.stringify(isSpectator ? built.spectator() : built.resident())}\n\n`);
      } catch { return res.end(); }
      streams.add(client);
      streamTimer ??= setInterval(broadcast, 2000);
      req.on("close", () => {
        streams.delete(client);
        if (!streams.size && streamTimer) { clearInterval(streamTimer); streamTimer = null; }
      });
      return;
    }
    if (req.method !== "POST") return send(404);

    const chunks = [];
    let size = 0;
    req.on("data", c => { size += c.length; if (size > MAX_BODY) req.destroy(); else chunks.push(c); });
    req.on("end", () => {
      // Une requête mal formée renvoie une erreur ; elle ne doit jamais arrêter le processus pour tout le monde.
      try { handlePost(); }
      catch (error) {
        console.error("penthouse :", url.pathname, "en erreur :", error?.message ?? error);
        if (!res.headersSent) send(500, "erreur interne");
      }
    });
    function handlePost() {
      const body = Buffer.concat(chunks);
      let p;
      try { p = JSON.parse(body); } catch { return send(400); }
      if (!p || typeof p !== "object") return send(400);

      if (url.pathname === "/api/spectate") {
        if (tooMany(ip)) return json(429, { error: "Trop d’essais, réessaie dans quelques minutes." });
        const room = String(p.room ?? "").trim();
        if (!room || room.length > 64 || slugify(room) !== slugify(roomName())) return json(404, { error: "Salle introuvable." });
        return json(200, { room: roomName() }, { "Set-Cookie": cookieFor(spectatorPass) });
      }
      if (url.pathname === "/api/exit-spectator") {
        if (!isSpectator) return json(403, { error: "Mode spectateur requis." });
        return json(200, {}, { "Set-Cookie": cookieFor("").replace("Max-Age=31536000", "Max-Age=0") });
      }
      if (url.pathname === "/e") {
        const apt = byToken(req.headers["x-tour-token"]);
        if (!apt) return send(401);
        const now = Date.now() / 1000;
        db.change(apt.slug, store => {
          const prev = Object.fromEntries(Object.entries(store.sessions).map(([k, s]) => [k, { state: s.state, updated: s.updated }]));
          ingest(store, String(url.searchParams.get("src") ?? "?").slice(0, 20), String(url.searchParams.get("host") ?? "?").slice(0, 40), p, now);
          onIngestEconomy(store, prev, now);
          onIngestGame(store, prev, p, now);
        });
        return send(204);
      }
      if (url.pathname === "/api/profile") {
        if (isSpectator || !same(cookie, pass)) return json(401, { error: "entrée requise" });
        const apt = byToken(req.headers["x-tour-token"]);
        if (!apt) return json(403, { error: "Clé de ton étage requise." });
        db.change(apt.slug, store => { store.profile = sanitizeProfile(p.profile, store.profile); });
        return json(200, { slug: apt.slug, profile: sanitizeProfile(db.get(apt.slug).store.profile) });
      }
      // Actions de jeu d'un résident : cookie d'entrée et clé de son étage. Le serveur décide seul du résultat.
      const residentApt = () => {
        if (isSpectator || !same(cookie, pass)) { json(401, { error: "entrée requise" }); return null; }
        const apt = byToken(req.headers["x-tour-token"]);
        if (!apt) { json(403, { error: "Clé de ton étage requise." }); return null; }
        return apt;
      };
      const play = (apt, fn) => {
        let result, toasts = [];
        db.change(apt.slug, store => {
          const now = Date.now() / 1000;
          result = fn(store, now);
          // XP et badges à jour dans la réponse, sans attendre le prochain état du flux.
          if (result && !result.error && !result.game) result.game = publicGame(store, now);
          toasts = [...(result?.toasts ?? []), ...pullToasts(store)];
        });
        if (!result || result.error) return json(400, { error: result?.error ?? "Action impossible." });
        const { toasts: _ignored, ...rest } = result;
        return json(200, { ...rest, toasts });
      };
      if (url.pathname === "/api/game/action") {
        const apt = residentApt();
        if (!apt) return;
        const action = String(p.action ?? "").slice(0, 32), floor = String(p.floor ?? "").slice(0, 48);
        return play(apt, (store, now) => performSpaceAction(store, action, now, { floor, slug: apt.slug }));
      }
      if (url.pathname === "/api/game/claim") {
        const apt = residentApt();
        if (!apt) return;
        const questId = String(p.questId ?? "").slice(0, 24);
        return play(apt, (store, now) => {
          const result = claimQuest(store, questId, now);
          // Une mission rapporte aussi des P$ : autant que son XP.
          const quest = DAILY_QUESTS.find(q => q.id === questId);
          if (result.ok && quest) questReward(store, quest.xp, quest.title, now);
          return result;
        });
      }
      // Économie : abonnements, boutique, casino, primes entre résidents. Le serveur décide de tout (y compris le hasard).
      if (url.pathname === "/api/economy/subscription") {
        const apt = residentApt();
        if (!apt) return;
        return play(apt, (store, now) => setSubscription(store, String(p.provider ?? "").slice(0, 16), p.tier ? String(p.tier).slice(0, 16) : null, now));
      }
      if (url.pathname === "/api/economy/buy") {
        const apt = residentApt();
        if (!apt) return;
        return play(apt, (store, now) => buyItem(store, String(p.item ?? "").slice(0, 24), String(p.target ?? "").slice(0, 16), now));
      }
      if (url.pathname === "/api/economy/casino") {
        const apt = residentApt();
        if (!apt) return;
        const pool = (db.setting("jackpot") ?? { pool: CASINO.jackpot.seed }).pool;
        let jackpot = null;
        const game = String(p.game ?? "").slice(0, 12), action = String(p.action ?? "deal").slice(0, 8);
        const answer = play(apt, (store, now) => {
          const result = playCasino(store, game, p.bet, String(p.choice ?? "").slice(0, 12), now, undefined, { pool, action });
          ({ jackpot = null } = result);
          delete result.jackpot;
          return result;
        });
        // Jackpot commun : chaque mise à la machine à sous l'alimente ; le 7️⃣7️⃣7️⃣ le remporte et il repart de zéro.
        if (jackpot) db.updateSetting("jackpot", current => {
          const base = current ?? { pool: CASINO.jackpot.seed, lastWinner: null };
          return jackpot.won ? { pool: CASINO.jackpot.seed, lastWinner: { name: apt.name, amount: jackpot.won, at: Date.now() / 1000 } }
            : { ...base, pool: Math.round((base.pool + jackpot.add) * 100) / 100 };
        });
        return answer;
      }
      if (url.pathname === "/api/economy/tip") {
        const apt = residentApt();
        if (!apt) return;
        const to = slugify(String(p.to ?? ""));
        let result, toasts = [];
        db.changeMany([apt.slug, to], ([from, target]) => {
          result = tip(from, target, p.amount, p.message, Date.now() / 1000);
          if (from && result?.ok) result.game = publicGame(from.store);
          if (from) toasts = pullToasts(from.store);
        });
        if (!result || result.error) return json(400, { error: result?.error ?? "Prime impossible." });
        return json(200, { ...result, toasts });
      }
      if (url.pathname === "/api/game/visit") {
        const apt = residentApt();
        if (!apt) return;
        const floorKey = String(p.floor ?? "").slice(0, 48);
        return play(apt, (store, now) => visitWing(store, floorKey, now, apt.slug));
      }
      // Télé du Salon : la chaîne est commune à tout le penthouse.
      if (url.pathname === "/api/tv") {
        if (!same(cookie, pass)) return json(401, { error: "entrée requise" });
        const channel = String(p.channel ?? "");
        // Le nom affiché vient de la clé quand elle est fournie : on ne choisit pas la télé « au nom » d'un autre.
        const by = byToken(req.headers["x-tour-token"])?.name ?? String(p.by ?? "").trim().slice(0, 32);
        if (channel === "custom") {
          const custom = parseTvLink(p.url);
          if (!custom) return json(400, { error: "Colle un lien YouTube (vidéo ou live) ou une chaîne Twitch." });
          const tv = { channel, custom, by, at: Date.now() / 1000 };
          db.setSetting("tv", tv);
          return json(200, tv);
        }
        if (channel !== "auto" && !CHANNELS.includes(channel)) return json(400, { error: "Chaîne inconnue." });
        const tv = { channel, by, at: Date.now() / 1000 };
        db.setSetting("tv", tv);
        return json(200, tv);
      }
      // Quitter le penthouse : seul le détenteur de la clé de l'étage peut le supprimer.
      if (url.pathname === "/api/leave") {
        const apt = byToken(req.headers["x-tour-token"]);
        if (!apt) return send(401);
        db.remove(apt.slug);
        return json(200, { slug: apt.slug });
      }
      // Entrer dans le penthouse (nom + code) ; un nouveau nom reçoit son appartement et sa clé.
      // /api/key exige la clé actuelle pour renouveler celle d’un appartement existant.
      if (url.pathname === "/api/join" || url.pathname === "/api/key") {
        if (tooMany(ip)) return json(429, { error: "Trop d'essais, réessaie dans quelques minutes." });
        if (!same(String(p.code ?? ""), code)) return json(403, { error: "Code du penthouse incorrect." });
        const name = String(p.name ?? "").trim().slice(0, 32), slug = slugify(name);
        if (!slug) return json(400, { error: "Choisis un nom." });
        if (["roof", "lounge", "club", "casino", "tennis", "golf"].includes(slug)) return json(400, { error: "Ce nom est réservé aux espaces communs. Choisis un autre nom." });
        let apt = db.get(slug), token;
        if (!apt) {
          token = newToken();
          if (!db.create(slug, name, sha(token), MAX_APARTMENTS)) {
            apt = db.get(slug);
            if (!apt) return json(409, { error: "Le penthouse est complet." });
            token = undefined; // créé au même instant par une autre requête : on entre sans nouvelle clé
          } else apt = db.get(slug);
        } else if (url.pathname === "/api/key") {
          if (byToken(req.headers["x-tour-token"])?.slug !== slug)
            return json(403, { error: "La clé actuelle de cet étage est nécessaire pour la remplacer." });
          token = newToken(); db.setToken(slug, sha(token));
        }
        const cookie = `penthouse=${pass}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;
        return json(200, { slug, name: apt.name, token }, { "Set-Cookie": cookie });
      }
      send(404);
    }
  });
  server.on("close", () => { if (streamTimer) clearInterval(streamTimer); streamTimer = null; streams.clear(); });
  return server;
}
