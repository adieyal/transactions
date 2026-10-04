import { MONTHS, fmt, withCurrency } from "../helpers.js";

// Friendly, facts-only phrasing. Every sentence here states something the
// data shows; nothing guesses at what it meant to the person.

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

// Sentences round to whole units of the amount's currency: €2,313, $27.
// Under one unit keeps the cents, so a small amount never reads as €0. The
// currency is the one named, or the one the story is being told in (see
// withCurrency in helpers.js).
export function money(n, currency) {
  const v = Number(n) || 0;
  return Math.abs(v) < 1
    ? exactMoney(v, currency)
    : exactMoney(Math.round(v), currency);
}

// The exact amount, for prices and anywhere a few cents matter: €26.50.
export function exactMoney(n, currency) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return fmt(v, Number.isInteger(v) ? 0 : 2, currency);
}

// A name from the data or the person (a merchant, thread, period or account),
// isolated so a right-to-left name keeps its own direction inside an English
// sentence. FSI … PDI works in HTML, in SVG and in plain text alike.
export const name = (s) => `\u2068${s}\u2069`;
// Text without the isolates, for comparing and for an assistant.
export const plain = (s) => String(s).replace(/[\u2068\u2069]/g, "");

export const count = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

export const plural = (n, one, many = one + "s") =>
  `${count(n)} ${n === 1 ? one : many}`;

export function list(items, joiner = "and") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items.at(-1)}`;
}

// "Hilltop Flats, Fresh Mart and four others": the merchants of ts, the
// largest first, naming at most two.
export function merchantList(ts) {
  const by = new Map();
  for (const t of ts) by.set(t.merchant, (by.get(t.merchant) ?? 0) + t.amount);
  const names = [...by].sort((a, b) => b[1] - a[1]).map(([m]) => name(m));
  if (names.length <= 3) return list(names);
  return list([...names.slice(0, 2), `${count(names.length - 2)} others`]);
}

export function ordinal(n) {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return n + suffix;
}

const parts = (iso) => iso.split("-").map(Number);

export function monthLong(ym) {
  const [y, m] = parts(ym);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function dayLong(iso) {
  const [y, m, d] = parts(iso);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function dayShort(iso) {
  const [, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

// "18 August 2026", "9–16 March 2026", "28 March – 2 April 2026".
export function dateRange(from, to) {
  if (from === to) return dayLong(from);
  const [y1, m1, d1] = parts(from),
    [y2, m2, d2] = parts(to);
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTH_NAMES[m2 - 1]} ${y2}`;
  if (y1 === y2)
    return `${d1} ${MONTH_NAMES[m1 - 1]} – ${d2} ${MONTH_NAMES[m2 - 1]} ${y2}`;
  return `${dayLong(from)} – ${dayLong(to)}`;
}

// "December 2025 and January 2026", "March, April and May 2026".
export function monthList(months, joiner = "and") {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  if (years.size > 1) return list(months.map(monthLong), joiner);
  const names = months.map((m) => MONTH_NAMES[parts(m)[1] - 1]);
  return `${list(names, joiner)} ${[...years][0]}`;
}

const placesText = (names, max = 4) =>
  names.length <= max
    ? list(names.map(name))
    : `${names
        .slice(0, max - 1)
        .map(name)
        .join(", ")} and ${plural(names.length - max + 1, "other place")}`;

export const KIND_LABELS = {
  cluster: "Several purchases close together",
  large: "Larger than usual",
  gap: "Something missing",
  price: "Price change",
  spike: "Larger than usual",
  rhythm: "Same day each month",
  new: "First time",
  budget: "Budget",
  loose: "Not in a thread",
};

export function kindLabel(m) {
  if (m.kind === "gap" && m.facts.stopped) return "Stopped";
  return KIND_LABELS[m.kind];
}

export function momentWhen(m) {
  if (m.kind === "gap") return monthList(m.facts.months);
  if (m.kind === "budget") return monthLong(m.month);
  if (m.kind === "rhythm")
    return `${monthLong(m.from.slice(0, 7))} – ${monthLong(m.to.slice(0, 7))}`;
  return dateRange(m.from, m.to);
}

// The fact the question is about, in one or two sentences.
// A moment's sentence, with its amounts in the moment's own currency.
export const momentFact = (m) => withCurrency(m.currency, () => factOf(m));

function factOf(m) {
  const f = m.facts;
  const who = name(f.merchant),
    thread = name(f.thread);
  switch (m.kind) {
    case "cluster":
      return `${money(f.total)} went to ${placesText(f.merchants)} within a week.`;
    case "large":
      if (f.count > 1)
        return `You made ${plural(f.count, "payment")} to ${who}, ${money(f.total)} in all.`;
      return f.largestOfYear
        ? `You paid ${who} ${money(f.total)}, your largest single payment of the year.`
        : `You paid ${who} ${money(f.total)}, more than three times the usual ${money(f.usual)} for ${name(f.usualFor)}.`;
    case "gap":
      if (f.stopped)
        return `${who} last appeared on ${dayLong(f.last)}, and not in ${monthLong(f.months[0])}.`;
      return `No ${who} in ${monthList(f.months, "or")}, though there was one in each of the other ${plural(f.seen, "month")}.`;
    case "price":
      return `${who} went ${f.after > f.before ? "up" : "down"} from ${exactMoney(f.before, f.currency)} to ${exactMoney(f.after, f.currency)} a month.`;
    case "spike":
      return `${who} came to ${money(f.amount)} in ${monthLong(m.month)}, compared with the usual ${money(f.usual)}.`;
    case "rhythm":
      return `You've paid ${who} on the ${ordinal(f.day)} of the month for ${plural(f.months, "month")} running.`;
    case "new":
      return `${money(f.total)} went to ${who} in ${monthLong(m.month)}, the first time it appears in your statements.`;
    case "budget":
      return `${thread} came to ${money(f.spent)} of ${money(f.budget)} in ${monthLong(m.month)}${f.first ? ", the first month above the budget" : ""}.`;
    case "loose":
      return `${cap(plural(f.count, "charge"))} at ${plural(f.places, "place")}, ${money(f.total)} in all, aren't in any thread yet.`;
  }
  return "";
}

