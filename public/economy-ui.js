// Interface de l'économie du penthouse : l'entreprise du résident (équipe et paie, boutique, casino, sport, classements, banque).
// Des fonctions pures qui renvoient du HTML, puis le dialogue « 💼 Entreprise » et ses appels au serveur.
// Tout texte venu du serveur ou d'un autre résident passe par esc. Le serveur décide de tout, hasard compris :
// les animations du casino ne font qu'occuper l'attente, puis montrent le vrai résultat renvoyé.
import { CASINO, CURRENCY, ECHELONS, GRADES, PROVIDERS, SHOP, TIPS, WORKDAY } from "./economy-data.js";

// ---------- formats ----------
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
export const money = n => `${nf.format(Number(n) || 0)} ${CURRENCY}`;
export const signedMoney = n => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(Number(n) || 0))}`;
export function duration(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
const pct = (a, b) => b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0;
const factorText = f => { const p = Math.round((Number(f) - 1) * 100); return `${p >= 0 ? "+" : "−"}${Math.abs(p)} %`; };
function dayName(date) {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(date ?? "") : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}
const when = t => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const toolOf = (tools, src) => tools[src] ?? { name: src, color: "#8e95aa" };

// ---------- petits morceaux réutilisés par app.js ----------
export const staffOf = (apt, src) => apt?.economy?.staff?.find(s => s.src === src) ?? null;

// Ligne « Rôle » de la fiche d'un agent. Un spectateur ne voit que le rôle et l'échelon.
export function agentRoleText(st, spectator = false) {
  if (!st) return null;
  const parts = [st.role ?? `${st.grade?.icon ?? ""} ${st.grade?.title ?? ""}`.trim()];
  if (!spectator && st.providerName) parts.push(`${st.providerName} ${st.tier?.name ?? "non déclaré"}${st.verified ? " ✓" : ""}`);
  if (!spectator && st.rate != null) parts.push(`${money(st.rate)}/h`);
  if (st.echelon) parts.push(`échelon ${st.echelon}/${ECHELONS.length}`);
  if (!spectator && st.morale != null) parts.push(`moral ${st.morale} %`);
  return parts.join(" · ");
}

// Clé du décor 3D : l'étage est reconstruit quand elle change (achat, ou nom et couleur du néon).
export function decorKeyOf(apt) {
  const decor = apt?.economy?.decor;
  if (!decor?.length) return "";
  return [...decor].sort().join(",") + (decor.includes("neon") ? `|${apt.name}|${apt.profile?.accent ?? ""}` : "");
}

export function walletChipHtml(eco, esc, shownWallet = eco?.wallet) {
  if (!eco) return "";
  const t = eco.title ?? {};
  return `<button type="button" class="eco-chip" data-eco-open="bank" aria-label="Portefeuille : ${esc(money(shownWallet))}, ${esc(t.title ?? "")}. Ouvrir la banque">
    <span aria-hidden="true">💰</span><b>${esc(money(shownWallet))}</b><span class="eco-chip-title" aria-hidden="true">· ${esc(t.icon ?? "")} ${esc(t.title ?? "")}</span></button>`;
}

// Événement du jour : icône et nom, le détail au survol ou au focus (infobulle accessible).
export function eventChipHtml(event, esc) {
  if (!event) return "";
  return `<span class="eco-event" tabindex="0" aria-describedby="ecoEventTip"><span aria-hidden="true">${esc(event.icon)}</span><span class="eco-event-name">${esc(event.name)}</span>
    <span class="eco-tip" role="tooltip" id="ecoEventTip"><b>Événement du jour · ${esc(event.name)}</b>${esc(event.desc)}</span></span>`;
}

// Résumé public d'un étage (panneau latéral) : titre, fortune, paie du jour.
export function residentEconomyLine(eco, esc) {
  if (!eco) return "";
  const t = eco.title ?? {};
  return `<p class="eco-line"><span>${esc(t.icon ?? "")} ${esc(t.title ?? "")}</span><span>💰 <b>${esc(money(eco.wallet))}</b></span><span>Paie du jour <b>${esc(money(eco.today?.pay))}</b></span></p>`;
}

export const fortuneLeaders = (apartments, n = 3) => apartments.filter(a => a.economy)
  .sort((x, y) => (y.economy.wallet ?? 0) - (x.economy.wallet ?? 0) || x.name.localeCompare(y.name, "fr")).slice(0, n);

// Primes reçues depuis le dernier état : le serveur ne remet ses célébrations qu'au résident qui agit.
export function freshTipsIn(eco, seen) {
  const tips = (eco?.ledger ?? []).filter(e => e.kind === "tip_in").map(e => ({ ...e, key: `${e.t}|${e.amount}|${e.label}` }));
  const fresh = seen ? tips.filter(e => !seen.has(e.key)) : [];
  const keys = new Set([...(seen ?? []), ...tips.map(e => e.key)]);
  return { fresh, seen: new Set([...keys].slice(-60)) };
}

// ---------- onglets du dialogue ----------
const TABS = [["team", "👥", "Équipe & paie"], ["shop", "🛍️", "Boutique"], ["casino", "🎰", "Casino"], ["sport", "🎾⛳", "Sport"], ["ranks", "🏆", "Classements"], ["bank", "🏦", "Banque"]];
const bar = (value, cls = "") => `<span class="eco-bar ${cls}"><i style="width:${value}%"></i></span>`;

function staffCard(st, c) {
  const { esc, tools } = c, T = toolOf(tools, st.src), provider = PROVIDERS[st.provider];
  const current = st.tier?.id ?? "";
  const sub = provider
    ? `<label class="eco-sub"><span>Abonnement ${esc(provider.name)}</span>
        <select data-sub="${esc(st.provider)}" data-fk="sub:${esc(st.provider)}" ${st.verified ? 'disabled title="Formule lue dans les journaux Codex"' : ""}>
          <option value="">Non déclaré (🎓 Stagiaire)</option>
          ${provider.tiers.map(t => `<option value="${esc(t.id)}" ${t.id === current ? "selected" : ""}>${esc(t.name)} · ${GRADES[t.rank]?.icon ?? ""} ${esc(GRADES[t.rank]?.title ?? "")}</option>`).join("")}
        </select></label>${st.verified ? '<span class="eco-verified" title="Formule confirmée par les journaux Codex">✓ vérifié</span>' : ""}`
    : `<p class="eco-muted">Freelance : pas d'abonnement à déclarer.</p>`;
  const e = Number(st.echelon) || 1, start = ECHELONS[e - 1] ?? 0, end = ECHELONS[e];
  const echelonPct = end == null || st.nextEchelon == null ? 100 : pct(end - start - st.nextEchelon, end - start);
  const morale = Number(st.morale) || 0;
  const flags = [
    st.active ? `<span class="eco-flag live">● au travail${st.active > 1 ? ` (${Number(st.active)})` : ""}</span>` : "",
    st.resting ? '<span class="eco-flag rest">😴 Repos obligatoire : 10 h atteintes</span>'
      : st.overtime ? `<span class="eco-flag over">⏱️ Heures sup (×${nf.format(WORKDAY.overtime)})</span>` : "",
  ].join("");
  return `<article class="eco-card" style="--tool:${esc(T.color)}">
    <header><i class="d" style="background:${esc(T.color)}"></i><b>${esc(T.name)}</b><span class="eco-role">${esc(st.role)}</span></header>
    ${flags ? `<div class="eco-flags">${flags}</div>` : ""}
    <div class="eco-subrow">${sub}</div>
    <div class="eco-rate"><b>${esc(money(st.rate))}/h</b><span>base ${esc(money(st.baseRate))}/h</span></div>
    ${st.factors?.length ? `<ul class="eco-factors">${st.factors.map(f => `<li><span>${esc(f.label)}</span><b class="${f.factor >= 1 ? "up" : "down"}">${factorText(f.factor)}</b></li>`).join("")}</ul>` : ""}
    <div class="eco-metric"><span>Échelon <b>${e}/${ECHELONS.length}</b></span><small>${st.nextEchelon == null ? "échelon maximum" : `suivant dans ${duration(st.nextEchelon)}`}</small>${bar(echelonPct)}</div>
    <div class="eco-metric"><span>Moral <b>${morale} %</b></span>${bar(morale, morale >= 80 ? "ok" : morale >= 60 ? "mid" : "low")}</div>
    <div class="eco-metric"><span>Aujourd'hui <b>${duration(st.todayMinutes)}</b></span><small>payé <b>${esc(money(st.todayPay))}</b></small>
      <span class="eco-bar day"><i style="width:${pct(st.todayMinutes, WORKDAY.max)}%"></i><em style="left:${pct(WORKDAY.normal, WORKDAY.max)}%" title="7 h normales"></em></span></div>
    ${st.model ? `<p class="eco-model">Modèle <code>${esc(st.model)}</code></p>` : ""}
  </article>`;
}

