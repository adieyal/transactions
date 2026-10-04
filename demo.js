import { addMonths } from "./helpers.js";

// Every account, merchant, transaction and story below is fictional.
// The year has three parts: the car breaks down and the holiday savings
// pause, a move to a new flat brings a burst of appliances, and the year
// ends with the holiday the savings were for. The car and the holiday come
// explained with periods and notes; the move is left for the app to ask
// about, so the demo shows a question turning into a period.
const CAR = 3,
  MOVE = 7;

export function createDemoData(today) {
  const batches = {},
    notes = {};
  const months = Array.from({ length: 12 }, (_, i) =>
    addMonths(today.slice(0, 7) + "-01", i - 12).slice(0, 7),
  );
  const latest = months.length - 1;
  const day = (index, d) => `${months[index]}-${String(d).padStart(2, "0")}`;
  for (const [index, month] of months.entries()) {
    const bank = [],
      card = [],
      savings = [];
    function add(rows, account, merchant, d, amount, extra = {}) {
      const date = day(index, d);
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
    const note = (t, text) => (notes[t.id] = text);
    const wobble = (n) => ((index * 37 + n) % 23) - 11;

    add(bank, "Demo Everyday", "Brightwell Energy", 3, 140 + wobble(5) * 2);
    add(bank, "Demo Everyday", "Willow Water", 5, 42);
    add(bank, "Demo Everyday", "Cloudfern Internet", 7, 65);
    add(card, "Demo Card", "Harbor Pantry", 4, 125 + wobble(1));
    add(card, "Demo Card", "Harbor Pantry", 20, 95 + wobble(7));
    add(card, "Demo Card", "Paper Kite Cafe", 9, 26 + wobble(3));
    add(card, "Demo Card", "Loopway Transit", 12, 38);
    add(card, "Demo Card", "Lantern Stream", 15, index === latest ? 35 : 29);
    const pet = add(
      bank,
      "Demo Everyday",
      "Meadow Paws",
      18,
      index === latest ? 95 : 55,
    );
    note(pet, "Supplies for Pixel, our fictional demo cat. #pets");

    if (index === CAR) {
      const tow = add(card, "Demo Card", "Cobble Lane Garage", 10, 120);
      note(tow, "Tow home after the clutch went on the ring road. #car");
      const repair = add(card, "Demo Card", "Cobble Lane Garage", 13, 1480);
      note(
        repair,
        "New clutch. Paid from the holiday money, so the savings transfers stop for a while. #car",
      );
    }

    if (index === MOVE) {
      add(bank, "Demo Everyday", "Bluebell Removals", 9, 640);
      add(bank, "Demo Everyday", "Cloudfern Internet", 10, 58, {
        details: "Connection at new address",
      });
      add(card, "Demo Card", "Kettle & Coil", 11, 890);
      add(card, "Demo Card", "Kettle & Coil", 12, 540);
      add(card, "Demo Card", "Kettle & Coil", 14, 75);
      add(card, "Demo Card", "Northgate Hardware", 15, 48);
      add(card, "Demo Card", "Linen Lane", 16, 120, {
        details: "Curtains",
      });
      add(card, "Demo Card", "Paper Kite Cafe", 11, 31);
      add(card, "Demo Card", "Paper Kite Cafe", 13, 27);
      add(card, "Demo Card", "Northgate Hardware", 22, 32);
      add(card, "Demo Card", "Northgate Hardware", 27, 64);
    }

    if (index === latest) {
      const desk = add(card, "Demo Card", "Oak & Loom", 14, 60, {
        date: day(latest - 2, 14),
        inst: { n: 2, of: 6 },
        orig: { amount: 360, currency: "ILS" },
        details: "Demo desk, payment 2 of 6",
      });
      note(desk, "A desk for the reading corner in the new flat. #home");
      const hotel = add(card, "Demo Card", "Lantern Bay Guesthouse", 20, 620);
      note(hotel, "Five nights by the harbour. #trip");
      add(card, "Demo Card", "Lantern Bay Ferry", 15, 48);
      add(card, "Demo Card", "Lantern Bay Ferry", 20, 48);
      add(card, "Demo Card", "Lantern Bay Fish Bar", 17, 54);
      add(card, "Demo Card", "Harbor Pantry", 23, -18, {
        type: "Demo refund",
        details: "Returned an unopened item",
      });
      add(savings, "Demo Savings", "Holiday fund to Everyday", 12, 1200, {
        type: "Demo transfer",
      });
      add(bank, "Demo Everyday", "From Demo Savings", 12, -1200, {
        type: "Demo transfer",
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
    // The car repair used the holiday money; saving resumes two months later.
    if (index !== CAR && index !== CAR + 1) {
      add(bank, "Demo Everyday", "Demo savings transfer", 24, 150, {
        type: "Demo transfer",
      });
      add(savings, "Demo Savings", "Demo savings received", 25, -150, {
        type: "Demo transfer",
      });
    }
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
        id: "demo-car",
        name: "The car broke down",
        start: day(CAR, 10),
        end: day(CAR, 13),
        color: "#9A5B2E",
        story:
          "The clutch went on the ring road. The tow and the repair came out of the holiday fund, and we skipped the next two savings transfers to get back on our feet.",
      },
      {
        id: "demo-trip",
        name: "Holiday in Lantern Bay",
        start: day(latest, 15),
        end: day(latest, 20),
        color: "#2F6B8F",
        story:
          "The holiday we had been saving for all year. The car set the fund back two months, but we got there. Routine bills and pet supplies happened during the same dates but were not part of the trip.",
      },
    ],
  };
}
