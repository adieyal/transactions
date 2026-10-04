import { esc, fmt } from "../helpers.js";
import { $, html, paneShown } from "./dom.js";
import { PALETTE } from "../transactions/constants.js";
import {
  compactTxn,
  findTransactions,
  listMerchants,
  nameChanges,
  noteChanges,
  totals,
} from "../assistant/tools.js";
import { systemPrompt } from "../assistant/prompts.js";
import { markdown } from "./markdown.js";

export function createChat(runtime, actions) {
  const { state, caps } = runtime;
  // everything the inspector shows about a transaction
  const compact = (t) =>
    compactTxn(t, {
      rules: state.previewRules ?? state.rules,
      transferText: actions.transferText,
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

  // The tools compute the changes; here they are applied and saved, and the
  // reply keeps what undoing them needs.
  function applyNoteChanges(changes, reply) {
    const { notes, undo, result } = noteChanges(
      runtime.derived,
      state.notes,
      changes,
      reply.undo,
    );
    reply.undo = undo;
    if (result.changed) {
      state.notes = notes;
      actions.save("notes");
      actions.refreshSoon();
    }
    reply.changedCount = Object.keys(reply.undo).length;
    return result;
  }

  function applyNameChanges(changes, reply) {
    const { names, undo, result } = nameChanges(
      runtime.derived,
      state.names,
      changes,
      reply.undoNames,
    );
    reply.undoNames = undo;
    if (result.changed) {
      state.names = names;
      actions.save("names");
      actions.refreshSoon();
    }
    reply.renamedCount = Object.keys(reply.undoNames).length;
    return result;
  }

  const WRITE_TOOLS = [
    {
      name: "list_merchants",
      description:
        "List every distinct merchant description: {original (exactly as on the statement), name (current display name, same as original unless renamed), count, total}. Use before renaming or translating.",
      execute: () => listMerchants(runtime.derived),
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
        actions.save("periods");
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
      execute: (q) => findTransactions(runtime.derived, q, compact),
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
      execute: (q) => totals(runtime.derived, q),
    },
  ];

  let askCtl = null;

  function renderAskCtx() {
    if (!paneShown("ask")) return;
    const n = [...state.selection].filter((id) =>
      runtime.derived?.byId.has(id),
    ).length;
    $("#askctx").innerHTML = n
      ? html`About the ${n} selected bead${n > 1 ? "s" : ""} <button class="linkish" id="ctxClear">(ask about everything instead)</button>`
      : "";
  }

  const md = (text) => markdown(text, runtime.derived.byId);

  function renderAskMem() {
    const n = state.turns.filter((t) => !t.pending).length;
    $("#askmem").innerHTML = n
      ? html`${actions.AI()} sees the last ${Math.min(n, 16)} messages below with each new question. <button class="linkish" id="newChat">Start a new conversation</button>`
      : "";
  }

  function renderLog() {
    if (!paneShown("ask")) return;
    renderAskMem();
    const log = $("#log");
    $("#askoff").innerHTML = caps.sample
      ? ""
      : actions.noAssistant("Ask needs an assistant.");
    $("#askbox").hidden = !caps.sample;
    if (!state.turns.length && !caps.sample) {
      log.innerHTML = "";
      return;
    }
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
      log.innerHTML = html`<p class="sub" style="margin:0 0 8px">${actions.AI()} can look things up across all your statements and points at the beads it's talking about.</p><div class="suggestions">${sug.map((s) => html`<button data-sug="${s}">${s}</button>`)}</div>`;
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
                        ? `<button class="linkish" data-openperiod="${id}">Open “<bdi>${esc(p.name)}</bdi>”</button>`
                        : "";
                    })
                    .join(" · ")}</p>`
                : ""
            }${!t.pending && t.content && t.q ? `<div class="a-actions"><button class="linkish" data-lensfrom="${i}">Turn this into a lens</button><button class="linkish" data-savereport="${i}">Save as a report</button></div>` : ""}</div>`,
      )
      .join("");
    log.scrollTop = log.scrollHeight;
  }

  // The opening message, from assistant/prompts.js; write: false for reports.
  const buildIntro = (write = true) =>
    systemPrompt({
      derived: runtime.derived,
      state,
      today: runtime.today,
      tools: caps.tools,
      write,
      compact,
    });

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
        actions.highlight(cited);
      }
    } catch (e) {
      reply.content = e.text || "";
      if (e.code !== "cancelled") reply.error = actions.sampleErr(e);
    }
    reply.pending = false;
    $("#stopBtn").hidden = true;
    $("#sendBtn").disabled = false;
    renderLog();
    actions.save("chat");
  }

  function wireAsk() {
    // The context and memory lines are redrawn often; their buttons are
    // handled here, once, for the whole pane.
    $("#pane-ask").addEventListener("click", (e) => {
      if (e.target.closest("#ctxClear")) {
        state.selection.clear();
        actions.refresh();
      } else if (e.target.closest("#newChat")) {
        state.turns = [];
        actions.save("chat");
        renderLog();
      }
    });
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
        actions.save("names");
        actions.save("chat");
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
        actions.save("notes");
        actions.save("chat");
        actions.refresh();
        renderLog();
        return;
      }
      const sn = e.target.closest("[data-shownoted]");
      if (sn) {
        const t = state.turns[+sn.dataset.shownoted];
        actions.highlight(Object.keys(t.undo || {}), { clearSelection: true });
        $("#tlwrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      if (e.target.closest("[data-review]")) {
        actions.openTab("threads");
        return;
      }
      const op = e.target.closest("[data-openperiod]");
      if (op) {
        actions.openPeriod(op.dataset.openperiod);
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
        actions.select([c.dataset.cite]);
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
          actions.save("lenses");
          actions.redraw();
          l.textContent = "Added to Lenses";
          actions.openTab("lenses");
          $("#lenses .lens:last-of-type")?.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
        } catch (err) {
          l.textContent = actions.sampleErr(err);
        }
      }
    });
  }

  return {
    buildIntro,
    callAssistant,
    renderAskCtx,
    renderLog,
    wireAsk,
  };
}

export const contract = {
  name: "chat",
  create: createChat,
  provides: [
    "buildIntro",
    "callAssistant",
    "renderAskCtx",
    "renderLog",
    "wireAsk",
  ],
  requires: [
    "AI",
    "addReport",
    "highlight",
    "noAssistant",
    "openPeriod",
    "openTab",
    "redraw",
    "refresh",
    "refreshSoon",
    "sampleErr",
    "save",
    "select",
    "transferText",
    "writeLens",
  ],
  renders: ["renderAskCtx", "renderLog"],
  wires: ["wireAsk"],
};
