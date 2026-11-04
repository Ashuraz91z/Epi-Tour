// Catalogue de l'économie du penthouse, partagé tel quel par le serveur (economy.js) et l'interface (economy-ui.js).
// Données pures, sans logique : un seul endroit à modifier pour changer un salaire, un prix ou une règle du casino.

export const CURRENCY = "P$"; // Penthouse dollars, monnaie du jeu : aucune valeur réelle.

// Abonnements par fournisseur d'IA. Le rang décide du grade (et donc du salaire) des agents de ce fournisseur.
// Les noms de formules sont indicatifs : le résident déclare la sienne, Codex la confirme quand ses journaux la donnent.
export const PROVIDERS = {
  claude: { name: "Claude", tools: ["claude"], tiers: [
    { id: "free", name: "Free", rank: 0 }, { id: "pro", name: "Pro", rank: 1 }, { id: "api", name: "API (à l'usage)", rank: 2 },
    { id: "team", name: "Team", rank: 3 }, { id: "max5", name: "Max 5x", rank: 3 }, { id: "max20", name: "Max 20x", rank: 4 },
    { id: "enterprise", name: "Enterprise", rank: 5 },
  ] },
  chatgpt: { name: "ChatGPT", tools: ["codex"], tiers: [
    { id: "free", name: "Free", rank: 0 }, { id: "plus", name: "Plus", rank: 1 }, { id: "api", name: "API (à l'usage)", rank: 2 },
    { id: "business", name: "Business / Team", rank: 3 }, { id: "pro", name: "Pro", rank: 4 }, { id: "enterprise", name: "Enterprise", rank: 5 },
  ] },
  cursor: { name: "Cursor", tools: ["cursor"], tiers: [
    { id: "hobby", name: "Hobby", rank: 0 }, { id: "pro", name: "Pro", rank: 1 }, { id: "teams", name: "Teams", rank: 3 },
    { id: "proplus", name: "Pro+", rank: 3 }, { id: "ultra", name: "Ultra", rank: 4 },
  ] },
  grok: { name: "Grok", tools: ["grok"], tiers: [
    { id: "free", name: "Free", rank: 0 }, { id: "premiumplus", name: "X Premium+", rank: 1 }, { id: "supergrok", name: "SuperGrok", rank: 2 },
    { id: "heavy", name: "SuperGrok Heavy", rank: 4 },
  ] },
  hermes: { name: "Hermes", tools: ["hermes"], tiers: [
    { id: "local", name: "Auto-hébergé", rank: 1 }, { id: "api", name: "API", rank: 2 }, { id: "cloud", name: "Cloud GPU", rank: 3 },
  ] },
  n8n: { name: "n8n", tools: ["n8n"], tiers: [
    { id: "community", name: "Community (auto-hébergé)", rank: 1 }, { id: "starter", name: "Starter", rank: 1 }, { id: "pro", name: "Pro", rank: 3 },
    { id: "enterprise", name: "Enterprise", rank: 5 },
  ] },
};
// Outil (src des événements) -> fournisseur de l'abonnement.
export const TOOL_PROVIDER = { claude: "claude", codex: "chatgpt", cursor: "cursor", grok: "grok", hermes: "hermes", n8n: "n8n" };
// Formule lue dans les journaux Codex (plan_type) -> formule ChatGPT du catalogue : l'abonnement est alors « vérifié ».
export const CHATGPT_PLANS = { free: "free", go: "free", plus: "plus", pro: "pro", team: "business", business: "business", enterprise: "enterprise", edu: "business" };

// Grades : rang de l'abonnement -> titre et taux horaire de base (P$ par heure de travail réel).
export const GRADES = [
  { rank: 0, id: "stagiaire", title: "Stagiaire", icon: "🎓", rate: 15 },
  { rank: 1, id: "junior", title: "Junior", icon: "🌱", rate: 30 },
  { rank: 2, id: "confirme", title: "Confirmé·e", icon: "🛠️", rate: 50 },
  { rank: 3, id: "senior", title: "Senior", icon: "🧠", rate: 80 },
  { rank: 4, id: "lead", title: "Lead", icon: "🧭", rate: 120 },
  { rank: 5, id: "directeur", title: "Directeur·rice", icon: "🏛️", rate: 160 },
];
// Métier de chaque outil ; un webhook inconnu est un freelance (grade Junior).
export const SPECIALTIES = { claude: "Ingé logiciel", codex: "Ingé logiciel", cursor: "Dev studio", hermes: "Chercheur·se IA", grok: "Analyste", n8n: "Automaticien·ne" };
export const FREELANCE = { specialty: "Freelance", rank: 1 };

// Carrière : minutes travaillées cumulées -> échelon (1 à 10). Chaque échelon ajoute 6 % au taux horaire.
export const ECHELONS = [0, 120, 360, 720, 1200, 1800, 2700, 3900, 5400, 7200];
export const ECHELON_BONUS = 0.06;

