// Shared by the components in this folder (ADR 0009). Nothing here reaches
// outside the element it is given.

// Subscribes el to the store while it is in the page, and unsubscribes when
// it leaves, so a removed element stops drawing.
export function subscribeWhileConnected(el, store, fn) {
  el.unsubscribe?.();
  const off = store.subscribe((change) => {
    if (!el.isConnected) {
      off();
      return;
    }
    fn(change);
  });
  el.unsubscribe = off;
}

// Asks for transactions to be lit up on the timeline. main.js answers the
// event; the store then tells every component about the new highlight.
export function emitHighlight(el, ids, { clearSelection = false } = {}) {
  el.dispatchEvent(
    new CustomEvent("tx-highlight", {
      bubbles: true,
      detail: { ids, clearSelection },
    }),
  );
}
