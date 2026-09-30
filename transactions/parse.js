import { BIDI, isoOf, pad2 } from "../helpers.js";

function parseAmount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number")
    return isFinite(v) ? { amount: v, currency: null } : null;
  let s = String(v).replace(BIDI, "").trim();
  if (!s) return null;
  let currency = null;
  if (s.includes("$")) currency = "USD";
  else if (s.includes("€")) currency = "EUR";
  else if (s.includes("£")) currency = "GBP";
  else if (s.includes("₪") || /ש"ח|ש״ח/.test(s)) currency = "ILS";
  const neg = /-|−/.test(s) || /^\(.*\)$/.test(s);
  let num = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(num)) return null;
  const lc = num.lastIndexOf(","),
    ld = num.lastIndexOf(".");
  if (lc > -1 && ld > -1)
    num =
      lc > ld
        ? num.replace(/\./g, "").replace(",", ".")
        : num.replace(/,/g, "");
  else if (lc > -1)
    num =
      num.length - lc - 1 === 3
        ? num.replace(/,/g, "")
        : num.replace(/,/g, ".");
  const n = parseFloat(num);
  if (!isFinite(n)) return null;
  return { amount: neg ? -n : n, currency };
}

function parseDateCell(v, order = "DMY") {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return isoOf(v);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const s = String(v).replace(BIDI, "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})/);
  if (!m) return null;
  let a = +m[1],
    b = +m[2],
    c = +m[3],
    y,
    mo,
    d;
  if (order === "YMD" || m[1].length === 4) {
    y = a;
    mo = b;
    d = c;
  } else if (order === "MDY") {
    mo = a;
    d = b;
    y = c;
  } else {
    d = a;
    mo = b;
    y = c;
  }
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

const HE_MONTHS = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  מרס: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

const INST_RE = /תשלום\s*-?\s*(\d+)\s*מ(?:תוך)?\s*-?\s*(\d+)/;
export { HE_MONTHS, INST_RE, parseAmount, parseDateCell };
