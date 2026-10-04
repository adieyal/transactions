import { $ } from "../helpers.js";

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

export { paneShown, toast };
