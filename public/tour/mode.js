// Mode d'affichage, choisi par chaque personne sur son appareil (menu « ⋯ ») :
// - « complet » : tout, gamification comprise (XP, P$, missions, boutique, casino, sports, célébrations) ;
// - « productif » : la gamification est masquée, il reste le travail des agents (états, demandes, quotas, temps de
//   travail, tâches livrées). Rien n'est supprimé : le serveur calcule tout pareil, l'interface ne l'affiche pas.
// Les étages de jeu (casino, tennis, golf) sont retirés de la liste et de la navigation ; les agents en pause peuvent
// toujours y aller.
const KEY = "penthouse.mode";
export const GAME_FLOORS = new Set(["casino", "tennis", "golf"]);

function read() {
  try { return localStorage.getItem(KEY) === "productif" ? "productif" : "complet"; } catch { return "complet"; }
}
let mode = read();
document.body.dataset.mode = mode;

export const productive = () => mode === "productif";
// Étage affiché dans la liste et la navigation : tous en mode complet, sans les étages de jeu en mode productif.
export const floorShown = key => !(productive() && GAME_FLOORS.has(key));

export function setMode(next) {
  mode = next === "productif" ? "productif" : "complet";
  try { localStorage.setItem(KEY, mode); } catch { /* stockage indisponible : le choix vaut pour cet onglet */ }
  document.body.dataset.mode = mode;
  dispatchEvent(new CustomEvent("penthouse:mode", { detail: mode }));
}
