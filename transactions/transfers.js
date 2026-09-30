import { addMonths, ms } from "../helpers.js";

function detectTransfers(rows, { batches, transferOv }) {
  const ov = transferOv;
  const info = {};
  const paid = {};
  const stmts = Object.values(batches)
    .filter((b) => b.kind === "leumi" || b.card)
    .map((b) => ({
      key: b.account + "|" + b.periods[0],
      account: b.account,
      period: b.periods[0],
      total: +b.rows.reduce((a, r) => a + r.amount, 0).toFixed(2),
    }));
  const cand = rows
    .filter((r) => ov[r.id] !== false)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const r of cand) {
    if (r.amount <= 0) continue;
    const st = stmts.find(
      (s) =>
        !paid[s.key] &&
        s.account !== r.account &&
        Math.abs(s.total - r.amount) <= 1 &&
        ms(r.date) >= ms(s.period + "-01") - 7 * 864e5 &&
        ms(r.date) <= ms(addMonths(s.period + "-01", 1)) + 12 * 864e5,
    );
    if (st) {
      info[r.id] = { kind: "card", stmt: st };
      paid[st.key] = r.id;
    }
  }
  const byAmt = {};
  for (const r of cand)
    if (r.amount < 0 && !info[r.id])
      (byAmt[(-r.amount).toFixed(2)] ||= []).push(r);
  for (const r of cand) {
    if (r.amount <= 0 || info[r.id]) continue;
    const m = (byAmt[r.amount.toFixed(2)] || []).find(
      (c) =>
        !info[c.id] &&
        c.account !== r.account &&
        Math.abs(ms(c.date) - ms(r.date)) <= 4 * 864e5,
    );
    if (m) {
      info[r.id] = { kind: "pair", other: m.id, dir: "out" };
      info[m.id] = { kind: "pair", other: r.id, dir: "in" };
    }
  }
  for (const [id, v] of Object.entries(ov))
    if (v === true && !info[id]) info[id] = { kind: "manual" };
  return { info, paid, stmts };
}
export { detectTransfers };
