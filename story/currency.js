import { withCurrency } from "../helpers.js";
import { list } from "./copy.js";

// Amounts in different currencies are never added up or compared. A story is
// told once per currency, from a view of the data holding only that
// currency's transactions, and each view formats its money in that currency.

const sorted = (xs) => [...new Set(xs)].sort();

export const currenciesOf = (txns) => sorted(txns.map((t) => t.currency));

// The derived data as if only one currency's transactions existed. Coverage
// keeps the accounts that hold that currency.
export function currencyView(derived, currency) {
  const own = (t) => t.currency === currency;
  const allTxns = derived.allTxns.filter(own);
  const accounts = new Set(allTxns.map((t) => t.account));
  return {
    ...derived,
    currency,
    txns: derived.txns.filter(own),
    allTxns,
    expected: (derived.expected || []).filter(own),
    purchaseCoverage: Object.fromEntries(
      Object.entries(derived.purchaseCoverage).filter(([a]) => accounts.has(a)),
    ),
  };
}

// fn(view) for each currency among txns, inside that currency. Returns the
// results in currency order, each with its currency.
export const eachCurrency = (derived, txns, fn) =>
  currenciesOf(txns).map((c) => ({
    currency: c,
    value: withCurrency(c, () => fn(currencyView(derived, c))),
  }));

// Sections told per currency. With one currency they are the plain sections;
// with several, a first line says so and each currency's sections follow
// under its own heading. With none there is no money to tell.
export function sectionsPerCurrency(derived, txns, fn) {
  const runs = eachCurrency(derived, txns, fn);
  if (!runs.length)
    return [
      {
        kind: "empty",
        parts: [
          {
            text: derived.unpriced
              ? "Some statements are waiting for you to say their currency, so their amounts aren't shown yet."
              : "Nothing went out or came in here.",
          },
        ],
      },
    ];
  if (runs.length === 1)
    return runs[0].value.map((s) => ({ ...s, currency: runs[0].currency }));
  const codes = runs.map((r) => r.currency);
  return [
    {
      kind: "currencies",
      parts: [
        {
          text: `These amounts are in ${list(codes)}. Each currency is told on its own, without converting.`,
        },
      ],
    },
    ...runs.flatMap((r) => [
      { kind: "heading", currency: r.currency, parts: [{ text: r.currency }] },
      ...r.value.map((s) => ({ ...s, currency: r.currency })),
    ]),
  ];
}
