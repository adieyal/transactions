import { BIDI, fnv, isCurrency, monthOf, pad2 } from "../helpers.js";
import { HE_MONTHS, INST_RE, parseAmount, parseDateCell } from "./parse.js";

// A Leumi card statement saved as a web page, from its table rows (see
// tableRows in files.js): { nested, text } for a row wrapping other tables,
// { cells } for the rest. Returns a batch, or null when it isn't one.
// The Israeli card format's amounts are in shekels. Each recognised format
// names its currency here; a generic file shows or is told its own.
const LEUMI_CURRENCY = "ILS";
export const FORMAT_CURRENCY = { leumi: LEUMI_CURRENCY };

function parseLeumiRows(tableRows, file) {
  if (!tableRows.some((r) => r.cells?.includes("תאריך העסקה"))) return null;
  const rows = [];
  let account = null,
    period = null,
    section = "",
    cols = null;
  const occ = {};
  for (const tr of tableRows) {
    if (tr.nested) {
      // an outer row wrapping nested tables: only use it for the card header
      const t = tr.text.replace(BIDI, "").replace(/\s+/g, " ");
      if (t.length < 400) {
        const m = t.match(
          /פרוט עסקאות לכרטיס\s+(.+?)\s+לתקופה:?\s*(\S+)\s+(\d{4})/,
        );
        if (m) {
          account = m[1].trim();
          const mo = HE_MONTHS[m[2]];
          if (mo) period = `${m[3]}-${pad2(mo)}`;
        }
      }
      continue;
    }
    const cells = tr.cells;
    const joined = cells.join(" ");
    const hm =
      joined.length < 400 &&
      joined.match(/פרוט עסקאות לכרטיס\s+(.+?)\s+לתקופה:?\s*(\S+)\s+(\d{4})/);
    if (hm) {
      account = hm[1].trim();
      const mo = HE_MONTHS[hm[2]];
      if (mo) period = `${hm[3]}-${pad2(mo)}`;
      continue;
    }
    if (
      cells.length === 1 &&
      /^עסקאות/.test(cells[0]) &&
      cells[0].length < 80
    ) {
      section = cells[0];
      continue;
    }
    if (cells.includes("תאריך העסקה")) {
      cols = {};
      cells.forEach((c, i) => {
        if (c === "תאריך העסקה") cols.date = i;
        else if (c === "שם בית העסק") cols.merchant = i;
        else if (c === "סכום העסקה") cols.orig = i;
        else if (c === "סוג העסקה") cols.type = i;
        else if (c === "פרטים") cols.details = i;
        else if (c === "סכום חיוב") cols.amount = i;
      });
      continue;
    }
    if (!cols || cols.date == null || cols.amount == null) continue;
    const date = parseDateCell(cells[cols.date], "DMY");
    if (!date) continue;
    const amt = parseAmount(cells[cols.amount]);
    if (!amt) continue;
    rows.push({
      date,
      merchant: cells[cols.merchant] || "",
      origRaw: cells[cols.orig],
      type: cells[cols.type] || "",
      details: cells[cols.details] || "",
      amount: amt.amount,
      section,
    });
  }
  if (!rows.length) return null;
  account = account || "Leumi card";
  period =
    period ||
    monthOf(
      rows
        .map((r) => r.date)
        .sort()
        .at(-1),
    );
  const out = rows.map((r) => {
    const o = parseAmount(r.origRaw);
    const im = r.details.match(INST_RE);
    const inst = im ? { n: +im[1], of: +im[2] } : null;
    const base = [account, r.date, r.merchant, r.amount, r.details].join("|");
    occ[base] = (occ[base] || 0) + 1;
    return {
      id: "t" + fnv(base + "|" + occ[base]),
      account,
      period,
      date: r.date,
      chargeDate: inst ? `${period}-10` : r.date,
      merchant: r.merchant,
      currency: LEUMI_CURRENCY,
      // The format's original-amount column without a symbol is in shekels.
      orig: o
        ? { amount: o.amount, currency: o.currency || LEUMI_CURRENCY }
        : null,
      type: r.type,
      details: r.details,
      amount: r.amount,
      inst,
      section: r.section,
      file,
    };
  });
  return {
    kind: "leumi",
    currency: LEUMI_CURRENCY,
    account,
    periods: [period],
    file,
    rows: out,
  };
}

// A generic table from a web page: the rows that aren't wrappers, without
// empty ones.
function tableMatrix(tableRows) {
  return tableRows
    .filter((r) => !r.nested && r.cells.some(Boolean))
    .map((r) => r.cells);
}

