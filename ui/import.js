import { esc, fmt, fnv, monthName } from "../helpers.js";
import { $, toast } from "./dom.js";
import { applyMapping, guessHeaderRow, sigOf } from "../transactions/import.js";
import { readMatrix } from "../files.js";

export function createImport(runtime, actions) {
  const { state, caps } = runtime;
  async function importFiles(files) {
    let added = 0,
      dup = 0;
    const names = [];
    for (const f of files) {
      try {
        const r = await readMatrix(f);
        let batch = r.batch;
        if (!batch) {
          const m = r.matrix;
          if (!m?.length) {
            toast(`${f.name} has no rows Transactions can read.`);
            continue;
          }
          let adapter = null,
            hr = null;
          for (let i = 0; i < Math.min(30, m.length); i++) {
            const a = state.adapters[fnv(sigOf(m[i]))];
            if (a) {
              adapter = a;
              hr = i;
              break;
            }
          }
          const map = await askMapping(
            m,
            f.name,
            adapter ? { ...adapter, headerRow: hr } : null,
          );
          if (!map) continue;
          batch = applyMapping(m, map, f.name);
          state.adapters[fnv(sigOf(m[map.headerRow]))] = { ...map };
          actions.save("adapters");
        }
        if (!batch.rows.length) {
          toast(`Nothing to import from ${f.name}.`);
          continue;
        }
        const existing = new Set(
          Object.values(state.batches).flatMap((b) => b.rows.map((r) => r.id)),
        );
        const fresh = batch.rows.filter((r) => !existing.has(r.id)).length;
        dup += batch.rows.length - fresh;
        added += fresh;
        batch.id = fnv(
          batch.kind +
            batch.account +
            batch.periods.join() +
            batch.rows.map((r) => r.id).join(),
        );
        batch.added = new Date().toISOString();
        if (!state.batches[batch.id]) {
          state.batches[batch.id] = batch;
          actions.saveBatch(batch);
        }
        names.push(
          `${batch.account} (${batch.periods.length === 1 ? monthName(batch.periods[0]) : batch.periods.length + " months"})`,
        );
      } catch (e) {
        // The spreadsheet reader's message stays up long enough to read.
        toast(
          `Couldn't read ${f.name}: ${e.message || e}`,
          e?.code === "sheet-reader" ? 12000 : undefined,
        );
      }
    }
    actions.refresh();
    if (names.length) {
      const stale = caps.sample ? actions.staleReports().length : 0;
      toast(
        `Added ${added} transaction${added === 1 ? "" : "s"} from ${names.join(", ")}${dup ? `. ${dup} were already here.` : "."}${stale ? ` ${stale} saved report${stale > 1 ? "s have" : " has"} new data.` : ""}`,
        8000,
        stale
          ? {
              label: "Run reports",
              fn: () => {
                actions.openTab("reports");
                actions.runStale();
              },
            }
          : undefined,
      );
    }
  }

  function askMapping(matrix, fileName, preset) {
    return new Promise((resolve) => {
      const dlg = $("#mapDlg");
      const hdr = guessHeaderRow(matrix);
      const ncol = Math.max(...matrix.slice(0, 40).map((r) => r.length));
      const map = {
        headerRow: hdr,
        date: null,
        merchant: null,
        amount: null,
        debit: null,
        credit: null,
        orig: null,
        type: null,
        details: null,
        dateFormat: "DMY",
        expenseSign: "positive",
        account: fileName.replace(/\.[^.]+$/, ""),
      };
      const H = matrix[hdr] || [];
      const find = (re) => {
        const i = H.findIndex((c) => re.test(String(c)));
        return i < 0 ? null : i;
      };
      map.date = find(/date|תאריך/i);
      map.merchant = find(/descr|payee|merchant|name|תיאור|שם|בית העסק|פרטים/i);
      map.debit = find(/debit|withdraw|חובה/i);
      map.credit = find(/credit|deposit|זכות/i);
      map.amount =
        map.debit == null && map.credit == null ? find(/amount|סכום/i) : null;
      if (preset) Object.assign(map, preset);
      $("#mapTitle").textContent = preset
        ? "Which account is this?"
        : "Teach Transactions this file";
      $("#mapIntro").innerHTML = preset
        ? `Transactions knows the format of <b dir="auto">${esc(fileName)}</b> and has filled in the columns. Check the account name at the bottom, since several accounts can share a format.`
        : `<b dir="auto">${esc(fileName)}</b> isn't a format Transactions knows yet. Point out which columns hold what. Transactions keeps this mapping and reads the next file with the same headings on its own.`;
      const colOpts = (sel) =>
        `<option value="">—</option>` +
        Array.from(
          { length: ncol },
          (_, i) =>
            `<option value="${i}"${sel === i ? " selected" : ""}>${i + 1}: ${esc(String((matrix[map.headerRow] || [])[i] ?? "").slice(0, 24))}</option>`,
        ).join("");
      const draw = () => {
        $("#mapTable").innerHTML =
          `<tr><th></th>${Array.from({ length: ncol }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>` +
          matrix
            .slice(0, Math.max(12, map.headerRow + 6))
            .map(
              (r, i) =>
                `<tr class="${i === map.headerRow ? "hdr" : i < map.headerRow ? "skip" : ""}"><th>${i}</th>${Array.from({ length: ncol }, (_, j) => `<td dir="auto">${esc(String(r[j] ?? "").slice(0, 40))}</td>`).join("")}</tr>`,
            )
            .join("");
        const f = (k, label) =>
          `<label>${label}<select data-k="${k}">${colOpts(map[k])}</select></label>`;
        $("#mapGrid").innerHTML =
          `<label>Heading row<input type="number" min="0" data-k="headerRow" value="${map.headerRow}"></label>${f("date", "Date")}${f("merchant", "Merchant or description")}${f("amount", "Amount (one signed column)")}
        <label>In that column, spending is<select data-k="expenseSign"><option value="positive"${map.expenseSign === "positive" ? " selected" : ""}>positive</option><option value="negative"${map.expenseSign === "negative" ? " selected" : ""}>negative</option></select></label>
        ${f("debit", "…or money out column")}${f("credit", "…and money in column")}${f("orig", "Original amount (optional)")}${f("type", "Type (optional)")}${f("details", "Details (optional)")}
        <label>Dates are written<select data-k="dateFormat">${[
          ["DMY", "day/month/year"],
          ["MDY", "month/day/year"],
          ["YMD", "year-month-day"],
        ]
          .map(
            ([v, l]) =>
              `<option value="${v}"${map.dateFormat === v ? " selected" : ""}>${l}</option>`,
          )
          .join("")}</select></label>
        <label>Account name<input data-k="account" value="${esc(map.account)}"></label>`;
        const b = applyMapping(matrix, map, fileName);
        $("#mapPreview").innerHTML = b.rows.length
          ? `<tr><th>Date</th><th>Merchant</th><th>Amount</th></tr>` +
            b.rows
              .slice(0, 6)
              .map(
                (r) =>
                  `<tr><td>${r.date}</td><td dir="auto">${esc(r.merchant)}</td><td>${fmt(r.amount)}</td></tr>`,
              )
              .join("") +
            `<tr><td colspan="3" class="sub">${b.rows.length} rows in total</td></tr>`
          : `<tr><td class="sub">No rows read yet. Choose at least a date column and an amount (or money out/in) column.</td></tr>`;
        $("#mapOk").disabled = !b.rows.length;
      };
      $("#mapGrid").oninput = (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        let v = e.target.value;
        if (["headerRow"].includes(k)) v = Math.max(0, +v || 0);
        else if (!["expenseSign", "dateFormat", "account"].includes(k))
          v = v === "" ? null : +v;
        map[k] = v;
        if (k === "amount" && v != null) {
          map.debit = map.credit = null;
        }
        if ((k === "debit" || k === "credit") && v != null) map.amount = null;
        draw();
      };
      const done = (v) => {
        dlg.close();
        resolve(v);
      };
      $("#mapOk").onclick = () => done({ ...map });
      $("#mapCancel").onclick = () => done(null);
      dlg.oncancel = (e) => {
        e.preventDefault();
        done(null);
      };
      $("#mapAsk").hidden = !caps.sample;
      $("#mapAskNote").textContent = "";
      $("#mapAsk").onclick = async () => {
        $("#mapAsk").disabled = true;
        $("#mapAskNote").textContent =
          actions.AI() + " is reading the first rows…";
        try {
          const r = await caps.sample.json(
            `These are the first rows of a bank or credit card statement export, as a JSON array of rows (each an array of cells; columns are 0-indexed). Work out how to read it.
Reply with only JSON: {"headerRow": number, "date": col, "merchant": col, "amount": col or null, "debit": col or null, "credit": col or null, "orig": col or null, "type": col or null, "details": col or null, "dateFormat": "DMY" | "MDY" | "YMD", "expenseSign": "positive" | "negative", "account": "short account name, like the bank and at most the last 4 digits of the card or account; never a full account number"}
Use either "amount" (a single signed column) or "debit" + "credit" (separate money-out and money-in columns). "merchant" is the payee or description column. "orig" is the original or foreign-currency amount if there's a separate one. "expenseSign" says whether spending appears as positive or negative numbers in "amount". "date" should be the transaction date rather than a value/charge date when both exist.
File name: ${fileName}
Rows:
${JSON.stringify(matrix.slice(0, 18).map((r) => r.map((c) => String(c ?? "").slice(0, 60))))}`,
            { modelTier: "quick" },
          );
          for (const k of [
            "headerRow",
            "date",
            "merchant",
            "amount",
            "debit",
            "credit",
            "orig",
            "type",
            "details",
          ])
            if (k in r) map[k] = r[k] == null || r[k] === "" ? null : +r[k];
          if (/^(DMY|MDY|YMD)$/.test(r.dateFormat))
            map.dateFormat = r.dateFormat;
          if (/^(positive|negative)$/.test(r.expenseSign))
            map.expenseSign = r.expenseSign;
          if (r.account) map.account = String(r.account).slice(0, 40);
          $("#mapAskNote").textContent =
            "Filled in. Check the preview before importing.";
          draw();
        } catch (e) {
          $("#mapAskNote").textContent = actions.sampleErr(e);
        }
        $("#mapAsk").disabled = false;
      };
      draw();
      dlg.showModal();
      if (caps.sample && !preset) $("#mapAsk").click();
      if (preset)
        setTimeout(() => {
          const a = $('#mapGrid [data-k="account"]');
          a?.focus();
          a?.select();
        }, 50);
    });
  }

  return { importFiles };
}

export const contract = {
  name: "import",
  create: createImport,
  provides: ["importFiles"],
  requires: [
    "AI",
    "openTab",
    "refresh",
    "runStale",
    "sampleErr",
    "save",
    "saveBatch",
    "staleReports",
  ],
  renders: [],
  wires: [],
};
