import { test } from "node:test";
import assert from "node:assert/strict";
import { notesHTML } from "../components/tx-year-story.js";

// The person's feedback: "Your notes" as a real table, tags as chips.
test("Your notes is a table with Date, Payment, Amount and Note", () => {
  const html = notesHTML([
    {
      date: "2026-01-10",
      merchant: "Cobble Lane Garage",
      amount: 120,
      currency: "ILS",
      text: "Tow home after the clutch went. #car #repair",
    },
  ]);
  assert.match(html, /<table class="yr-notetable"><caption[^>]*>Your notes</);
  assert.deepEqual(
    [...html.matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((m) => m[1]),
    ["Date", "Payment", "Amount", "Note"],
  );
  assert.match(html, /<td[^>]*>Cobble Lane Garage<\/td>/);
  assert.match(html, /₪120/);
  // Each tag is a linked reference to every payment carrying it.
  assert.deepEqual(
    [...html.matchAll(/class="yr-tag"[^>]*data-ref data-tag="([^"]+)">#/g)].map(
      (m) => m[1],
    ),
    ["#car", "#repair"],
  );
  assert.match(html, /<span>Tow home after the clutch went\.<\/span>/);
});
