import { normText } from "../helpers.js";
import { PALETTE } from "./constants.js";

function parseRules(text) {
  const lines = text.split("\n");
  const threads = [];
  const errors = {};
  let cur = null;
  const mk = (src, line) => {
    src = src.trim();
    if (!src) return null;
    const rm = src.match(/^\/(.+)\/([a-z]*)$/);
    if (rm) {
      try {
        const re = new RegExp(rm[1], rm[2].includes("i") ? rm[2] : rm[2] + "i");
        return { line, src, test: (t) => re.test(t.raw) };
      } catch (e) {
        errors[line] = "This pattern isn't a valid regular expression";
        return null;
      }
    }
    if (src.startsWith("#")) {
      const tag = src.toLowerCase();
      return { line, src, test: (t) => t.noteLower.includes(tag) };
    }
    const n = normText(src);
    if (!n) {
      errors[line] =
        "Nothing left to match once numbers and punctuation are removed";
      return null;
    }
    return { line, src, test: (t) => t.norm.includes(n) };
  };
  lines.forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith("//")) return;
    const indented = /^\s/.test(raw);
    if (!indented) {
      if (s.startsWith("#")) return; // a top-level # line reads as a comment
      let head = s,
        budget = null;
      const bm = head.match(
        /\[\s*budget\s+([\d,.]+)\s*(?:\/\s*(?:month|mo))?\s*\]/i,
      );
      if (bm) {
        budget = parseFloat(bm[1].replace(/,/g, ""));
        head = (
          head.slice(0, bm.index) + head.slice(bm.index + bm[0].length)
        ).trim();
      }
      const ci = head.indexOf(":");
      let name = head,
        inline = [];
      if (ci > 0) {
        name = head.slice(0, ci).trim();
        inline = head
          .slice(ci + 1)
          .split(",")
          .filter((x) => x.trim());
      }
      cur = {
        name,
        line: i,
        patterns: [],
        budget: isFinite(budget) ? budget : null,
      };
      threads.push(cur);
      inline.forEach((p) => {
        const pp = mk(p, i);
        if (pp) cur.patterns.push(pp);
      });
    } else {
      if (!cur) {
        errors[i] = "Indented lines belong under a thread name";
        return;
      }
      const pp = mk(s, i);
      if (pp) cur.patterns.push(pp);
    }
  });
  const seen = {};
  threads.forEach((t) => {
    const k = t.name.toLowerCase();
    if (seen[k] != null)
      errors[t.line] =
        "Another thread already has this name, so this one is merged into it";
    seen[k] ??= t;
  });
  const merged = [];
  const byName = {};
  threads.forEach((t) => {
    const k = t.name.toLowerCase();
    if (byName[k]) {
      byName[k].patterns.push(...t.patterns);
      byName[k].budget ??= t.budget;
    } else {
      byName[k] = { ...t, patterns: [...t.patterns] };
      merged.push(byName[k]);
    }
  });
  merged.forEach((t, i) => (t.color = PALETTE[i % PALETTE.length]));
  return { threads: merged, errors, lineCount: lines.length };
}
export { parseRules };
