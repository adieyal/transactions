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
        return txnIds.length
          ? { text, txnIds: [...new Set(txnIds)] }
          : { text, unchecked: true };
      }),
    )
    .filter((p) => p.length);
  return {
    paragraphs,
    unchecked: paragraphs.flat().some((s) => s.unchecked),
    chips: chips([...new Set(cited)].map((id) => byId.get(id))),
  };
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
