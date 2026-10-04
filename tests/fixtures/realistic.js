// A fictional workspace shaped like a real card account, for the problems a
// playtest with real data found (docs/story-first-plan.md). Every name and
// amount below is made up; only the patterns match what real statements do.
//
// One card account. Each statement is labelled with the month it is charged
// in (the 10th) and holds the purchases of the month before, so purchases
// from January to September arrive in statements labelled February to
// October. Today is 4 October: October's own purchases have no statement yet.

export const REALISTIC_TODAY = "2026-10-04";
// The fictional card's statements are in shekels.
export const CURRENCY = "ILS";
// A Hebrew account label with digits, as Israeli card exports have.
export const ACCOUNT = "כרטיס בדוי 4821";

// Calendar months with purchases, oldest first.
export const PURCHASE_MONTHS = [
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
];

export const M = {
  // Mixed Hebrew and English names, to check their direction in sentences.
  payer: "Northwind Payroll בע״מ",
  power: "Brightline Power",
  fee: "Card Fee",
  phone: "Skyreach Mobile",
  stream: "Streamly",
  music: "Tunebox",
  insurance: "Harbourside Home Insurance",
  parking: "Parkly Parking",
  vet: "Willowbrook Vet Clinic",
  grocer: "Greenbasket Market",
  cafe: "Copperleaf Cafe",
  furniture: "ol2kridge רהיטים",
  books: "Pagebound Books",
  florist: "Sweetpea Florist",
};

// The phone sits in a thread of cheaper charges with a budget it is always
// over, as in the playtest.
export const RULES = `To Cancel  [budget 60]
  skyreach mobile
  tunebox
  #to_cancel

Bills
  brightline power
  card fee

Subscriptions
  streamly

Groceries  [budget 1200]
  greenbasket market

Getting around
  parkly parking

Pets
  willowbrook vet clinic

Insurance
  harbourside home insurance
`;

// One-off places that no thread rule matches, so they land in Loose ends.
// Each name is used once: a place name per month and a kind of shop.
const PLACES = [
  "Fernhill",
  "Lanternlight",
  "Bramble",
  "Quayside",
  "Tidewater",
  "Silverbirch",
  "Driftwood",
  "Cobalt",
  "Juniper",
];
const SHOPS = ["Bakery", "Gift Shop", "Hardware"];

const pad = (n) => String(n).padStart(2, "0");
const nextMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};

export function createRealisticData() {
  const batches = {};
  for (const [index, month] of PURCHASE_MONTHS.entries()) {
    const statement = nextMonth(month);
    const rows = [];
    // A small deterministic wobble, so amounts vary without randomness.
    const wobble = (n, span) => ((index * 37 + n * 11) % (2 * span + 1)) - span;
    const add = (merchant, d, amount, extra = {}) =>
      rows.push({
        id: `real-${month}-${rows.length + 1}`,
        account: ACCOUNT,
        period: statement,
        date: `${month}-${pad(d)}`,
        chargeDate: `${statement}-10`,
        merchant,
        amount,
        currency: CURRENCY,
        orig: null,
        type: "Fictional purchase",
        details: "",
        inst: null,
        section: "",
        file: `fictional-card-${statement}.csv`,
        ...extra,
      });

    // Money in: a salary-like payment from a payer, steady until a raise.
    add(M.payer, 28, index === 8 ? -11250 : -9400, {
      type: "Fictional credit",
    });
    // Electricity, billed every second month; a small card fee every month.
    if (index % 2 === 0) add(M.power, 14, [520, 610, 480, 575, 555][index / 2]);
    add(M.fee, 2, 18);
    // Fixed recurring charges.
    add(M.phone, 6, 119);
    add(M.stream, 15, index === 8 ? 35 : 30);
    add(M.music, 21, 25);
    // Home insurance, monthly until May, then nothing.
    if (index <= 4) add(M.insurance, 26, 210);
    // Pay-as-you-go parking, billed once a month for the month's use.
    if (index === 7) add(M.parking, 31, 16);
    if (index === 8) add(M.parking, 30, 126);
    // A vet, for two unrelated visits.
    if (index === 2) add(M.vet, 17, 1840);
    if (index === 6) add(M.vet, 9, 760);
    // Groceries most weeks, and a coffee now and then.
    for (const [w, d] of [3, 11, 19, 25].entries())
      add(M.grocer, d, 210 + wobble(w, 60));
    add(M.cafe, 8, 32 + wobble(5, 10));
    if (index % 3 === 0) add(M.cafe, 23, 28 + wobble(6, 8));
    // A sizeable set of uncategorised one-off charges.
    for (let k = 0; k < 3; k++)
      add(
        `${PLACES[index]} ${SHOPS[k]}`,
        5 + k * 8,
        60 + ((index * 53 + k * 97) % 190),
      );
    // An ordinary week in June: one big purchase and two small unrelated ones.
    if (month === "2026-06") {
      add(M.books, 9, 48);
      add(M.furniture, 10, 2450);
      add(M.florist, 12, 75);
    }
    // A real refund, from a shop also paid.
    if (index === 8)
      add(M.grocer, 22, -64, {
        type: "Fictional refund",
        details: "Returned item",
      });
    // A refund of a few shekels, too small to mention.
    if (index === 6) add(M.grocer, 24, -4.5, { type: "Fictional refund" });

    const id = `real-card-${statement}`;
    batches[id] = {
      id,
      kind: "generic",
      currency: CURRENCY,
      card: true,
      account: ACCOUNT,
      periods: [statement],
      file: `fictional-card-${statement}.csv`,
      added: REALISTIC_TODAY,
      rows,
    };
  }
  return { batches, notes: {}, periods: [], rules: RULES };
}
