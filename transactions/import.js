import { BIDI, fnv, isCurrency, monthOf, pad2 } from "../helpers.js";
import { HE_MONTHS, INST_RE, parseAmount, parseDateCell } from "./parse.js";

// A Leumi card statement saved as a web page, from its table rows (see
// tableRows in files.js): { nested, text } for a row wrapping other tables,
// { cells } for the rest. Returns a batch, or null when it isn't one.
// The Israeli card format's amounts are in shekels.
const LEUMI_CURRENCY = "ILS";

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
// symbol, otherwise the one the file was found or said to be in.
function rowCurrency(row, map) {
  if (map.currencyColumn != null) {
    const c = currencyIn(row[map.currencyColumn]);
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
    const h = String(head[c] ?? "").replace(BIDI, "");
    const fromHead = currencyIn(h.replace(/\b(amount|debit|credit)\b/gi, ""));
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

function applyMapping(matrix, map, file) {
  const out = [];
  const occ = {};
  const account = (map.account || "").trim() || file.replace(/\.[^.]+$/, "");
  for (let r = (map.headerRow ?? 0) + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;
    const date = parseDateCell(row[map.date], map.dateFormat || "DMY");
    if (!date) continue;
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
    if (amount == null || amount === 0) continue;
    const merchant = String(row[map.merchant] ?? "")
      .replace(BIDI, "")
      .trim();
    const currency = rowCurrency(row, map);
    if (!currency) continue;
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
  return {
    kind: "generic",
    currency: currencies.length === 1 ? currencies[0] : null,
    account,
    periods: [...new Set(out.map((r) => r.period))].sort(),
    file,
    rows: out,
  };
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
  parseLeumiRows,
  sigOf,
  tableMatrix,
};
