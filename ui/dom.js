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
export { toast };