function teamHtml(c) {
  const { eco, esc, tools } = c, today = eco.today ?? {}, staff = eco.staff ?? [];
  const cards = staff.length ? `<div class="eco-staff">${staff.map(st => staffCard(st, c)).join("")}</div>`
    : `<p class="eco-muted">Aucun employé pour l'instant : relie tes agents, chaque outil vu devient un employé payé à l'heure de travail réel.</p>`;
  const rows = staff.map(st => `<tr><td><i class="d" style="background:${esc(toolOf(tools, st.src).color)}"></i>${esc(toolOf(tools, st.src).name)}</td>
    <td>${esc(st.role)}</td><td class="m">${duration(st.todayMinutes)}</td><td class="m">${esc(money(st.rate))}/h</td><td class="m">${esc(money(st.todayPay))}</td></tr>`).join("");
  const salaries = Number(today.pay) || 0, primes = Number(today.primes) || 0;
  const history = [{ date: today.date, pay: salaries + primes, minutes: today.minutes, today: true }, ...(eco.history ?? [])];
  const top = Math.max(1, ...history.map(h => Number(h.pay) || 0));
  return `${cards}
    <h4>Fiche de paie · ${esc(dayName(today.date))}</h4>
    <div class="eco-scroll"><table class="eco-table"><thead><tr><th>Agent</th><th>Rôle</th><th>Heures</th><th>Taux actuel</th><th>Payé</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Personne n\'a encore travaillé aujourd\'hui.</td></tr>'}</tbody>
      <tfoot><tr><th colspan="4">Salaires</th><td class="m">${esc(money(salaries))}</td></tr>
        <tr><th colspan="4">Primes · ${Number(today.deliveries) || 0} livraison(s), ${Number(today.reactivity) || 0} réactivité</th><td class="m">${esc(money(primes))}</td></tr>
        <tr class="total"><th colspan="4">Total du jour</th><td class="m">${esc(money(salaries + primes))}</td></tr></tfoot></table></div>
    <p class="eco-muted">Casino aujourd'hui : ${esc(signedMoney(today.casinoNet))} · primes envoyées : ${esc(money(today.tipsSent))} · journée de ${duration(WORKDAY.normal)}, heures sup jusqu'à ${duration(WORKDAY.max)}.</p>
    <h4>7 derniers jours</h4>
    <ol class="eco-history">${history.map(h => `<li class="${h.today ? "today" : ""}"><span>${h.today ? "Aujourd'hui" : esc(dayName(h.date))}</span>
      <span class="eco-bar"><i style="width:${pct(Number(h.pay) || 0, top)}%"></i></span><b>${esc(money(h.pay))}</b><small>${duration(h.minutes)}</small></li>`).join("")}</ol>`;
}

const priceOf = (item, eco) => Math.round(item.price * (Number(eco.shopFactor) || 1));
function shopItem(item, c) {
  const { eco, esc, tools, now } = c, price = priceOf(item, eco);
  const owned = item.kind === "decor" && eco.decor?.includes(item.id);
  const until = item.hours ? Number(eco.perks?.[item.id]) || 0 : 0, active = until > now;
  const insured = item.id === "assurance" && !!eco.perks?.assurance;
  const poor = (Number(eco.wallet) || 0) < price;
  const staff = (eco.staff ?? []).filter(s => s.provider);
  let action;
  if (owned) action = '<span class="eco-owned">✓ Dans ton bureau</span>';
  else if (insured) action = '<span class="eco-owned">🛡️ Active jusqu\'à ta prochaine perte</span>';
  else if (item.target && !staff.length) action = '<span class="eco-muted">Aucun agent à former pour l\'instant.</span>';
  else action = `${item.target ? `<label class="eco-target"><span>Agent</span><select name="formationTarget" data-keep data-fk="target">${staff.map(s =>
      `<option value="${esc(s.src)}" ${c.form.formationTarget === s.src ? "selected" : ""}>${esc(toolOf(tools, s.src).name)} · échelon ${Number(s.echelon) || 1}</option>`).join("")}</select></label>` : ""}
    <button type="button" class="eco-buy" data-buy="${esc(item.id)}" data-fk="buy:${esc(item.id)}" ${poor ? `disabled title="Solde insuffisant"` : ""}>${active ? "Prolonger" : "Acheter"}</button>`;
  const priceTag = price !== item.price ? `<s>${esc(money(item.price))}</s> <b>${esc(money(price))}</b>` : `<b>${esc(money(price))}</b>`;
  return `<article class="eco-item ${owned ? "owned" : ""}"><span class="eco-item-icon" aria-hidden="true">${esc(item.icon)}</span>
    <div><h5>${esc(item.name)}</h5><p>${esc(item.desc)}</p>${active ? `<p class="eco-active">Actif · encore ${duration((until - now) / 60)}</p>` : ""}</div>
    <footer><span class="eco-price">${priceTag}</span>${action}</footer></article>`;
}

function shopHtml(c) {
  const { eco, now } = c, perks = eco.perks ?? {};
  const actives = SHOP.filter(i => i.hours && (Number(perks[i.id]) || 0) > now)
    .map(i => `<li>${i.icon} ${i.name} · encore <b>${duration((perks[i.id] - now) / 60)}</b></li>`);
  if (perks.assurance) actives.push("<li>🛡️ Assurance casino · jusqu'à ta prochaine perte</li>");
  const sale = (Number(eco.shopFactor) || 1) < 1 ? `<p class="eco-banner">🛍️ Soldes du jour : −${Math.round((1 - eco.shopFactor) * 100)} % sur toute la boutique.</p>` : "";
  return `${sale}<p class="eco-muted">Solde : <b>${money(eco.wallet)}</b>. Le décor est permanent et visible dans ton bureau 3D ; les avantages sont temporaires.</p>
    ${actives.length ? `<div class="eco-actives"><h4>Avantages actifs</h4><ul>${actives.join("")}</ul></div>` : ""}
    <h4>Avantages</h4><div class="eco-shop">${SHOP.filter(i => i.kind === "perk").map(i => shopItem(i, c)).join("")}</div>
    <h4>Décor du bureau</h4><div class="eco-shop">${SHOP.filter(i => i.kind === "decor").map(i => shopItem(i, c)).join("")}</div>`;
}

// ---------- casino et sport : rendu ----------
// Roue européenne : ordre réel des cases, de 0 en haut, dans le sens des aiguilles d'une montre.
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const SEG = 360 / WHEEL.length;
const pocketColor = n => n === 0 ? "vert" : CASINO.roulette.red.includes(n) ? "rouge" : "noir";
const WHEEL_BG = `conic-gradient(${WHEEL.map((n, i) => `${{ vert: "#1f8f4e", rouge: "#b3243a", noir: "#15161c" }[pocketColor(n)]} ${(i * SEG).toFixed(3)}deg ${((i + 1) * SEG).toFixed(3)}deg`).join(",")})`;
const RANK = r => r === 0 ? "1er" : `${r + 1}e`;

const BJ = CASINO.blackjack ?? { payout: 2, natural: 2.5, dealerStands: 17 };
const STYLES = CASINO.tennis?.styles ?? [], SHOTS = CASINO.golf?.shots ?? [];
const idOf = v => (v && typeof v === "object" ? v.id : v);
const defaultOf = list => (list[1] ?? list[0])?.id ?? "";
const winCls = net => net > 0 ? "win" : net < 0 ? "loss" : "";
const secs = t => (Number(t) > 1e12 ? Number(t) / 1000 : Number(t));
const betOf = form => Math.floor(Number(form.bet ?? 50)) || 0;
const gainText = (form, payout) => money(Math.floor(betOf(form) * payout));

