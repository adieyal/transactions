import { esc, fmt } from "../helpers.js";

// The little markdown the assistant and people write: paragraphs, line
// breaks, "- " lists, **bold** and [[id]] citations. Everything is escaped
// first, so the only markup in the result is what this function adds.
// byId: the derived transactions, for citation labels; an unknown id is dropped.
export function markdown(text, byId) {
  const withCites = esc(text)
    .replace(/\[\[([a-z0-9\-]+)\]\]/gi, (_, id) => {
      const t = byId.get(id);
      return t
        ? `<button class="cite" data-cite="${id}" title="${esc(t.merchant)}"><span dir="auto">${esc(t.merchant.slice(0, 22))}</span> ${fmt(t.amount, 0, t.currency)}</button>`
        : "";
    })
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return withCites
    .split(/\n{2,}/)
    .map((b) => {
      const ls = b.split("\n");
      if (ls.every((l) => /^\s*[-*•] /.test(l)))
        return `<ul>${ls.map((l) => `<li>${l.replace(/^\s*[-*•] /, "")}</li>`).join("")}</ul>`;
      return `<p>${ls.join("<br>")}</p>`;
    })
    .join("");
}
