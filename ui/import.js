import { CURRENCIES, esc, fmt, fnv, monthName } from "../helpers.js";
import { $, toast } from "./dom.js";
import {
  columnWords,
  detectCurrency,
  guessHeaderRow,
  inferDateOrder,
  inferExpenseSign,
  readMapping,
  sigOf,
} from "../transactions/import.js";
import { readMatrix } from "../files.js";
import { needsCurrency, setCurrency } from "../documents.js";

export function createImport(runtime, actions) {
  const { state, caps } = runtime;
  // Asked once per import, before anything changes. The demo is cleared only
  // when the first statement is about to go in, so cancelling a mapping keeps
  // it as well.
  const REPLACE_DEMO =
    "Replace the demo with your statements?\n\nThe fictional demo year, with its notes, periods and answers, is removed and your statements take its place.";

  // Why some rows of a file weren't read, in a sentence; "" when all were.
  const UNREAD = {
    date: [
      "has no date Transactions can read",
      "have no date Transactions can read",
    ],
    amount: ["has no amount", "have no amount"],
    zero: ["has an amount of 0", "have an amount of 0"],
    currency: ["doesn't say its currency", "don't say their currency"],
  };
  function unreadText(unread) {
    if (!unread.length) return "";
    const parts = Object.entries(UNREAD)
      .map(([k, [one, many]]) => {
        const rows = unread.filter((u) => u.reason === k).map((u) => u.row);
        if (!rows.length) return "";
        const which =
          rows.slice(0, 5).join(", ") + (rows.length > 5 ? "…" : "");
        return `${rows.length} ${rows.length === 1 ? one : many} (row${rows.length === 1 ? "" : "s"} ${which})`;
      })
      .filter(Boolean);
    return `${unread.length} row${unread.length === 1 ? "" : "s"} couldn't be read: ${parts.join(", ")}.`;
  }

  async function importFiles(files) {
    let added = 0,
      dup = 0;
    const names = [];
    const skipped = [];
    let demo = state.isDemo ? "ask" : "no";
    for (const f of files) {
      try {
        const r = await readMatrix(f);
        if (demo === "ask") {
          if (!confirm(REPLACE_DEMO)) {
            toast("Kept the demo. Nothing was imported.");
            return;
          }
          demo = "replace";
        }
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
          const read = readMapping(m, map, f.name);
          batch = read.batch;
          if (read.unread.length)
            skipped.push(`${f.name}: ${unreadText(read.unread)}`);
          state.adapters[fnv(sigOf(m[map.headerRow]))] = { ...map };
          actions.save("adapters");
        }
        if (!batch.rows.length) {
          toast(`Nothing to import from ${f.name}.`);
          continue;
        }
        if (demo === "replace") {
          await actions.replaceDemo();
          demo = "no";
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
        `Added ${added} transaction${added === 1 ? "" : "s"} from ${names.join(", ")}${dup ? `. ${dup} were already here.` : "."}${skipped.length ? ` ${skipped.join(" ")}` : ""}${stale ? ` ${stale} saved report${stale > 1 ? "s have" : " has"} new data.` : ""}`,
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
        // Read from the dates and amounts where they settle it, otherwise
        // asked; the *Chosen flags keep a choice over what is inferred.
        dateFormat: null,
        dateChosen: false,
        expenseSign: null,
        signChosen: false,
        // The currency the file shows, or the one the person chose; never a
        // default. currencyChosen keeps a choice over what is detected.
        currency: null,
        currencyChosen: false,
        currencyColumn: null,
        account: fileName.replace(/\.[^.]+$/, ""),
      };
      const H = matrix[hdr] || [];
      const find = (re) => {
        const i = H.findIndex((c) => re.test(String(c)));
        return i < 0 ? null : i;
      };
      for (const k of ["date", "merchant", "debit", "credit", "currencyColumn"])
        map[k] = find(columnWords(k));
      map.amount =
        map.debit == null && map.credit == null
          ? find(columnWords("amount"))
          : null;
      if (preset)
        Object.assign(map, preset, {
          dateChosen: !!preset.dateFormat,
          signChosen: !!preset.expenseSign,
        });
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
        const found = detectCurrency(matrix, map);
        if (!map.currencyChosen) map.currency = found;
        const order = inferDateOrder(matrix, map);
        if (!map.dateChosen) map.dateFormat = order;
        const sign = inferExpenseSign(matrix, map);
        if (!map.signChosen) map.expenseSign = sign;
        const usesSign = map.amount != null;
        const dateNote =
          map.dateChosen || map.date == null
            ? ""
            : order
              ? " Read from the dates in the file; change it if it's wrong."
              : " The dates could be read either way, such as 03/04 for 3 April or March 4. Choose how they are written.";
        const signNote =
          map.signChosen || !usesSign
            ? ""
            : sign
              ? ` Most amounts are ${sign}, so spending is read as ${sign}; change it if it's wrong.`
              : " About as many amounts are positive as negative. Choose which one is spending.";
        const pick = (k, opts) =>
          `<option value=""${map[k] ? "" : " selected"}>Choose…</option>` +
          opts
            .map(
              ([v, l]) =>
                `<option value="${v}"${map[k] === v ? " selected" : ""}>${l}</option>`,
            )
            .join("");
        const currencyNote = map.currencyChosen
          ? ""
          : found
            ? " Found in the file; change it if it's wrong."
            : map.currencyColumn != null
              ? " Read from the currency column."
              : " The file doesn't say.";
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
        <label>In that column, spending is<select data-k="expenseSign">${pick(
          "expenseSign",
          [
            ["positive", "positive"],
            ["negative", "negative"],
          ],
        )}</select><span class="sub">${esc(signNote)}</span></label>
        ${f("debit", "…or money out column")}${f("credit", "…and money in column")}${f("currencyColumn", "Currency column (optional)")}${f("orig", "Original amount (optional)")}${f("type", "Type (optional)")}${f("details", "Details (optional)")}
        <label>Dates are written<select data-k="dateFormat">${pick(
          "dateFormat",
          [
            ["DMY", "day/month/year"],
            ["MDY", "month/day/year"],
            ["YMD", "year-month-day"],
          ],
        )}</select><span class="sub">${esc(dateNote)}</span></label>
        <label>Account name<input data-k="account" value="${esc(map.account)}"></label>
        <label>Currency<select data-k="currency"><option value=""${map.currency ? "" : " selected"}>Choose…</option>${CURRENCIES.map((c) => `<option value="${esc(c)}"${map.currency === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select><span class="sub" id="mapCurNote">${esc(currencyNote)}</span></label>`;
        const { batch: b, unread } = readMapping(matrix, map, fileName);
        const unpriced = !map.currency && b.rows.length === 0;
        const waiting =
          map.date != null && !map.dateFormat
            ? "Choose how the dates are written before importing."
            : usesSign && !map.expenseSign
              ? "Choose whether spending is positive or negative before importing."
              : "";
        $("#mapPreview").innerHTML = waiting
          ? `<tr><td class="sub">${esc(waiting)}</td></tr>`
          : b.rows.length
            ? `<tr><th>Date</th><th>Merchant</th><th>Amount</th></tr>` +
              b.rows
                .slice(0, 6)
                .map(
                  (r) =>
                    `<tr><td>${r.date}</td><td dir="auto">${esc(r.merchant)}</td><td>${fmt(r.amount, undefined, r.currency)}</td></tr>`,
                )
                .join("") +
              `<tr><td colspan="3" class="sub">${b.rows.length} rows in total. ${esc(unreadText(unread))}</td></tr>`
            : unpriced &&
                readMapping(matrix, { ...map, currency: "XXX" }, fileName).batch
                  .rows.length
              ? `<tr><td class="sub">Choose the currency these amounts are in. The file doesn't say, and Transactions never guesses one.</td></tr>`
              : `<tr><td class="sub">No rows read yet. Choose at least a date column and an amount (or money out/in) column.</td></tr>`;
        $("#mapOk").disabled = !!waiting || !b.rows.length;
      };
      $("#mapGrid").oninput = (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        let v = e.target.value;
        if (["headerRow"].includes(k)) v = Math.max(0, +v || 0);
        else if (k === "currency") {
          v = v || null;
          map.currencyChosen = !!v;
        } else if (k === "dateFormat" || k === "expenseSign") {
          v = v || null;
          map[k === "dateFormat" ? "dateChosen" : "signChosen"] = !!v;
        } else if (k !== "account") v = v === "" ? null : +v;
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
            Object.assign(map, { dateFormat: r.dateFormat, dateChosen: true });
          if (/^(positive|negative)$/.test(r.expenseSign))
            Object.assign(map, {
              expenseSign: r.expenseSign,
              signChosen: true,
            });
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

  // Statements saved before they recorded a currency, in a format that
  // doesn't say one: asked once, all together, and saved with the answer.
  // Until then their amounts stay off the page rather than in a guess.
  function askCurrencies() {
    const waiting = needsCurrency(state);
    if (!waiting.length) return;
    const dlg = $("#curDlg");
    const options = `<option value="">Choose…</option>${CURRENCIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}`;
    $("#curList").innerHTML = waiting
      .map(
        (b) =>
          `<label><span dir="auto">${esc(b.account)}</span> <span class="sub">${esc(b.periods.length === 1 ? monthName(b.periods[0]) : `${b.periods.length} months`)} · <span dir="auto">${esc(b.file)}</span></span><select data-batch="${esc(b.id)}">${options}</select></label>`,
      )
      .join("");
    const chosen = () =>
      [...$("#curList").querySelectorAll("select")].filter((s) => s.value);
    $("#curOk").disabled = true;
    $("#curList").onchange = () => {
      // One answer fills the others still unanswered, since statements
      // usually share a currency; each can still be changed.
      const first = chosen()[0]?.value;
      for (const s of $("#curList").querySelectorAll("select"))
        if (!s.value && first) s.value = first;
      $("#curOk").disabled = chosen().length < waiting.length;
    };
    $("#curOk").onclick = () => {
      for (const s of chosen()) {
        const b = state.batches[s.dataset.batch];
        setCurrency(b, s.value);
        actions.saveBatch(b);
      }
      dlg.close();
      actions.refresh();
    };
    $("#curLater").onclick = () => dlg.close();
    dlg.showModal();
  }

  return { importFiles, askCurrencies };
}

export const contract = {
  name: "import",
  create: createImport,
  provides: ["importFiles", "askCurrencies"],
  requires: [
    "AI",
    "openTab",
    "refresh",
    "replaceDemo",
    "runStale",
    "sampleErr",
    "save",
    "saveBatch",
    "staleReports",
  ],
  renders: [],
  wires: [],
};