// ---------- blackjack : cartes dessinées en HTML et CSS ----------
const CARD_RANKS = { A: "As", K: "Roi", Q: "Dame", J: "Valet" };
const CARD_SUITS = { "♠": "pique", "♥": "cœur", "♦": "carreau", "♣": "trèfle" };
function parseCard(card) {
  const m = /^(10|[2-9AKQJ])(.+)$/u.exec(String(card ?? ""));
  if (!m) return null;
  const suit = [...m[2]].find(ch => CARD_SUITS[ch]) ?? m[2];
  return { rank: m[1], suit, red: suit === "♥" || suit === "♦" };
}
// Total d'une main, l'as compte 11 ou 1 ; la carte cachée (« ?? ») ne compte pas.
function handTotal(cards) {
  let total = 0, aces = 0;
  for (const card of cards ?? []) {
    const p = parseCard(card);
    if (!p) continue;
    if (p.rank === "A") { aces++; total += 11; } else total += "KQJ".includes(p.rank) ? 10 : Number(p.rank);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}
const cardName = card => { const p = card === "??" ? null : parseCard(card); return p ? `${CARD_RANKS[p.rank] ?? p.rank} de ${CARD_SUITS[p.suit] ?? p.suit}` : "carte cachée"; };
const totalText = (cards, server) => !cards?.length ? "–" : cards.includes("??") ? `${handTotal(cards)} + ?` : String(server ?? handTotal(cards));
const handLabel = (who, cards) => !cards.length ? `${who} : pas encore de cartes.`
  : `${who} : ${cards.map(cardName).join(", ")}. ${cards.includes("??") ? "Total visible" : "Total"} ${handTotal(cards)}.`;
function cardHtml(card, esc, cls = "") {
  const p = card === "??" ? null : parseCard(card);
  if (!p) return `<span class="bj-card back ${cls}"></span>`;
  const corner = `${esc(p.rank)}<br>${esc(p.suit)}`;
  return `<span class="bj-card${p.red ? " red" : ""} ${cls}"><i>${corner}</i><b>${esc(p.suit)}</b><i class="br">${corner}</i></span>`;
}
// Main en cours (economy.blackjack) : la reprendre après un rechargement.
const liveHand = eco => (eco?.blackjack && (eco.blackjack.status ?? "playing") === "playing" ? eco.blackjack : null);
const BJ_STAMP = { win: ["Gagné", "win"], blackjack: ["Blackjack !", "bj"], push: ["Égalité", "push"], lose: ["Perdu", "loss"], bust: ["Sauté !", "loss"] };

function blackjackText(r) {
  const h = r.hand ?? {}, p = Number(h.playerTotal ?? handTotal(h.player)), d = Number(h.dealerTotal ?? handTotal(h.dealer));
  const gain = signedMoney(r.net);
  switch (h.status) {
    case "playing": return `Toi ${handTotal(h.player)}, la banque montre ${handTotal(h.dealer)}. ${h.player?.length === 2 ? "Tirer, rester ou doubler ?" : "Tirer ou rester ?"}`;
    case "blackjack": return `Blackjack ! Gagné : ${gain}`;
    case "win": return d > 21 ? `La banque saute à ${d} : gagné ! ${gain}` : `${p} contre ${d} : gagné ! ${gain}`;
    case "push": return `Égalité à ${p} : mise remboursée.`;
    case "bust": return `${p} : tu dépasses 21. Perdu : ${gain}`;
    case "lose": return d === 21 && h.dealer?.length === 2 ? `Blackjack de la banque. Perdu : ${gain}` : `${d} contre ${p} : la banque gagne. Perdu : ${gain}`;
    default: return gain;
  }
}

function outcomeText(game, r, tools) {
  const gain = r.net > 0 ? `Gagné ! ${signedMoney(r.net)}` : r.net === 0 ? "Mise récupérée." : `Perdu : ${signedMoney(r.net)}`;
  switch (game) {
    case "slots": return `${(r.reels ?? []).join(" ")} — ${gain}${r.progressive ? ` · 🎉 JACKPOT COMMUN : +${money(r.progressive)} !` : ""}`;
    case "roulette": return `La bille s'arrête sur ${r.number} ${r.color}. ${gain}`;
    case "race": return `${toolOf(tools, r.winner).name} gagne la course. ${gain}`;
    case "blackjack": return blackjackText(r);
    case "tennis": { const [a, b] = r.score ?? [0, 0]; return `Set ${a}–${b} : ${r.won ? "tu bats le pro du club !" : "le pro du club l'emporte."} ${gain}`; }
    case "golf": return r.holed ? `Dans le trou ! ${gain}` : `Raté, ${r.miss ?? "à côté"}. ${gain}`;
    default: return gain;
  }
}
const outcomeHtml = (game, c) => {
  const r = c.last[game];
  return r ? `<p class="eco-outcome ${winCls(r.net)}">${c.esc(outcomeText(game, r, c.tools))}</p>` : "";
};

function casinoClosed(eco) {
  const cas = eco.casino ?? {};
  return (Number(cas.playsLeft) || 0) <= 0 || (Number(cas.lossLeft) || 0) < CASINO.minBet || (Number(eco.wallet) || 0) < CASINO.minBet;
}
// Barre de mise partagée par le casino et le sport : même mise, mêmes limites du jour.
function betBarHtml(c, closedText) {
  const { eco, esc, form } = c, cas = eco.casino ?? {}, rec = eco.records ?? {};
  return `<div class="eco-betbar">
      <label><span>Ta mise</span><input type="number" name="bet" data-keep data-fk="bet" inputmode="numeric" min="${CASINO.minBet}" max="${CASINO.maxBet}" step="1" value="${esc(form.bet ?? 50)}"></label>
      <div class="eco-chips" role="group" aria-label="Mises rapides">${[10, 50, 100, 250, 500].filter(v => v >= CASINO.minBet && v <= CASINO.maxBet).map(v => `<button type="button" data-bet="${v}" aria-label="Miser ${v} ${CURRENCY}">${v}</button>`).join("")}</div>
      <p class="eco-limits">Solde <b>${esc(money(eco.wallet))}</b> · ${Number(cas.playsLeft) || 0} partie(s) restante(s) · pertes encore possibles <b>${esc(money(cas.lossLeft))}</b>
        · record <b>${esc(money(rec.biggestWin))}</b> · jackpots <b>${Number(rec.jackpots) || 0}</b>${eco.perks?.assurance ? " · 🛡️ assuré·e" : ""}</p>
      ${casinoClosed(eco) ? `<p class="eco-banner warn">${closedText}</p>` : ""}
    </div>`;
}

// Jackpot commun (data.casino) : le montant est écrit à part (syncJackpot) pour compter jusqu'à sa nouvelle valeur sans tout redessiner.
function jackpotHtml(c) {
  const { esc, pot } = c;
  if (pot?.jackpot == null) return "";
  const w = pot.lastWinner, share = nf.format(Math.round((CASINO.jackpot?.share ?? 0) * 1000) / 10);
  return `<section class="eco-jackpot" aria-labelledby="ecoJackpotTitle">
    <span class="eco-jp-icon" aria-hidden="true">💰</span>
    <div class="eco-jp-main"><h4 id="ecoJackpotTitle">Jackpot commun</h4><b class="eco-jp-amount" data-jackpot></b></div>
    <p class="eco-jp-info">Le 7️⃣7️⃣7️⃣ à la machine à sous le remporte, en plus de son gain. ${share} % de chaque mise l'alimentent, offerts par la maison.
      <span class="eco-jp-last">${w ? `Dernier gagnant : <b>${esc(w.name)}</b> · ${esc(money(w.amount))} · ${esc(when(secs(w.at)))}` : "Personne ne l'a encore remporté."}</span></p>
  </section>`;
}

function blackjackHtml(c, playAttr) {
  const { eco, esc, last } = c, live = liveHand(eco), done = live ? null : last.blackjack;
  const hand = live ?? done?.hand ?? null, player = hand?.player ?? [], dealer = hand?.dealer ?? [];
  const stamp = done && hand ? BJ_STAMP[hand.status] : null;
  const row = (side, who, cards, total) => `<div class="eco-bj-row ${side}"><span class="eco-bj-label">${who} <b data-total="${side}">${esc(totalText(cards, total))}</b></span>
      <div class="eco-bj-hand" data-hand="${side}" role="img" aria-label="${esc(handLabel(who, cards))}">${cards.map(k => cardHtml(k, esc)).join("")}</div></div>`;
  let actions;
  if (live) {
    const rich = (Number(eco.wallet) || 0) >= (Number(live.bet) || 0);
    actions = `<div class="eco-bj-actions" role="group" aria-label="Ton coup">
        <button type="button" class="eco-play" data-bj="hit" data-fk="bj:hit">Tirer</button>
        <button type="button" class="eco-play alt" data-bj="stand" data-fk="bj:stand">Rester</button>
        ${player.length === 2 ? `<button type="button" class="eco-play alt wide" data-bj="double" data-fk="bj:double" ${rich ? "" : "disabled"}>Doubler · +${esc(money(live.bet))}</button>
          ${rich ? "" : '<small class="eco-bj-note">Solde insuffisant pour doubler.</small>'}` : ""}
      </div>`;
  } else actions = `<button type="button" class="eco-play" data-bj="deal" data-fk="bj:deal" ${playAttr}>Distribuer</button>`;
  const text = live ? blackjackText({ hand: live, net: 0 }) : done ? outcomeText("blackjack", done) : `Choisis ta mise, puis « Distribuer ». La banque tire jusqu'à ${BJ.dealerStands}.`;
  return `<section class="eco-game eco-bj" aria-labelledby="ecoBjTitle"><h4 id="ecoBjTitle">🃏 Blackjack</h4>
    <div class="eco-bj-body">
      <div class="eco-felt">
        <span class="eco-shoe" aria-hidden="true"></span>
        ${row("dealer", "Banque", dealer, hand?.dealerTotal)}
        ${stamp ? `<span class="eco-bj-stamp ${stamp[1]}" aria-hidden="true">${stamp[0]}</span>`
          : `<span class="eco-felt-arc" aria-hidden="true">Blackjack paie × ${nf.format(BJ.natural)} · la banque tire jusqu'à ${BJ.dealerStands}</span>`}
        ${row("player", "Toi", player, hand?.playerTotal)}
      </div>
      <div class="eco-bj-side">
        <p class="eco-paytable">Gagné <b>× ${nf.format(BJ.payout)}</b> · blackjack <b>× ${nf.format(BJ.natural)}</b> · égalité remboursée.</p>
        ${hand ? `<p class="eco-bj-bet">${live ? "Mise en jeu" : "Mise"} <b>${esc(money(hand.bet))}</b></p>` : ""}
        ${actions}
        <p class="eco-outcome ${live ? "" : done ? winCls(done.net) : ""}">${esc(text)}</p>
      </div>
    </div></section>`;
}

function slotsHtml(c, playAttr) {
  const { esc, last } = c, reels = last.slots?.reels ?? ["🍒", "⭐", "7️⃣"];
  return `<section class="eco-game" aria-labelledby="ecoSlotsTitle"><h4 id="ecoSlotsTitle">🎰 Machine à sous</h4>
      <div class="eco-reels" aria-hidden="true">${reels.map(s => `<span class="eco-reel">${esc(s)}</span>`).join("")}</div>
      <p class="eco-paytable">${CASINO.slots.symbols.map(s => `${esc(s.s)}×3 <b>×${s.pay3}</b>`).join(" · ")} · paire <b>×${nf.format(CASINO.slots.pair)}</b>${c.pot?.jackpot != null ? " · 7️⃣7️⃣7️⃣ <b>+ jackpot commun</b>" : ""}</p>
      <button type="button" class="eco-play" data-play="slots" data-fk="play:slots" ${playAttr}>Tirer le levier</button>${outcomeHtml("slots", c)}</section>`;
}

function rouletteHtml(c, playAttr) {
  const { esc, form, last } = c, r = last.roulette, choice = form.rouletteChoice ?? "rouge";
  return `<section class="eco-game" aria-labelledby="ecoRouletteTitle"><h4 id="ecoRouletteTitle">🎡 Roulette</h4>
      <div class="eco-wheel-wrap" aria-hidden="true"><div class="eco-wheel" style="background:${WHEEL_BG};transform:rotate(${Number(c.rot) || 0}deg)"></div><span class="eco-pointer"></span>
        <span class="eco-ball ${r ? esc(r.color) : ""}">${r ? esc(r.number) : "?"}</span></div>
      <label class="eco-choice"><span>Tu mises sur</span><select name="rouletteChoice" data-keep data-fk="rouletteChoice">
        <optgroup label="Chances simples (× ${CASINO.roulette.even})">${["rouge", "noir", "pair", "impair"].map(v => `<option value="${v}" ${choice === v ? "selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</optgroup>
        <optgroup label="Numéro plein (× ${CASINO.roulette.number})">${[...Array(37).keys()].map(n => `<option value="${n}" ${choice === String(n) ? "selected" : ""}>${n} · ${pocketColor(n)}</option>`).join("")}</optgroup>
      </select></label>
      <button type="button" class="eco-play" data-play="roulette" data-fk="play:roulette" ${playAttr}>Lancer la bille</button>${outcomeHtml("roulette", c)}</section>`;
}

function raceHtml(c, playAttr) {
  const { esc, tools, form, last } = c, choice = form.raceChoice ?? CASINO.race.runners[0];
  const rankOf = new Map((last.race?.order ?? []).map((k, i) => [k, i]));
  return `<section class="eco-game" aria-labelledby="ecoRaceTitle"><h4 id="ecoRaceTitle">🏁 Course de robots</h4>
      <div class="eco-track" aria-hidden="true">${CASINO.race.runners.map(k => {
        const T = toolOf(tools, k), rank = rankOf.get(k);
        return `<div class="eco-lane"><span class="eco-lane-name">${esc(T.name)}</span><span class="eco-lane-track"><span class="eco-runner" data-runner="${esc(k)}" style="--c:${esc(T.color)};--p:${rank == null ? 0 : (1 - rank * 0.08).toFixed(2)}">🤖</span></span><span class="eco-lane-rank">${rank == null ? "" : RANK(rank)}</span></div>`;
      }).join("")}</div>
      <label class="eco-choice"><span>Ton robot (× ${nf.format(CASINO.race.payout)})</span><select name="raceChoice" data-keep data-fk="raceChoice">${CASINO.race.runners.map(k => `<option value="${esc(k)}" ${choice === k ? "selected" : ""}>${esc(toolOf(tools, k).name)}</option>`).join("")}</select></label>
      <button type="button" class="eco-play" data-play="race" data-fk="play:race" ${playAttr}>Départ !</button>${outcomeHtml("race", c)}</section>`;
}

function casinoHtml(c) {
  const { eco } = c, playAttr = casinoClosed(eco) ? "disabled" : "";
  return `${jackpotHtml(c)}
    ${eco.event?.id === "jackpot" ? '<p class="eco-banner">🎰 Jackpot progressif aujourd\'hui : 7️⃣7️⃣7️⃣ paie × 100 à la machine à sous.</p>' : ""}
    ${betBarHtml(c, "Le casino est fermé pour toi aujourd'hui (limite atteinte ou solde trop bas).")}
    <div class="eco-games">${blackjackHtml(c, playAttr)}${slotsHtml(c, playAttr)}${rouletteHtml(c, playAttr)}${raceHtml(c, playAttr)}</div>
    <p class="eco-muted">Mise de ${CASINO.minBet} à ${CASINO.maxBet} ${CURRENCY}. Le tirage est fait par le serveur. ${CURRENCY} : monnaie de jeu, sans valeur réelle.</p>`;
}

// ---------- sport : tennis et golf ----------
// Choix du style ou du putt : de vrais boutons radio (flèches du clavier), chance et gain affichés.
function optionsHtml(name, list, chosen, c, legend) {
  const { esc, form } = c;
  return `<fieldset class="eco-options"><legend>${legend}</legend>${list.map(o => `<label class="eco-opt">
      <input type="radio" name="${name}" value="${esc(o.id)}" data-keep data-fk="${name}:${esc(o.id)}"${o.id === chosen ? " checked" : ""}>
      <span class="eco-opt-card"><span class="ico" aria-hidden="true">${esc(o.icon)}</span><b>${esc(o.name)}</b><span class="pay">× ${esc(nf.format(o.payout))}</span>
        <small>${Math.round(o.chance * 100)} % de chances · rapporte <span data-gain="${Number(o.payout)}">${esc(gainText(form, o.payout))}</span></small>
        <span class="eco-bar" aria-hidden="true"><i style="width:${Math.round(o.chance * 100)}%"></i></span></span></label>`).join("")}</fieldset>`;
}

function tennisHtml(c, playAttr) {
  const { form, last } = c, r = last.tennis, choice = form.tennisStyle ?? defaultOf(STYLES);
  const games = Array.isArray(r?.games) ? r.games : [], score = r?.score ?? [0, 0];
  const row = (who, name, n) => `<div class="eco-score-row ${who}${r && (r.won ? who === "toi" : who === "pro") ? " won" : ""}" data-who="${who}">
      <span class="eco-score-name">${name}</span><span class="eco-score-strip">${games.map(g => `<i${g === who ? ' class="on"' : ""}></i>`).join("")}</span><b data-games>${Number(n) || 0}</b></div>`;
  return `<section class="eco-game eco-sport-game" aria-labelledby="ecoTennisTitle"><h4 id="ecoTennisTitle">🎾 Tennis · un set contre le pro</h4>
      <div class="eco-court" aria-hidden="true"><span class="eco-court-lines"></span><span class="eco-net"></span>
        <span class="eco-tp me"></span><span class="eco-tp pro"></span><span class="eco-tball"></span></div>
      <div class="eco-score" aria-hidden="true">${row("toi", "Toi", score[0])}${row("pro", "Pro du club", score[1])}</div>
      ${optionsHtml("tennisStyle", STYLES, choice, c, "Ton style de jeu")}
      <button type="button" class="eco-play" data-play="tennis" data-fk="play:tennis" ${playAttr}>Jouer le set</button>${outcomeHtml("tennis", c)}</section>`;
}

// Green vu de dessus : le trou à droite, la balle part de 1 m, 4 m ou 12 m (positions en % du green).
const HOLE = { x: 84, y: 50 };
const golfStart = id => [72, 48, 12][SHOTS.findIndex(s => s.id === idOf(id))] ?? 40;
const distanceOf = shot => /(\d+)\s*m\b/.exec(shot.name)?.[0] ?? shot.icon;
function golfEnd(x0, r) {
  if (r.holed) return { ...HOLE };
  switch (r.miss) {
    case "trop court": return { x: x0 + (HOLE.x - x0) * 0.7, y: 53 };
    case "trop long": return { x: 94, y: 46 };
    case "à gauche": return { x: 87, y: 31 };
    case "à droite": return { x: 87, y: 69 };
    default: return { x: 90, y: 60 };
  }
}
function greenHtml(choice, r, esc) {
  const x0 = golfStart(choice), same = !!r && idOf(r.shot) === choice;
  const at = same ? golfEnd(x0, r) : { x: x0, y: 50 };
  const tag = same && !r.holed && r.miss ? `<span class="eco-gtag${at.x > 80 ? " end" : ""}" style="left:${at.x}%;top:${at.y}%">${esc(r.miss)}</span>` : "";
  return `<div class="eco-green-wrap${same && r.holed ? " holed" : ""}" aria-hidden="true"><span class="eco-green"></span>
      ${SHOTS.map(s => `<span class="eco-gmark${s.id === choice ? " on" : ""}" style="left:${golfStart(s.id)}%"><span>${esc(distanceOf(s))}</span></span>`).join("")}
      <span class="eco-aim" style="left:${x0}%;width:${HOLE.x - x0}%"></span><span class="eco-hole"></span><span class="eco-pin"></span>
      <span class="eco-gball${same && r.holed ? " in" : ""}" style="left:${at.x}%;top:${at.y}%"></span>${tag}</div>`;
}

function golfHtml(c, playAttr) {
  const { esc, form, last } = c, choice = form.golfShot ?? defaultOf(SHOTS);
  return `<section class="eco-game eco-sport-game" aria-labelledby="ecoGolfTitle"><h4 id="ecoGolfTitle">⛳ Golf · un putt</h4>
      ${greenHtml(choice, last.golf, esc)}
      ${optionsHtml("golfShot", SHOTS, choice, c, "Ton putt")}
      <button type="button" class="eco-play" data-play="golf" data-fk="play:golf" ${playAttr}>Putter</button>${outcomeHtml("golf", c)}</section>`;
}

function sportHtml(c) {
  const playAttr = casinoClosed(c.eco) ? "disabled" : "";
  return `<p class="eco-banner eco-sport-hint"><span aria-hidden="true">🎾⛳</span> Les activités <b>gratuites</b> qui rapportent de l'XP se jouent aux étages <b>Tennis</b> et <b>Golf</b> de la tour.
      Ici, tu mises des ${CURRENCY} contre le pro du club.</p>
    ${betBarHtml(c, "Les paris sont fermés pour toi aujourd'hui (limite du casino atteinte ou solde trop bas).")}
    <div class="eco-games eco-sports">${tennisHtml(c, playAttr)}${golfHtml(c, playAttr)}</div>
    <p class="eco-muted">Mêmes mises et mêmes limites du jour qu'au casino. Le résultat est tiré par le serveur. ${CURRENCY} : monnaie de jeu, sans valeur réelle.</p>`;
}

function ranksHtml(c) {
  const { esc, apartments, me } = c, list = apartments.filter(a => a.economy);
  const boards = [
    ["💰 Fortune", a => Number(a.economy.wallet) || 0, money],
    ["💶 Paie du jour", a => Number(a.economy.today?.pay) || 0, money],
    ["⏱️ Heures du jour", a => Number(a.economy.today?.minutes) || 0, duration],
    ["🏆 Plus gros gain au casino", a => Number(a.economy.records?.biggestWin) || 0, money],
  ];
  return `<div class="eco-ranks">${boards.map(([title, value, fmt]) => {
    const rows = [...list].sort((x, y) => value(y) - value(x) || x.name.localeCompare(y.name, "fr"));
    return `<section class="eco-rank"><h4>${title}</h4><ol>${rows.map(a => `<li class="${a.slug === me ? "me" : ""}"><span>${esc(a.economy.title?.icon ?? "")} ${esc(a.name)}${a.slug === me ? " <small>(toi)</small>" : ""}</span><b>${esc(fmt(value(a)))}</b></li>`).join("")
      || "<li>Personne pour l'instant.</li>"}</ol></section>`;
  }).join("")}</div>`;
}

const LEDGER_ICON = { salary: "💼", prime: "⭐", buy: "🛍️", casino: "🎰", tip_in: "💌", tip_out: "📤", promo: "🎖️", quest: "🎯", refund: "🛡️" };
function bankHtml(c) {
  const { eco, esc, apartments, me, form } = c, t = eco.title ?? {}, next = t.next;
  const progress = next ? pct((Number(eco.earned) || 0) - (t.min ?? 0), next.min - (t.min ?? 0)) : 100;
  const others = apartments.filter(a => a.slug !== me);
  const tipsLeft = Math.max(0, Number(eco.today?.tipsLeft ?? TIPS.dailyMax) || 0);
  const maxTip = Math.max(0, Math.min(tipsLeft, Math.floor(Number(eco.wallet) || 0)));
  const ledger = (eco.ledger ?? []).map(e => `<tr><td class="m">${esc(when(e.t))}</td><td><span aria-hidden="true">${LEDGER_ICON[e.kind] ?? "•"}</span> ${esc(e.label)}</td>
    <td class="m ${e.amount >= 0 ? "up" : "down"}">${esc(signedMoney(e.amount))}</td></tr>`).join("");
  return `<div class="eco-bankhead">
      <div class="eco-balance"><span>Solde</span><b>${esc(money(eco.wallet))}</b><small>Gagné au total (salaires, primes, missions) : ${esc(money(eco.earned))}</small></div>
      <div class="eco-titlecard"><span class="eco-title-icon" aria-hidden="true">${esc(t.icon ?? "")}</span><div><b>${esc(t.title ?? "")}</b>
        <small>${next ? `Encore ${esc(money(next.min - (Number(eco.earned) || 0)))} gagnés pour devenir ${esc(next.icon)} ${esc(next.title)}` : "Titre maximum atteint."}</small>${bar(progress)}</div></div>
    </div>
    <h4>Relevé</h4>
    <div class="eco-scroll"><table class="eco-table"><thead><tr><th>Quand</th><th>Opération</th><th>Montant</th></tr></thead>
      <tbody>${ledger || '<tr><td colspan="3">Aucune opération pour l\'instant.</td></tr>'}</tbody></table></div>
    <h4>Envoyer une prime à un collègue</h4>
    ${others.length ? `<form class="eco-tipform" novalidate>
      <label><span>À</span><select name="to" data-keep data-fk="tipTo" required>${others.map(a => `<option value="${esc(a.slug)}" ${form.to === a.slug ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label><span>Montant</span><input type="number" name="amount" data-keep inputmode="numeric" min="${TIPS.min}" max="${maxTip}" step="1" required value="${esc(form.amount ?? "")}" placeholder="${TIPS.min}"></label>
      <label class="wide"><span>Message (facultatif)</span><input name="message" data-keep maxlength="${TIPS.message}" value="${esc(form.message ?? "")}" placeholder="Merci pour le coup de main !"></label>
      <button type="submit" data-fk="tipSend" ${maxTip < TIPS.min ? "disabled" : ""}>Envoyer la prime</button>
      <p class="eco-muted wide">Encore <b>${esc(money(tipsLeft))}</b> à offrir aujourd'hui (plafond ${esc(money(TIPS.dailyMax))}, minimum ${esc(money(TIPS.min))}).</p>
    </form>` : '<p class="eco-muted">Aucun autre résident à remercier pour l\'instant.</p>'}`;
}

const RENDER = { team: teamHtml, shop: shopHtml, casino: casinoHtml, sport: sportHtml, ranks: ranksHtml, bank: bankHtml };

// ---------- animations du casino et du sport (purement visuelles) ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
const NOOP = { async stop() {}, cancel() {} };
const toEl = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

function spinSlots(panel, reduced) {
  const reels = [...panel.querySelectorAll(".eco-reel")];
  if (reduced || !reels.length) return NOOP;
  const symbols = CASINO.slots.symbols.map(s => s.s), spinning = reels.map(() => true);
  reels.forEach(el => { el.classList.remove("stop"); el.classList.add("spin"); });
  const timer = setInterval(() => reels.forEach((el, i) => { if (spinning[i]) el.textContent = symbols[Math.floor(Math.random() * symbols.length)]; }), 70);
  return {
    async stop(r) {
      for (let i = 0; i < reels.length; i++) {
        if (i) await wait(320);
        spinning[i] = false;
        reels[i].textContent = r.reels[i];
        reels[i].classList.replace("spin", "stop");
      }
      clearInterval(timer);
      await wait(260);
    },
    cancel() { clearInterval(timer); reels.forEach(el => el.classList.remove("spin")); },
  };
}

// La roue tourne à vitesse constante pendant l'attente, puis décélère régulièrement jusqu'à la vraie case.
function spinRoulette(panel, reduced, start) {
  const wheel = panel.querySelector(".eco-wheel"), ball = panel.querySelector(".eco-ball");
  if (reduced || !wheel) return { async stop(r) { return (((-(WHEEL.indexOf(r.number) + 0.5) * SEG) % 360) + 360) % 360; }, cancel() {} };
  const v = 520;
  let angle = Number(start) || 0, last = performance.now(), plan = null, raf = 0, done;
  const finished = new Promise(r => { done = r; });
  ball.textContent = "…"; ball.className = "eco-ball";
  const tick = now => {
    if (!plan) angle += v * Math.min(0.05, (now - last) / 1000);
    else {
      const t = Math.min(plan.T, (now - plan.at) / 1000);
      angle = plan.from + v * t - (v * v / (2 * plan.D)) * t * t;
      if (t >= plan.T) { wheel.style.transform = `rotate(${plan.from + plan.D}deg)`; done(); return; }
    }
    last = now;
    wheel.style.transform = `rotate(${angle}deg)`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    async stop(r) {
      const goal = (((-(WHEEL.indexOf(r.number) + 0.5) * SEG) % 360) + 360) % 360, current = ((angle % 360) + 360) % 360;
      const D = 420 + ((goal - current + 360) % 360);
      plan = { at: performance.now(), from: angle, D, T: (2 * D) / v };
      await finished;
      ball.textContent = r.number; ball.className = `eco-ball ${r.color}`;
      await wait(200);
      return goal;
    },
    cancel() { cancelAnimationFrame(raf); },
  };
}

// Course : les robots avancent par à-coups pendant l'attente, puis finissent dans l'ordre tiré par le serveur.
function runRace(panel, reduced) {
  const els = new Map([...panel.querySelectorAll("[data-runner]")].map(el => [el.dataset.runner, el]));
  panel.querySelectorAll(".eco-lane-rank").forEach(el => { el.textContent = ""; });
  if (reduced || !els.size) return NOOP;
  const pos = new Map([...els.keys()].map(k => [k, 0]));
  els.forEach(el => el.style.setProperty("--p", "0"));
  let plan = null, raf = 0, last = performance.now(), done;
  const finished = new Promise(r => { done = r; });
  const tick = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let arrived = true;
    for (const [k, el] of els) {
      let p = pos.get(k);
      if (!plan) p = Math.min(0.42, p + dt * (0.04 + Math.random() * 0.14));
      else {
        const f = plan.get(k), t = Math.min(1, (now - f.at) / (f.T * 1000));
        p = f.from + (f.to - f.from) * (1 - (1 - t) ** 2);
        if (t < 1) arrived = false;
      }
      pos.set(k, p);
      el.style.setProperty("--p", p.toFixed(4));
    }
    if (plan && arrived) { done(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    async stop(r) {
      const at = performance.now();
      plan = new Map(r.order.map((k, rank) => [k, { at, from: pos.get(k) ?? 0, to: 1 - rank * 0.08, T: 1.1 + rank * 0.22 }]));
      await finished;
      await wait(150);
    },
    cancel() { cancelAnimationFrame(raf); },
  };
}

// Tennis : un échange de fond de court pendant l'attente, puis le tableau se remplit jeu par jeu (result.games).
function playSet(panel, reduced) {
  const court = panel.querySelector(".eco-court"), rows = [...panel.querySelectorAll(".eco-score-row")];
  if (!court || !rows.length) return NOOP;
  const ball = court.querySelector(".eco-tball");
  rows.forEach(row => { row.classList.remove("won", "hit"); row.querySelector(".eco-score-strip").replaceChildren(); row.querySelector("[data-games]").textContent = "0"; });
  if (reduced) return NOOP;
  court.classList.add("rally");
  return {
    async stop(r) {
      court.classList.remove("rally");
      const games = Array.isArray(r.games) ? r.games : [], per = Math.max(150, Math.min(300, 2600 / Math.max(1, games.length)));
      const count = { toi: 0, pro: 0 };
      for (const g of games) {
        count[g] = (count[g] ?? 0) + 1;
        for (const row of rows) {
          const mine = row.dataset.who === g, cell = document.createElement("i");
          if (mine) cell.className = "on";
          row.querySelector(".eco-score-strip").append(cell);
          if (!mine) continue;
          row.querySelector("[data-games]").textContent = count[g];
          row.classList.remove("hit"); void row.offsetWidth; row.classList.add("hit");
        }
        // Le point gagnant tombe dans le camp de celui qui perd le jeu.
        if (ball) { ball.style.left = g === "toi" ? "80%" : "20%"; ball.style.top = `${28 + Math.random() * 44}%`; }
        await wait(per);
      }
      rows.find(row => row.dataset.who === (r.won ? "toi" : "pro"))?.classList.add("won");
      await wait(350);
    },
    cancel() { court.classList.remove("rally"); },
  };
}

// Golf : ligne de visée pendant l'attente, puis la balle roule vers le trou et s'arrête où le serveur l'a décidé.
function rollPutt(panel, reduced, choice) {
  const wrap = panel.querySelector(".eco-green-wrap"), ball = wrap?.querySelector(".eco-gball");
  if (!ball) return NOOP;
  const x0 = golfStart(choice);
  wrap.classList.remove("holed", "cheer");
  wrap.querySelector(".eco-gtag")?.remove();
  ball.classList.remove("in", "rolling");
  ball.style.left = `${x0}%`; ball.style.top = "50%";
  if (reduced) return NOOP;
  wrap.classList.add("aiming");
  return {
    async stop(r) {
      wrap.classList.remove("aiming");
      const end = golfEnd(x0, r), T = 0.8 + Math.hypot(end.x - x0, end.y - HOLE.y) / 45;
      ball.style.setProperty("--t", `${T.toFixed(2)}s`);
      ball.classList.add("rolling");
      void ball.offsetWidth;
      ball.style.left = `${end.x}%`; ball.style.top = `${end.y}%`;
      await wait(T * 1000 + 80);
      if (r.holed) { ball.classList.add("in"); await wait(320); } else await wait(250);
    },
    cancel() { wrap.classList.remove("aiming"); },
  };
}

// Jackpot commun remporté : pluie de pièces et grand bandeau (bandeau seul si le mouvement est réduit).
function jackpotParty(host, amount, reduced) {
  const layer = document.createElement("div");
  layer.className = "eco-party";
  layer.setAttribute("aria-hidden", "true");
  const coins = reduced ? "" : Array.from({ length: 36 }, (_, i) => `<span class="eco-coin" style="--x:${(Math.random() * 100).toFixed(1)}%;--d:${(1.6 + Math.random() * 1.6).toFixed(2)}s;--delay:${(Math.random() * 1.2).toFixed(2)}s;--s:${18 + Math.round(Math.random() * 18)}px;--r:${Math.round(Math.random() * 720 - 360)}deg">${["🪙", "💰", "✨", "💎"][i % 4]}</span>`).join("");
  layer.innerHTML = `${coins}<div class="eco-party-title">Jackpot commun<b>+${money(Number(amount) || 0)}</b></div>`;
  host.append(layer);
  setTimeout(() => layer.classList.add("out"), 3600);
  setTimeout(() => layer.remove(), 4200);
}

// ---------- le dialogue « 💼 Entreprise » ----------
// getMine() rend l'appartement du résident (avec economy), onEconomy(eco) remplace son economy et redessine la page.
// Après chaque résultat du serveur, l'événement « penthouse:play » ({ game, result }) laisse la scène 3D l'animer aussi.
export function createEconomyUi({ dialog, body, esc, tools, getData, getMine, getToken, onEconomy, celebrate }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const state = { tab: "team", busy: false, frozenWallet: null, html: "", summary: "", form: {}, last: {}, rot: 0 };
  // Jackpot commun affiché : il compte jusqu'au nouveau montant, et reste gelé pendant une partie (comme le solde).
  const pot = { shown: null, target: null, frozen: null, raf: 0 };
  body.innerHTML = `<div class="eco-summary" id="ecoSummary"></div>
    <div class="eco-tabs" role="tablist" aria-label="Rubriques de l'entreprise">${TABS.map(([id, icon, name]) =>
      `<button type="button" role="tab" id="ecoTab-${id}" aria-controls="ecoPanel" aria-selected="false" tabindex="-1" data-tab="${id}"><span aria-hidden="true">${icon}</span> ${name}</button>`).join("")}</div>
    <p class="eco-status" id="ecoStatus" role="status" aria-live="polite"></p>
    <div class="eco-panel" id="ecoPanel" role="tabpanel" tabindex="0"></div>`;
  const panel = body.querySelector("#ecoPanel"), statusEl = body.querySelector("#ecoStatus"), summaryEl = body.querySelector("#ecoSummary");
  const tabs = [...body.querySelectorAll("[role=tab]")];

  const context = () => {
    const data = getData(), mine = getMine();
    return { eco: mine?.economy, esc, tools, now: data?.now ?? Date.now() / 1000, apartments: data?.apartments ?? [], me: mine?.slug,
      form: state.form, last: state.last, rot: state.rot, pot: data?.casino ?? null };
  };
  // Ligne d'état (annoncée aux lecteurs d'écran) : tone = "err" (refus), "ok" (réussite ou gain), "loss" (perte au casino).
  const setStatus = (text, tone = "") => { statusEl.textContent = text; statusEl.className = `eco-status ${tone}`; };
  const toneOf = net => net > 0 ? "ok" : net < 0 ? "loss" : "";

  const showPot = v => { const el = panel.querySelector("[data-jackpot]"); if (el) el.textContent = money(Math.round(v)); };
  function syncJackpot() {
    const live = getData()?.casino?.jackpot;
    if (live == null) return;
    const target = state.busy && pot.frozen != null ? pot.frozen : Number(live) || 0;
    if (pot.shown == null || reduced.matches || !dialog.open) {
      cancelAnimationFrame(pot.raf); pot.raf = 0; pot.shown = pot.target = target; showPot(target); return;
    }
    if (target === pot.target) { showPot(pot.raf ? pot.shown : target); return; }
    const from = pot.shown, at = performance.now(), box = panel.querySelector(".eco-jackpot");
    pot.target = target;
    cancelAnimationFrame(pot.raf);
    if (box && target > from) { box.classList.remove("up"); void box.offsetWidth; box.classList.add("up"); }
    const step = now => {
      const t = Math.min(1, (now - at) / 900);
      pot.shown = from + (target - from) * (1 - (1 - t) ** 3);
      showPot(pot.shown);
      pot.raf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    pot.raf = requestAnimationFrame(step);
  }

  function refresh(force = false) {
    if (!dialog.open && !force) return;
    const c = context();
    for (const t of tabs) {
      const on = t.dataset.tab === state.tab;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute("aria-labelledby", `ecoTab-${state.tab}`);
    if (!c.eco) { panel.innerHTML = '<p class="eco-muted">Ton entreprise ouvre bientôt : l\'économie n\'est pas encore disponible.</p>'; state.html = ""; return; }
    const t = c.eco.title ?? {};
    const summary = `<span class="eco-sum-wallet">💰 <b>${esc(money(state.busy ? state.frozenWallet : c.eco.wallet))}</b></span><span>${esc(t.icon ?? "")} ${esc(t.title ?? "")}</span>${eventChipHtml(c.eco.event, esc).replace('id="ecoEventTip"', 'id="ecoEventTipDlg"').replace('aria-describedby="ecoEventTip"', 'aria-describedby="ecoEventTipDlg"')}`;
    if (summary !== state.summary) { summaryEl.innerHTML = summary; state.summary = summary; }
    // Pas de redessin pendant une partie, ni sous les doigts de quelqu'un qui saisit ou ouvre une liste.
    const active = document.activeElement;
    if (!state.busy && (force || !(panel.contains(active) && active.matches("input, select, textarea")))) {
      const html = RENDER[state.tab](c);
      if (force || html !== state.html) {
        const focusKey = panel.contains(active) ? active.dataset.fk : null;
        panel.innerHTML = html;
        state.html = html;
        if (focusKey) panel.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
      }
    }
    syncJackpot();
  }

  function open(tab) {
    if (tab && RENDER[tab]) state.tab = tab;
    setStatus("");
    refresh(true);
    if (!dialog.open) dialog.showModal();
  }

  async function post(path, payload) {
    const token = getToken();
    if (!token) throw new Error("Clé de ton étage requise : ouvre « Relier mes agents ».");
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Tour-Token": token }, body: JSON.stringify(payload) });
    let j = {};
    try { j = await r.json(); } catch { /* réponse vide */ }
    if (!r.ok) throw new Error(j.error ?? `Action refusée (HTTP ${r.status}).`);
    return j;
  }
  // Action simple : bouton désactivé pendant l'appel, message dans la ligne d'état, puis nouvel état.
  async function act(button, path, payload, success) {
    if (button) button.disabled = true;
    setStatus("…");
    try {
      const j = await post(path, payload);
      setStatus(success, "ok");
      celebrate(j.toasts);
      if (j.economy) onEconomy(j.economy);
      refresh(true);
      return j;
    } catch (error) {
      setStatus(error.message, "err");
      refresh(true);
      return null;
    }
  }

  // ----- parties -----
  // La scène 3D (app.js) écoute cet événement pour rejouer la partie dans la tour.
  const announce = (game, result, extra = {}) => window.dispatchEvent(new CustomEvent("penthouse:play", { detail: { game, result, ...extra } }));
  // Le solde affiché garde la mise retirée jusqu'à la fin de l'animation : le flux ne dévoile pas le résultat.
  function begin(frozenWallet, text) {
    state.busy = true; state.frozenWallet = frozenWallet; pot.frozen = pot.shown;
    panel.querySelectorAll(".eco-play").forEach(b => { b.disabled = true; });
    setStatus(text);
    refresh();
  }
  function end() { state.busy = false; pot.frozen = null; }
  // Le bouton pressé est désactivé pendant la partie, puis redessiné : le focus clavier y revient.
  const focusKey = () => panel.contains(document.activeElement) ? document.activeElement.dataset.fk ?? null : null;
  function focusBack(key) {
    if (!key || !dialog.open) return;
    const a = document.activeElement;
    if (a && a !== document.body && panel.contains(a)) return;
    panel.querySelector(`[data-fk="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }
  // Petits effets après le dernier rendu (le redessin les effacerait sinon).
  function flourish(game, r) {
    if (game === "slots" && r.progressive) {
      panel.querySelector(".eco-jackpot")?.classList.add("won");
      panel.querySelector(".eco-reels")?.classList.add("jackpot");
      jackpotParty(dialog, r.progressive, reduced.matches);
    }
    if (reduced.matches) return;
    if (game === "blackjack") panel.querySelector(".eco-bj-stamp")?.classList.add("pop");
    if (game === "golf" && r.holed) panel.querySelector(".eco-green-wrap")?.classList.add("cheer");
    if (game === "tennis") panel.querySelector(".eco-score-row.won")?.classList.add("hit");
  }

  const WAIT_TEXT = { slots: "Les rouleaux tournent…", roulette: "La bille tourne…", race: "Les robots s'élancent…", tennis: "Échange en fond de court…", golf: "Tu lis la pente du green…" };
  const MIN_WAIT = { tennis: 1200, golf: 700 };
  const CHOICE = {
    roulette: () => state.form.rouletteChoice ?? "rouge",
    race: () => state.form.raceChoice ?? CASINO.race.runners[0],
    tennis: () => state.form.tennisStyle ?? defaultOf(STYLES),
    golf: () => state.form.golfShot ?? defaultOf(SHOTS),
  };
  function checkBet(eco) {
    const bet = Math.floor(Number(state.form.bet ?? 50));
    if (!(bet >= CASINO.minBet && bet <= CASINO.maxBet)) { setStatus(`Mise entre ${CASINO.minBet} et ${CASINO.maxBet} ${CURRENCY}.`, "err"); return null; }
    if (bet > (Number(eco.wallet) || 0)) { setStatus("Solde insuffisant pour cette mise.", "err"); return null; }
    return bet;
  }

  async function play(game) {
    if (state.busy) return;
    const eco = getMine()?.economy;
    if (!eco) return;
    const bet = checkBet(eco);
    if (bet == null) return;
    const choice = CHOICE[game]?.() ?? "", key = focusKey(), R = reduced.matches;
    begin((Number(eco.wallet) || 0) - bet, WAIT_TEXT[game] ?? "…");
    const anim = game === "slots" ? spinSlots(panel, R) : game === "roulette" ? spinRoulette(panel, R, state.rot) : game === "race" ? runRace(panel, R)
      : game === "tennis" ? playSet(panel, R) : game === "golf" ? rollPutt(panel, R, choice) : NOOP;
    let result = null;
    try {
      const [j] = await Promise.all([post("/api/economy/casino", { game, bet, choice }), wait(R ? 0 : MIN_WAIT[game] ?? 900)]);
      result = j.result;
      announce(game, result);
      const rot = await anim.stop(result);
      if (game === "roulette" && rot != null) state.rot = rot;
      state.last[game] = result;
      end();
      setStatus(outcomeText(game, result, tools), toneOf(result.net));
      celebrate(j.toasts);
      if (j.economy) onEconomy(j.economy);
    } catch (error) {
      anim.cancel();
      end();
      result = null;
      setStatus(error.message, "err");
    }
    refresh(true);
    focusBack(key);
    if (result) flourish(game, result);
  }

  // Blackjack : les nouvelles cartes sortent du sabot une à une, la carte cachée de la banque se retourne.
  async function dealCards(prev, hand) {
    const felt = panel.querySelector(".eco-felt");
    if (!felt) return;
    felt.classList.remove("dealing");
    const R = reduced.matches, shoe = felt.querySelector(".eco-shoe");
    const els = { player: felt.querySelector('[data-hand="player"]'), dealer: felt.querySelector('[data-hand="dealer"]') };
    const P = hand.player ?? [], D = hand.dealer ?? [], fresh = !prev.player.length && !prev.dealer.length;
    const vis = { player: [...prev.player], dealer: [...prev.dealer] }, steps = [];
    felt.querySelector(".eco-bj-stamp")?.remove();
    if (fresh) {
      els.player.replaceChildren(); els.dealer.replaceChildren();
      // Donne : toi, la banque, toi, la banque (face cachée) ; la carte se retourne si la main se termine tout de suite.
      for (let i = 0; i < 2; i++) {
        if (P[i]) steps.push(["player", P[i]]);
        if (D[i]) steps.push(["dealer", i === 1 ? "??" : D[i]]);
      }
      if (D[1] && D[1] !== "??") steps.push(["flip", 1]);
      P.slice(2).forEach(k => steps.push(["player", k]));
      D.slice(2).forEach(k => steps.push(["dealer", k]));
    } else {
      P.slice(prev.player.length).forEach(k => steps.push(["player", k]));
      prev.dealer.forEach((k, i) => { if (k === "??" && D[i] && D[i] !== "??") steps.push(["flip", i]); });
      D.slice(prev.dealer.length).forEach(k => steps.push(["dealer", k]));
    }
    const totals = () => {
      felt.querySelector('[data-total="player"]').textContent = totalText(vis.player);
      felt.querySelector('[data-total="dealer"]').textContent = totalText(vis.dealer);
    };
    for (const [kind, x] of steps) {
      if (kind === "flip") {
        const old = els.dealer.children[x];
        vis.dealer[x] = D[x];
        if (old && !R) { old.classList.add("flip-out"); await wait(170); }
        const card = toEl(cardHtml(D[x], esc, R ? "" : "flip-in"));
        if (old) old.replaceWith(card); else els.dealer.append(card);
      } else {
        vis[kind].push(x);
        const card = toEl(cardHtml(x, esc));
        els[kind].append(card);
        if (!R && shoe) {
          const a = shoe.getBoundingClientRect(), b = card.getBoundingClientRect();
          card.style.setProperty("--dx", `${Math.round(a.left + a.width / 2 - b.left - b.width / 2)}px`);
          card.style.setProperty("--dy", `${Math.round(a.top + a.height / 2 - b.top - b.height / 2)}px`);
          card.classList.add("deal");
        }
      }
      totals();
      if (!R) await wait(kind === "flip" ? 320 : 360);
    }
    if (!R) await wait(220);
  }

  const BJ_WAIT = { deal: "La croupière distribue…", hit: "Une carte pour toi…", stand: "La banque retourne sa carte…", double: "Mise doublée : une seule carte…" };
  async function playBlackjack(action) {
    if (state.busy || !BJ_WAIT[action]) return;
    const eco = getMine()?.economy;
    if (!eco) return;
    const live = liveHand(eco), wallet = Number(eco.wallet) || 0;
    let bet = 0;
    if (action === "deal") {
      if (live) return setStatus("Termine d'abord ta main en cours.", "err");
      bet = checkBet(eco);
      if (bet == null) return;
    } else if (!live) return setStatus("Aucune main en cours : distribue d'abord.", "err");
    const cost = action === "deal" ? bet : action === "double" ? Number(live.bet) || 0 : 0;
    if (cost > wallet) return setStatus("Solde insuffisant pour doubler.", "err");
    const prev = live ? { player: [...(live.player ?? [])], dealer: [...(live.dealer ?? [])] } : { player: [], dealer: [] };
    const hadFocus = panel.contains(document.activeElement);
    begin(wallet - cost, BJ_WAIT[action]);
    const felt = panel.querySelector(".eco-felt");
    if (felt && !reduced.matches) {
      felt.classList.add("dealing");
      if (action === "deal") felt.querySelectorAll(".bj-card, .eco-bj-stamp").forEach(el => el.classList.add("sweep"));
    }
    let result = null;
    try {
      const payload = action === "deal" ? { game: "blackjack", action, bet } : { game: "blackjack", action };
      const [j] = await Promise.all([post("/api/economy/casino", payload), wait(reduced.matches ? 0 : 450)]);
      result = j.result;
      announce("blackjack", result, { action });
      if (result?.hand) await dealCards(prev, result.hand);
      state.last.blackjack = result;
      end();
      setStatus(outcomeText("blackjack", result, tools), result?.hand?.status === "playing" ? "" : toneOf(result.net));
      celebrate(j.toasts);
      if (j.economy) onEconomy(j.economy);
    } catch (error) {
      end();
      result = null;
      setStatus(error.message, "err");
    }
    refresh(true);
    if (hadFocus) panel.querySelector(`[data-fk="${liveHand(getMine()?.economy) ? "bj:hit" : "bj:deal"}"]`)?.focus({ preventScroll: true });
    if (result && result.hand?.status !== "playing") flourish("blackjack", result);
  }

  async function sendTip(form) {
    const f = Object.fromEntries(new FormData(form));
    const amount = Math.floor(Number(f.amount));
    if (!f.to) return setStatus("Choisis le résident à remercier.", "err");
    if (!(amount >= TIPS.min)) return setStatus(`Prime minimum : ${TIPS.min} ${CURRENCY}.`, "err");
    const name = getData()?.apartments.find(a => a.slug === f.to)?.name ?? f.to;
    const j = await act(form.querySelector("button[type=submit]"), "/api/economy/tip", { to: f.to, amount, message: String(f.message ?? "").slice(0, TIPS.message) },
      `💌 Prime de ${money(amount)} envoyée à ${name}.`);
    if (j) { delete state.form.amount; delete state.form.message; refresh(true); }
  }

  // Gains affichés sous chaque style ou putt : suivent la mise sans redessiner le panneau.
  const syncGains = () => panel.querySelectorAll("[data-gain]").forEach(el => { el.textContent = gainText(state.form, Number(el.dataset.gain)); });

  dialog.addEventListener("click", e => {
    const tab = e.target.closest("[role=tab]");
    if (tab) { state.tab = tab.dataset.tab; setStatus(""); refresh(true); tab.focus(); return; }
    const chip = e.target.closest("[data-bet]");
    if (chip) {
      state.form.bet = chip.dataset.bet;
      const input = panel.querySelector("[name=bet]");
      if (input) input.value = chip.dataset.bet;
      syncGains();
      return;
    }
    const buy = e.target.closest("[data-buy]");
    if (buy && !buy.disabled) {
      const item = SHOP.find(i => i.id === buy.dataset.buy);
      if (!item) return;
      const target = item.target ? panel.querySelector("[name=formationTarget]")?.value ?? "" : undefined;
      act(buy, "/api/economy/buy", { item: item.id, ...(item.target ? { target } : {}) }, `${item.icon} ${item.name} : c'est à toi.`);
      return;
    }
    const bj = e.target.closest("[data-bj]");
    if (bj && !bj.disabled) { playBlackjack(bj.dataset.bj); return; }
    const p = e.target.closest("[data-play]");
    if (p && !p.disabled) play(p.dataset.play);
  });
  dialog.addEventListener("input", e => {
    if (!e.target.matches("[data-keep]")) return;
    state.form[e.target.name] = e.target.value;
    if (e.target.name === "bet") syncGains();
  });
  dialog.addEventListener("change", e => {
    const el = e.target;
    if (el.matches("[data-keep]")) state.form[el.name] = el.value;
    // Golf : la balle se place tout de suite au départ du putt choisi.
    if (el.name === "golfShot" && !state.busy) panel.querySelector(".eco-green-wrap")?.replaceWith(toEl(greenHtml(el.value, state.last.golf, esc)));
    if (el.matches("select[data-sub]")) {
      const provider = el.dataset.sub, tier = el.value, def = PROVIDERS[provider];
      const name = def?.tiers.find(t => t.id === tier)?.name;
      act(null, "/api/economy/subscription", { provider, tier }, `Abonnement ${def?.name ?? provider} : ${name ?? "retiré"}.`);
    }
  });
  dialog.addEventListener("submit", e => {
    const form = e.target.closest(".eco-tipform");
    if (!form) return;
    e.preventDefault();
    sendTip(form);
  });
  // Onglets au clavier : flèches, début et fin.
  body.querySelector("[role=tablist]").addEventListener("keydown", e => {
    const i = tabs.findIndex(t => t.dataset.tab === state.tab);
    const j = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    state.tab = tabs[j].dataset.tab; setStatus(""); refresh(true); tabs[j].focus();
  });

  return {
    open, refresh,
    // Solde à montrer dans l'en-tête : gelé pendant une partie, pour ne pas dévoiler le résultat avant l'animation.
    shownWallet: eco => state.busy ? state.frozenWallet : eco?.wallet,
  };
}
