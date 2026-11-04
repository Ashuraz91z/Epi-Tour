// Interface de l'économie du penthouse : l'entreprise du résident (équipe et paie, boutique, casino, classements, banque).
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
const TABS = [["team", "👥", "Équipe & paie"], ["shop", "🛍️", "Boutique"], ["casino", "🎰", "Casino"], ["ranks", "🏆", "Classements"], ["bank", "🏦", "Banque"]];
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

// Roue européenne : ordre réel des cases, de 0 en haut, dans le sens des aiguilles d'une montre.
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const SEG = 360 / WHEEL.length;
const pocketColor = n => n === 0 ? "vert" : CASINO.roulette.red.includes(n) ? "rouge" : "noir";
const WHEEL_BG = `conic-gradient(${WHEEL.map((n, i) => `${{ vert: "#1f8f4e", rouge: "#b3243a", noir: "#15161c" }[pocketColor(n)]} ${(i * SEG).toFixed(3)}deg ${((i + 1) * SEG).toFixed(3)}deg`).join(",")})`;
const RANK = r => r === 0 ? "1er" : `${r + 1}e`;

function outcomeText(game, r, tools) {
  const gain = r.net > 0 ? `Gagné ! ${signedMoney(r.net)}` : r.net === 0 ? "Mise récupérée." : `Perdu : ${signedMoney(r.net)}`;
  if (game === "slots") return `${r.reels.join(" ")} — ${gain}`;
  if (game === "roulette") return `La bille s'arrête sur ${r.number} ${r.color}. ${gain}`;
  return `${toolOf(tools, r.winner).name} gagne la course. ${gain}`;
}

