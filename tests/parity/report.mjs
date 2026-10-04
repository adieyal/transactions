// Writes the parity table as Markdown from manifest.json and the --json
// results of run.mjs: losses (fail, unreachable) first, then bench only,
// then pass.
//
//   node tests/parity/report.mjs <new.json> [<old.json>] > REPORT-table.md

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const [newPath, oldPath] = process.argv.slice(2);
const results = new Map(
  JSON.parse(readFileSync(newPath, "utf8")).map((r) => [r.id, r]),
);
const old = oldPath
  ? new Map(JSON.parse(readFileSync(oldPath, "utf8")).map((r) => [r.id, r]))
  : null;

const order = { fail: 0, unreachable: 1, bench: 2, pass: 3 };
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const rows = manifest.entries
  .filter((e) => results.has(e.id))
  .map((e) => ({ e, r: results.get(e.id) }))
  .sort((a, b) => order[a.r.status] - order[b.r.status]);

console.log(
  `| Result | Id | What the person does | Expected effect | 8d87cd2 | Selector at 8d87cd2 |${old ? " 8d87cd2 run |" : ""} Detail |`,
);
console.log(`|---|---|---|---|---|---|${old ? "---|" : ""}---|`);
for (const { e, r } of rows) {
  const status = r.status === "bench" ? "bench only" : r.status;
  console.log(
    `| **${status}** | \`${e.id}\` | ${cell(e.does)} | ${cell(e.effect)} | \`${e.source}\` | \`${cell(e.selector)}\` |${old ? ` ${old.get(e.id)?.status ?? "–"} |` : ""} ${cell(r.detail || "")} |`,
  );
}
