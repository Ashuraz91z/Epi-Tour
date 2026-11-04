// Les étages du penthouse, dans SQLite. L'hébergeur peut faire tourner plusieurs copies du serveur à la fois :
// chaque modification est une transaction (lecture, changement, écriture) pour qu'aucune n'efface les autres.
import { DatabaseSync } from "node:sqlite";
import { createStore, snapshot } from "./core.js";

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS apartments (slug TEXT PRIMARY KEY, name TEXT NOT NULL, created REAL NOT NULL, token_hash TEXT NOT NULL, store TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- Clés supplémentaires d'un étage : celles des étages fusionnés dedans, pour que leurs machines restent reliées.
    CREATE TABLE IF NOT EXISTS keys (token_hash TEXT PRIMARY KEY, slug TEXT NOT NULL)`);
  const row = r => r && { slug: r.slug, name: r.name, created: r.created, tokenHash: r.token_hash, store: { ...createStore(), ...JSON.parse(r.store) } };
  const one = db.prepare("SELECT * FROM apartments WHERE slug = ?");
  const tx = fn => {
    db.exec("BEGIN IMMEDIATE");
    try { const v = fn(); db.exec("COMMIT"); return v; } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return {
    all: () => db.prepare("SELECT * FROM apartments ORDER BY created").all().map(row),
    // Lecture unique ; le ménage n'écrit que s'il change l'état. Une collecte concurrente n'est jamais écrasée.
    snapshots: now => {
      const changes = [];
      const views = db.prepare("SELECT * FROM apartments ORDER BY created").all().map(raw => {
        const a = row(raw), view = snapshot(a.store, now), after = JSON.stringify(a.store);
        if (after !== raw.store) changes.push([after, a.slug, raw.store]);
        return { slug: a.slug, name: a.name, created: a.created, ...view };
      });
      if (changes.length) tx(() => {
        const update = db.prepare("UPDATE apartments SET store = ? WHERE slug = ? AND store = ?");
        for (const change of changes) update.run(...change);
      });
      return views;
    },
    get: slug => row(one.get(slug)),
    byTokenHash: hash => row(db.prepare("SELECT * FROM apartments WHERE token_hash = ?").get(hash)
      ?? db.prepare("SELECT a.* FROM keys k JOIN apartments a ON a.slug = k.slug WHERE k.token_hash = ?").get(hash)),
    // Création si le nom est libre (et le penthouse pas complet) : renvoie false sinon, même en cas de course.
    create: (slug, name, tokenHash, max) => tx(() => {
      if (one.get(slug) || db.prepare("SELECT count(*) n FROM apartments").get().n >= max) return false;
      db.prepare("INSERT INTO apartments VALUES (?, ?, ?, ?, ?)").run(slug, name, Date.now() / 1000, tokenHash, JSON.stringify(createStore()));
      return true;
    }),
    count: () => db.prepare("SELECT count(*) n FROM apartments").get().n,
    // Nouvelle clé : les anciennes, y compris celles reprises d'étages fusionnés, ne relient plus aucune machine.
    setToken: (slug, tokenHash) => tx(() => {
      db.prepare("DELETE FROM keys WHERE slug = ?").run(slug);
      db.prepare("UPDATE apartments SET token_hash = ? WHERE slug = ?").run(tokenHash, slug);
    }),
    remove: slug => tx(() => {
      db.prepare("DELETE FROM keys WHERE slug = ?").run(slug);
      db.prepare("DELETE FROM apartments WHERE slug = ?").run(slug);
    }),
    // Administration (admin.js) : fusion de deux étages en une transaction, renommage en gardant la clé.
    merge: (from, into, combine) => tx(() => {
      const a = row(one.get(from)), b = row(one.get(into));
      if (!a || !b || from === into) return null;
      const store = combine(b.store, a.store);
      db.prepare("UPDATE apartments SET store = ?, created = ? WHERE slug = ?").run(JSON.stringify(store), Math.min(a.created, b.created), into);
      db.prepare("INSERT OR REPLACE INTO keys VALUES (?, ?)").run(a.tokenHash, into);
      db.prepare("UPDATE keys SET slug = ? WHERE slug = ?").run(into, from);
      db.prepare("DELETE FROM apartments WHERE slug = ?").run(from);
      return { from: a.name, into: b.name };
    }),
    rename: (slug, newSlug, name) => tx(() => {
      if (!one.get(slug) || (newSlug !== slug && one.get(newSlug))) return false;
      db.prepare("UPDATE apartments SET slug = ?, name = ? WHERE slug = ?").run(newSlug, name, slug);
      db.prepare("UPDATE keys SET slug = ? WHERE slug = ?").run(newSlug, slug);
      return true;
    }),
    change: (slug, fn) => tx(() => {
      const a = row(one.get(slug));
      if (!a) return;
      const before = JSON.stringify(a.store);
      const result = fn(a.store);
      const after = JSON.stringify(a.store);
      if (after !== before) db.prepare("UPDATE apartments SET store = ? WHERE slug = ?").run(after, slug);
      return result;
    }),
    // Plusieurs étages modifiés ensemble (prime d'un résident à un autre) : tout ou rien.
    changeMany: (slugs, fn) => tx(() => {
      const list = slugs.map(slug => row(one.get(slug)));
      if (list.some(a => !a)) return fn(list.map(() => null));
      const before = list.map(a => JSON.stringify(a.store));
      const result = fn(list);
      list.forEach((a, i) => {
        const after = JSON.stringify(a.store);
        if (after !== before[i]) db.prepare("UPDATE apartments SET store = ? WHERE slug = ?").run(after, a.slug);
      });
      return result;
    }),
    // Réglages communs à tout le penthouse (la chaîne de la télé du Salon).
    setting: key => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key); return r ? JSON.parse(r.value) : undefined; },
    setSetting: (key, value) => db.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").run(key, JSON.stringify(value)),
    // Réglage commun modifié d'après sa valeur actuelle (jackpot du casino), sans perdre une mise concurrente.
    updateSetting: (key, fn) => tx(() => {
      const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      const next = fn(r ? JSON.parse(r.value) : undefined);
      db.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").run(key, JSON.stringify(next));
      return next;
    }),
    // Reprise de l'ancienne sauvegarde JSON (une seule fois, base vide).
    importJson: apartments => tx(() => {
      for (const [slug, a] of Object.entries(apartments))
        db.prepare("INSERT OR IGNORE INTO apartments VALUES (?, ?, ?, ?, ?)").run(slug, a.name, a.created, a.tokenHash, JSON.stringify(a.store ?? createStore()));
    }),
  };
}
