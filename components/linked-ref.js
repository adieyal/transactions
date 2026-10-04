import { periodPayments } from "../transactions/period-stats.js";
import { emitHighlight } from "./base.js";

// Linked references (ADR 0012): anything that stands for a set of payments.
// That covers a dotted story phrase (.sp[data-ids]), a citation
// ([data-cite]), and an element marked data-ref: a period chip
// (data-period-ref, its payments found from the period's id, not its name),
// a thread name, or a bench line (data-ids). One delegated controller per
// host gives them all the same behaviour:
// - hovering or focusing lights up their beads (tx-highlight), and leaving
//   puts back what was lit before;
// - a click, Enter or Space pins them as the selection (tx-select, answered
//   by actions.select), which stays after the pointer leaves and opens in
//   the bench like any selection. Clicking again or Escape releases it, and
//   pinning something else replaces it. A pinned reference shows
//   aria-pressed="true".
// data-ref="hover" lights up without pinning, for elements whose click does
// something else (a busy stretch's chip names it).
export const REF = ".sp[data-ids], [data-cite], [data-ref]";

// The payment ids a reference stands for.
export function refIds(el, runtime) {
  const d = el.dataset;
  if (d.periodRef) {
    const p = runtime.state.periods.find((x) => x.id === d.periodRef);
    return p && runtime.derived
      ? periodPayments(runtime.derived.allTxns, p)
      : [];
  }
  if (d.ids) return d.ids.split(",").filter(Boolean);
  return d.cite ? [d.cite] : [];
}

const pins = (el) => el.dataset.ref !== "hover";
const same = (ids, set) =>
  ids.length > 0 && ids.length === set.size && ids.every((i) => set.has(i));

// Pins a reference's payments as the selection, or releases them if they
// are the selection already. For a host whose own click handler claims the
// element first (a period's name on <tx-period-strip>).
export function togglePin(el, runtime) {
  const ids = refIds(el, runtime);
  if (!ids.length) return;
  const on = same(ids, runtime.state.selection);
  el.dispatchEvent(
    new CustomEvent("tx-select", {
      bubbles: true,
      detail: { ids: on ? [] : ids },
    }),
  );
}

// aria-pressed and the pressed look on every pinnable reference in host.
export function markRefs(host, runtime) {
  host.querySelectorAll(REF).forEach((el) => {
    if (refocus && keyOf(el) === refocus && el.isConnected) {
      refocus = null;
      el.focus();
    }
    if (!pins(el)) return;
    const on = same(refIds(el, runtime), runtime.state.selection);
    if (el.tagName !== "BUTTON") el.setAttribute("role", "button");
    el.setAttribute("aria-pressed", String(on));
    el.classList.toggle("pinned", on);
  });
}

// A reference pinned from the keyboard keeps its focus across the refresh
// that redraws it: found again by what it stands for.
let refocus = null;
const keyOf = (el) =>
  `${el.classList[0]} ${el.dataset.periodRef ?? el.dataset.ids ?? el.dataset.cite}`;

// One event is handled once, by the innermost host that wired it.
const handled = new WeakSet();

// Wires host's references. opts.pin: false lights up only (the old panel's
// inspector, where a click opens things of its own).
export function wireLinkedRefs(host, runtime, { pin = true } = {}) {
  const { state } = runtime;
  let hovered = null,
    before = null;
  const target = (node) => {
    const el = node?.closest?.(REF);
    return el && host.contains(el) ? el : null;
  };
  const claim = (e) => {
    if (handled.has(e)) return false;
    handled.add(e);
    return true;
  };
  function show(el) {
    const ids = refIds(el, runtime);
    host.querySelectorAll(".sp.on").forEach((x) => x.classList.remove("on"));
    el.classList.add("on");
    if (!(hovered && state.highlight === hovered)) before = state.highlight;
    hovered = new Set(ids);
    emitHighlight(host, hovered);
  }
  function hide(el) {
    el.classList.remove("on");
    if (hovered && state.highlight === hovered)
      emitHighlight(host, before ?? new Set());
    hovered = before = null;
  }
  for (const [type, fn] of [
    ["mouseover", show],
    ["focusin", show],
    ["mouseout", hide],
    ["focusout", hide],
  ])
    host.addEventListener(type, (e) => {
      const el = target(e.target);
      if (!el || el.contains(e.relatedTarget) || !claim(e)) return;
      fn(el);
    });
  if (!pin) return;
  const toggle = (el) => {
    // The pin replaces the hover's highlight, so leaving keeps it.
    hovered = before = null;
    togglePin(el, runtime);
  };
  host.addEventListener("click", (e) => {
    const el = target(e.target);
    if (!el || !pins(el) || !claim(e)) return;
    toggle(el);
  });
  host.addEventListener("keydown", (e) => {
    const el = target(e.target);
    if (!el || !claim(e)) return;
    if (e.key === "Escape" && state.selection.size) {
      hovered = before = null;
      refocus = keyOf(el);
      el.dispatchEvent(
        new CustomEvent("tx-select", { bubbles: true, detail: { ids: [] } }),
      );
    } else if (
      pins(el) &&
      el.tagName !== "BUTTON" &&
      (e.key === "Enter" || e.key === " ")
    ) {
      e.preventDefault();
      refocus = keyOf(el);
      toggle(el);
    }
  });
  const off = runtime.store.subscribe(() => {
    if (!host.isConnected) return off();
    queueMicrotask(() => markRefs(host, runtime));
  });
  queueMicrotask(() => markRefs(host, runtime));
}
