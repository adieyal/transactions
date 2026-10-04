import { AI_KEY, makeOpenAI } from "../assistant.js";
import { toast } from "./dom.js";
import { $ } from "../helpers.js";

export function createAssistantSettings(runtime, actions) {
  const { caps } = runtime;
  function loadAI() {
    try {
      return JSON.parse(localStorage.getItem(AI_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveAI(v) {
    try {
      localStorage.setItem(AI_KEY, JSON.stringify(v));
    } catch {
      toast("This browser wouldn't keep the settings.");
    }
  }

  function AI() {
    if (caps.sample && caps.sample === caps.claude) return "Claude";
    if (caps.sample?.label) return caps.sample.label;
    return "the assistant";
  }

  function applyProvider() {
    const cfg = loadAI();
    if (cfg.provider === "openai" && cfg.base && cfg.model) {
      caps.sample = makeOpenAI(cfg);
      caps.tools = true;
    } else {
      caps.sample = caps.claude;
      caps.tools = caps.claudeTools;
    }
  }

  // Shown in place of the AI features when no assistant is connected.
  function noAssistant(headline, extra = "") {
    const why = window.claude?.use
      ? "Claude isn't allowed in this view. You can allow it, or pick another assistant."
      : "Connect ChatGPT, a local model through Ollama or LM Studio, or any OpenAI-compatible service. Your statements stay in this browser until you ask something. Then the question and the transactions it needs go to the service you pick.";
    return `<div class="nudge"><p><b>${headline}</b> ${extra} ${why}</p><div class="row-actions"><span class="sub">Threads, periods, notes and lenses all work without one.</span><button class="btn small" data-connect>Connect an assistant</button></div></div>`;
  }

  function wireConnect() {
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-connect]")) openAISettings();
    });
  }

  function openAISettings() {
    const dlg = $("#aiDlg");
    const cfg = loadAI();
    const prov = cfg.provider || (caps.claude ? "claude" : "openai");
    dlg
      .querySelectorAll('[name="prov"]')
      .forEach((r) => (r.checked = r.value === prov));
    $("#aiBase").value = cfg.base || "";
    $("#aiKey").value = cfg.key || "";
    $("#aiModel").value = cfg.model || "";
    $("#aiNote").textContent = "";
    const sync = () => {
      const v = dlg.querySelector('[name="prov"]:checked')?.value;
      $("#aiOpenai").style.display = v === "openai" ? "" : "none";
      $("#aiCsp").hidden = !(v === "openai" && window.claude?.use);
    };
    dlg.querySelectorAll('[name="prov"]').forEach((r) => (r.onchange = sync));
    sync();
    const read = () => ({
      provider: dlg.querySelector('[name="prov"]:checked')?.value || "claude",
      base: $("#aiBase").value.trim(),
      key: $("#aiKey").value.trim(),
      model: $("#aiModel").value.trim(),
    });
    $("#aiTest").onclick = async () => {
      const c = read();
      const note = $("#aiNote");
      if (c.provider === "claude") {
        note.textContent = caps.claude
          ? "Claude is available here."
          : "Claude isn't available in this copy. It works when Transactions is open in claude.ai.";
        return;
      }
      if (!c.base || !c.model) {
        note.textContent = "Fill in the host and the model first.";
        return;
      }
      note.textContent = "Checking…";
      try {
        const r = await makeOpenAI(c)("Reply with the single word OK.");
        note.textContent = `Connected. It replied “${r.text.slice(0, 30)}”.`;
      } catch (e) {
        note.textContent = sampleErr(e);
      }
    };
    $("#aiForget").onclick = () => {
      $("#aiKey").value = "";
      const c = loadAI();
      delete c.key;
      saveAI(c);
      $("#aiNote").textContent = "Key removed from this browser.";
      applyProvider();
      actions.refresh();
    };
    $("#aiCancel").onclick = () => dlg.close();
    $("#aiSave").onclick = () => {
      const c = read();
      if (c.provider === "openai" && (!c.base || !c.model)) {
        $("#aiNote").textContent =
          "Fill in the host and the model, or pick Claude.";
        return;
      }
      saveAI(c);
      applyProvider();
      dlg.close();
      actions.refresh();
      toast(
        caps.sample
          ? `${AI()} will handle suggestions, lenses and questions.`
          : "Saved. Claude isn't available in this copy, so the AI buttons stay hidden.",
      );
    };
    dlg.showModal();
  }

  function sampleErr(e) {
    switch (e?.code) {
      case "not_granted":
      case "sampling_disabled":
      case "not_declared":
      case "capability_disabled":
      case "capability_removed":
        if (caps.sample === caps.claude) {
          caps.claude = null;
          applyProvider();
          actions.refresh();
        }
        return "Claude isn't allowed in this view. Pick another assistant under More → AI assistant settings.";
      case "rate_limited":
        return `${AI()} is busy or you've hit a usage limit. Try again in a little while.`;
      case "session_expired":
        return "Sign in to Claude again, then retry.";
      case "auth":
        return "The API key was refused. Check it under More → AI assistant settings.";
      case "network":
        return e.message;
      case "prompt_too_large":
        return "That's too much data to send in one go. Narrow the range or hide an account.";
      case "invalid_json":
        return `${AI()}'s answer wasn't in the expected shape. Try again, or phrase it differently.`;
      case "refused":
        return `${AI()} declined that one. Try rephrasing.`;
      case "cancelled":
        return "Stopped.";
      default:
        return e?.message
          ? "Something went wrong: " + e.message
          : `Something went wrong reaching ${AI()}. Try again.`;
    }
  }

  return {
    AI,
    applyProvider,
    noAssistant,
    openAISettings,
    sampleErr,
    wireConnect,
  };
}

export const contract = {
  name: "assistant-settings",
  create: createAssistantSettings,
  provides: [
    "AI",
    "applyProvider",
    "noAssistant",
    "openAISettings",
    "sampleErr",
    "wireConnect",
  ],
  requires: ["refresh"],
  renders: [],
  wires: ["wireConnect"],
};