// Journée de travail d'un agent (par outil) : 7 h normales, heures sup majorées jusqu'à 10 h, au-delà repos obligatoire.
export const WORKDAY = { normal: 7 * 60, max: 10 * 60, overtime: 1.25 };
// Majorations (heure de Paris) : nuit de 22 h à 6 h, dimanche.
export const MAJORATIONS = { nightFrom: 22, nightTo: 6, night: 1.25, sunday: 1.5 };
// Primes : livraison (tour terminé après du travail), réactivité (autorisation donnée en moins de 2 min).
export const PRIMES = { delivery: { base: 4, perRank: 3, dailyMax: 30 }, reactivity: { amount: 12, within: 120, dailyMax: 20 } };
// Modèle utilisé : les gros modèles touchent une prime, les petits un peu moins.
export const MODEL_FACTORS = [
  { pattern: "opus|-pro\\b|o3-pro|heavy|ultra", factor: 1.15, label: "Prime modèle haut de gamme" },
  { pattern: "haiku|mini|nano|flash|lite", factor: 0.9, label: "Modèle léger" },
];
// Moral : baisse après 2 h de travail sans pause (1 point / 3 min), plancher 40. Il module le salaire de 82 % à 100 %.
export const MORALE = { freshMinutes: 120, perPoint: 3, floor: 40, pauseMinutes: 15, minFactor: 0.7 };

// Titre du résident (PDG) selon le cumul de ses salaires et primes.
export const TITLES = [
  { min: 0, title: "Auto-entrepreneur·e", icon: "🧢" },
  { min: 500, title: "Fondateur·rice", icon: "🚀" },
  { min: 2000, title: "Startup", icon: "🌱" },
  { min: 10000, title: "Scale-up", icon: "📈" },
  { min: 50000, title: "Licorne", icon: "🦄" },
  { min: 200000, title: "Décacorne", icon: "🐉" },
  { min: 1000000, title: "Empire", icon: "👑" },
];

// Boutique. Avantages : temporaires ou à usage unique. Décor : permanent, visible dans le bureau 3D du résident.
export const SHOP = [
  { id: "cafe_premium", kind: "perk", name: "Café premium", icon: "☕", price: 120, hours: 4, desc: "Moral au maximum pour toute l'équipe pendant 4 h." },
  { id: "objectifs", kind: "perk", name: "Objectifs trimestriels", icon: "📈", price: 400, hours: 3, desc: "Salaires +20 % pendant 3 h." },
  { id: "formation", kind: "perk", name: "Formation express", icon: "📚", price: 300, target: true, minutes: 120, desc: "+2 h d'ancienneté pour un agent : sa promotion arrive plus vite." },
  { id: "seminaire", kind: "perk", name: "Séminaire au Club", icon: "🪩", price: 250, xp: 150, desc: "+150 XP pour ton étage." },
  { id: "assurance", kind: "perk", name: "Assurance casino", icon: "🛡️", price: 150, desc: "Rembourse la moitié de ta prochaine perte au casino (500 P$ max)." },
  { id: "plante_xl", kind: "decor", name: "Plante géante", icon: "🌿", price: 200, desc: "Un coin de jungle dans ton bureau." },
  { id: "arcade", kind: "decor", name: "Borne d'arcade", icon: "👾", price: 900, desc: "Pour les pauses de tes agents." },
  { id: "neon", kind: "decor", name: "Néon à ton nom", icon: "💡", price: 1200, desc: "Ton nom en lettres lumineuses, à ta couleur." },
  { id: "aquarium", kind: "decor", name: "Aquarium", icon: "🐠", price: 1500, desc: "Des poissons qui ne demandent jamais d'autorisation." },
  { id: "trophee", kind: "decor", name: "Trophée doré", icon: "🏆", price: 2500, desc: "Pour rappeler qui fait tourner la tour." },
  { id: "piano", kind: "decor", name: "Piano à queue", icon: "🎹", price: 5000, desc: "Le standing d'un vrai penthouse." },
  { id: "statue", kind: "decor", name: "Statue de robot en or", icon: "🗿", price: 10000, desc: "Ton meilleur agent, immortalisé." },
];

