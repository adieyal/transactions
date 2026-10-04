// Capability parity: runs every entry of manifest.json against one build.
//
//   npm run parity -- <url> [--as old|new] [--only id,id] [--json out.json]
//
// <url> is a served transactions.html. Each entry runs in a fresh browser
// context from the view a person lands in (the demo, or a fixture CSV
// imported through the file picker). Entries carry two step lists: `old`
// for 8d87cd2, which proves the manifest, and `new` for the current UI,
// empty where no way to reach the capability is known ("unreachable").
// The build is told apart by its first-run page, or by --as.
//
// No browser dependency is added to the repo (docs/architecture.md):
// playwright-core is loaded from PLAYWRIGHT_CORE, a path to an install
// outside the repo, and Chrome from CHROME (default /usr/bin/google-chrome).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const as = opt("as");
const only = opt("only")?.split(",");
const jsonOut = opt("json");
const url = args[0];
if (!url) {
  console.error("usage: npm run parity -- <url> [--as old|new] [--only ids]");
  process.exit(2);
}

const pwPath = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(
  pwPath
    ? pathToFileURL(join(resolve(pwPath), "index.mjs")).href
    : "playwright-core"
);
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const fixture = (name) => resolve(here, "..", "fixtures", name);

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
});

// Lands where a person lands: the demo on 8d87cd2 (tour closed), or the
// first-run page's "Open Sam's year" on the new UI. With data "csv", the
// fixture is imported through the header's file input instead.
async function land(page, data) {
  await page.goto(url);
  await page.waitForTimeout(900);
  const isNew = await page.evaluate(
    () => !!document.querySelector("tx-first-run"),
  );
  const kind = as || (isNew ? "new" : "old");
  if (data === "csv") {
    await page.setInputFiles("#file", fixture(manifest.fixtureCsv));
    await page.waitForTimeout(1200);
    for (const sel of ["#mapOk", "#curOk"]) {
      if (
        await page
          .locator(sel)
          .isVisible()
          .catch(() => false)
      ) {
        await page.click(sel);
        await page.waitForTimeout(600);
      }
    }
  } else if (kind === "new") {
    await page.getByRole("button", { name: /Sam.s year/ }).click();
    await page.waitForTimeout(900);
  }
  if (
    await page
      .locator(".tour-close")
      .isVisible()
      .catch(() => false)
  ) {
    await page.click(".tour-close");
    await page.waitForTimeout(200);
  }
  return kind;
}

// Steps: {click, shift, nth, text}, {dblclick}, {hover}, {focus}, {key},
// {fill, value}, {press, key} (key on an element), {each, key} (presses
// key on the first match until none is left), {drag, dx, dy, at},
// {menu: act} (opens More and picks a data-act item), {files: act, file}
// (picks a More item that opens the file picker, and chooses file), {wait},
// {save: name, js}, {expect: js}. `js` is a function body run in the page
// with S (saved values) in scope; expect fails unless it returns truthy.
async function run(page, steps, S) {
  for (const s of steps) {
    const loc = (sel) => {
      let l = page.locator(sel);
      if (s.text) l = l.filter({ hasText: s.text });
      return s.nth != null ? l.nth(s.nth) : l.first();
    };
    if (s.click) {
      await loc(s.click).click({
        modifiers: s.shift ? ["Shift"] : [],
        force: !!s.force,
        position: s.at,
        timeout: 3000,
      });
    } else if (s.dblclick) await loc(s.dblclick).dblclick({ timeout: 3000 });
    else if (s.hover)
      await loc(s.hover).hover({ timeout: 3000, force: !!s.force });
    else if (s.focus) await loc(s.focus).focus({ timeout: 3000 });
    else if (s.fill) await loc(s.fill).fill(s.value, { timeout: 3000 });
    else if (s.press) await loc(s.press).press(s.key, { timeout: 3000 });
    else if (s.menu) {
      await page.click("#moreBtn", { timeout: 3000 });
      await page.click(`[data-act="${s.menu}"]`, { timeout: 3000 });
    } else if (s.each) {
      for (let i = 0; i < 20 && (await page.locator(s.each).count()); i++) {
        await page.locator(s.each).first().focus();
        await page.keyboard.press(s.key);
        await page.waitForTimeout(150);
      }
    } else if (s.key) await page.keyboard.press(s.key);
    else if (s.files) {
      const chooser = page.waitForEvent("filechooser", { timeout: 3000 });
      await page.click("#moreBtn", { timeout: 3000 });
      await page.click(`[data-act="${s.files}"]`, { timeout: 3000 });
      await (await chooser).setFiles(join(here, s.file));
    } else if (s.drag) {
      const box = await loc(s.drag).boundingBox({ timeout: 3000 });
      if (!box) throw new Error(`no box for ${s.drag}`);
      const x = box.x + (s.at?.x ?? box.width / 2);
      const y = box.y + (s.at?.y ?? box.height / 2);
      if (s.shift) await page.keyboard.down("Shift");
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++)
        await page.mouse.move(
          x + ((s.dx || 0) * i) / 8,
          y + ((s.dy || 0) * i) / 8,
        );
      await page.mouse.up();
      if (s.shift) await page.keyboard.up("Shift");
    } else if (s.save) {
      S[s.save] = await page.evaluate(
        ([js, S]) => new Function("S", js)(S),
        [s.js, S],
      );
    } else if (s.expect) {
      let ok = false;
      for (let i = 0; i < 20 && !ok; i++) {
        ok = await page.evaluate(
          ([js, S]) => !!new Function("S", js)(S),
          [s.expect, S],
        );
        if (!ok) await page.waitForTimeout(150);
      }
      if (!ok) throw new Error(`expected: ${s.expect}`);
    }
    if (s.wait) await page.waitForTimeout(s.wait);
    else await page.waitForTimeout(120);
  }
}

