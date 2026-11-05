// État partagé de la tour : les variables que plusieurs modules modifient. Un module ne peut pas réassigner une
// variable importée d'un autre : elles vivent donc ici, dans un seul objet, et chacun lit et écrit world.x.
// N'ajoute un champ ici que s'il est vraiment écrit depuis plusieurs modules ; sinon garde un `let` dans son module.
export const world = {
  // État reçu du serveur et tour
  data: null,            // dernier état complet (/api/state ou flux SSE) : apartments, viewer, tv, now…
  residents: [],         // résidents de la tour, dans l'ordre des étages (syncFloors)
  order: [],             // clés des étages de haut en bas : "roof", "lucas:work", "lounge"…
  focus: 0,              // indice dans order de l'étage regardé
  modelsReady: false,    // modèles 3D chargés : le flux temps réel peut construire les étages
  towerTop: -0.5,        // haut du fût de la tour, qui suit l'étage regardé
  // Télé du Salon
  liveNow: {},           // chaînes Twitch en direct (/api/live)
  tvChoice: "auto",      // chaîne choisie (commune à tout le penthouse)
  tvBy: "",              // qui l'a choisie
  tvMine: 0,             // jusqu'à quand ignorer l'état du serveur après son propre clic (3 s)
  tvCustom: null,        // lien perso normalisé par le serveur
  tvLinkOpen: false, tvLinkDraft: "", tvLinkError: "", // formulaire du lien perso
  shownUrl: "",          // page actuellement chargée dans l'écran du Salon
  // Navigation et visite spectateur
  lastMove: 0,           // dernier changement d'étage (mode écran ?ecran)
  lastTourViewKey: "", lastTourData: null, // dernière étape de visite affichée
  tourStarted: 0, tourPaused: false,       // visite spectateur : départ et pause
  // Alertes
  activeApproval: null,  // demande d'accord affichée dans le bandeau
};
