// Ne redéclenche pas une alerte au polling ; une demande renouvelée ou réapparue est nouvelle.
export function approvalState(apartments, previous, slug) {
  const pending = apartments.filter(a => a.slug === slug).flatMap(apartment => apartment.sessions
    .filter(session => session.state === 'autorisation')
    .map(session => ({ apartment, session, key: JSON.stringify([apartment.slug, session.src, session.host, session.sid]) })));
  const current = new Map(pending.map(item => [item.key, item.session.updated]));
  const fresh = pending.filter(item => !previous.has(item.key) || previous.get(item.key) !== item.session.updated);
  return { pending, current, fresh };
}
