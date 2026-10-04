import { lensFmt } from "../lens-api.js";

// Lens code runs in a hidden frame with an opaque origin (sandbox without
// allow-same-origin) and a CSP that allows only its own inline script: it
// can't reach this page, its storage or the network. Data goes in and plain
// view objects come back by postMessage; a lens that runs too long is
// stopped by replacing the frame.

const TIMEOUT_MS = 1500;
// unsafe-eval: the runner builds each lens with new Function; default-src 'none'
// still blocks every request, including connect-src.
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'";

// Runs inside the frame. lib's functions are rebuilt here; its data comes in.
function runner(fmtSource) {
  const fmt = (0, eval)(fmtSource);
  addEventListener("message", (e) => {
    const { id, code, txns, data } = e.data || {};
    const lib = {
      sum: (a, f = (x) => x) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0),
      groupBy: (a, f) =>
        a.reduce((o, x) => {
          const k = f(x);
          (o[k] ||= []).push(x);
          return o;
        }, {}),
      month: (d) => String(d).slice(0, 7),
      fmt: (n, currency) => fmt(n, currency, data.currencies),
      ...data,
    };
    let reply;
    try {
      const view = new Function("txns", "lib", code)(txns, lib);
      if (!view || typeof view !== "object")
        throw new Error(
          "The lens needs to return a view, e.g. { kind: 'bars', items: [...] }",
        );
      reply = { id, ok: true, view: JSON.parse(JSON.stringify(view)) };
    } catch (err) {
      reply = { id, ok: false, error: String(err?.message || err) };
    }
    parent.postMessage(reply, "*");
  });
}

const srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>(${runner})(${JSON.stringify(String(lensFmt))})<\/script>`;

export function newLensSandbox(doc = document) {
  let frame = null,
    ready = null,
    nextId = 1;
  const waiting = new Map();

  function start() {
    frame?.remove();
    frame = doc.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.display = "none";
    frame.srcdoc = srcdoc;
    ready = new Promise((resolve) =>
      frame.addEventListener("load", resolve, { once: true }),
    );
    doc.body.append(frame);
  }

  addEventListener("message", (e) => {
    // Only the frame's own replies, and only plain data.
    if (!frame || e.source !== frame.contentWindow) return;
    const msg = e.data;
    const job = msg && waiting.get(msg.id);
    if (!job) return;
    waiting.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.ok && msg.view && typeof msg.view === "object")
      job.resolve(msg.view);
    else job.reject(new Error(msg.error || "The lens didn't return a view."));
  });

  // Posts one job to the current frame, with its own timer. The frame runs
  // jobs in order, so the first to time out is the one that is stuck: it is
  // stopped by replacing the frame, and the jobs queued behind it are sent
  // again to the new one.
  async function post(job) {
    if (!frame) start();
    await ready;
    job.timer = setTimeout(() => {
      waiting.delete(job.id);
      const queued = [...waiting.values()];
      waiting.clear();
      queued.forEach((j) => clearTimeout(j.timer));
      start();
      job.reject(
        new Error(
          `The lens took longer than ${TIMEOUT_MS / 1000} seconds and was stopped.`,
        ),
      );
      queued.forEach(send);
    }, TIMEOUT_MS);
    frame.contentWindow.postMessage(job.message, "*");
  }
  function send(job) {
    waiting.set(job.id, job);
    post(job);
  }

  // Resolves with the lens's view, or rejects with its error.
  function run(code, { txns, data }) {
    const id = nextId++;
    return new Promise((resolve, reject) =>
      send({ id, resolve, reject, message: { id, code, txns, data } }),
    );
  }

  return { run };
}
