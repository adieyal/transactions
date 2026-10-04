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

const fmt = (n, dp) => {
  const v = Number(n) || 0;
  const d = dp ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return (
    (v < 0 ? "−" : "") +
    "₪" +
    Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  );
};

const fmtShort = (n) => {
  const a = Math.abs(n);
  const s =
    a >= 10000
      ? (a / 1000).toFixed(0) + "k"
      : a >= 1000
        ? (a / 1000).toFixed(1) + "k"
        : a.toFixed(0);
  return (n < 0 ? "−" : "") + "₪" + s;
};

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
  MONTHS,
  addMonths,
  debounce,
  esc,
  fmt,
  fmtDate,
  fmtShort,
  fnv,
  isoOf,
  monthName,
  monthOf,
  ms,
  normText,
  pad2,
};
