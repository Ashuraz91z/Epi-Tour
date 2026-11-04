// Migrations de données, exécutées une seule fois au démarrage du serveur (identifiant gardé dans la table settings).
// Utile quand on ne peut pas lancer `npm run admin` sur le serveur : on décrit le ménage ici, le déploiement l'applique.
// Chaque étape est sans risque si elle est rejouée ou si un étage n'existe pas (elle est alors sautée) ; plusieurs
// copies du serveur peuvent démarrer en même temps : chaque fusion est une transaction.
import { mergeStores } from "./admin.js";
import { slugify } from "./penthouse.js";

export const MIGRATIONS = [
  {
    id: "2026-11-04-doublons",
    // Une même personne, plusieurs étages. On ne touche pas aux autres étages (Danny, Lucas, Quentin, hugoat…).
    steps: [
      { merge: ["Paul-Adrien", "Paul-Arien"] }, // ancien étage dont la clé est perdue
      { merge: ["Paul", "Paul-Arien"] }, // étage créé en navigation privée
      { rename: ["Paul-Arien", "Paul-Adrien"] }, // faute de frappe corrigée ; la clé du Mac reste valable
      { merge: ["Linnix", "Arthur"] }, // Linnix et Arthur sont la même personne
    ],
  },
  {
    // Si la migration précédente a tourné avant l'existence des alias : les anciens noms mènent à l'étage gardé.
    id: "2026-11-04-anciens-noms",
    steps: [
      { alias: ["Paul", "Paul-Adrien"] },
      { alias: ["Paul-Arien", "Paul-Adrien"] },
      { alias: ["Linnix", "Arthur"] },
    ],
  },
];

export function runMigrations(db, log = console.log, migrations = MIGRATIONS) {
  for (const m of migrations) {
    if ((db.setting("migrations") ?? []).includes(m.id)) continue;
    for (const step of m.steps) {
      if (step.merge) {
        const [from, into] = step.merge.map(slugify);
        if (!db.get(from) || !db.get(into) || from === into) { log(`migration ${m.id} : fusion ${step.merge.join(" → ")} sautée (étage absent)`); continue; }
        const done = db.merge(from, into, mergeStores);
        log(`migration ${m.id} : ${done ? `« ${done.from} » fusionné dans « ${done.into} »` : "fusion impossible"}`);
      } else if (step.alias) {
        const [name, target] = step.alias;
        log(`migration ${m.id} : ${db.addAlias(slugify(name), slugify(target)) ? `« ${name} » mène à « ${target} »` : `alias « ${name} » sauté`}`);
      } else if (step.rename) {
        const [name, newName] = step.rename, slug = slugify(name), newSlug = slugify(newName);
        if (!db.get(slug)) { log(`migration ${m.id} : renommage de « ${name} » sauté (étage absent)`); continue; }
        log(`migration ${m.id} : ${db.rename(slug, newSlug, newName) ? `« ${name} » renommé « ${newName} »` : `renommage de « ${name} » impossible (nom pris)`}`);
      }
    }
    db.setSetting("migrations", [...new Set([...(db.setting("migrations") ?? []), m.id])]);
  }
}
