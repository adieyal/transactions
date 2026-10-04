// A phrase that lights up its transactions, or plain text when it has none.
export const phraseHTML = (p, esc) =>
  p.txnIds?.length
    ? `<span class="sp" tabindex="0" data-ids="${esc(p.txnIds.join(","))}">${esc(p.text)}</span>`
    : esc(p.text);

// Whether ids are exactly the lit-up transactions.
export const sameIds = (ids, highlight) =>
  ids.length > 0 &&
  ids.length === highlight.size &&
  ids.every((i) => highlight.has(i));
