import { fmtDate } from "../helpers.js";
import {
  compactTxn,
  findTransactions,
  listMerchants,
  totals,
} from "../assistant/tools.js";
import { PALETTE } from "../transactions/constants.js";
import {
  addLens,
  addPeriod,
  addToThread,
  clearBudget,
  editLens,
  editPeriod,
  removeLens,
  removePeriod,
  removeReport,
  renameMerchants,
  runLens,
  setBudget,
  setRules,
  setTransfer,
  tag,
  untag,
  writeNotes,
} from "../model/index.js";

// The assistant's tools for <tx-chat> (components/tx-chat.js). The lookups
// read the derived data; every change is one of the model's commands
// (ADR 0013), committed through actions.commit like the person's own edits,
// so it is saved, logged for Undo and shown at once. change(record, line)
// is the chat's: it commits the record and puts the line in the thread.
//
// Each tool has `doing(input)`, the live line shown while it runs.
export function chatTools(runtime, actions, change) {
  const { state } = runtime;
  const compact = (t) =>
    compactTxn(t, {
      rules: state.previewRules ?? state.rules,
      transferText: actions.transferText,
    });
  const d = () => runtime.derived;
  const n = (k, one, many = one + "s") => `${k} ${k === 1 ? one : many}`;
  const txnsOf = (ids) =>
    []
      .concat(ids || [])
      .map((id) => d().byId.get(id))
      .filter(Boolean);
  const period = (name) => {
    const p = state.periods.find(
      (x) =>
        x.name.toLowerCase() ===
        String(name || "")
          .trim()
          .toLowerCase(),
    );
    if (!p) throw new Error(`There's no period called ${name}.`);
    return p;
  };
  const lens = (id) => {
    const l = state.lenses.find((x) => x.id === id || x.title === id);
    if (!l) throw new Error(`There's no lens ${id}.`);
    return l;
  };
  const days = (p) => `${fmtDate(p.start)} to ${fmtDate(p.end)}`;
  const newId = (prefix) =>
    prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const FILTER_PROPS = {
    period: { type: "string", description: "Name of a period they marked" },
    include_transfers: {
      type: "boolean",
      description: "Include money moved between their own accounts",
    },
    text: {
      type: "string",
      description: "Part of a merchant name or note, in any language",
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
  const obj = (properties, required = []) => ({
    type: "object",
    properties,
    required,
  });
  const strings = { type: "array", items: { type: "string" } };
  const searching = (q) =>
    `Searching ${q.thread ? q.thread : "your statements"}${q.text ? ` for “${q.text}”` : ""}${q.period ? ` in ${q.period}` : ""}…`;

  return [
    {
      name: "find_transactions",
      description:
        "Find transactions matching filters. Returns {count, totals, rows} with rows newest first (at most `limit`, default 60). totals has one sum per currency code, never added together. Each row's amount is in its currency, positive = money out.",
      inputSchema: obj({ ...FILTER_PROPS, limit: { type: "number" } }),
      doing: searching,
      execute: (q) => findTransactions(d(), q, compact),
    },
    {
      name: "totals",
      description:
        "Sum and count transactions grouped by month, thread, merchant, account or statement period, after the same filters. Returns [{key, currency, count, total}], one entry per key and currency (amounts in different currencies are never added), sorted by key for month/period, otherwise by total.",
      inputSchema: obj(
        {
          group_by: {
            type: "string",
            enum: ["month", "thread", "merchant", "account", "period"],
          },
          ...FILTER_PROPS,
        },
        ["group_by"],
      ),
      doing: (q) => `Adding up by ${q.group_by || "month"}…`,
      execute: (q) => totals(d(), q),
    },
    {
      name: "list_merchants",
      description:
        "List every distinct merchant description: {original (exactly as on the statement), name (current display name, same as original unless renamed), currency, count, total}. Use before renaming or translating.",
      doing: () => "Listing the merchants…",
      execute: () => listMerchants(d()),
    },
    {
      name: "tag",
      description:
        "Add #tags to transactions' notes, and optionally remove others. ids from find_transactions. add and remove are tags such as #food. The person sees the change and can undo it.",
      inputSchema: obj({ ids: strings, add: strings, remove: strings }, [
        "ids",
      ]),
      doing: (q) => `Tagging ${n([].concat(q.ids || []).length, "payment")}…`,
      execute: (q) => change(tag(state, q), { ids: q.ids }),
    },
    {
      name: "untag",
      description: "Remove #tags from transactions' notes.",
      inputSchema: obj({ ids: strings, remove: strings }, ["ids", "remove"]),
      doing: (q) =>
        `Removing tags from ${n([].concat(q.ids || []).length, "payment")}…`,
      execute: (q) => change(untag(state, q), { ids: q.ids }),
    },
    {
      name: "update_notes",
      description:
        "Write the person's notes on transactions: translations, #tags, reminders. Each change targets one transaction by id, or every transaction with an exact merchant name via merchant. mode 'append' (default) adds the text on a new line unless it's already there; 'replace' overwrites the note (an empty text clears it). Returns {changed, not_found}.",
      inputSchema: obj(
        {
          changes: {
            type: "array",
            items: obj(
              {
                id: { type: "string" },
                merchant: {
                  type: "string",
                  description: "Exact merchant name as it appears in the data",
                },
                text: { type: "string" },
                mode: { type: "string", enum: ["append", "replace"] },
              },
              ["text"],
            ),
          },
        },
        ["changes"],
      ),
      doing: () => "Writing notes…",
      execute: (q) => {
        const r = writeNotes(state, d(), q);
        change(r, { ids: Object.keys(r?.patches[0].entries || {}) });
        return r?.result ?? { changed: 0 };
      },
    },
    {
      name: "rename_merchants",
      description:
        "Change the display name of merchants, e.g. to translate the description. The original statement text is always kept and shown beside it. Applies to every transaction from that merchant, including later statements. changes: [{merchant (original or current name), name (new display name; empty restores the original)}]. Returns {changed, not_found}.",
      inputSchema: obj(
        {
          changes: {
            type: "array",
            items: obj(
              { merchant: { type: "string" }, name: { type: "string" } },
              ["merchant", "name"],
            ),
          },
        },
        ["changes"],
      ),
      doing: () => "Renaming merchants…",
      execute: (q) => {
        const r = renameMerchants(state, d(), q);
        change(r);
        return r?.result ?? { changed: 0 };
      },
    },
    {
      name: "set_transfer",
      description:
        "Mark a transaction as money moved between their own accounts (on: true), or not (on: false).",
      inputSchema: obj({ id: { type: "string" }, on: { type: "boolean" } }, [
        "id",
        "on",
      ]),
      doing: () => "Marking a transfer…",
      execute: (q) => {
        const t = txnsOf([q.id])[0];
        if (!t) throw new Error("There's no such transaction.");
        return change(setTransfer(state, q), {
          ids: [q.id],
          line: `${q.on ? "Marked" : "Unmarked"} ${t.merchant} on ${fmtDate(t.date)} as a transfer between your accounts`,
        });
      },
    },
    {
      name: "list_periods",
      description:
        "List the periods they've marked: [{name, start, end, story}].",
      doing: () => "Reading your periods…",
      execute: () =>
        state.periods.map(({ name, start, end, story }) => ({
          name,
          start,
          end,
          story: story || "",
        })),
    },
    {
      name: "save_period",
      description:
        "Create a period (a stretch of time such as a trip or a move), or change the one with this name. Dates are YYYY-MM-DD. story is optional first-person context; pass it only when they ask. rename_to renames it. Periods may overlap.",
      inputSchema: obj(
        {
          name: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          story: { type: "string" },
          rename_to: { type: "string" },
        },
        ["name"],
      ),
      doing: (q) => `Marking the period ${q.name}…`,
      execute: (q) => {
        const name = String(q.name || "").trim();
        const old = state.periods.find(
          (x) => x.name.toLowerCase() === name.toLowerCase(),
        );
        if (!old) {
          const id = newId("p");
          const p = () => state.periods.find((x) => x.id === id);
          change(
            addPeriod(state, {
              id,
              name: q.rename_to || name,
              start: q.start,
              end: q.end,
              story: q.story || "",
              color: PALETTE[(state.periods.length + 3) % PALETTE.length],
            }),
            {
              line: () => `Made a period ${p().name}, ${days(p())}`,
              period: id,
            },
          );
          return { saved: { name: p().name, start: p().start, end: p().end } };
        }
        const fields = {};
        for (const k of ["start", "end", "story"])
          if (q[k] !== undefined) fields[k] = q[k];
        if (q.rename_to) fields.name = q.rename_to;
        change(editPeriod(state, { id: old.id, ...fields }), {
          line: `Changed the period ${old.name}`,
          period: old.id,
        });
        const p = state.periods.find((x) => x.id === old.id);
        return { saved: { name: p.name, start: p.start, end: p.end } };
      },
    },
    {
      name: "delete_period",
      description: "Delete a period by name. Its payments stay.",
      inputSchema: obj({ name: { type: "string" } }, ["name"]),
      doing: (q) => `Removing the period ${q.name}…`,
      execute: (q) => change(removePeriod(state, { id: period(q.name).id })),
    },
    {
      name: "get_thread_rules",
      description:
        "Read the person's thread rules text, with each thread's budget line, before changing it with set_thread_rules.",
      doing: () => "Reading your threads…",
      execute: () => state.rules,
    },
    {
      name: "set_thread_rules",
      description:
        "Replace the thread rules with the FULL new text, in their rules language (thread name on its own line, indented patterns; # tags match notes; /regex/; // comments). Use to create, rename, merge or change threads. The person sees the change and can undo it.",
      inputSchema: obj(
        {
          rules: { type: "string" },
          summary: {
            type: "string",
            description: "One plain sentence on what changed",
          },
        },
        ["rules"],
      ),
      doing: () => "Changing your threads…",
      execute: (q) => {
        if (!String(q.rules || "").trim()) throw new Error("rules is empty");
        return change(setRules(state, q), {
          line: q.summary || "Changed your threads",
        });
      },
    },
    {
      name: "add_to_thread",
      description:
        "Put transactions' merchants in a thread (created if it doesn't exist). ids from find_transactions.",
      inputSchema: obj({ name: { type: "string" }, ids: strings }, [
        "name",
        "ids",
      ]),
      doing: (q) => `Adding payments to ${q.name}…`,
      execute: (q) => {
        const txns = txnsOf(q.ids);
        return change(addToThread(state, { name: q.name, txns }), {
          ids: q.ids,
          line: `Put ${n(txns.length, "payment")} in the thread ${q.name}`,
        });
      },
    },
    {
      name: "set_budget",
      description:
        "Set a thread's monthly budget, in the thread's currency. 0 removes it.",
      inputSchema: obj(
        { thread: { type: "string" }, monthly: { type: "number" } },
        ["thread", "monthly"],
      ),
      doing: (q) => `Setting a budget for ${q.thread}…`,
      execute: (q) => {
        const value = Number(q.monthly);
        const r = value
          ? setBudget(state, { thread: q.thread, value })
          : clearBudget(state, { thread: q.thread });
        return change(r, {
          line: value
            ? `Set a budget of ${value} a month for ${q.thread}`
            : `Removed the budget for ${q.thread}`,
        });
      },
    },
    {
      name: "list_lenses",
      description: "List their lenses: [{id, title}].",
      doing: () => "Reading your lenses…",
      execute: () => state.lenses.map(({ id, title }) => ({ id, title })),
    },
    {
      name: "create_lens",
      description:
        "Create a lens, a small saved view of their data that updates with new statements. Describe what it should show in brief; it is written and added to their lenses. Returns its id.",
      inputSchema: obj(
        { title: { type: "string" }, brief: { type: "string" } },
        ["brief"],
      ),
      doing: (q) => `Writing the lens ${q.title || q.brief}…`,
      execute: async (q) => {
        const r = await actions.writeLens(q.brief);
        const id = newId("l");
        change(
          addLens(state, { id, title: q.title || r.title, code: r.code }),
          {
            line: `Made a lens ${q.title || r.title}`,
          },
        );
        return { id, title: state.lenses.find((l) => l.id === id).title };
      },
    },
    {
      name: "edit_lens",
      description:
        "Retitle a lens, or rewrite what it shows from a new brief. id from list_lenses.",
      inputSchema: obj(
        {
          id: { type: "string" },
          title: { type: "string" },
          brief: { type: "string" },
        },
        ["id"],
      ),
      doing: () => "Changing a lens…",
      execute: async (q) => {
        const l = lens(q.id);
        const code = q.brief
          ? (
              await actions.writeLens(q.brief, {
                change: q.brief,
                code: l.code,
              })
            ).code
          : undefined;
        return change(editLens(state, { id: l.id, title: q.title, code }), {
          line: `Changed the lens ${q.title || l.title}`,
        });
      },
    },
    {
      name: "run_lens",
      description: "Run a lens and read what it shows. id from list_lenses.",
      inputSchema: obj({ id: { type: "string" } }, ["id"]),
      doing: (q) => `Running the lens ${lens(q.id).title}…`,
      execute: (q) => runLens(state, d(), { id: lens(q.id).id }, runtime.today),
    },
    {
      name: "delete_lens",
      description: "Delete a lens. id from list_lenses.",
      inputSchema: obj({ id: { type: "string" } }, ["id"]),
      doing: () => "Removing a lens…",
      execute: (q) => change(removeLens(state, { id: lens(q.id).id })),
    },
    {
      name: "list_saved_questions",
      description:
        "List their saved questions (stories they re-run): [{id, question, answered}].",
      doing: () => "Reading your saved questions…",
      execute: () =>
        state.reports.map((r) => ({
          id: r.id,
          question: r.q,
          answered: r.ranAt,
        })),
    },
    {
      name: "save_question",
      description:
        "Save a question so they can run it again as their statements grow, with the answer you gave.",
      inputSchema: obj(
        { question: { type: "string" }, answer: { type: "string" } },
        ["question"],
      ),
      doing: () => "Saving the question…",
      execute: (q) =>
        change(actions.addReport(q.question, q.answer || "", { open: false }), {
          line: `Saved the question “${q.question}”`,
          committed: true,
        }),
    },
    {
      name: "delete_saved_question",
      description: "Delete a saved question. id from list_saved_questions.",
      inputSchema: obj({ id: { type: "string" } }, ["id"]),
      doing: () => "Removing a saved question…",
      execute: (q) => change(removeReport(state, { id: q.id })),
    },
  ];
}
