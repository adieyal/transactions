// The M3 verifier's five-month CSV (ZAR, April to August 2026, no threads),
// as one statement a month, for story tests.
import { readFileSync } from "node:fs";

export function fiveMonths() {
  const text = readFileSync(
    new URL("./five-months.csv", import.meta.url),
    "utf8",
  );
  const batches = {};
  text
    .trim()
    .split("\n")
    .slice(1)
    .forEach((line, i) => {
      const [date, merchant, amount, currency] = line.split(",");
      const period = date.slice(0, 7);
      const id = `five-${period}`;
      batches[id] ||= {
        id,
        kind: "generic",
        currency,
        card: false,
        account: "Everyday",
        periods: [period],
        file: `five-${period}.csv`,
        added: "2026-10-04",
        rows: [],
      };
      batches[id].rows.push({
        id: `${id}-${i}`,
        account: "Everyday",
        period,
        date,
        chargeDate: date,
        merchant,
        amount: -Number(amount),
        currency,
        orig: null,
        type: "",
        details: "",
        inst: null,
        section: "",
        file: batches[id].file,
      });
    });
  return { batches, notes: {}, periods: [] };
}
