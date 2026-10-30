// Separate trust classes: anonymous traffic must never spend an account's budget.
// Use the socket peer, never client-supplied forwarding headers. Behind a proxy,
// anonymous clients share its budget; deploy per-source filtering at the edge.
export function createRequestLimiter({ requestsPerMinute, emergencyRequestsPerMinute, now }) {
  let start = now();
  const groups = new Map();
  return (group, key) => {
    const time = now();
    if (time - start >= 60_000 || time < start) { groups.clear(); start = time; }
    let state = groups.get(group);
    if (!state) { state = { total: 0, clients: new Map() }; groups.set(group, state); }
    const count = state.clients.get(key) || 0;
    // Check the individual budget first: repeated rejected requests cannot exhaust
    // the emergency budget of other clients. Bound maps independently per class.
    if (count >= requestsPerMinute || state.total >= emergencyRequestsPerMinute ||
        (!state.clients.has(key) && state.clients.size >= 4096)) {
      return Math.max(1, Math.ceil((60_000 - (time - start)) / 1000));
    }
    state.clients.set(key, count + 1); state.total++;
    return 0;
  };
}
