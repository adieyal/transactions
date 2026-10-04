// The one place a reply is cleaned before it is shown or saved: reasoning
// some models write before the answer is dropped. That is a whole
// <think>…</think> or <reasoning>…</reasoning> block, a leading one not yet
// closed (still thinking, so nothing to show), or reasoning whose opening
// tag the model left out, which ends at a closing tag.
const TAGS = "think|thinking|reasoning";

export function stripThinking(text) {
  return String(text ?? "")
    .replace(new RegExp(`<(${TAGS})>[\\s\\S]*?</\\1>`, "gi"), "")
    .replace(new RegExp(`^\\s*<(${TAGS})>[\\s\\S]*$`, "i"), "")
    .replace(new RegExp(`^[\\s\\S]*?</(${TAGS})>`, "i"), "")
    .trim();
}
