import { addMonths, TODAY } from "./helpers.js";

// Every account, merchant, transaction and story below is fictional.
export function createDemoData(today = TODAY) {
  const batches = {},
    notes = {};
  const months = [-3, -2, -1].map((offset) =>
    addMonths(today.slice(0, 7) + "-01", offset).slice(0, 7),
  );
  const latest = months.at(-1);
  for (const [index, month] of months.entries()) {
    const bank = [],
      card = [],
      savings = [];
    function add(rows, account, merchant, day, amount, extra = {}) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const transaction = {
        id: `demo-${month}-${account.replaceAll(" ", "-").toLowerCase()}-${rows.length + 1}`,
        account,
        period: month,
        date,
        chargeDate: date,
        merchant,
        amount,
        orig: null,
        type: "Demo purchase",
        details: "",
        inst: null,
        section: "",
        file: `fictional-${month}.csv`,
        ...extra,
      };
      rows.push(transaction);
      return transaction;
    }
    add(bank, "Demo Everyday", "Brightwell Energy", 3, 145 + index * 10);
    add(bank, "Demo Everyday", "Willow Water", 5, 42);
    add(bank, "Demo Everyday", "Cloudfern Internet", 7, 65);
    add(card, "Demo Card", "Harbor Pantry", 4, 125 + index * 8);
    add(card, "Demo Card", "Harbor Pantry", 20, 92 + index * 5);
    add(card, "Demo Card", "Paper Kite Cafe", 9, 24 + index * 3);
    add(card, "Demo Card", "Loopway Transit", 12, 38);
    add(card, "Demo Card", "Lantern Stream", 15, index === 2 ? 35 : 29);
    const pet = add(
      bank,
      "Demo Everyday",
      "Meadow Paws",
      18,
      index === 2 ? 95 : 55,
    );
    notes[pet.id] = "Supplies for Pixel, our fictional demo cat. #pets";
    if (index === 2) {
      const furniture = add(card, "Demo Card", "Oak & Loom", 14, 60, {
        date: `${months[0]}-14`,
        inst: { n: 2, of: 6 },
        orig: { amount: 360, currency: "ILS" },
        details: "Demo desk, payment 2 of 6",
      });
      notes[furniture.id] = "A made-up desk for the reading corner. #home";
      const hotel = add(card, "Demo Card", "Lantern Bay Guesthouse", 16, 230);
      add(card, "Demo Card", "Lantern Bay Ferry", 17, 48);
      notes[hotel.id] = "Fictional weekend away. #trip";
      add(card, "Demo Card", "Harbor Pantry", 23, -18, {
        type: "Demo refund",
        details: "Returned an unopened item",
      });
    }
    add(
      bank,
      "Demo Everyday",
      "Demo Card payment",
      28,
      card.reduce((sum, row) => sum + row.amount, 0),
      { type: "Demo transfer" },
    );
    add(bank, "Demo Everyday", "Demo savings transfer", 24, 350, {
      type: "Demo transfer",
    });
    add(savings, "Demo Savings", "Demo savings received", 25, -350, {
      type: "Demo transfer",
    });
    for (const [account, rows, isCard] of [
      ["Demo Everyday", bank, false],
      ["Demo Card", card, true],
      ["Demo Savings", savings, false],
    ]) {
      const id = `demo-${account.replaceAll(" ", "-").toLowerCase()}-${month}`;
      batches[id] = {
        id,
        kind: "generic",
        card: isCard,
        account,
        periods: [month],
        file: `fictional-${month}.csv`,
        added: today,
        rows,
      };
    }
  }
  return {
    batches: Object.fromEntries(
      Object.entries(batches).sort(([a], [b]) => a.localeCompare(b)),
    ),
    notes,
    periods: [
      {
        id: "demo-trip",
        name: "Weekend in Lantern Bay",
        start: `${latest}-15`,
        end: `${latest}-18`,
        color: "#2F6B8F",
        story:
          "This is a fictional weekend in Lantern Bay. We stayed at the guesthouse and took the ferry. Routine bills and pet supplies happened during the same dates but were not part of the trip.",
      },
    ],
  };
}
