function findChanges(groups, coverage, dismissed = {}) {
  const flags = [];
  for (const g of Object.values(groups)) {
    if (!g[0]?.recurring) continue;
    const last = g.at(-1);
    const cov = [...(coverage[last.account] || [])].sort();
    const perPeriod = {};
    g.forEach((t) => (perPeriod[t.period] = (perPeriod[t.period] || 0) + 1));
    const oncePer = Object.values(perPeriod).every((n) => n === 1);
    const prev = [...g].reverse().find((t) => t.period !== last.period);
    if (prev && oncePer) {
      const useOrig =
        last.orig &&
        prev.orig &&
        last.orig.currency !== "ILS" &&
        last.orig.currency === prev.orig.currency;
      const a = useOrig ? prev.orig.amount : prev.amount,
        b = useOrig ? last.orig.amount : last.amount,
        cur = useOrig ? last.orig.currency : "ILS";
      if (
        Math.abs(b - a) >= 1 &&
        Math.abs(b - a) / Math.max(1, Math.abs(a)) >= 0.03
      )
        flags.push({
          id: "price|" + last.id,
          type: "price",
          t: last,
          prev,
          a,
          b,
          cur,
          group: g.map((x) => x.id),
        });
    }
    if (cov.length && cov.at(-1) > last.period)
      flags.push({
        id: "gone|" + last.id + "|" + cov.at(-1),
        type: "gone",
        t: last,
        since: cov.at(-1),
        group: g.map((x) => x.id),
      });
  }
  return flags.filter((f) => !dismissed[f.id]);
}
export { findChanges };
