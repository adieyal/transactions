import {
  coveredMonths,
  momentId,
  monthsSeen,
  spending,
  typicalMonth,
} from "./moment-kit.js";
import {
  budgets,
  clusters,
  gaps,
  large,
  loose,
  newMerchants,
  prices,
  rhythms,
  spikes,
} from "./moment-rules.js";
import { eachCurrency } from "./currency.js";

// Moments are things in the data worth an optional question. The rules that
// find them are in moment-rules.js; this module chooses which to ask.

export { coveredMonths, momentId, monthsSeen, spending, typicalMonth };

export const MAX_OPEN_PER_MONTH = 3;
// The Questions tab shows this many; the rest fold under "More questions".
export const MAX_SHOWN = 5;
// Moments that describe an event; a smaller moment inside one is the same question.
const CONTAINERS = new Set(["cluster", "large"]);
// What a moment asks about, so nothing is asked about twice: its merchants,
// or for a budget its thread. Charges in no thread are one question anyway.
const subjects = (m) =>
  m.kind === "budget"
    ? ["budget::" + m.facts.thread]
    : m.kind === "loose"
      ? []
      : m.facts.keys;

// Every moment the rules find, highest rank first, before anything is dropped.
// Each currency is looked at on its own, so no rule ever compares or adds
// amounts in different currencies; a moment carries its currency.
export function detectMoments(derived, state) {
  const all = eachCurrency(derived, derived.allTxns, (view) =>
    momentsIn(view, state).map((m) => ({ ...m, currency: view.currency })),
  ).flatMap((r) => r.value);
  const seen = new Set();
  return all
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

function momentsIn(derived, state) {
  const spend = derived.allTxns.filter(spending);
  const ctx = {
    derived,
    state,
    spend,
    months: coveredMonths(derived),
    typical: typicalMonth(derived),
    monthsSeen: monthsSeen(spend),
  };
  const spike = spikes(ctx);
  const spiked = new Set(spike.flatMap((m) => m.txnIds));
  const all = [
    ...clusters(ctx),
    ...large(ctx),
    ...gaps(ctx),
    ...prices(ctx, spiked),
    ...spike,
    ...rhythms(ctx),
    ...newMerchants(ctx),
    ...budgets(ctx),
    ...loose(ctx),
  ];
  return all;
}

// A transaction is explained by a note written for it (a note repeated on the
// merchant's other charges doesn't count), or by a period it falls in unless
// it is routine spending that happened during those dates.
export function explainer(derived, state) {
  const seen = monthsSeen(derived.allTxns.filter(spending));
  const uses = new Map();
  const noteKey = (t) => t.key + "\n" + t.note;
  for (const t of derived.allTxns)
    if (t.note) uses.set(noteKey(t), (uses.get(noteKey(t)) || 0) + 1);
  return (m) => {
    // Charges in no thread are explained by threading them, not by notes.
    if (m.kind === "loose") return false;
    if (m.kind === "gap")
      return state.periods.some((p) => p.start <= m.from && p.end >= m.to);
    return m.txnIds.every((id) => {
      const t = derived.byId.get(id);
      return (
        !!t &&
        ((t.periods?.length > 0 && !(seen.get(t.key)?.size >= 3)) ||
          (!!t.note && uses.get(noteKey(t)) === 1))
      );
    });
  };
}

// The questions to offer: not answered or skipped, not explained, not part of
// a bigger moment, not about a merchant or budget already asked about, and at
// most three a month, highest rank first.
export function findMoments(
  derived,
  state,
  all = detectMoments(derived, state),
) {
  const answers = state.answers || {};
  const explained = explainer(derived, state);
  const perMonth = {};
  const asked = new Set(all.filter((m) => answers[m.id]).flatMap(subjects));
  return all.filter((m, i) => {
    if (answers[m.id] || explained(m)) return false;
    const keys = subjects(m);
    if (keys.length && keys.every((k) => asked.has(k))) return false;
    const inside = all
      .slice(0, i)
      .some(
        (h) =>
          CONTAINERS.has(h.kind) &&
          m.txnIds.every((id) => h.txnIds.includes(id)),
      );
    if (inside) return false;
    perMonth[m.month] = (perMonth[m.month] || 0) + 1;
    if (perMonth[m.month] > MAX_OPEN_PER_MONTH) return false;
    keys.forEach((k) => asked.add(k));
    return true;
  });
}

// Record an answer (or a skip) and remember a real answer for the merchant,
// so the same choice can be offered next time. Returns new documents.
export function applyAnswer(
  { answers = {}, merchantAnswers = {} },
  m,
  { status, choice = null, action = null, note = null, created = null, at },
) {
  const next = {
    answers: {
      ...answers,
      [m.id]: { status, choice, note, created, at },
    },
    merchantAnswers: { ...merchantAnswers },
  };
  // Only short answers are worth offering again as a suggestion.
  if (status === "answered" && choice && choice.length <= 60)
    for (const key of m.facts.keys || [])
      next.merchantAnswers[key] = { choice, action, at };
  return next;
}
