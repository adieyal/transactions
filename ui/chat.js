import { $, TODAY, esc, fmt, monthOf, normText } from "../helpers.js";
import { PALETTE } from "../transactions/constants.js";

export function createChat(runtime, actions) {
  const { state, caps } = runtime;
  function filterTxns(q = {}) {
    let ts = q.include_expected
      ? [...runtime.derived.allTxns, ...runtime.derived.expected]
      : [...runtime.derived.allTxns];
    if (!q.include_transfers) ts = ts.filter((t) => !t.transfer);
    if (q.period) {
      const pn = String(q.period).toLowerCase();
      ts = ts.filter((t) =>
        (t.periods || []).some((n) => n.toLowerCase().includes(pn)),
      );
    }
    if (q.ids?.length) {
      const s = new Set(q.ids.map(String));
      ts = ts.filter((t) => s.has(t.id));
    }
    if (q.text) {
      const n = normText(q.text),
        l = String(q.text).toLowerCase();
      ts = ts.filter(
        (t) => t.norm.includes(n) || t.raw.toLowerCase().includes(l),
      );
    }
    if (q.thread)
      ts = ts.filter(
        (t) => t.thread.toLowerCase() === String(q.thread).toLowerCase(),
      );
    if (q.account)
      ts = ts.filter((t) =>
        t.account.toLowerCase().includes(String(q.account).toLowerCase()),
      );
    if (q.from) ts = ts.filter((t) => t.date >= q.from);
    if (q.to) ts = ts.filter((t) => t.date <= q.to);
    if (q.min != null) ts = ts.filter((t) => t.amount >= +q.min);
    if (q.max != null) ts = ts.filter((t) => t.amount <= +q.max);
    return ts;
  }

  // everything the inspector shows about a transaction
  const ruleText = (t) =>
    t.matchLine != null
      ? `line ${t.matchLine + 1}: ${(state.previewRules ?? state.rules).split("\n")[t.matchLine].trim()}`
      : undefined;
  const sourceText = (t) =>
    t.derivedFrom
      ? `worked out from the ${t.account} ${t.derivedFrom.period || ""} statement`
      : [t.account, t.period && `${t.period} statement`, t.file]
          .filter(Boolean)
          .join(", ");
  const compact = (t) => ({
    periods: t.periods?.length ? t.periods : undefined,
    transfer: t.transfer ? actions.transferText(t) : undefined,
    transfer_other: t.transfer?.kind === "pair" ? t.transfer.other : undefined,
    id: t.id,
    kind: t.kind === "actual" ? undefined : t.kind,
    date: t.date,
    charge_date:
      t.chargeDate && t.chargeDate !== t.date ? t.chargeDate : undefined,
    merchant: t.merchant,
    original: t.original && t.original !== t.merchant ? t.original : undefined,
    amount: t.amount,
    orig: t.orig ? `${t.orig.currency} ${t.orig.amount}` : undefined,
    type: t.type || undefined,
    details: t.details || undefined,
    thread: t.thread,
    rule: ruleText(t),
    account: t.account,
    source: sourceText(t),
    note: t.note || undefined,
    inst: t.inst ? `${t.inst.n}/${t.inst.of}` : undefined,
    expected: t.kind === "ghost" || undefined,
    why: t.why || undefined,
  });

  const FILTER_PROPS = {
    period: { type: "string", description: "Name of a period they marked" },
    include_transfers: {
      type: "boolean",
      description: "Include money moved between their own accounts",
    },
    text: {
      type: "string",
      description: "Part of a merchant name or note (Hebrew or English)",
    },
    thread: { type: "string" },
    account: { type: "string" },
    from: { type: "string", description: "YYYY-MM-DD" },
    to: { type: "string", description: "YYYY-MM-DD" },
    min: { type: "number" },
    max: { type: "number" },
    ids: { type: "array", items: { type: "string" } },
    include_expected: {
      type: "boolean",
      description: "Also include projected future charges",
    },
  };

  function applyNoteChanges(changes, reply) {
    const list = Array.isArray(changes) ? changes.slice(0, 600) : [];
    if (!list.length) throw new Error("changes must be a non-empty list");
    reply.undo ||= {};
    let changed = 0,
      missing = [];
    for (const c of list) {
      const text = String(c?.text ?? "").trim();
      const mode = c?.mode === "replace" ? "replace" : "append";
      let ids = [];
      if (c?.id)
        ids = runtime.derived.allTxns.some((t) => t.id === String(c.id))
          ? [String(c.id)]
          : [];
      else if (c?.merchant) {
        const m = String(c.merchant).trim();
        ids = runtime.derived.allTxns
          .filter((t) => t.merchant === m || t.original === m)
          .map((t) => t.id);
        if (!ids.length) {
          const n = normText(m);
          ids = runtime.derived.allTxns
            .filter((t) => normText(t.merchant) === n)
            .map((t) => t.id);
        }
      }
      if (!ids.length) {
        missing.push(c?.id || c?.merchant || "?");
        continue;
      }
      for (const id of ids) {
        const before = state.notes[id] || "";
        let after;
        if (mode === "replace") after = text;
        else
          after =
            !text || before.includes(text)
              ? before
              : before
                ? before + "\n" + text
                : text;
        if (after === before) continue;
        if (!(id in reply.undo)) reply.undo[id] = before;
        if (after) state.notes[id] = after;
        else delete state.notes[id];
        changed++;
      }
    }
    if (changed) {
      actions.saveSoon("notes", () => ({ map: state.notes }), 300);
      actions.refreshSoon();
    }
    reply.changedCount = Object.keys(reply.undo).length;
    return { changed, not_found: missing.slice(0, 20) };
  }

  function applyNameChanges(changes, reply) {
    const list = Array.isArray(changes) ? changes.slice(0, 600) : [];
    if (!list.length) throw new Error("changes must be a non-empty list");
    reply.undoNames ||= {};
    let changed = 0;
    const missing = [];
    for (const c of list) {
      const m = String(c?.merchant ?? "").trim();
      const name = String(c?.name ?? "").trim();
      if (!m) continue;
      const n = normText(m);
      const keys = [
        ...new Set(
          runtime.derived.allTxns
            .filter(
              (t) =>
                t.original === m ||
                t.merchant === m ||
                t.nameKey === n ||
                normText(t.merchant) === n,
            )
            .map((t) => t.nameKey),
        ),
      ];
      if (!keys.length) {
        missing.push(m);
        continue;
      }
      for (const k of keys) {
        const before = state.names[k] || null;
        const orig = runtime.derived.allTxns.find(
          (t) => t.nameKey === k,
        )?.original;
        const after = name && name !== orig ? { name, by: "ai" } : null;
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        if (!(k in reply.undoNames)) reply.undoNames[k] = before;
        if (after) state.names[k] = after;
        else delete state.names[k];
        changed++;
      }
    }
    if (changed) {
      actions.saveSoon("names", () => ({ map: state.names }), 300);
      actions.refreshSoon();
    }
    reply.renamedCount = Object.keys(reply.undoNames).length;
    return { changed, not_found: missing.slice(0, 20) };
  }

  const WRITE_TOOLS = [
    {
      name: "list_merchants",
      description:
        "List every distinct merchant description: {original (exactly as on the statement), name (current display name, same as original unless renamed), count, total}. Use before renaming or translating.",
      execute: () => {
        const g = {};
        for (const t of runtime.derived.allTxns) {
          g[t.nameKey] ||= {
            original: t.original,
            name: t.merchant,
            count: 0,
            total: 0,
          };
          g[t.nameKey].count++;
          g[t.nameKey].total += t.amount;
        }
        return Object.values(g)
          .sort((a, b) => b.total - a.total)
          .slice(0, 400)
          .map((x) => ({ ...x, total: +x.total.toFixed(2) }));
      },
    },
    {
      name: "rename_merchants",
      description:
        "Change the display name of merchants, e.g. to translate the description. The original statement text is always kept and still shown beside it. Applies to every transaction from that merchant, including ones in statements added later. changes: [{merchant (original or current name), name (new display name; empty string restores the original)}]. Returns {changed, not_found}. The person can undo.",
      inputSchema: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                merchant: { type: "string" },
                name: { type: "string" },
              },
              required: ["merchant", "name"],
            },
          },
        },
        required: ["changes"],
      },
      execute: (q, reply) => applyNameChanges(q.changes, reply),
    },
    {
      name: "update_notes",
      description:
        "Write the person's notes on transactions: translations, #tags, reminders. Only use when they ask you to add or change notes. Each change targets one transaction by id, or every transaction with an exact merchant name via merchant. mode 'append' (default) adds the text on a new line unless it's already there; 'replace' overwrites the note. Returns {changed, not_found}. The person can undo.",
      inputSchema: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                merchant: {
                  type: "string",
                  description: "Exact merchant name as it appears in the data",
                },
                text: { type: "string" },
                mode: { type: "string", enum: ["append", "replace"] },
              },
              required: ["text"],
            },
          },
        },
        required: ["changes"],
      },
      execute: (q, reply) => applyNoteChanges(q.changes, reply),
    },
    {
      name: "propose_threads",
      description:
        "Show the person a new version of their thread rules as a preview on the timeline; they choose to keep or discard it. Pass the FULL rules text in their rules language (thread name on its own line, indented patterns; # tags match notes; /regex/; // comments). Use when they ask to create, rename, merge or change threads.",
      inputSchema: {
        type: "object",
        properties: {
          rules: { type: "string" },
          summary: {
            type: "string",
            description: "One sentence on what changed",
          },
        },
        required: ["rules"],
      },
      execute: (q, reply) => {
        const r = String(q.rules || "").replace(/\r/g, "");
        if (!r.trim()) throw new Error("rules is empty");
        state.previewRules = r;
        state.previewSummary = String(q.summary || "");
        reply.proposed = true;
        actions.refresh();
        return "Shown as a preview. The person will keep or discard it in the Threads panel.";
      },
    },
    {
      name: "list_periods",
      description:
        "List the periods they've marked: [{name, start, end, story}].",
      execute: () =>
        state.periods.map((p) => ({
          name: p.name,
          start: p.start,
          end: p.end,
          story: p.story || "",
        })),
    },
    {
      name: "save_period",
      description:
        "Create a period (a stretch of time such as a trip or a move), or update one with the same name. Dates are YYYY-MM-DD. story is optional first-person context; pass it only when they ask you to write or change it. Periods may overlap.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          story: { type: "string" },
          rename_to: { type: "string" },
        },
        required: ["name"],
      },
      execute: (q, reply) => {
        const name = String(q.name || "").trim();
        if (!name) throw new Error("name is required");
        const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
        let p = state.periods.find(
          (x) => x.name.toLowerCase() === name.toLowerCase(),
        );
        if (!p) {
          if (!valid(q.start) || !valid(q.end))
            throw new Error(
              "start and end (YYYY-MM-DD) are required for a new period",
            );
          p = {
            id:
              "p" +
              Date.now().toString(36) +
              Math.random().toString(36).slice(2, 5),
            name,
            start: q.start,
            end: q.end,
            story: "",
            color: PALETTE[(state.periods.length + 3) % PALETTE.length],
          };
          state.periods.push(p);
        }
        if (valid(q.start)) p.start = q.start;
        if (valid(q.end)) p.end = q.end;
        if (p.end < p.start) [p.start, p.end] = [p.end, p.start];
        if (typeof q.story === "string") p.story = q.story;
        if (q.rename_to) p.name = String(q.rename_to);
        reply.periods = [...new Set([...(reply.periods || []), p.id])];
        actions.savePeriods();
        actions.refreshSoon();
        return { saved: { name: p.name, start: p.start, end: p.end } };
      },
    },
    {
      name: "get_thread_rules",
      description:
        "Read the person's current thread rules text (to edit it with propose_threads).",
      execute: () => state.rules,
    },
  ];

  const ASK_TOOLS = [
    {
      name: "find_transactions",
      description:
        "Find transactions matching filters. Returns {count, total, rows} with rows newest first (at most `limit`, default 60). Amounts in ILS, positive = money out.",
      inputSchema: {
        type: "object",
        properties: { ...FILTER_PROPS, limit: { type: "number" } },
      },
      execute(q) {
        const ts = filterTxns(q).sort((a, b) => (a.date < b.date ? 1 : -1));
        const lim = Math.min(200, Math.max(1, +q.limit || 60));
        return {
          count: ts.length,
          total: +ts.reduce((a, t) => a + t.amount, 0).toFixed(2),
          rows: ts.slice(0, lim).map(compact),
        };
      },
    },
    {
      name: "totals",
      description:
        "Sum and count transactions grouped by month, thread, merchant, account or statement period, after the same filters. Returns [{key, count, total}] sorted by key for month/period, otherwise by total.",
      inputSchema: {
        type: "object",
        properties: {
          group_by: {
            type: "string",
            enum: ["month", "thread", "merchant", "account", "period"],
          },
          ...FILTER_PROPS,
        },
        required: ["group_by"],
      },
      execute(q) {
        const f =
          {
            month: (t) => monthOf(t.date),
            thread: (t) => t.thread,
            merchant: (t) => t.merchant,
            account: (t) => t.account,
            period: (t) => t.period,
          }[q.group_by] || ((t) => t.thread);
        const g = {};
        for (const t of filterTxns(q)) {
          const k = f(t);
          g[k] ||= { key: k, count: 0, total: 0 };
          g[k].count++;
          g[k].total += t.amount;
        }
        const out = Object.values(g).map((x) => ({
          ...x,
          total: +x.total.toFixed(2),
        }));
        return /month|period/.test(q.group_by)
          ? out.sort((a, b) => (a.key < b.key ? -1 : 1))
          : out.sort((a, b) => b.total - a.total);
      },
    },
  ];

  let askCtl = null;

  function renderAskCtx() {
    const n = [...state.selection].filter((id) =>
      runtime.derived?.byId.has(id),
    ).length;
    $("#askctx").innerHTML = n
      ? `About the ${n} selected bead${n > 1 ? "s" : ""} <button class="linkish" id="ctxClear">(ask about everything instead)</button>`
      : "";
    $("#ctxClear")?.addEventListener("click", () => {
      state.selection.clear();
      actions.refresh();
    });
  }

  function md(text) {
    const withCites = esc(text)
      .replace(/\[\[([a-z0-9\-]+)\]\]/gi, (_, id) => {
        const t = runtime.derived.byId.get(id);
        return t
          ? `<button class="cite" data-cite="${id}" title="${esc(t.merchant)}"><span dir="auto">${esc(t.merchant.slice(0, 22))}</span> ${fmt(t.amount, 0)}</button>`
          : "";
      })
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const blocks = withCites.split(/\n{2,}/);
    return blocks
      .map((b) => {
        const ls = b.split("\n");
        if (ls.every((l) => /^\s*[-*•] /.test(l)))
          return `<ul>${ls.map((l) => `<li>${l.replace(/^\s*[-*•] /, "")}</li>`).join("")}</ul>`;
        return `<p>${ls.join("<br>")}</p>`;
      })
      .join("");
  }

  function renderAskMem() {
    const n = state.turns.filter((t) => !t.pending).length;
    $("#askmem").innerHTML = n
      ? `${actions.AI()} sees the last ${Math.min(n, 16)} messages below with each new question. <button class="linkish" id="newChat">Start a new conversation</button>`
      : "";
    $("#newChat")?.addEventListener("click", () => {
      state.turns = [];
      actions.saveChat();
      renderLog();
    });
  }

  function renderLog() {
    renderAskMem();
    const log = $("#log");
    if (!state.turns.length) {
      const sug = runtime.derived?.allTxns?.length
        ? [
            "What's quietly costing me every month?",
            "What did the animals cost me this year?",
            "Which charges look unusual compared to the rest?",
            "What's already committed for the next three months?",
            "Translate all the merchant names into English",
          ]
        : [];
      log.innerHTML = `<p class="sub" style="margin:0 0 8px">${actions.AI()} can look things up across all your statements and points at the beads it's talking about.</p><div class="suggestions">${sug.map((s) => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join("")}</div>`;
      return;
    }
    log.innerHTML = state.turns
      .map((t, i) =>
        t.role === "user"
          ? `<div class="q" dir="auto">${esc(t.shown || t.content)}</div>`
          : `<div class="a" dir="auto">${t.pending && !t.content ? `<p class="thinking">${esc(t.status || "Thinking…")}</p>` : md(t.content)}${t.error ? `<p class="sub">${esc(t.error)}</p>` : ""}${!t.pending && t.changedCount ? `<p class="sub" style="margin:4px 0">${t.undone ? `Undone: notes on ${t.changedCount} transaction${t.changedCount > 1 ? "s are" : " is"} back as they were.` : `Changed notes on ${t.changedCount} transaction${t.changedCount > 1 ? "s" : ""}. <button class="linkish" data-undo="${i}">Undo</button> · <button class="linkish" data-shownoted="${i}">Show them</button>`}</p>` : ""}${!t.pending && t.renamedCount ? `<p class="sub" style="margin:4px 0">${t.namesUndone ? `Undone: ${t.renamedCount} merchant name${t.renamedCount > 1 ? "s are" : " is"} back as before.` : `Renamed ${t.renamedCount} merchant${t.renamedCount > 1 ? "s" : ""}. The originals are kept. <button class="linkish" data-undonames="${i}">Undo</button>`}</p>` : ""}${!t.pending && t.proposed ? `<p class="sub" style="margin:4px 0"><button class="linkish" data-review>Review the suggested threads</button></p>` : ""}${
              !t.pending && t.periods?.length
                ? `<p class="sub" style="margin:4px 0">${t.periods
                    .map((id) => {
                      const p = state.periods.find((x) => x.id === id);
                      return p
                        ? `<button class="linkish" data-openperiod="${id}">Open “${esc(p.name)}”</button>`
                        : "";
                    })
                    .join(" · ")}</p>`
                : ""
            }${!t.pending && t.content && t.q ? `<div class="a-actions"><button class="linkish" data-lensfrom="${i}">Turn this into a lens</button><button class="linkish" data-savereport="${i}">Save as a report</button></div>` : ""}</div>`,
      )
      .join("");
    log.scrollTop = log.scrollHeight;
  }

  function buildIntro(write = true) {
    const pers = state.periods
      .slice()
      .sort((a, b) => (a.start < b.start ? -1 : 1));
    const budgets = runtime.derived.R.threads
      .filter((t) => t.budget != null)
      .map((t) => `${t.name} ₪${t.budget}/month`);
    let intro = `You're the question-answering part of Transactions, a personal tool one person uses to explore their own card and bank statements. Today is ${TODAY}.
Money is in ILS (₪). A positive amount is money out; negative is a refund or money in. "Threads" are the person's own groupings, from rules they edit: ${runtime.derived.names.join(", ")}. Accounts and the statement months present: ${actions.coverageText()}. Any other months are missing, so say so when an answer depends on them.
Transfers between their own accounts (such as the bank paying the card bill) are not spending: the tools leave them out unless you pass include_transfers.
Transaction fields: date is when it was bought and charge_date when it was billed, if different; amount is in ILS and orig is the amount in the currency it was charged in; type and details are copied from the statement; rule is the line of their thread rules that put it in its thread; source is the account, statement month and file it came from; kind is set for things worked out rather than read from a statement, with why explaining it.
${budgets.length ? `Monthly budgets they've set: ${budgets.join(", ")}.\n` : ""}${pers.length ? `Periods they've marked as context for what was going on (they can overlap, and not every charge in the dates belongs):\n${pers.map((p) => `- "${p.name}" ${p.start} to ${p.end}${p.story ? `: ${p.story.replace(/\s+/g, " ").slice(0, 300)}` : ""}`).join("\n")}\n` : ""}Answer briefly (a few sentences or a short list) in the language the person writes in. Don't guess figures. When you refer to specific transactions, cite them inline as [[id]] using ids from the data (at most 8 citations; no other link syntax).`;
    if (caps.tools) {
      intro += `\nUse the tools to look things up.`;
      if (write)
        intro += ` When the person asks to translate or rename descriptions, use list_merchants then rename_merchants (short, natural names like "Israel Electric Corp", "Shufersal Deal, Yakhin"; keep brand names; the original is kept automatically). When they ask to annotate or tag transactions, write it into their notes with update_notes (prefer the merchant form for anything that applies to every visit to a merchant). When they ask to change threads, read them with get_thread_rules and show a new version with propose_threads. When they describe a stretch of time (a trip, a move, a busy season), create or update it with save_period, and you can write its story. Only change things they asked for, then say briefly what you changed.`;
      else
        intro += ` In this mode you only read; don't try to change anything.`;
    } else
      intro +=
        `\nAll transactions, one JSON object per line:\n` +
        runtime.derived.allTxns
          .slice(0, 1800)
          .map((t) => JSON.stringify(compact(t)))
          .join("\n") +
        `\nExpected future charges:\n` +
        runtime.derived.expected
          .map((t) => JSON.stringify(compact(t)))
          .join("\n") +
        `\nYou can't change anything in this setup, only read. If they ask for changes, say so and suggest picking an assistant that supports tools.`;
    return intro;
  }

  async function callAssistant(
    messages,
    reply,
    { write = true, onText, signal } = {},
  ) {
    const opts = {
      signal,
      onText: ({ text }) => {
        reply.content = text;
        onText?.(text);
      },
    };
    if (caps.tools) {
      const tools = write ? [...ASK_TOOLS, ...WRITE_TOOLS] : ASK_TOOLS;
      opts.tools = tools.map((t) => ({
        ...t,
        execute: (inp) => {
          reply.status = WRITE_TOOLS.includes(t)
            ? "Making the changes…"
            : "Looking through your statements…";
          onText?.(reply.content);
          return t.execute(inp || {}, reply);
        },
      }));
    } else opts.cache = false;
    const r = await caps.sample(messages, opts);
    return r.text.replace(/^\s+/, "");
  }

  async function ask(question) {
    if (!caps.sample || !question.trim()) return;
    const sel = [...state.selection].filter((id) =>
      runtime.derived.byId.has(id),
    );
    const shown = question.trim();
    const content =
      shown +
      (sel.length
        ? `\n\n(They've selected these on the timeline: ${sel
            .slice(0, 60)
            .map((id) => `[[${id}]]`)
            .join(" ")} — ids you can pass to find_transactions.)`
        : "");
    state.turns.push({ role: "user", content, shown });
    const reply = { role: "assistant", content: "", pending: true, q: shown };
    state.turns.push(reply);
    renderLog();
    const turns = state.turns
      .filter((t) => t !== reply && !t.pending)
      .slice(-16)
      .map((t) => ({ role: t.role, content: t.content || "(no answer)" }));
    while (turns.length && turns[0].role !== "user") turns.shift();
    askCtl = new AbortController();
    $("#stopBtn").hidden = false;
    $("#sendBtn").disabled = true;
    try {
      reply.content = await callAssistant(
        [{ role: "user", content: buildIntro(true) }, ...turns],
        reply,
        { write: true, signal: askCtl.signal, onText: () => renderLog() },
      );
      const cited = [...reply.content.matchAll(/\[\[([a-z0-9\-]+)\]\]/gi)]
        .map((m) => m[1])
        .filter((id) => runtime.derived.byId.has(id));
      if (cited.length) {
        state.highlight = new Set(cited);
        actions.renderTimeline();
      }
    } catch (e) {
      reply.content = e.text || "";
      if (e.code !== "cancelled") reply.error = actions.sampleErr(e);
    }
    reply.pending = false;
    $("#stopBtn").hidden = true;
    $("#sendBtn").disabled = false;
    renderLog();
    actions.saveChat();
  }

  function wireAsk() {
    $("#sendBtn").onclick = () => {
      const v = $("#askInput").value;
      $("#askInput").value = "";
      ask(v);
    };
    $("#askInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#sendBtn").click();
      }
    });
    $("#stopBtn").onclick = () => askCtl?.abort();
    $("#log").addEventListener("click", async (e) => {
      const s = e.target.closest("[data-sug]");
      if (s) {
        ask(s.dataset.sug);
        return;
      }
      const unn = e.target.closest("[data-undonames]");
      if (unn) {
        const t = state.turns[+unn.dataset.undonames];
        for (const [k, before] of Object.entries(t.undoNames || {})) {
          if (state.names[k] && state.names[k].by !== "ai") continue;
          if (before) state.names[k] = before;
          else delete state.names[k];
        }
        t.namesUndone = true;
        actions.saveSoon("names", () => ({ map: state.names }), 200);
        actions.saveChat();
        actions.refresh();
        renderLog();
        return;
      }
      const un = e.target.closest("[data-undo]");
      if (un) {
        const t = state.turns[+un.dataset.undo];
        for (const [id, before] of Object.entries(t.undo || {})) {
          if (before) state.notes[id] = before;
          else delete state.notes[id];
        }
        t.undone = true;
        actions.saveSoon("notes", () => ({ map: state.notes }), 200);
        actions.saveChat();
        actions.refresh();
        renderLog();
        return;
      }
      const sn = e.target.closest("[data-shownoted]");
      if (sn) {
        const t = state.turns[+sn.dataset.shownoted];
        state.highlight = new Set(Object.keys(t.undo || {}));
        state.selection.clear();
        actions.renderTimeline();
        $("#tlwrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      if (e.target.closest("[data-review]")) {
        actions.openTab("threads");
        return;
      }
      const op = e.target.closest("[data-openperiod]");
      if (op) {
        state.periodSel = op.dataset.openperiod;
        state.selection.clear();
        state.statement = null;
        actions.refresh();
        $("#insp").scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const sr = e.target.closest("[data-savereport]");
      if (sr) {
        const t = state.turns[+sr.dataset.savereport];
        actions.addReport(t.q, t.content);
        return;
      }
      const c = e.target.closest("[data-cite]");
      if (c) {
        state.selection = new Set([c.dataset.cite]);
        state.highlight = new Set([c.dataset.cite]);
        actions.refresh();
        $("#tlwrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const l = e.target.closest("[data-lensfrom]");
      if (l) {
        const turn = state.turns[+l.dataset.lensfrom];
        l.textContent = actions.AI() + " is writing the lens…";
        l.disabled = true;
        try {
          const r = await actions.writeLens(turn.q, {
            context: `Question: ${turn.q}\nAnswer: ${turn.content}`,
          });
          state.lenses.push({
            id: "l" + Date.now().toString(36),
            title: r.title || turn.q.slice(0, 40),
            code: r.code,
          });
          actions.saveLenses();
          actions.renderLenses();
          l.textContent = "Added to Lenses";
          $("#lenses").lastElementChild?.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
        } catch (err) {
          l.textContent = actions.sampleErr(err);
        }
      }
    });
  }

  return { buildIntro, callAssistant, md, renderAskCtx, renderLog, wireAsk };
}