// States the fact and offers an option. Never asks why.
export function questionText(m) {
  const offer =
    m.kind === "cluster"
      ? "Want to name this period?"
      : m.kind === "loose"
        ? "Want to sort them into threads?"
        : "Want to add a note?";
  return `${momentFact(m)} ${offer}`;
}

export const PRIVACY_NOTE = "Optional. Only you can see your answer.";

// Where answers are kept, from the storage backend's kind.
export const privacyLabel = (backendKind) =>
  backendKind === "account"
    ? "Saved privately to your Claude account"
    : "Private to this device";

// Where an answer to a question is kept, for the line under the question:
// "your answer stays on this device" is false when saving to the account.
export const answerKept = (backendKind) =>
  backendKind === "account"
    ? "your answer is saved privately to your Claude account"
    : "your answer stays on this device";

// The explanation behind the privacy chip and the banner above the questions.
export function privacyText(backendKind) {
  const account = backendKind === "account";
  const where = account
    ? "in your Claude account, where only you can see them"
    : "in this browser, on this device only";
  const assistant =
    "Nothing goes to an assistant unless you press a button that asks one.";
  return {
    label: privacyLabel(backendKind),
    details: [
      `Your statements, notes, periods and answers are saved ${where}.`,
      assistant,
      "The questions come from patterns in your own data. Answering is optional, and Skip is always there.",
    ],
    banner: account
      ? `Only you see your answers. They are saved privately to your Claude account, alongside your statements. ${assistant}`
      : `Only you see your answers. They are saved in this browser, alongside your statements, and are not sent anywhere. ${assistant}`,
  };
}

export const GENERIC_ANSWERS = [
  { label: "Name this period", action: "period", source: "generic" },
  { label: "Write a note", action: "note", source: "generic" },
  { label: "Skip", action: "skip", source: "generic" },
];

// Words in merchant names that suggest an answer, per language. Any
// language can be added, and a merchant in a language not listed simply gets
// the generic answers.
export const KEYWORD_TERMS = {
  en: {
    moving: ["removal", "movers", "moving"],
    garage: ["garage", "mechanic"],
    vet: ["vet", "veterinar"],
    stay: ["hotel", "guesthouse", "hostel"],
    flights: ["airline", "airways"],
    pharmacy: ["pharmacy", "chemist"],
  },
  he: {
    moving: ["הובלה", "הובלות"],
    garage: ["מוסך"],
    vet: ["וטרינר"],
    stay: ["מלון", "צימר"],
    flights: ["תעופה", "אל על"],
    pharmacy: ["בית מרקחת", "סופר פארם"],
  },
};
// What each kind of keyword offers, in the app's own language.
const KEYWORD_ANSWERS = [
  { key: "moving", label: "Moving house", action: "period" },
  { key: "garage", label: "Car repair", action: "note" },
  { key: "vet", label: "Vet visit", action: "note" },
  { key: "stay", label: "A trip away", action: "period" },
  { key: "flights", label: "Flights", action: "period" },
  { key: "pharmacy", label: "Pharmacy", action: "note" },
];
export const KEYWORDS = KEYWORD_ANSWERS.map(({ key, label, action }) => ({
  terms: Object.values(KEYWORD_TERMS).flatMap((l) => l[key] || []),
  label,
  action,
}));

const words = (s) => ` ${String(s).toLowerCase()} `;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Naming a period fits a moment with several charges or several days that is
// about an event, not a single charge or a merchant's routine.
const PERIOD_KINDS = new Set(["cluster", "large", "new", "gap"]);
export const periodFits = (m) =>
  PERIOD_KINDS.has(m.kind) &&
  !m.facts.stopped &&
  (m.txnIds.length > 1 || m.from !== m.to);

export const SORT_ANSWER = {
  label: "Sort them in Threads",
  action: "threads",
  source: "generic",
};

// Suggested answers: the last answer given for the same merchant, then
// keyword matches, then any labels an assistant suggested when asked, then
// the generic options.
export function answerOptions(m, merchantAnswers = {}, assisted = []) {
  if (m.kind === "loose") return [SORT_ANSWER, GENERIC_ANSWERS.at(-1)];
  const out = [];
  const period = periodFits(m);
  const add = (option) => {
    if (option.action === "period" && !period) {
      if (option.source === "generic") return;
      option = { ...option, action: "note" };
    }
    if (!out.some((o) => o.label === option.label)) out.push(option);
  };
  for (const key of m.facts.keys || []) {
    const last = merchantAnswers[key];
    if (last?.choice)
      add({
        label: last.choice,
        action: last.action || "note",
        source: "merchant",
      });
  }
  const names = [
    ...(m.facts.keys || []).map((k) => k.split("::").pop()),
    ...(m.facts.merchants || [m.facts.merchant || ""]),
  ]
    .map(words)
    .join(" ");
  for (const k of KEYWORDS)
    if (k.terms.some((term) => names.includes(" " + term)))
      add({ label: k.label, action: k.action, source: "keyword" });
  // Labels an assistant suggested, only after someone asked for them.
  for (const label of assisted)
    add({
      label,
      action: m.kind === "cluster" ? "period" : "note",
      source: "assistant",
    });
  GENERIC_ANSWERS.forEach(add);
  return out;
}