function casinoHtml(c) {
  const { eco, esc, tools, form, last } = c, cas = eco.casino ?? {}, rec = eco.records ?? {};
  const bet = form.bet ?? 50, choiceR = form.rouletteChoice ?? "rouge", choiceC = form.raceChoice ?? CASINO.race.runners[0];
  const closed = (Number(cas.playsLeft) || 0) <= 0 || (Number(cas.lossLeft) || 0) < CASINO.minBet || (Number(eco.wallet) || 0) < CASINO.minBet;
  const playAttr = closed ? "disabled" : "";
  const reels = last.slots?.reels ?? ["🍒", "⭐", "7️⃣"];
  const r = last.roulette, race = last.race;
  const rankOf = new Map((race?.order ?? []).map((k, i) => [k, i]));
  const outcome = game => last[game] ? `<p class="eco-outcome ${last[game].net > 0 ? "win" : last[game].net < 0 ? "loss" : ""}">${esc(outcomeText(game, last[game], tools))}</p>` : "";
  return `${eco.event?.id === "jackpot" ? '<p class="eco-banner">🎰 Jackpot progressif aujourd\'hui : 7️⃣7️⃣7️⃣ paie × 100 à la machine à sous.</p>' : ""}
    <div class="eco-betbar">
      <label><span>Ta mise</span><input type="number" name="bet" data-keep inputmode="numeric" min="${CASINO.minBet}" max="${CASINO.maxBet}" step="1" value="${esc(bet)}"></label>
      <div class="eco-chips" role="group" aria-label="Mises rapides">${[10, 50, 100, 250, 500].filter(v => v >= CASINO.minBet && v <= CASINO.maxBet).map(v => `<button type="button" data-bet="${v}" aria-label="Miser ${v} ${CURRENCY}">${v}</button>`).join("")}</div>
      <p class="eco-limits">Solde <b>${esc(money(eco.wallet))}</b> · ${Number(cas.playsLeft) || 0} partie(s) restante(s) · pertes encore possibles <b>${esc(money(cas.lossLeft))}</b>
        · record <b>${esc(money(rec.biggestWin))}</b> · jackpots <b>${Number(rec.jackpots) || 0}</b>${eco.perks?.assurance ? " · 🛡️ assuré·e" : ""}</p>
      ${closed ? '<p class="eco-banner warn">Le casino est fermé pour toi aujourd\'hui (limite atteinte ou solde trop bas).</p>' : ""}
    </div>
    <div class="eco-games">
      <section class="eco-game" aria-labelledby="ecoSlotsTitle"><h4 id="ecoSlotsTitle">🎰 Machine à sous</h4>
        <div class="eco-reels" aria-hidden="true">${reels.map(s => `<span class="eco-reel">${esc(s)}</span>`).join("")}</div>
        <p class="eco-paytable">${CASINO.slots.symbols.map(s => `${esc(s.s)}×3 <b>×${s.pay3}</b>`).join(" · ")} · paire <b>×${nf.format(CASINO.slots.pair)}</b></p>
        <button type="button" class="eco-play" data-play="slots" data-fk="play:slots" ${playAttr}>Tirer le levier</button>${outcome("slots")}</section>
      <section class="eco-game" aria-labelledby="ecoRouletteTitle"><h4 id="ecoRouletteTitle">🎡 Roulette</h4>
        <div class="eco-wheel-wrap" aria-hidden="true"><div class="eco-wheel" style="background:${WHEEL_BG};transform:rotate(${Number(c.rot) || 0}deg)"></div><span class="eco-pointer"></span>
          <span class="eco-ball ${r ? esc(r.color) : ""}">${r ? esc(r.number) : "?"}</span></div>
        <label class="eco-choice"><span>Tu mises sur</span><select name="rouletteChoice" data-keep data-fk="rouletteChoice">
          <optgroup label="Chances simples (× ${CASINO.roulette.even})">${["rouge", "noir", "pair", "impair"].map(v => `<option value="${v}" ${choiceR === v ? "selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</optgroup>
          <optgroup label="Numéro plein (× ${CASINO.roulette.number})">${[...Array(37).keys()].map(n => `<option value="${n}" ${choiceR === String(n) ? "selected" : ""}>${n} · ${pocketColor(n)}</option>`).join("")}</optgroup>
        </select></label>
        <button type="button" class="eco-play" data-play="roulette" data-fk="play:roulette" ${playAttr}>Lancer la bille</button>${outcome("roulette")}</section>
      <section class="eco-game" aria-labelledby="ecoRaceTitle"><h4 id="ecoRaceTitle">🏁 Course de robots</h4>
        <div class="eco-track" aria-hidden="true">${CASINO.race.runners.map(k => {
          const T = toolOf(tools, k), rank = rankOf.get(k);
          return `<div class="eco-lane"><span class="eco-lane-name">${esc(T.name)}</span><span class="eco-lane-track"><span class="eco-runner" data-runner="${esc(k)}" style="--c:${esc(T.color)};--p:${rank == null ? 0 : (1 - rank * 0.08).toFixed(2)}">🤖</span></span><span class="eco-lane-rank">${rank == null ? "" : RANK(rank)}</span></div>`;
        }).join("")}</div>
        <label class="eco-choice"><span>Ton robot (× ${nf.format(CASINO.race.payout)})</span><select name="raceChoice" data-keep data-fk="raceChoice">${CASINO.race.runners.map(k => `<option value="${esc(k)}" ${choiceC === k ? "selected" : ""}>${esc(toolOf(tools, k).name)}</option>`).join("")}</select></label>
        <button type="button" class="eco-play" data-play="race" data-fk="play:race" ${playAttr}>Départ !</button>${outcome("race")}</section>
    </div>
    <p class="eco-muted">Mise de ${CASINO.minBet} à ${CASINO.maxBet} ${CURRENCY}. Le tirage est fait par le serveur. ${CURRENCY} : monnaie de jeu, sans valeur réelle.</p>`;
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

const RENDER = { team: teamHtml, shop: shopHtml, casino: casinoHtml, ranks: ranksHtml, bank: bankHtml };

// ---------- animations du casino (purement visuelles) ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));

function spinSlots(panel, reduced) {
  const reels = [...panel.querySelectorAll(".eco-reel")];
  if (reduced || !reels.length) return { async stop() {}, cancel() {} };
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
  if (reduced || !els.size) return { async stop() {}, cancel() {} };
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

// ---------- le dialogue « 💼 Entreprise » ----------
// getMine() rend l'appartement du résident (avec economy), onEconomy(eco) remplace son economy et redessine la page.
export function createEconomyUi({ dialog, body, esc, tools, getData, getMine, getToken, onEconomy, celebrate }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const state = { tab: "team", busy: false, frozenWallet: null, html: "", summary: "", form: {}, last: {}, rot: 0 };
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
      form: state.form, last: state.last, rot: state.rot };
  };
  // Ligne d'état (annoncée aux lecteurs d'écran) : tone = "err" (refus), "ok" (réussite ou gain), "loss" (perte au casino).
  const setStatus = (text, tone = "") => { statusEl.textContent = text; statusEl.className = `eco-status ${tone}`; };

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
    if (state.busy) return;
    const active = document.activeElement;
    if (!force && panel.contains(active) && active.matches("input, select, textarea")) return;
    const html = RENDER[state.tab](c);
    if (!force && html === state.html) return;
    const focusKey = panel.contains(active) ? active.dataset.fk : null;
    panel.innerHTML = html;
    state.html = html;
    if (focusKey) panel.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
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

  async function play(game) {
    if (state.busy) return;
    const eco = getMine()?.economy;
    if (!eco) return;
    const bet = Math.floor(Number(state.form.bet ?? 50));
    if (!(bet >= CASINO.minBet && bet <= CASINO.maxBet)) return setStatus(`Mise entre ${CASINO.minBet} et ${CASINO.maxBet} ${CURRENCY}.`, "err");
    if (bet > (Number(eco.wallet) || 0)) return setStatus("Solde insuffisant pour cette mise.", "err");
    const choice = game === "roulette" ? state.form.rouletteChoice ?? "rouge" : game === "race" ? state.form.raceChoice ?? CASINO.race.runners[0] : "";
    // Le solde affiché garde la mise retirée jusqu'à la fin de l'animation : le flux ne dévoile pas le résultat.
    state.busy = true; state.frozenWallet = (Number(eco.wallet) || 0) - bet;
    panel.querySelectorAll(".eco-play").forEach(b => { b.disabled = true; });
    setStatus(game === "slots" ? "Les rouleaux tournent…" : game === "roulette" ? "La bille tourne…" : "Les robots s'élancent…");
    refresh();
    const anim = game === "slots" ? spinSlots(panel, reduced.matches) : game === "roulette" ? spinRoulette(panel, reduced.matches, state.rot) : runRace(panel, reduced.matches);
    try {
      const [j] = await Promise.all([post("/api/economy/casino", { game, bet, choice }), wait(reduced.matches ? 0 : 900)]);
      const rot = await anim.stop(j.result);
      if (game === "roulette" && rot != null) state.rot = rot;
      state.last[game] = j.result;
      state.busy = false;
      setStatus(outcomeText(game, j.result, tools), j.result.net > 0 ? "ok" : j.result.net < 0 ? "loss" : "");
      celebrate(j.toasts);
      if (j.economy) onEconomy(j.economy);
    } catch (error) {
      anim.cancel();
      state.busy = false;
      setStatus(error.message, "err");
    }
    refresh(true);
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

  dialog.addEventListener("click", e => {
    const tab = e.target.closest("[role=tab]");
    if (tab) { state.tab = tab.dataset.tab; setStatus(""); refresh(true); tab.focus(); return; }
    const chip = e.target.closest("[data-bet]");
    if (chip) {
      state.form.bet = chip.dataset.bet;
      const input = panel.querySelector("[name=bet]");
      if (input) input.value = chip.dataset.bet;
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
    const p = e.target.closest("[data-play]");
    if (p && !p.disabled) play(p.dataset.play);
  });
  dialog.addEventListener("input", e => { if (e.target.matches("[data-keep]")) state.form[e.target.name] = e.target.value; });
  dialog.addEventListener("change", e => {
    const el = e.target;
    if (el.matches("[data-keep]")) state.form[el.name] = el.value;
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
