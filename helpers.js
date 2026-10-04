const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const pad2 = (n) => String(n).padStart(2, "0");

const isoOf = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const ms = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d || 1);
};

const monthOf = (iso) => iso.slice(0, 7);

function addMonths(iso, k) {
  let [y, m, d] = iso.split("-").map(Number);
  m = m - 1 + k;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${pad2(m + 1)}-${pad2(Math.min(d || 1, last))}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const monthName = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

// Money is always shown in its own currency, an ISO code such as "EUR".
// Story code that tells one currency at a time names it once with
// withCurrency; an amount with no currency at all is an error, never a guess.
let scoped = null;
function withCurrency(currency, fn) {
  const before = scoped;
  scoped = currency;
  try {
    return fn();
  } finally {
    scoped = before;
  }
}
function currencyFor(currency) {
  const c = currency ?? scoped;
  if (!c) throw new Error("An amount has no currency.");
  return c;
}
const formatters = new Map();
function formatter(currency, d) {
  const k = currency + d;
  if (!formatters.has(k))
    formatters.set(
      k,
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }),
    );
  return formatters.get(k);
}
const fractionDigits = (currency) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits;
// The ISO 4217 codes this browser knows, for checks and for the import
// dialog's list.
const CURRENCIES = Intl.supportedValuesOf("currency");
const known = new Set(CURRENCIES);
const isCurrency = (c) => known.has(c);

const fmt = (n, dp, currency) => {
  const c = currencyFor(currency);
  const v = Number(n) || 0;
  const d = dp ?? (Math.abs(v) >= 1000 ? 0 : fractionDigits(c));
  return (v < 0 ? "−" : "") + formatter(c, d).format(Math.abs(v));
};

// An amount as written on a statement: always the currency's own decimals
// (¥1,280, $1,234.50).
const fmtExact = (n, currency) =>
  fmt(n, fractionDigits(currencyFor(currency)), currency);

const fmtShort = (n, currency) => {
  const c = currencyFor(currency);
  const a = Math.abs(n);
  const short = (x, d) => formatter(c, d).format(x);
  const s =
    a >= 10000
      ? short(a / 1000, 0) + "k"
      : a >= 1000
        ? short(a / 1000, 1) + "k"
        : short(a, 0);
  return (n < 0 ? "−" : "") + s;
};

// Amounts in several currencies, each summed on its own and never converted:
// "€120 · £40". items are { amount, currency }.
function sumsByCurrency(items) {
  const sums = new Map();
  for (const t of items)
    sums.set(t.currency, (sums.get(t.currency) || 0) + t.amount);
  return [...sums].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
const fmtByCurrency = (items, dp, f = fmt) =>
  sumsByCurrency(items)
    .map(([c, v]) => (f === fmt ? fmt(v, dp, c) : f(v, c)))
    .join(" · ");

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

function debounce(fn, t) {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), t);
  };
}

function normText(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(BIDI, "")
    .replace(/["'`׳״*.,\-_()\/\\:;|]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export {
  BIDI,
  CURRENCIES,
  MONTHS,
  addMonths,
  debounce,
  esc,
  fmt,
  fmtDate,
  fmtByCurrency,
  fmtExact,
  fmtShort,
  isCurrency,
  sumsByCurrency,
  withCurrency,
  currencyFor,
  fnv,
  isoOf,
  monthName,
  monthOf,
  ms,
  normText,
  pad2,
};
