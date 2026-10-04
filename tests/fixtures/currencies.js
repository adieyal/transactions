import { createDemoData } from "../../demo.js";

// Fictional workspaces in other currencies, made from the demo's fictional
// year: one in US dollars only, and one with its card in pounds and its bank
// and savings in euros.
export const TODAY = "2026-09-30";

export const usdWorkspace = () =>
  createDemoData(TODAY, { currencyOf: () => "USD" });

export const eurGbpWorkspace = () =>
  createDemoData(TODAY, {
    currencyOf: (account) => (account === "Demo Card" ? "GBP" : "EUR"),
  });
