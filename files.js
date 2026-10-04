import { BIDI, isoOf } from "./helpers.js";
import {
  csvMatrix,
  decodeText,
  parseLeumiRows,
  tableMatrix,
} from "./transactions/import.js";

// Reading statement files in the browser: bytes from a File, web pages
// through DOMParser and spreadsheets through SheetJS. What the reading
// produces is parsed by the pure functions in transactions/import.js.

// The rows of every table in a web page, with their cell text cleaned up.
// A row that wraps other tables keeps only its whole text.
function tableRows(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (t) => t.replace(BIDI, "").replace(/\s+/g, " ").trim();
  return [...doc.querySelectorAll("tr")].map((tr) =>
    tr.querySelector("tr")
      ? { nested: true, text: tr.textContent }
      : { cells: [...tr.cells].map((c) => clean(c.textContent)) },
  );
}

// SheetJS, loaded only when someone chooses a spreadsheet (the user's
// decision, ADR 0007): a pinned version, checked against its hash.
export const SHEETJS = {
  src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  integrity:
    "sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==",
};
export const SHEETJS_UNAVAILABLE =
  "The spreadsheet reader couldn't load, so spreadsheet files can't be opened right now. You may be offline, or something is blocking it. Save the file as CSV and add that instead.";

// Resolves with SheetJS, adding its script the first time. A failed load
// (offline, blocked, or a hash that doesn't match) rejects with
// SHEETJS_UNAVAILABLE and can be tried again later.
let loading = null;
export function loadSheetJS(doc = globalThis.document, win = globalThis) {
  if (win.XLSX) return Promise.resolve(win.XLSX);
  return (loading ||= new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    const fail = () => {
      loading = null;
      script.remove();
      const error = new Error(SHEETJS_UNAVAILABLE);
      error.code = "sheet-reader";
      reject(error);
    };
    script.src = SHEETJS.src;
    script.integrity = SHEETJS.integrity;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.onload = () => (win.XLSX ? resolve(win.XLSX) : fail());
    script.onerror = fail;
    doc.head.append(script);
  }));
}

async function sheetMatrix(buf) {
  const XLSX = await loadSheetJS();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(ws, { header: 1, raw: true, defval: "" })
    .map((r) => r.map((c) => (c instanceof Date ? isoOf(c) : c)))
    .filter((r) => r.some((c) => String(c).trim()));
}

// A statement file as a ready batch (a recognised Leumi page) or as a matrix
// of cells for the mapping step.
export async function readMatrix(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder("latin1")
    .decode(buf.slice(0, 1024))
    .toLowerCase();
  if (/<(html|table|!doctype)/.test(head)) {
    const rows = tableRows(decodeText(buf));
    const leumi = parseLeumiRows(rows, file.name);
    if (leumi) return { batch: leumi };
    return { matrix: tableMatrix(rows) };
  }
  if (/\.(csv|txt|tsv)$/i.test(file.name))
    return { matrix: csvMatrix(decodeText(buf)) };
  return { matrix: await sheetMatrix(buf) };
}