// Casino : tirages faits par le serveur, mises en P$. Limites quotidiennes pour garder le jeu… un jeu.
export const CASINO = {
  minBet: 10, maxBet: 500, dailyLossLimit: 2000, dailyPlays: 200,
  // Machine à sous : 3 rouleaux. Trois identiques : mise × pay3. Deux identiques : mise × pair. Retour moyen ≈ 94 %.
  slots: {
    symbols: [
      { s: "🍒", w: 30, pay3: 3 }, { s: "🍋", w: 25, pay3: 4 }, { s: "🔔", w: 18, pay3: 6 },
      { s: "⭐", w: 12, pay3: 10 }, { s: "💎", w: 8, pay3: 20 }, { s: "7️⃣", w: 7, pay3: 50 },
    ],
    pair: 1.5,
  },
  // Roulette européenne (0 à 36) : couleur ou parité × 2, numéro plein × 36.
  roulette: { red: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36], even: 2, number: 36 },
  // Course de robots : un robot par outil, le gagnant paie × 5,5.
  race: { runners: ["claude", "codex", "cursor", "hermes", "grok", "n8n"], payout: 5.5 },
  // Blackjack : un sabot de 52 cartes par main, la banque tire jusqu'à 17. Gagné × 2, blackjack × 2,5, égalité remboursée.
  blackjack: { payout: 2, natural: 2.5, dealerStands: 17 },
  // Jackpot commun à tout le penthouse : 2 % de chaque mise à la machine à sous l'alimentent (offerts par la maison),
  // le 7️⃣7️⃣7️⃣ l'emporte en plus de son gain. Il repart de 1 000 P$.
  jackpot: { seed: 1000, share: 0.02 },
  // Étage Tennis : match en un set contre le pro du club. Plus le style est risqué, plus il rapporte.
  tennis: { styles: [
    { id: "attaque", name: "Attaque à outrance", icon: "⚡", chance: 0.35, payout: 2.6 },
    { id: "equilibre", name: "Jeu équilibré", icon: "🎾", chance: 0.48, payout: 1.95 },
    { id: "defense", name: "Mur du fond de court", icon: "🧱", chance: 0.6, payout: 1.55 },
  ] },
  // Étage Golf : un putt, du plus facile au plus long.
  golf: { shots: [
    { id: "court", name: "Putt de 1 m", icon: "⛳", chance: 0.72, payout: 1.3 },
    { id: "moyen", name: "Putt de 4 m", icon: "🏌️", chance: 0.47, payout: 2 },
    { id: "long", name: "Putt de 12 m", icon: "🦅", chance: 0.22, payout: 4.2 },
  ] },
};

// Mini-jeux d'adresse des étages Tennis et Golf, joués dans le navigateur. Le résultat vient du joueur : la récompense
// est donc vérifiée (durée, score possible) et plafonnée à quelques parties par jour et par sport.
export const SPORTS = {
  dailyRewards: 5,
  tennis: {
    gamesToWin: 3, // match en trois jeux gagnants ; un jeu se joue en points de tennis (15, 30, 40, jeu)
    minSecondsPerGame: 6,
    lossXp: 5,
    levels: [
      { id: "debutant", name: "Débutant du club", icon: "🙂", speed: 0.75, money: 15, xp: 20 },
      { id: "pro", name: "Pro du club", icon: "😎", speed: 1, money: 35, xp: 40 },
      { id: "legende", name: "Légende du court", icon: "🏆", speed: 1.3, money: 70, xp: 70 },
    ],
  },
  golf: {
    par: [2, 3, 4], // trois trous de mini-golf
    maxStrokes: 10, // par trou ; au-delà, la balle est ramassée
    minSecondsPerHole: 4,
    par0: { money: 15, xp: 25 }, // parcours au par
    underPar: { money: 15, xp: 10 }, // par coup sous le par
    overXp: 10,
    ace: 50, // trou en un : bonus par trou
  },
};

// Virements entre résidents (« prime de collègue »).
export const TIPS = { min: 10, dailyMax: 1000, message: 80 };

// Événement du jour, identique pour tout le penthouse (tiré d'après la date).
export const EVENTS = [
  { id: "calme", name: "Journée calme", icon: "🌤️", desc: "Rien de spécial : au travail !", weight: 8 },
  { id: "double_paie", name: "Double paie", icon: "💸", desc: "Tous les salaires sont doublés aujourd'hui.", weight: 1, salary: 2 },
  { id: "black_friday", name: "Black Friday", icon: "🛍️", desc: "Toute la boutique à −30 %.", weight: 2, shop: 0.7 },
  { id: "nuit_blanche", name: "Nuit blanche", icon: "🌙", desc: "Majoration de nuit portée à +60 %.", weight: 2, night: 1.6 },
  { id: "jackpot", name: "Jackpot progressif", icon: "🎰", desc: "Le 7️⃣7️⃣7️⃣ paie × 100 à la machine à sous.", weight: 2, jackpot: 100 },
  { id: "augmentation", name: "Les stagiaires ont obtenu une augmentation", icon: "✊", desc: "Les stagiaires sont payés double.", weight: 2, intern: 2 },
  { id: "bien_etre", name: "Séminaire bien-être", icon: "🧘", desc: "Le moral de tous les agents reste au maximum.", weight: 2, morale: true },
  { id: "audit", name: "Audit surprise", icon: "🕵️", desc: "Primes de livraison doublées.", weight: 2, delivery: 2 },
];

// Badges gagnés par l'économie (affichés avec ceux du jeu).
export const ECONOMY_BADGES = {
  first_pay: "Premier salaire", promo: "Première promotion", rich: "Fortune à 5 chiffres", jackpot: "Jackpot !",
  generous: "Patron·ne généreux·se", night_shift: "Équipe de nuit", decorator: "Décorateur·rice", unicorn: "Licorne",
  ace: "Trou en un", champion: "Champion du club",
};
