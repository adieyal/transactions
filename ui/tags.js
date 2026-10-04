import { toast } from "./dom.js";
import { esc } from "../helpers.js";
import {
  parseTags,
  restoreNotes,
  retag,
  tagsOf,
} from "../transactions/tags.js";

export function createTags(runtime, actions) {
  const { state } = runtime;
  function bulkTag(ids, add = [], remove = []) {
    const { notes, previous } = retag(state.notes, ids, add, remove);
    const n = Object.keys(previous).length;
    if (!n) {
      toast(
        add.length
          ? "They all have that tag already."
          : "None of them had that tag.",
      );
      return;
    }
    state.notes = notes;
    actions.save("notes");
    actions.refresh();
    const what = [
      add.length ? `added ${add.join(" ")}` : "",
      remove.length ? `removed ${remove.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    toast(
      `${what[0].toUpperCase() + what.slice(1)} on ${n} transaction${n > 1 ? "s" : ""}.`,
      9000,
      {
        label: "Undo",
        fn: () => {
          state.notes = restoreNotes(state.notes, previous);
          actions.save("notes");
          actions.refresh();
          toast("Tags put back as they were.");
        },
      },
    );
  }

  function tagToolsHTML(ids, key) {
    const counts = {};
    for (const id of ids)
      for (const t of tagsOf(state.notes[id])) counts[t] = (counts[t] || 0) + 1;
    const have = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return `<div class="tagtools" data-tagkey="${key}"><input data-tagin placeholder="#tag or several" aria-label="Tags to add" list="allTags"><datalist id="allTags">${Object.keys(
      runtime.derived.tags,
    )
      .map((t) => `<option value="${esc(t)}">`)
      .join("")}</datalist>
    <button class="btn small" data-tagadd>Add tag${ids.length > 1 ? ` to ${ids.length}` : ""}</button>
    ${have.map(([t, c]) => `<span class="tagchip" dir="auto">${esc(t)}${ids.length > 1 ? ` <span class="sub">${c}</span>` : ""}<button data-tagrm="${esc(t)}" title="Remove ${esc(t)} from ${c > 1 ? "these " + c : "this one"}" aria-label="Remove ${esc(t)}">×</button></span>`).join("")}</div>`;
  }

  function wireTagTools(root, getIds) {
    const box = root.querySelector(".tagtools");
    if (!box) return;
    const input = box.querySelector("[data-tagin]");
    const add = () => {
      const tags = parseTags(input.value);
      if (!tags.length) {
        input.focus();
        return;
      }
      bulkTag(getIds(), tags, []);
    };
    box.querySelector("[data-tagadd]").onclick = add;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        add();
      }
    });
    box
      .querySelectorAll("[data-tagrm]")
      .forEach(
        (b) => (b.onclick = () => bulkTag(getIds(), [], [b.dataset.tagrm])),
      );
  }

  return { bulkTag, parseTags, tagToolsHTML, wireTagTools };
}

export const contract = {
  name: "tags",
  create: createTags,
  provides: ["bulkTag", "parseTags", "tagToolsHTML", "wireTagTools"],
  requires: ["refresh", "save"],
  renders: [],
  wires: [],
};
