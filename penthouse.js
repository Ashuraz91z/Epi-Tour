// Le penthouse : un site où chacun entre avec son nom, reçoit un appartement et y relie ses agents.
// Les collecteurs envoient leurs événements sur POST /e avec la clé de l'appartement (même format que la v1).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ingest } from "./core.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 256 * 1024;
const MAX_APARTMENTS = 50;
const acceptsGzip = req => /(?:^|,)\s*gzip\s*(?:,|$)/i.test(req.headers["accept-encoding"] ?? "");
const FILES = {
  "/break-motion.js": ["public/break-motion.js", "text/javascript"],
  "/approval-alert.js": ["public/approval-alert.js", "text/javascript"],
  "/spectator-tour.js": ["public/spectator-tour.js", "text/javascript"],
  "/desk-slots.js": ["public/desk-slots.js", "text/javascript"],
  "/": ["public/index.html", "text/html"], "/app.js": ["public/app.js", "text/javascript"], "/style.css": ["public/style.css", "text/css"],
  "/tour-hook": ["collecteurs/tour-hook", "text/plain"], "/install-hook.py": ["collecteurs/install-hook.py", "text/plain"],
  "/hermes-handler.py": ["collecteurs/hermes-hook/handler.py", "text/plain"],
  "/hermes-hook.yaml": ["collecteurs/hermes-hook/HOOK.yaml", "text/plain"],
  "/grok-mcp.py": ["collecteurs/grok-mcp.py", "text/plain"],
  "/tour_http.py": ["collecteurs/tour_http.py", "text/plain"],
  "/tour-sync": ["collecteurs/tour-sync", "text/plain"],
  "/install-sync.py": ["collecteurs/install-sync.py", "text/plain"],
  "/tour-check": ["collecteurs/tour-check", "text/plain"],
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
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 600_000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 10;
}

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
    sessions: a.sessions.map(s => ({ src: s.src, host: sha(s.host).slice(0, 12), sid: s.sid,
      state: s.state, started: s.started, updated: s.updated, task: "", action: "" })),
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
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",").pop().trim();

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
      const now = Date.now() / 1000;
      const apartments = db.snapshots(now);
      const tv = db.setting("tv") ?? { channel: "auto" };
      return json(200, { now, viewer: { role: isSpectator ? "spectator" : "resident", room: roomName() },
        tv: isSpectator ? { channel: tv.channel } : tv, apartments: isSpectator ? apartments.map(spectatorSnapshot) : apartments });
    }
    if (req.method !== "POST") return send(404);

    const chunks = [];
    let size = 0;
    req.on("data", c => { size += c.length; if (size > MAX_BODY) req.destroy(); else chunks.push(c); });
    req.on("end", () => {
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
        db.change(apt.slug, store => ingest(store, String(url.searchParams.get("src") ?? "?").slice(0, 20), String(url.searchParams.get("host") ?? "?").slice(0, 40), p));
        return send(204);
      }
      // Télé du Salon : la chaîne est commune à tout le penthouse.
      if (url.pathname === "/api/tv") {
        if (!same(cookie, pass)) return json(401, { error: "entrée requise" });
        const channel = String(p.channel ?? "");
        if (channel === "custom") {
          const customUrl = String(p.url ?? "").trim().slice(0, 500);
          if (!customUrl) return json(400, { error: "URL requise pour lien personnalisé." });
          const tv = { channel: "custom", url: customUrl, by: String(p.by ?? "").trim().slice(0, 32), at: Date.now() / 1000 };
          db.setSetting("tv", tv);
          return json(200, tv);
        }
        if (channel !== "auto" && !CHANNELS.includes(channel)) return json(400, { error: "Chaîne inconnue." });
        const tv = { channel, by: String(p.by ?? "").trim().slice(0, 32), at: Date.now() / 1000 };
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
        if (["roof", "lounge", "club", "casino"].includes(slug)) return json(400, { error: "Ce nom est réservé aux espaces communs. Choisis un autre nom." });
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
    });
  });
  return server;
}