// Page helpers for `expect` and `save`: P.ls reads a saved document from
// localStorage (the demo's prefix first), P.vis says whether anything
// matching is rendered, P.toast is the visible toast's text.
const helpers = () => {
  window.__downloads = 0;
  window.P = {
    ls(k) {
      const keys = Object.keys(localStorage).filter((x) => x.endsWith(":" + k));
      const key = keys.find((x) => x.includes("demo")) || keys[0];
      return key ? JSON.parse(localStorage[key]) : null;
    },
    n: (s) => document.querySelectorAll(s).length,
    vis: (s) =>
      [...document.querySelectorAll(s)].some((e) => e.getClientRects().length),
    text: (s) => document.querySelector(s)?.textContent.trim() || "",
    toast() {
      const t = document.querySelector("#toast");
      return t && t.getClientRects().length ? t.textContent : "";
    },
  };
};

// The new UI keeps 8d87cd2's panels behind More > Timeline and panels.
// An entry marked `bench` that has no default-view steps, or whose
// default-view steps fail, is tried there too, and reported as "bench".
const BENCH = [{ menu: "bench", wait: 900 }];

async function attempt(e, steps) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  await ctx.addInitScript(helpers);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("download", () =>
    page.evaluate(() => window.__downloads++).catch(() => {}),
  );
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  let kind = as;
  try {
    kind = await land(page, e.data);
    const list = typeof steps === "function" ? steps(kind) : steps;
    if (!list?.length) return { status: "unreachable", kind };
    await run(page, list, {});
    if (errors.length)
      return { status: "fail", kind, detail: `page error: ${errors[0]}` };
    return { status: "pass", kind };
  } catch (err) {
    return {
      status: "fail",
      kind,
      detail: String(err.message || err)
        .split("\n")[0]
        .slice(0, 200),
    };
  } finally {
    await ctx.close();
  }
}

const results = [];
for (const e of manifest.entries) {
  if (only && !only.includes(e.id)) continue;
  let r = await attempt(e, (kind) => e[kind]);
  if (r.kind === "new" && r.status !== "pass" && e.bench) {
    const b = await attempt(e, [...BENCH, ...e.old]);
    if (b.status === "pass")
      r = {
        status: "bench",
        detail: r.status === "fail" ? `default view: ${r.detail}` : "",
      };
    else if (r.status === "unreachable")
      // Reached in the bench but the effect didn't follow: a failure, not
      // a missing control.
      r = {
        status: /^expected|^page error/.test(b.detail) ? "fail" : "unreachable",
        detail: `bench: ${b.detail}`,
      };
  }
  results.push({ id: e.id, status: r.status, detail: r.detail || "" });
  console.log(
    `${r.status.padEnd(11)} ${e.id}${r.detail ? `  ${r.detail}` : ""}`,
  );
}
await browser.close();

const count = (s) => results.filter((r) => r.status === s).length;
console.log(
  `\n${count("pass")} pass, ${count("bench")} bench only, ${count("fail")} fail, ${count("unreachable")} unreachable of ${results.length}`,
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
process.exit(count("pass") === results.length ? 0 : 1);
