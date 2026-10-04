import { MONTHS } from "../helpers.js";

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

// ₪2,313 for whole amounts, ₪26.50 otherwise.
export function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const whole = Number.isInteger(v);
  return (
    (v < 0 ? "−" : "") +
    "₪" +
    Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    })
  );
}

export const count = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

export const plural = (n, one, many = one + "s") =>
  `${count(n)} ${n === 1 ? one : many}`;

export function list(items, joiner = "and") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items.at(-1)}`;
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
    ? list(names)
    : `${names.slice(0, max - 1).join(", ")} and ${plural(names.length - max + 1, "other place")}`;

export const KIND_LABELS = {
  cluster: "Several purchases close together",
  large: "Larger than usual",
  gap: "Something missing",
  price: "Price change",
  spike: "Larger than usual",
  rhythm: "Same day each month",
  new: "First time",
  budget: "Budget",
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
export function momentFact(m) {
  const f = m.facts;
  switch (m.kind) {
    case "cluster":
      return `${money(f.total)} went to ${placesText(f.merchants)} within a week.`;
    case "large":
      if (f.count > 1)
        return `You made ${plural(f.count, "payment")} to ${f.merchant}, ${money(f.total)} in all.`;
      return f.largestOfYear
        ? `You paid ${f.merchant} ${money(f.total)}, your largest single payment of the year.`
        : `You paid ${f.merchant} ${money(f.total)}, more than three times the usual ${money(f.usual)} for ${f.usualFor}.`;
    case "gap":
      if (f.stopped)
        return `${f.merchant} last appeared on ${dayLong(f.last)}, and not in ${monthLong(f.months[0])}.`;
      return `No ${f.merchant} in ${monthList(f.months, "or")}, though there was one in each of the other ${plural(f.seen, "month")}.`;
    case "price":
      return `${f.merchant} went ${f.after > f.before ? "up" : "down"} from ${money(f.before)} to ${money(f.after)} a month.`;
    case "spike":
      return `${f.merchant} came to ${money(f.amount)} in ${monthLong(m.month)}, compared with the usual ${money(f.usual)}.`;
    case "rhythm":
      return `You've paid ${f.merchant} on the ${ordinal(f.day)} of the month for ${plural(f.months, "month")} running.`;
    case "new":
      return `${money(f.total)} went to ${f.merchant} in ${monthLong(m.month)}, the first time it appears in your statements.`;
    case "budget":
      return `${f.thread} came to ${money(f.spent)} of ${money(f.budget)} in ${monthLong(m.month)}${f.first ? ", the first month above the budget" : ""}.`;
  }
  return "";
}

// States the fact and offers an option. Never asks why.
export function questionText(m) {
  const offer =
    m.kind === "cluster" ? "Want to name this period?" : "Want to add a note?";
  return `${momentFact(m)} ${offer}`;
}

export const PRIVACY_NOTE = "Optional. Only you can see your answer.";

// Where answers are kept, from the storage backend's kind.
export const privacyLabel = (backendKind) =>
  backendKind === "account"
    ? "Saved privately to your Claude account"
    : "Private to this device";

export const GENERIC_ANSWERS = [
  { label: "Name this period", action: "period", source: "generic" },
  { label: "Write a note", action: "note", source: "generic" },
  { label: "Skip", action: "skip", source: "generic" },
];

// Words in merchant names that suggest an answer, in English and Hebrew.
export const KEYWORDS = [
  {
    terms: ["removal", "movers", "moving", "הובלה", "הובלות"],
    label: "Moving house",
    action: "period",
  },
  {
    terms: ["garage", "mechanic", "מוסך"],
    label: "Car repair",
    action: "note",
  },
  {
    terms: ["vet", "veterinar", "וטרינר"],
    label: "Vet visit",
    action: "note",
  },
  {
    terms: ["hotel", "guesthouse", "hostel", "מלון", "צימר"],
    label: "A trip away",
    action: "period",
  },
  {
    terms: ["airline", "airways", "תעופה", "אל על"],
    label: "Flights",
    action: "period",
  },
  {
    terms: ["pharmacy", "chemist", "בית מרקחת", "סופר פארם"],
    label: "Pharmacy",
    action: "note",
  },
];

const words = (s) => ` ${String(s).toLowerCase()} `;

// Suggested answers without an assistant: the last answer given for the
// same merchant, then keyword matches, then the generic options.
export function answerOptions(m, merchantAnswers = {}) {
  const out = [];
  const add = (option) => {
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
  GENERIC_ANSWERS.forEach(add);
  return out;
}
