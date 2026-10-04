import { esc } from "../helpers.js";
import { html } from "../ui/dom.js";
import { compactTxn } from "../assistant/tools.js";
import { systemPrompt } from "../assistant/prompts.js";
import { stripThinking } from "../assistant/reply.js";
import { markdown } from "../ui/markdown.js";
import { addLens } from "../model/index.js";
import { chatTools } from "./chat-tools.js";
import { subscribeWhileConnected } from "./base.js";

// <tx-chat>: the one conversation with the assistant (ASSISTANT-BRIEF,
// moved from ui/chat.js). Every view embeds the same element: the year's Ask
// section, the one-month view and the panel's Ask tab. They share one thread
// (state.turns), and only one question runs at a time.
//
// The assistant's tools are the model's commands (chat-tools.js), so it can
// do what the person can. Each change it makes shows in the thread as a
// plain line with Undo through the one undo log, and lights its payments.
// Nothing is sent until the person presses Ask.
const READ_TOOLS = new Set([
  "find_transactions",
  "totals",
  "list_merchants",
  "list_periods",
  "get_thread_rules",
  "list_lenses",
  "run_lens",
  "list_saved_questions",
]);

const SUGGESTIONS = [
  "What's quietly costing me every month?",
  "What did the animals cost me this year?",
  "Which charges look unusual compared to the rest?",
  "What's already committed for the next three months?",
  "Translate all the merchant names into English",
];

