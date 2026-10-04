import test from "node:test";
import assert from "node:assert/strict";
import { html, raw } from "../ui/dom.js";

test("html escapes every value and keeps its own markup", () => {
  const name = `<img src=x onerror="alert(1)"> & "Kettle"`;
  assert.equal(
    String(html`<b title="${name}">${name}</b>`),
    `<b title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;Kettle&quot;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;Kettle&quot;</b>`,
  );
  // Nested html and raw markup go in as they are; lists are joined.
  const items = ["a<", "b"].map((x) => html`<li>${x}</li>`);
  assert.equal(
    String(html`<ul>${items}</ul>`),
    "<ul><li>a&lt;</li><li>b</li></ul>",
  );
  assert.equal(String(html`<p>${raw("<i>md</i>")}</p>`), "<p><i>md</i></p>");
  // null and undefined add nothing; booleans and numbers print as they would.
  assert.equal(
    String(html`${null}${undefined}<x aria-pressed="${false}" n="${0}">`),
    '<x aria-pressed="false" n="0">',
  );
  // An html result can be joined or concatenated like a string.
  assert.equal([html`<a>`, html`<b>`].join(""), "<a><b>");
  assert.equal("x" + html`<c>`, "x<c>");
});
