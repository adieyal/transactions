import { esc } from "../helpers.js";
// The first element matching a selector, in the document or under el.
const $ = (s, el = document) => el.querySelector(s);

let toastTimer;

function toast(msg, t = 4200, action) {
  const el = $("#toast");
  el.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.className = "toastbtn";
    b.onclick = () => {
      el.style.display = "none";
      action.fn();
    };
    el.append(" ", b);
  }
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => (el.style.display = "none"),
    action ? Math.max(t, 9000) : t,
  );
}
// Whether a side-panel pane is the open tab. Renders for a pane return early
// when it isn't; opening the tab redraws it.
const paneShown = (name) =>
  !!document.getElementById("pane-" + name)?.classList.contains("on");

// HTML with every interpolated value escaped. A value made by html (or
// wrapped in raw, for markup built elsewhere such as markdown output) goes in
// as it is; an array is joined; null and undefined add nothing. Booleans
// print as true or false, as in a plain template (aria-pressed="false").
class Raw {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}
const raw = (text) => new Raw(String(text));
const part = (v) =>
  v instanceof Raw
    ? v.text
    : Array.isArray(v)
      ? v.map(part).join("")
      : v == null
        ? ""
        : esc(v);
function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => (out += part(v) + strings[i + 1]));
  return new Raw(out);
}

export { $, html, paneShown, raw, toast };
