import { count, dayShort, list, money, name } from "./copy.js";

// An assistant's answer told as a story (artboard 3, "A saved question" and
// "You asked"). Each sentence that cites payments ([[id]]) lights exactly
// those payments; a sentence citing none can't be tied to payments, so it is
// marked unchecked and shown struck (Copy rules, section 9). The chips under
// the answer name the cited payments, a merchant at a time.

const CITE = /\[\[([a-z0-9-]+)\]\]/gi;
const MAX_CHIPS = 4;

function sentences(paragraph) {
  return paragraph
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•] /, "").trim())
    .filter(Boolean)
    .flatMap(
      // A stop followed by a space ends a sentence, so "₪12.50" doesn't;
      // citations just after the stop belong to the sentence before.
      (l) =>
        l.match(
          /(?:[^.!?]|[.!?](?=[^\s[]))+(?:[.!?]+|$)(?:\s*\[\[[a-z0-9-]+\]\])*/gi,
        ) ?? [],
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

// "Suggested change: add #car to [[id]] [[id]]", on its own line (see
// systemPrompt): taken out of the story and offered with Apply / Discard.
const SUGGEST =
  /^\s*\**suggested change:?\**\s*add\s+((?:#[\p{L}\p{N}_-]+[\s,]*(?:and\s+)?)+)to\b(.*)$/imu;

function suggestion(answer, byId) {
  const m = String(answer || "").match(SUGGEST);
  if (!m) return { rest: answer, suggestion: null };
  const tags = [...new Set(m[1].toLowerCase().match(/#[\p{L}\p{N}_-]+/gu))];
  const txnIds = [...new Set([...m[2].matchAll(CITE)].map((c) => c[1]))].filter(
    (id) => byId.get(id)?.kind === "actual",
  );
  return {
    rest: String(answer).replace(m[0], ""),
    suggestion: txnIds.length ? { tags, txnIds } : null,
  };
}

// "the two Cityride Taxi payments", "these 5 payments".
export function suggestionWhat(sg, byId) {
  const ts = sg.txnIds.map((id) => byId.get(id));
  const ms = new Set(ts.map((t) => t.merchant));
  if (ms.size > 1) return `these ${count(ts.length)} payments`;
  return ts.length === 1
    ? `the ${name(ts[0].merchant)} payment on ${dayShort(ts[0].date)}`
    : `the ${count(ts.length)} ${name(ts[0].merchant)} payments`;
}

export function answerStory(answer, byId) {
  const cited = [];
  const { rest, suggestion: suggested } = suggestion(answer, byId);
  const paragraphs = String(rest || "")
    .split(/\n{2,}/)
    .map((p) =>
      sentences(p).map((s) => {
        const txnIds = [...s.matchAll(CITE)]
          .map((m) => m[1])
          .filter((id) => byId.has(id));
        const text = s
          .replace(CITE, "")
          .replace(/\s+([.,;:!?])/g, "$1")
          .replace(/\s{2,}/g, " ")
          .trim();
        cited.push(...txnIds);
        const ids = [...new Set(txnIds)];
        return ids.length
          ? {
              text,
              txnIds: ids,
              checked: figuresMatch(
                text,
                ids.map((id) => byId.get(id)),
              ),
            }
          : { text, unchecked: true };
      }),
    )
    .filter((p) => p.length);
  return {
    paragraphs,
    unchecked: paragraphs.flat().some((s) => s.unchecked),
    // "each sentence checked against your transactions": true only when
    // every sentence cites payments and each amount it names is one of them,
    // or the sum of a merchant's, or of all of them.
    checked: paragraphs.length > 0 && paragraphs.flat().every((s) => s.checked),
    chips: chips([...new Set(cited)].map((id) => byId.get(id))),
    suggestion: suggested,
  };
}

// The latest payment on the statements, for a run's `through`.
export const latestPayment = (derived) =>
  derived.txns
    .filter((t) => t.kind === "actual")
    .reduce((a, t) => (t.date > a ? t.date : a), "");

// "Since the last run: no new payments to Meadow Paws." The merchants are
// those the answer cites; a payment is new when it is dated after the latest
// one the run before saw. Nothing to say before a second run.
export function sinceLastRun(r, story, derived) {
  if (!r.prevThrough) return null;
  const cited = new Set(
    story.paragraphs
      .flat()
      .flatMap((s) => s.txnIds ?? [])
      .map((id) => derived.byId.get(id)?.merchant)
      .filter(Boolean),
  );
  const fresh = derived.txns.filter(
    (t) =>
      t.kind === "actual" &&
      t.date > r.prevThrough &&
      (!cited.size || cited.has(t.merchant)),
  );
  const to = cited.size ? ` to ${list([...cited].map(name))}` : "";
  if (!fresh.length) return `Since the last run: no new payments${to}.`;
  const sum = fresh.reduce((a, t) => a + t.amount, 0);
  return `Since the last run: ${fresh.length} new payment${fresh.length > 1 ? "s" : ""}${to}, ${money(sum, fresh[0].currency)}.`;
}

// The amounts a sentence names: "₪1,600", "ZAR 119", "$12.50", "€26.50".
const FIGURE =
  /(?:\p{Sc}\s?|\b[A-Z]{3}\s)(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?\p{Sc}/gu;
export function figures(text) {
  return [...String(text).matchAll(FIGURE)].map((m) =>
    Number((m[1] ?? m[2]).replace(/,/g, "")),
  );
}

// A currency's own sign as the story writes it: ILS → "₪", USD → "$".
const signOf = (c) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: c,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(0)
    .find((p) => p.type === "currency")?.value;

// Counts and amounts written as words can't be compared, so they are never
// checked ("one" is left out: it is mostly not a count).
const NUMBER_WORD =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|twice|thrice)\b/i;

// A sentence is checked only when every figure in it was compared and
// matched: each amount is marked with the cited payments' own currency (its
// sign or code) and equals a cited payment, a merchant's total among them,
// or the total of them all, to the nearest whole unit as the story rounds.
// Any other number (a bare 1700, "9 times", "30 June", "$1,600" for shekel
// payments) or a number word means it wasn't compared, so it isn't checked.
export function figuresMatch(text, ts) {
  const str = String(text);
  if (NUMBER_WORD.test(str)) return false;
  const byCurrency = new Map();
  for (const t of ts)
    byCurrency.set(t.currency, [...(byCurrency.get(t.currency) ?? []), t]);
  const allowed = (group) => {
    const sums = new Map();
    for (const t of group)
      sums.set(t.merchant, (sums.get(t.merchant) ?? 0) + Math.abs(t.amount));
    return [
      ...group.map((t) => Math.abs(t.amount)),
      ...sums.values(),
      group.reduce((a, t) => a + Math.abs(t.amount), 0),
    ];
  };
  let rest = str;
  for (const m of str.matchAll(FIGURE)) {
    const mark = m[0].replace(/[\d,.\s]/g, "");
    const group = [...byCurrency]
      .filter(([c]) => c && (mark === c || mark === signOf(c)))
      .flatMap(([, g]) => g);
    const f = Number((m[1] ?? m[2]).replace(/,/g, ""));
    if (!group.length || !allowed(group).some((v) => Math.abs(v - f) < 1))
      return false;
    rest = rest.replace(m[0], " ");
  }
  return !/\d/.test(rest);
}

// "Meadow Paws · 18 Sep · ₪95", "Meadow Paws · 11 payments · ₪55 each".
function chips(ts) {
  const by = new Map();
  for (const t of ts) by.set(t.merchant, [...(by.get(t.merchant) ?? []), t]);
  return [...by]
    .map(([m, g]) => {
      const amounts = new Set(g.map((t) => t.amount));
      const text =
        g.length === 1
          ? `${name(m)} · ${dayShort(g[0].date)} · ${money(g[0].amount, g[0].currency)}`
          : amounts.size === 1
            ? `${name(m)} · ${g.length} payments · ${money(g[0].amount, g[0].currency)} each`
            : `${name(m)} · ${g.length} payments`;
      return { text, txnIds: g.map((t) => t.id) };
    })
    .slice(0, MAX_CHIPS);
}
