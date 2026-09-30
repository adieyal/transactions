import { $, esc, fmt, fmtDate, monthName } from "../helpers.js";

export function createChanges(runtime, actions) {
  const { state } = runtime;
  const money = (v, cur) =>
    cur && cur !== "ILS"
      ? `${{ USD: "$", EUR: "€", GBP: "£" }[cur] || cur + " "}${Math.abs(v).toFixed(2)}`
      : fmt(v);

  function renderChanges() {
    const el = $("#changes");
    if (
      !state.loaded ||
      !runtime.derived?.allTxns.length ||
      !runtime.derived.flags.length
    ) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML =
      `<div class="sec-h"><h2>Worth a look</h2><span class="sub">Changes in things you pay for regularly</span></div><ul class="changes">` +
      runtime.derived.flags
        .map((f) => {
          const who = `<b dir="auto">${esc(f.t.merchant)}</b>`;
          const line =
            f.type === "price"
              ? `<span class="chg ${f.b > f.a ? "up" : "down"}">${f.b > f.a ? "▲" : "▼"}</span> ${who} went from ${money(f.a, f.cur)} to ${money(f.b, f.cur)} (${f.b > f.a ? "+" : "−"}${Math.round((Math.abs(f.b - f.a) / Math.abs(f.a)) * 100)}%) in the ${monthName(f.t.period)} statement.`
              : `<span class="chg gone">◌</span> ${who} isn't in your ${monthName(f.since)} statement. It was last charged on ${fmtDate(f.t.date)} (${fmt(f.t.amount)}).`;
          return `<li>${line} <button class="linkish" data-flagshow="${esc(f.id)}">Show</button> <button class="linkish" data-flagdismiss="${esc(f.id)}">Dismiss</button></li>`;
        })
        .join("") +
      `</ul>`;
  }

  function wireChanges() {
    $("#changes").addEventListener("click", (e) => {
      const s = e.target.closest("[data-flagshow]");
      if (s) {
        const f = runtime.derived.flags.find(
          (x) => x.id === s.dataset.flagshow,
        );
        if (!f) return;
        state.highlight = new Set(f.group);
        state.selection = new Set([f.t.id]);
        state.periodSel = null;
        actions.refresh();
        $("#tlwrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const d = e.target.closest("[data-flagdismiss]");
      if (d) {
        state.dismissed[d.dataset.flagdismiss] = true;
        actions.saveSoon("dismissed", () => ({ map: state.dismissed }), 200);
        actions.refresh();
      }
    });
  }

  return { renderChanges, wireChanges };
}