function csvMatrix(text) {
  const first = text.split(/\r?\n/, 5).join("\n");
  const delim = [",", ";", "\t", "|"]
    .map((d) => [d, first.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [],
    cur = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

function decodeText(buf) {
  let t = new TextDecoder("utf-8").decode(buf);
  if ((t.match(/\uFFFD/g) || []).length > 3) {
    try {
      t = new TextDecoder("windows-1255").decode(buf);
    } catch {}
  }
  return t.replace(/^\uFEFF/, "");
}

const sigOf = (row) =>
  (row || [])
    .map((c) => String(c ?? "").trim())
    .filter(Boolean)
    .join("|");

function guessHeaderRow(m) {
  for (let i = 0; i < Math.min(30, m.length); i++) {
    const r = m[i];
    const txt = r.filter(
      (c) =>
        typeof c === "string" &&
        c.trim() &&
        !parseDateCell(c) &&
        !parseAmount(c),
    );
    if (txt.length >= 3) return i;
  }
  return 0;
}

// Words in column headings that say what a column holds, per language. Any
// language can be added; none is needed for the dialog to work.
const COLUMN_WORDS = {
  en: {
    date: ["date"],
    merchant: ["descr", "payee", "merchant", "name"],
    debit: ["debit", "withdraw"],
    credit: ["credit", "deposit"],
    amount: ["amount"],
    currencyColumn: ["currency", "ccy"],
  },
  he: {
    date: ["תאריך"],
    merchant: ["תיאור", "שם", "בית העסק", "פרטים"],
    debit: ["חובה"],
    credit: ["זכות"],
    amount: ["סכום"],
    currencyColumn: ["מטבע"],
  },
};
const columnWords = (k) =>
  new RegExp(
    Object.values(COLUMN_WORDS)
      .flatMap((l) => l[k] || [])
      .join("|"),
    "i",
  );

// A row's currency: from the currency column when it holds an ISO code or a
// symbol, then from the amount cell itself ("EUR 90.00"), and only then the
// one the file was found or said to be in.
function rowCurrency(row, map) {
  if (map.currencyColumn != null) {
    const c = currencyIn(row[map.currencyColumn]);
    if (c) return c;
  }
  for (const k of ["amount", "debit", "credit"])
    if (map[k] != null && map[k] !== "") {
      const c = parseAmount(row[map[k]])?.currency;
      if (c) return c;
    }
  return map.currency || null;
}

// The currency a cell names: an ISO code ("EUR") or a symbol ("€12.50").
function currencyIn(cell) {
  const s = String(cell ?? "").replace(BIDI, "");
  const code = s
    .toUpperCase()
    .match(/\b[A-Z]{3}\b/g)
    ?.find(isCurrency);
  return code || parseAmount(s)?.currency || symbolOnly(s);
}
const symbolOnly = (s) => parseAmount(s + "1")?.currency || null;

// The currency a column heading names. A code counts only in capitals and
// standing on its own ("Amount (USD)", "EUR"), so the words of a heading
// ("Top-up amount", "Try") are never read as one.
function headingCurrency(heading) {
  const s = String(heading ?? "").replace(BIDI, "");
  const code = [...s.matchAll(/(?:^|[\s(\[/])([A-Z]{3})(?=$|[\s)\]/:])/g)]
    .map((m) => m[1])
    .find(isCurrency);
  return code || symbolOnly(s.replace(/[A-Za-z\s()[\]/:-]/g, ""));
}

// The one currency a statement file shows, or null when it shows none or
// several: a currency column, ISO codes or symbols in the heading or the
// money columns.
function detectCurrency(matrix, map) {
  const found = new Set();
  const cols = [map.amount, map.debit, map.credit, map.currencyColumn].filter(
    (c) => c != null && c !== "",
  );
  const head = matrix[map.headerRow ?? 0] || [];
  for (const c of cols) {
    const fromHead = headingCurrency(head[c]);
    if (fromHead) found.add(fromHead);
  }
  for (let r = (map.headerRow ?? 0) + 1; r < matrix.length; r++)
    for (const c of cols) {
      const v = matrix[r]?.[c];
      const cur =
        c === map.currencyColumn ? currencyIn(v) : parseAmount(v)?.currency;
      if (cur) found.add(cur);
    }
  return found.size === 1 ? [...found][0] : null;
}

const bodyRows = (matrix, map) =>
  matrix
    .slice((map.headerRow ?? 0) + 1)
    .filter((row) => row?.some((c) => String(c ?? "").trim()));

// How a file writes its dates, read from the dates themselves: a part above
// 12 can only be the day. Null when the dates don't settle it, so the person
// is asked; "YMD" when every date starts with its year or isn't text.
function inferDateOrder(matrix, map) {
  if (map.date == null || map.date === "") return null;
  let day1 = false,
    day2 = false,
    open = false;
  for (const row of bodyRows(matrix, map)) {
    const m = String(row[map.date] ?? "")
      .replace(BIDI, "")
      .trim()
      .match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) day1 = true;
    else if (+m[2] > 12) day2 = true;
    else open = true;
  }
  if (day1 !== day2) return day1 ? "DMY" : "MDY";
  return day1 || open ? null : "YMD";
}

// Whether spending is written as positive or negative in a single amount
// column, from the share of negative amounts: most rows of a statement are
// spending. Null when the amounts don't settle it.
function inferExpenseSign(matrix, map) {
  if (map.amount == null || map.amount === "") return null;
  let neg = 0,
    all = 0;
  for (const row of bodyRows(matrix, map)) {
    const a = parseAmount(row[map.amount]);
    if (!a?.amount) continue;
    all++;
    if (a.amount < 0) neg++;
  }
  if (!all) return null;
  if (neg / all >= 0.6) return "negative";
  if (neg / all <= 0.4) return "positive";
  return null;
}

function applyMapping(matrix, map, file) {
  return readMapping(matrix, map, file).batch;
}

// A generic file read with a mapping: the batch, and the rows that couldn't
// be read, each with its reason ("date", "amount", "zero" or "currency").
function readMapping(matrix, map, file) {
  const out = [];
  const unread = [];
  const occ = {};
  const account = (map.account || "").trim() || file.replace(/\.[^.]+$/, "");
  for (let r = (map.headerRow ?? 0) + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row?.some((c) => String(c ?? "").trim())) continue;
    const date = parseDateCell(row[map.date], map.dateFormat || "DMY");
    if (!date) {
      unread.push({ row: r, reason: "date" });
      continue;
    }
    let amount = null;
    if (map.amount != null && map.amount !== "") {
      const a = parseAmount(row[map.amount]);
      if (a) amount = map.expenseSign === "negative" ? -a.amount : a.amount;
    } else if (map.debit != null || map.credit != null) {
      const d = map.debit != null ? parseAmount(row[map.debit]) : null,
        c = map.credit != null ? parseAmount(row[map.credit]) : null;
      if (d || c)
        amount = (d ? Math.abs(d.amount) : 0) - (c ? Math.abs(c.amount) : 0);
    }
    if (amount == null || amount === 0) {
      unread.push({ row: r, reason: amount == null ? "amount" : "zero" });
      continue;
    }
    const merchant = String(row[map.merchant] ?? "")
      .replace(BIDI, "")
      .trim();
    const currency = rowCurrency(row, map);
    if (!currency) {
      unread.push({ row: r, reason: "currency" });
      continue;
    }
    const o = map.orig != null ? parseAmount(row[map.orig]) : null;
    const details =
      map.details != null ? String(row[map.details] ?? "").trim() : "";
    const im = details.match(INST_RE);
    const inst = im ? { n: +im[1], of: +im[2] } : null;
    const base = [account, date, merchant, amount, details].join("|");
    occ[base] = (occ[base] || 0) + 1;
    out.push({
      id: "t" + fnv(base + "|" + occ[base]),
      account,
      period: monthOf(date),
      date,
      chargeDate: inst ? `${monthOf(date)}-10` : date,
      merchant,
      currency,
      // An original amount is kept only when it says its currency.
      orig: o?.currency ? { amount: o.amount, currency: o.currency } : null,
      type: map.type != null ? String(row[map.type] ?? "").trim() : "",
      details,
      amount,
      inst,
      section: "",
      file,
    });
  }
  const currencies = [...new Set(out.map((r) => r.currency))];
  const batch = {
    kind: "generic",
    currency: currencies.length === 1 ? currencies[0] : null,
    account,
    periods: [...new Set(out.map((r) => r.period))].sort(),
    file,
    rows: out,
  };
  return { batch, unread };
}
export {
  COLUMN_WORDS,
  columnWords,
  currencyIn,
  detectCurrency,
  applyMapping,
  csvMatrix,
  decodeText,
  guessHeaderRow,
  inferDateOrder,
  inferExpenseSign,
  parseLeumiRows,
  readMapping,
  sigOf,
  tableMatrix,
};
