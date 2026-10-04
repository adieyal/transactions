import { fmt, fmtDate, fmtExact, monthName } from "../helpers.js";
import { $, html } from "./dom.js";

// What the timeline says about a bead: its tooltip, and how a transfer is
// described (also used by the assistant's transaction details).

// byId: the derived transactions, to name a transfer's other side.
export function describeTransfer(t, byId) {
  const tr = t.transfer;
  if (!tr) return "";
  if (tr.kind === "card")
    return `pays the ${tr.stmt.account} statement for ${monthName(tr.stmt.period)} (${fmt(tr.stmt.total, undefined, tr.stmt.currency)})`;
  if (tr.kind === "pair") {
    const o = byId.get(tr.other);
    return o
      ? `moved ${tr.dir === "out" ? "to" : "from"} ${o.account}`
      : "moved between your accounts";
  }
  return "marked by you as a transfer";
}

function describe(t, byId) {
  if (t.kind === "purchase")
    return `${t.why} · ${fmt(t.amount, undefined, t.currency)}`;
  if (t.kind === "ghost" || t.kind === "inferred") return t.why;
  const bits = [fmtDate(t.date)];
  if (t.inst) bits.push(`payment ${t.inst.n} of ${t.inst.of}`);
  if (t.transfer) bits.push(describeTransfer(t, byId));
  if (
    t.orig &&
    (t.orig.currency !== t.currency ||
      Math.abs(t.orig.amount - t.amount) > 0.01)
  )
    bits.push(
      `originally ${fmtExact(Math.abs(t.orig.amount), t.orig.currency)}`,
    );
  if (t.periods?.length) bits.push(t.periods.join(", "));
  return bits.join(" · ");
}

// The tooltip beside the pointer over a bead.
export function showBeadTip(t, ev, byId) {
  const tip = $("#tip");
  const wrap = $("#tlwrap").getBoundingClientRect();
  tip.innerHTML = html`<div class="m" dir="auto">${t.merchant}</div>${t.renamed ? html`<div class="s" dir="auto">${t.original}</div>` : ""}<div><b>${fmt(t.amount, undefined, t.currency)}</b> <span class="s">${describe(t, byId)}</span></div>${t.note ? html`<div class="s" dir="auto">${t.note}</div>` : ""}`;
  tip.style.display = "block";
  let x = ev.clientX - wrap.left + 14,
    y = ev.clientY - wrap.top + 14;
  if (x + 300 > wrap.width) x = ev.clientX - wrap.left - 300;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