export function createChatComponent(runtime, actions) {
  const { state, caps } = runtime;
  const live = new Set();
  // This session's change records, by the key of their line in the thread.
  // After a reload the lines stay, without Undo.
  const records = new Map();
  let askCtl = null;
  let current = null;
  let asker = null;
  let seq = 0;

  const compact = (t) =>
    compactTxn(t, {
      rules: state.previewRules ?? state.rules,
      transferText: actions.transferText,
    });

  // Commits a model command's record from a tool and puts its line in the
  // reply. Returns what the assistant is told.
  // committed: the record was committed already (ui/reports.js addReport).
  function change(rec, { ids = [], line, period = null, committed } = {}) {
    if (!rec) return { changed: 0 };
    if (!committed) actions.commit(rec, { refresh: "soon" });
    const key = `c${Date.now().toString(36)}${seq++}`;
    records.set(key, rec);
    const text =
      (typeof line === "function" ? line() : line) ||
      (rec.summary || rec.command).replace(/\.$/, "");
    const lit = (ids.length ? ids : changedIds(rec)).filter((id) =>
      runtime.derived.byId.has(id),
    );
    current?.changes.push({ key, text, ids: lit, period, undone: false });
    if (lit.length) actions.highlight(lit);
    show();
    return { done: text };
  }
  const changedIds = (rec) =>
    rec.patches.flatMap((p) =>
      p.field === "notes" || p.field === "transferOv"
        ? Object.keys(p.entries)
        : [],
    );

  const tools = chatTools(runtime, actions, change);

  // The opening message, from assistant/prompts.js; write: false for saved
  // questions run again (ui/reports.js), which change nothing.
  const buildIntro = (write = true) =>
    systemPrompt({
      derived: runtime.derived,
      state,
      today: runtime.today,
      tools: caps.tools,
      write,
      compact,
    });

  // The one path a reply takes: each tool call gets a live line in
  // reply.steps, and the text is cleaned of reasoning (assistant/reply.js).
  async function callAssistant(
    messages,
    reply,
    { write = true, onText, signal } = {},
  ) {
    const opts = {
      signal,
      onText: ({ text }) => {
        reply.content = stripThinking(text);
        onText?.(reply.content);
      },
    };
    if (caps.tools) {
      const use = write ? tools : tools.filter((t) => READ_TOOLS.has(t.name));
      opts.tools = use.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (inp) => {
          const q = inp || {};
          let doing = "";
          try {
            doing = t.doing?.(q) || "";
          } catch {}
          const step = { text: doing || "Looking through your statements…" };
          (reply.steps ||= []).push(step);
          onText?.(reply.content);
          try {
            return await t.execute(q);
          } catch (e) {
            step.failed = true;
            throw e;
          } finally {
            step.done = true;
            onText?.(reply.content);
          }
        },
      }));
    } else opts.cache = false;
    const r = await caps.sample(messages, opts);
    return stripThinking(r.text);
  }

  async function ask(question, from) {
    if (!caps.sample || !question.trim() || askCtl) return;
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
    const reply = {
      role: "assistant",
      content: "",
      pending: true,
      q: shown,
      steps: [],
      changes: [],
    };
    state.turns.push(reply);
    const turns = state.turns
      .filter((t) => t !== reply && !t.pending)
      .slice(-16)
      .map((t) => ({ role: t.role, content: t.content || "(no answer)" }));
    while (turns.length && turns[0].role !== "user") turns.shift();
    askCtl = new AbortController();
    current = reply;
    asker = from;
    show();
    try {
      reply.content = await callAssistant(
        [{ role: "user", content: buildIntro() }, ...turns],
        reply,
        { signal: askCtl.signal, onText: () => show() },
      );
      const cited = [...reply.content.matchAll(/\[\[([a-z0-9\-]+)\]\]/gi)]
        .map((m) => m[1])
        .filter((id) => runtime.derived.byId.has(id));
      // What it changed stays lit beside what it cites.
      const lit = [
        ...new Set([...cited, ...reply.changes.flatMap((c) => c.ids)]),
      ];
      if (lit.length) actions.highlight(lit);
    } catch (e) {
      reply.content = stripThinking(e.text);
      reply.error = e.code === "cancelled" ? "Stopped." : actions.sampleErr(e);
    }
    reply.pending = false;
    askCtl = null;
    current = null;
    show();
    actions.save("chat");
  }

  function undoLine(t, key) {
    const line = t.changes?.find((c) => c.key === key);
    const rec = records.get(key);
    if (!line || !rec || line.undone) return;
    // Refused when what it changed was edited again since; the reason is
    // shown by changes.js, and the line keeps its Undo.
    if (!actions.undo(rec)) return;
    records.delete(key);
    line.undone = true;
    actions.save("chat");
    show();
  }

  // Redraws every <tx-chat> in the page.
  function show() {
    for (const el of live) el.render();
  }

  const md = (text) => markdown(text, runtime.derived.byId);

  function changeHTML(c, i) {
    if (c.undone)
      return html`<li class="ch-change undone">Undone: ${c.text}</li>`;
    return html`<li class="ch-change">${c.text}${records.has(c.key) ? html` <button class="yr-link" data-undo-change="${c.key}" data-turn="${i}">Undo</button>` : ""}${c.ids?.length ? html` · <button class="yr-link" data-show-change="${c.key}" data-turn="${i}">Show them</button>` : ""}${c.period ? html` · <button class="yr-link" data-openperiod="${c.period}">Open it</button>` : ""}</li>`;
  }

  function replyHTML(t, i) {
    const working = t.pending
      ? html`<p class="ch-working" role="status"><span class="ch-dots" aria-hidden="true"></span>${t.steps?.length ? "Working…" : "Thinking…"}</p>${t.steps?.length ? html`<ul class="ch-steps">${t.steps.map((s) => html`<li class="${s.done ? (s.failed ? "failed" : "done") : "now"}">${s.text}</li>`)}</ul>` : ""}`
      : "";
    const changes = t.changes?.length
      ? html`<ul class="ch-changes">${t.changes.map((c) => changeHTML(c, i))}</ul>`
      : "";
    const after =
      !t.pending && t.content && t.q
        ? html`<div class="a-actions"><button class="yr-link" data-lensfrom="${i}">Turn this into a lens</button><button class="yr-link" data-savereport="${i}">Save as a story</button></div>`
        : "";
    return `<div class="a" dir="auto">${working}${changes}${t.content ? md(t.content) : ""}${t.error ? html`<p class="ch-sub">${t.error}</p>` : ""}${after}</div>`;
  }

  function logHTML() {
    if (!state.turns.length) {
      const sug = runtime.derived?.allTxns?.length ? SUGGESTIONS : [];
      return html`<p class="ch-sub">${actions.AI()} can look things up across all your statements, points at the payments it's talking about, and can tag, note, rename, mark periods, set budgets and make lenses when you ask. You'll see each change here, with Undo.</p><div class="suggestions">${sug.map((s) => html`<button class="bn-small" data-sug="${s}">${s}</button>`)}</div>`;
    }
    return state.turns
      .map((t, i) =>
        t.role === "user"
          ? `<div class="q" dir="auto">${esc(t.shown || t.content)}</div>`
          : replyHTML(t, i),
      )
      .join("");
  }

  function defineChat() {
    if (customElements.get("tx-chat")) return;
    customElements.define(
      "tx-chat",
      class extends HTMLElement {
        connectedCallback() {
          if (!this.built) this.build();
          live.add(this);
          subscribeWhileConnected(this, runtime.store, (c) => {
            if (c !== "highlight") this.render();
          });
          this.render();
        }
        disconnectedCallback() {
          live.delete(this);
        }
        build() {
          this.built = true;
          this.innerHTML = html`<div class="ch-off"></div><div class="ch-mem"></div><div class="ch-log" aria-live="polite"></div>
            <div class="ch-box"><div class="ch-ctx"></div>
              <textarea class="ch-input" rows="3" aria-label="Question" placeholder="Ask, or ask for changes: “tag the pizza places #food”"></textarea>
              <div class="ch-row"><span class="ch-note"></span><span class="ch-btns"><button class="bn-small ch-stop" hidden>Stop</button><button class="bn-dark ch-send">Ask</button></span></div>
            </div>`;
          const input = this.querySelector(".ch-input");
          const send = () => {
            const v = input.value;
            if (!v.trim() || askCtl) return;
            input.value = "";
            ask(v, this);
          };
          this.querySelector(".ch-send").onclick = send;
          this.querySelector(".ch-stop").onclick = () => askCtl?.abort();
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          });
          this.addEventListener("click", (e) => this.click(e));
        }
        // "Ask about these": the question started, ready to finish.
        prefill(text) {
          if (!this.built) this.build();
          const input = this.querySelector(".ch-input");
          input.value = text;
          input.focus();
          input.setSelectionRange(text.length, text.length);
        }
        render() {
          if (!this.built) return;
          const ai = actions.AI();
          const off = this.querySelector(".ch-off");
          off.innerHTML = caps.sample
            ? ""
            : actions.noAssistant("Ask needs an assistant.");
          this.querySelector(".ch-box").hidden = !caps.sample;
          const n = state.turns.filter((t) => !t.pending).length;
          this.querySelector(".ch-mem").innerHTML = n
            ? html`${ai} sees the last ${Math.min(n, 16)} messages below with each new question. <button class="yr-link" data-new-chat>Start a new conversation</button>`
            : "";
          const sel = [...state.selection].filter((id) =>
            runtime.derived?.byId.has(id),
          ).length;
          this.querySelector(".ch-ctx").innerHTML = sel
            ? html`About the ${sel} selected payment${sel > 1 ? "s" : ""} <button class="yr-link" data-ctx-clear>(ask about everything instead)</button>`
            : "";
          this.querySelector(".ch-note").textContent =
            `Sends your question, account and thread names, and the transactions it looks up to ${ai}`;
          this.querySelector(".ch-stop").hidden = !askCtl;
          this.querySelector(".ch-send").disabled =
            !!askCtl || !runtime.derived?.allTxns.length;
          const log = this.querySelector(".ch-log");
          log.innerHTML = !state.turns.length && !caps.sample ? "" : logHTML();
          log.scrollTop = log.scrollHeight;
          // The question just sent, in view at once.
          if (asker === this && current) {
            const q = log.querySelectorAll(".q");
            q[q.length - 1]?.scrollIntoView({ block: "nearest" });
          }
        }
        async click(e) {
          const d = e.target.closest("button")?.dataset;
          if (!d) return;
          if ("ctxClear" in d) {
            state.selection.clear();
            actions.refresh();
          } else if ("newChat" in d) {
            if (askCtl) return;
            state.turns = [];
            actions.save("chat");
            show();
          } else if (d.sug) ask(d.sug, this);
          else if (d.undoChange) undoLine(state.turns[+d.turn], d.undoChange);
          else if (d.showChange) {
            const c = state.turns[+d.turn]?.changes?.find(
              (x) => x.key === d.showChange,
            );
            if (c) actions.highlight(c.ids, { clearSelection: true });
          } else if (d.openperiod)
            this.dispatchEvent(
              new CustomEvent("tx-open-period", {
                bubbles: true,
                detail: { id: d.openperiod },
              }),
            );
          else if (d.savereport) {
            const t = state.turns[+d.savereport];
            actions.addReport(t.q, t.content);
          } else if (d.cite) actions.select([d.cite]);
          else if (d.lensfrom) {
            const b = e.target.closest("button");
            const turn = state.turns[+d.lensfrom];
            b.textContent = actions.AI() + " is writing the lens…";
            b.disabled = true;
            try {
              const r = await actions.writeLens(turn.q, {
                context: `Question: ${turn.q}\nAnswer: ${turn.content}`,
              });
              actions.commit(
                addLens(state, {
                  id: "l" + Date.now().toString(36),
                  title: r.title || turn.q.slice(0, 40),
                  code: r.code,
                }),
                { refresh: "none" },
              );
              actions.redraw();
              b.textContent = "Added to Lenses";
              actions.openTab("lenses");
            } catch (err) {
              b.textContent = actions.sampleErr(err);
            }
          }
        }
      },
    );
  }

  return { buildIntro, callAssistant, defineChat };
}

export const contract = {
  name: "tx-chat",
  create: createChatComponent,
  provides: ["buildIntro", "callAssistant", "defineChat"],
  requires: [
    "AI",
    "addReport",
    "commit",
    "highlight",
    "noAssistant",
    "openTab",
    "redraw",
    "refresh",
    "sampleErr",
    "save",
    "select",
    "transferText",
    "undo",
    "writeLens",
  ],
  renders: [],
  wires: ["defineChat"],
};
