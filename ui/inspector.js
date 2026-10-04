import { $, esc, fmt, fmtDate, monthName, normText } from "../helpers.js";
import { toast } from "./dom.js";
import { wireHoverHighlight } from "./highlight.js";

export function createInspector(runtime, actions) {
  const { state, caps } = runtime;
  function setTransfer(id, on) {
    const t = runtime.derived.byId.get(id);
    const auto = !!t?.transfer && t.transfer.kind !== "manual";
    if (on) state.transferOv[id] = true;
    else state.transferOv[id] = false;
    if (on && auto) delete state.transferOv[id];
    actions.save("transfers");
    actions.refresh();
  }

  function wireInspector() {
    wireHoverHighlight($("#insp"), runtime, actions);
    $("#insp").addEventListener("click", (e) => {
      const c = e.target.closest("[data-cite]");
      if (c) {
        state.periodSel = null;
        state.statement = null;
        actions.select([c.dataset.cite]);
        return;
      }
      const op = e.target.closest("[data-openperiod]");
      if (op) {
        actions.openPeriod(op.dataset.openperiod);
        return;
      }
      const b = e.target.closest(".bar[data-ids]");
      if (b) {
        const ids = b.dataset.ids.split(",").filter(Boolean);
        actions.highlight(ids);
      }
    });
  }

  // A refresh leaves the inspector alone while someone types in one of its
  // text fields (a period's name, a note), so the field keeps its caret.
  // Any other call redraws it.
  function renderInspector({ fromRefresh = false } = {}) {
    const el = $("#insp");
    if (
      fromRefresh &&
      el.contains(document.activeElement) &&
      document.activeElement.matches(
        "textarea, input:not([type]), input[type=text], input[type=search]",
      )
    )
      return;
    if (!state.loaded || !runtime.derived.allTxns.length) {
      el.innerHTML = "";
      return;
    }
    const selP = state.periods.find((p) => p.id === state.periodSel);
    if (selP) {
      actions.renderPeriodInspector(el, selP);
      return;
    }
    if (state.statement) {
      const { account, period } = state.statement;
      const bs = Object.values(state.batches).filter(
        (b) => b.account === account && b.periods.includes(period),
      );
      const paidId = runtime.derived.stmtPaid[account + "|" + period];
      const paid = paidId && runtime.derived.byId.get(paidId);
      const stT = runtime.derived.stmts.find(
        (x) => x.account === account && x.period === period,
      );
      el.innerHTML =
        `<div class="ins-m" dir="auto">${esc(account)}</div><div class="sub">${monthName(period)}${stT ? ` · statement total ${fmt(stT.total)}` : ""}</div>` +
        (paid
          ? `<p class="sub">Paid from <span dir="auto">${esc(paid.account)}</span> on ${fmtDate(paid.date)}: <button class="cite" data-cite="${paid.id}"><span dir="auto">${esc(paid.merchant.slice(0, 22))}</span> ${fmt(paid.amount, 0)}</button>. That payment isn't counted as spending, so these charges aren't counted twice.</p>`
          : stT
            ? `<p class="sub">No payment for this statement found in your other accounts yet.</p>`
            : "") +
        bs
          .map(
            (b) =>
              `<p class="sub">From <b dir="auto">${esc(b.file)}</b>: ${b.rows.length} transactions${b.periods.length > 1 ? ` covering ${b.periods.length} months` : ""}.</p><div class="row-actions"><button class="btn small quiet" data-rm="${b.id}">Remove this ${b.kind === "leumi" ? "statement" : "import"}</button></div>`,
          )
          .join("");
      el.querySelectorAll("[data-rm]").forEach(
        (b) =>
          (b.onclick = () => {
            const bt = state.batches[b.dataset.rm];
            if (
              !confirm(`Remove ${bt.rows.length} transactions from ${bt.file}?`)
            )
              return;
            actions.removeBatch(bt);
            state.statement = null;
            actions.refresh();
            toast("Removed. Add the file again any time.");
          }),
      );
      return;
    }
    if (
      state.threadSel &&
      !state.selection.size &&
      runtime.derived.names.includes(state.threadSel)
    ) {
      actions.renderThreadInspector(el, state.threadSel);
      return;
    }
    const ids = [...state.selection].filter((id) =>
      runtime.derived.byId.has(id),
    );
    if (!ids.length) {
      el.innerHTML = `<p class="hint">Hover a bead for the short story, click it for where it came from. Drag across the timeline to gather several and turn them into a thread.</p><p class="hint">Solid beads are charges on your statements. Hollow ones with a line are refunds. Dashed ones are expected or missing: recurring charges projected ahead, instalments still to come, or payments that sit in a statement you haven't added.</p>`;
      return;
    }
    if (ids.length === 1) {
      const t = runtime.derived.byId.get(ids[0]);
      const thr = runtime.derived.R.threads.find((x) => x.name === t.thread);
      const rule =
        t.matchLine != null
          ? `caught by line ${t.matchLine + 1} <button class="linkish" data-line="${t.matchLine}">“${esc((state.previewRules ?? state.rules).split("\n")[t.matchLine].trim())}”</button>`
          : "not caught by any thread yet";
      const kv = [];
      kv.push([
        t.kind === "purchase" ? "Full price" : "Charged",
        `${fmt(t.amount)}${t.kind === "ghost" ? " (expected)" : t.kind === "inferred" ? " (worked out)" : ""}`,
      ]);
      if (t.orig && t.kind === "actual")
        kv.push([
          "Original amount",
          `${t.orig.currency} ${t.orig.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        ]);
      kv.push([
        t.kind === "purchase" ? "Bought" : "Date",
        fmtDate(t.date) +
          (t.kind === "actual" && t.chargeDate && t.chargeDate !== t.date
            ? ` (charged around ${fmtDate(t.chargeDate)})`
            : ""),
      ]);
      if (t.type) kv.push(["Type", `<span dir="auto">${esc(t.type)}</span>`]);
      if (t.details)
        kv.push(["Details", `<span dir="auto">${esc(t.details)}</span>`]);
      if (t.transfer)
        kv.push([
          "Transfer",
          `${esc(actions.transferText(t))}. Not counted as spending.${t.transfer.kind === "pair" ? ` <button class="linkish" data-cite="${t.transfer.other}">See the other side</button>` : ""}`,
        ]);
      else
        kv.push([
          "Thread",
          `<b style="color:${thr?.color || "var(--ink-2)"}"><bdi>${esc(t.thread)}</bdi></b>, ${rule}`,
        ]);
      if (t.periods?.length)
        kv.push([
          "During",
          t.periods
            .map((n) => {
              const p = state.periods.find((x) => x.name === n);
              return p
                ? `<button class="linkish" data-openperiod="${p.id}" dir="auto">${esc(n)}</button>`
                : esc(n);
            })
            .join(", "),
        ]);
      if (t.derivedFrom)
        kv.push([
          "Source",
          `Worked out from the <span dir="auto">${esc(t.account)}</span> ${monthName(t.derivedFrom.period)} statement`,
        ]);
      else
        kv.push([
          "Source",
          `<span dir="auto">${esc(t.account)}</span>, ${t.period ? monthName(t.period) + " statement, " : ""}<span dir="auto">${esc(t.file || "")}</span>`,
        ]);
      if (t.why) kv.push(["Why it's here", esc(t.why)]);
      const realId = t.kind === "actual" ? t.id : null;
      const nk = t.nameKey || normText(t.original || t.merchant);
      kv.unshift([
        "Description",
        `<input id="nameBox" dir="auto" value="${esc(t.renamed ? t.merchant : "")}" placeholder="${esc(t.original || t.merchant)}" aria-label="Display name" style="width:100%;border:1px solid var(--wire);background:var(--raised);border-radius:6px;padding:3px 7px">
      <div class="sub" dir="auto" style="margin-top:2px">${t.renamed ? `On the statement: ${esc(t.original)} · ${state.names[nk]?.by === "ai" ? "translated by the assistant" : "your name"} · <button class="linkish" id="nameReset">Use the original</button>` : "Type a name to show instead. The original stays on file."}</div>`,
      ]);
      el.innerHTML = `<div class="ins-grid"><div><div class="ins-m" dir="auto">${esc(t.merchant)}</div><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>
      <div>${realId ? `<label class="sub" for="noteBox">Note. Any #tag you write here can be caught by a thread.</label><textarea class="note" id="noteBox" dir="auto" placeholder="e.g. #vet  Bella's checkup">${esc(state.notes[realId] || "")}</textarea>` : `<p class="sub">This bead is worked out from other charges, so there's nothing to annotate yet.</p>`}
      ${realId ? actions.tagToolsHTML([realId], "one") : ""}
      <div class="row-actions">${caps.sample ? `<button class="btn small quiet" id="askThese">Ask about this</button>` : ""}${realId ? `<button class="btn small quiet" id="trToggle">${t.transfer ? "Not a transfer" : "This is a transfer between my accounts"}</button>` : ""}</div></div></div>`;
      $("#trToggle")?.addEventListener("click", () =>
        setTransfer(realId, !t.transfer),
      );
      if (realId) actions.wireTagTools(el, () => [realId]);
      el.querySelector("[data-line]")?.addEventListener("click", (e) =>
        actions.selectRuleLine(+e.currentTarget.dataset.line),
      );
      const setName = (v) => {
        v = v.trim();
        if (v && v !== (t.original || t.merchant))
          state.names[nk] = { name: v, by: "you" };
        else delete state.names[nk];
        actions.save("names");
        actions.refreshSoon();
      };
      $("#nameBox")?.addEventListener("input", (e) => setName(e.target.value));
      $("#nameReset")?.addEventListener("click", () => {
        setName("");
        renderInspector();
      });
      if (realId)
        $("#noteBox").addEventListener("input", (e) => {
          const v = e.target.value;
          if (v.trim()) state.notes[realId] = v;
          else delete state.notes[realId];
          actions.save("notes");
          actions.refreshSoon();
        });
    } else {
      const ts = ids.map((id) => runtime.derived.byId.get(id));
      const real = ts.filter((t) => t.kind === "actual");
      const sum = real.reduce((a, t) => a + t.amount, 0);
      const dates = ts.map((t) => t.date).sort();
      const merch = [...new Set(ts.map((t) => t.merchant))];
      el.innerHTML = `<div class="ins-m">${ids.length} beads</div><div class="sub">${fmt(sum)} on statements${ts.length > real.length ? `, plus ${ts.length - real.length} expected` : ""}, ${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}</div>
      <p class="sub" dir="auto" style="margin:6px 0 0">${merch.slice(0, 8).map(esc).join(" · ")}${merch.length > 8 ? ` and ${merch.length - 8} more` : ""}</p>
      <div class="row-actions"><input id="threadName" placeholder="Thread name" aria-label="Thread name" list="threadNames"><datalist id="threadNames">${runtime.derived.R.threads.map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist>
      <button class="btn small" id="makeThread">Thread these</button><button class="btn small quiet" id="makePeriod" title="A period from ${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}">Mark as a period</button>${caps.sample ? `<button class="btn small quiet" id="askThese">Ask about these</button>` : ""}<button class="btn small quiet" id="clearSel">Clear</button></div>
      ${
        real.length
          ? actions.tagToolsHTML(
              real.map((t) => t.id),
              "sel",
            )
          : `<p class="sub">These are all worked-out beads, so there's nothing to tag.</p>`
      }`;
      actions.wireTagTools(el, () => real.map((t) => t.id));
      $("#makeThread").onclick = () => {
        const n = $("#threadName").value.trim();
        if (!n) {
          $("#threadName").focus();
          return;
        }
        addToThread(n, real.length ? real : ts);
      };
      $("#threadName").addEventListener("keydown", (e) => {
        if (e.key === "Enter") $("#makeThread").click();
      });
      $("#makePeriod").onclick = () =>
        actions.addPeriod(dates[0], dates.at(-1));
      $("#clearSel").onclick = () => {
        state.selection.clear();
        actions.refresh();
      };
    }
    $("#askThese")?.addEventListener("click", () => {
      actions.openTab("ask");
      $("#askInput").focus();
    });
  }

  function addToThread(name, ts) {
    const pats = [
      ...new Set(ts.map((t) => normText(t.merchant)).filter(Boolean)),
    ];
    const lines = state.rules.split("\n");
    const idx = lines.findIndex(
      (l) =>
        !/^\s/.test(l) &&
        l.trim() &&
        !l.trim().startsWith("//") &&
        l.trim().replace(/:.*$/, "").toLowerCase() === name.toLowerCase(),
    );
    let at, count;
    if (idx >= 0) {
      let j = idx + 1;
      while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
      lines.splice(j, 0, ...pats.map((p) => "  " + p));
      at = j;
      count = pats.length;
    } else {
      let j = 0;
      while (
        j < lines.length &&
        (!lines[j].trim() || lines[j].trim().startsWith("//"))
      )
        j++;
      lines.splice(j, 0, name, ...pats.map((p) => "  " + p), "");
      at = j;
      count = pats.length + 1;
    }
    state.rules = lines.join("\n");
    state.previewRules = null;
    actions.save("rules");
    state.selection.clear();
    actions.openTab("threads");
    actions.refresh();
    actions.selectRuleLine(at, count);
    const landed = ts
      .map((t) => runtime.derived.byId.get(t.id))
      .filter(Boolean);
    const elsewhere = landed.filter(
      (t) => t.thread.toLowerCase() !== name.toLowerCase(),
    );
    if (elsewhere.length) {
      const who = [...new Set(elsewhere.map((t) => t.thread))].join(", ");
      toast(
        `${landed.length - elsewhere.length} of ${landed.length} are now on “${name}”. The rest are still caught by ${who}, which comes first. Move “${name}” above it to change that.`,
        8000,
      );
    } else
      toast(
        `${landed.length} beads now on “${name}”. The new lines are highlighted in Threads.`,
      );
  }

  return {
    renderInspector,
    wireInspector,
    // The registered render: a refresh, so a field being typed in is kept.
    refreshInspector: () => renderInspector({ fromRefresh: true }),
  };
}

export const contract = {
  name: "inspector",
  create: createInspector,
  provides: ["refreshInspector", "renderInspector", "wireInspector"],
  requires: [
    "addPeriod",
    "highlight",
    "openPeriod",
    "openTab",
    "refresh",
    "refreshSoon",
    "removeBatch",
    "renderPeriodInspector",
    "renderThreadInspector",
    "save",
    "select",
    "selectRuleLine",
    "tagToolsHTML",
    "transferText",
    "wireTagTools",
  ],
  renders: ["refreshInspector"],
  wires: ["wireInspector"],
};
