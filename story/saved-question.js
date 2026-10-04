import { dayShort, money, name } from "./copy.js";

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

export function answerStory(answer, byId) {
  const cited = [];
  const paragraphs = String(answer || "")
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
  };
}

// The amounts a sentence names: "₪1,600", "ZAR 119", "$12.50", "€26.50".
const FIGURE =
  /(?:\p{Sc}\s?|\b[A-Z]{3}\s)(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?\p{Sc}/gu;
export function figures(text) {
  return [...String(text).matchAll(FIGURE)].map((m) =>
    Number((m[1] ?? m[2]).replace(/,/g, "")),
  );
}

// Each named amount matches a cited payment, a merchant's total among them,
// or the total of them all, to the nearest whole unit as the story rounds.
function figuresMatch(text, ts) {
  const sums = new Map();
  for (const t of ts)
    sums.set(t.merchant, (sums.get(t.merchant) ?? 0) + Math.abs(t.amount));
  const ok = [
    ...ts.map((t) => Math.abs(t.amount)),
    ...sums.values(),
    ts.reduce((a, t) => a + Math.abs(t.amount), 0),
  ];
  return figures(text).every((f) => ok.some((v) => Math.abs(v - f) < 1));
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
