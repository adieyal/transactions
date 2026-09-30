import { BIDI, fnv, isoOf, monthOf, pad2 } from "../helpers.js";
import { HE_MONTHS, INST_RE, parseAmount, parseDateCell } from "./parse.js";

function parseLeumiHTML(html, file) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.body || !doc.body.textContent.includes("תאריך העסקה")) return null;
  const rows = [];
  let account = null,
    period = null,
    section = "",
    cols = null;
  const occ = {};
  for (const tr of doc.querySelectorAll("tr")) {
    if (tr.querySelector("tr")) {
      // an outer row wrapping nested tables: only use it for the card header
      const t = tr.textContent.replace(BIDI, "").replace(/\s+/g, " ");
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
    const cells = [...tr.cells].map((c) =>
      c.textContent.replace(BIDI, "").replace(/\s+/g, " ").trim(),
    );
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
      orig: o ? { amount: o.amount, currency: o.currency || "ILS" } : null,
      type: r.type,
      details: r.details,
      amount: r.amount,
      inst,
      section: r.section,
      file,
    };
  });
  return { kind: "leumi", account, periods: [period], file, rows: out };
}

function htmlMatrix(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const m = [];
  for (const tr of doc.querySelectorAll("tr")) {
    if (tr.querySelector("tr")) continue;
    const c = [...tr.cells].map((x) =>
      x.textContent.replace(BIDI, "").replace(/\s+/g, " ").trim(),
    );
    if (c.some(Boolean)) m.push(c);
  }
  return m;
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

async function readMatrix(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder("latin1")
    .decode(buf.slice(0, 1024))
    .toLowerCase();
  if (/<(html|table|!doctype)/.test(head)) {
    const text = decodeText(buf);
    const leumi = parseLeumiHTML(text, file.name);
    if (leumi) return { batch: leumi };
    return { matrix: htmlMatrix(text) };
  }
  if (/\.(csv|txt|tsv)$/i.test(file.name))
    return { matrix: csvMatrix(decodeText(buf)) };
  if (!window.XLSX)
    throw new Error(
      "The spreadsheet reader didn't load, so .xlsx files can't be opened right now. Export as CSV instead.",
    );
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const m = XLSX.utils
    .sheet_to_json(ws, { header: 1, raw: true, defval: "" })
    .map((r) => r.map((c) => (c instanceof Date ? isoOf(c) : c)));
  return { matrix: m.filter((r) => r.some((c) => String(c).trim())) };
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
      orig: o ? { amount: o.amount, currency: o.currency || "ILS" } : null,
      type: map.type != null ? String(row[map.type] ?? "").trim() : "",
      details,
      amount,
      inst,
      section: "",
      file,
    });
  }
  return {
    kind: "generic",
    account,
    periods: [...new Set(out.map((r) => r.period))].sort(),
    file,
    rows: out,
  };
}
export { applyMapping, guessHeaderRow, readMatrix, sigOf };
