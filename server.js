// Démarre le penthouse. Lancé tel quel par l'hébergeur, parfois en plusieurs copies : l'état vit dans SQLite.
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";
import { createApp } from "./penthouse.js";
import { runMigrations } from "./migrations.js";

const PORT = Number(process.env.PORT ?? 3000);
// Hors du dossier du site : un redéploiement remplace le site mais garde les étages.
const DATA_DIR = process.env.DATA_DIR ?? join(homedir(), ".tour-de-controle");
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const db = openDb(join(DATA_DIR, "penthouse.db"));

// Reprise de l'ancienne sauvegarde JSON, une seule fois.
const legacy = join(DATA_DIR, "state.json");
if (existsSync(legacy) && db.count() === 0) {
  db.importJson(JSON.parse(readFileSync(legacy, "utf8")));
  renameSync(legacy, legacy + ".importe");
}

// Ménage des données décrit dans migrations.js (fusion d'étages en double…), une seule fois par migration.
runMigrations(db);

const code = process.env.PENTHOUSE_CODE;
if (!code) throw new Error("PENTHOUSE_CODE manquant : le code d'entrée du penthouse.");
createApp({ code, db }).listen(PORT, () => console.log(`Penthouse ouvert sur le port ${PORT} (processus ${process.pid})`));
