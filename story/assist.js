import {
  kindLabel,
  momentWhen,
  monthLong,
  plain,
  questionText,
} from "./copy.js";

// Optional help from an assistant, only ever run from a button press. The
// templates stay the source of truth: a reply is used only if it parses,
// every sentence cites transactions from the facts it was given, and it
// brings in no number of its own. Otherwise the template text stays, with
// a short reason.

const POLISHED = new Set([
  "overview",
  "regular",
  "period",
  "savings",
  "budget",
]);
const CITE = /\[\[([^\]]*)\]\]/g;

// A model's reasoning (<think>, <thinking> or <reasoning> blocks, or an
// unclosed one at the start) is never part of the reply.
const stripFences = (text) =>
  String(text ?? "")
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .replace(/^\s*<(think|thinking|reasoning)>[\s\S]*$/i, "")
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

// Every number in a text, without thousands separators: "€3,136" → "3136".
const numbersIn = (text) =>
  (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) =>
    String(Number(n.replace(/,/g, ""))),
  );

// Quoted in a note that ends with its own full stop.
const short = (s) => {
  const t = s.replace(/[.!?]+$/, "");
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
};

// --- Suggest answers -------------------------------------------------------

export function answerSuggestionPrompt(m) {
  const merchants = m.facts.merchants || [m.facts.merchant || m.facts.thread];
  return `You're helping one person label something in their own bank and card statements, in a personal tool called Transactions. The app noticed this and is asking them an optional question.

What the app noticed (${kindLabel(m)}, ${momentWhen(m)}): ${plain(questionText(m))}
Merchants involved: ${merchants.filter(Boolean).join(", ")}

Suggest up to 3 short answers they might pick, each 1 to 4 words, describing what it might have been (for example "Moving house" or "Car repair"). No amounts, no dates, no judgement. Reply with only JSON: {"answers": ["...", "..."]}`;
}

export function parseAnswerSuggestions(text) {
  let data;
  try {
    data = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, reason: "the reply wasn't in the expected shape" };
  }
  const list = Array.isArray(data) ? data : data?.answers;
  if (!Array.isArray(list) || !list.length)
    return { ok: false, reason: "the reply had no answers" };
  const labels = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim())
      return { ok: false, reason: "an answer wasn't plain text" };
    const label = item.trim().replace(/\s+/g, " ");
    if (/\d/.test(label) || /\p{Sc}/u.test(label))
      return {
        ok: false,
        reason: `an answer brought in a figure: “${short(label)}”`,
      };
    if (label.length > 40)
      return { ok: false, reason: `an answer was too long: “${short(label)}”` };
    if (!labels.some((l) => l.toLowerCase() === label.toLowerCase()))
      labels.push(label);
  }
  return { ok: true, labels: labels.slice(0, 3) };
}

export async function suggestAnswers(sample, m) {
  const r = await sample(answerSuggestionPrompt(m), {
    modelTier: "default",
    cache: false,
  });
  return parseAnswerSuggestions(r?.text);
}

// --- Polish this summary ---------------------------------------------------

// The generated facts the assistant may use, each phrase followed by the
// ids it stands for. The person's own words and the questions stay out.
export function polishFacts(sections) {
  return sections
    .filter((s) => POLISHED.has(s.kind))
    .map(
      (s) =>
        "- " +
        s.parts
          .map((p) =>
            plain(
              p.txnIds?.length ? `${p.text} [[${p.txnIds.join(",")}]]` : p.text,
            ),
          )
          .join(""),
    )
    .join("\n");
}

export function polishPrompt(sections, month) {
  return `You're helping one person read a summary of their own spending in ${monthLong(month)}, in a personal tool called Transactions. Below are the facts, written by the app. Each phrase is followed by the ids of the transactions it describes, like [[id1,id2]].

${polishFacts(sections)}

Tell the month as a short story in two to four paragraphs, in a friendly, second-person voice ("you"). Don't walk through the facts in order or recite every number. Find the thread that makes this month interesting (what stood out, what kept coming back, what changed, how one thing led into the next), lead with it, and let the rest support it. Leave out facts that add nothing, and keep figures to the few that matter.

Use a little dry humour: understated and wry, the kind that comes from noticing something, at most a line or two. Never mock or judge the person or their spending, no puns or exclamation marks, and nothing over the top. If nothing in the month invites it, play it straight.

Rules:
- Every sentence must end with one or more citations taken from the facts, like [[id1,id2]].
- Use only the amounts and numbers that appear in the facts. Don't work out new totals, differences or percentages.
- Everything you say must be true of the facts. Don't guess reasons, feelings or what anything meant to them; the humour comes from how you tell what happened, never from inventing it.
Reply with only the prose.`;
}

// Splits prose into sentences, keeping citations that follow a full stop.
function sentencesOf(text) {
  return text
    .split(/(?<=[.!?](?:\s*\[\[[^\]]*\]\])*)\s+(?=\S)(?!\[\[)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validatePolish(text, sections, month) {
  const prose = stripFences(text);
  if (!prose) return { ok: false, reason: "the reply was empty" };
  const facts = sections.filter((s) => POLISHED.has(s.kind));
  const allowedIds = new Set(
    facts.flatMap((s) => s.parts.flatMap((p) => p.txnIds || [])),
  );
  // The facts' own figures, plus the month's year so "April 2026" is fine.
  const allowedNumbers = new Set(
    numbersIn(
      [...facts.flatMap((s) => s.parts.map((p) => p.text)), month].join(" "),
    ),
  );
  const sentences = [];
  for (const raw of prose.split(/\n\s*\n/).flatMap(sentencesOf)) {
    const ids = [...raw.matchAll(CITE)].flatMap((c) =>
      c[1].split(/[\s,]+/).filter(Boolean),
    );
    const clean = raw
      .replace(CITE, "")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!clean) continue;
    if (!ids.length)
      return {
        ok: false,
        reason: `a sentence didn't cite its transactions: “${short(clean)}”`,
      };
    if (ids.some((id) => !allowedIds.has(id)))
      return {
        ok: false,
        reason: `a sentence cited transactions that aren't in ${monthLong(month)}`,
      };
    const invented = numbersIn(clean).find((n) => !allowedNumbers.has(n));
    if (invented)
      return {
        ok: false,
        reason: `it used a figure that isn't in the summary (${invented})`,
      };
    sentences.push({ text: clean, txnIds: [...new Set(ids)] });
  }
  if (!sentences.length) return { ok: false, reason: "the reply was empty" };
  return { ok: true, sentences };
}

export async function polishSummary(sample, sections, month) {
  const r = await sample(polishPrompt(sections, month), {
    modelTier: "default",
    cache: false,
  });
  return validatePolish(r?.text, sections, month);
}
