function normBase(b) {
  let u = String(b || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u))
    u =
      (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u)
        ? "http://"
        : "https://") + u;
  u = u.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  try {
    const url = new URL(u);
    if (url.pathname === "/" || url.pathname === "") u = url.origin + "/v1";
  } catch {}
  return u;
}

function extractJSON(text) {
  const t = String(text || "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) {
    try {
      return JSON.parse(f[1]);
    } catch {}
  }
  const a = Math.min(
      ...["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0),
    ),
    z = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (isFinite(a) && z > a) {
    try {
      return JSON.parse(t.slice(a, z + 1));
    } catch {}
  }
  throw { code: "invalid_json", text: t };
}

function makeOpenAI(cfg) {
  const base = normBase(cfg.base),
    host = (() => {
      try {
        return new URL(base).host;
      } catch {
        return base;
      }
    })();
  const label = /openai\.com$/i.test(host) ? "ChatGPT" : host;
  async function post(body, signal) {
    let res;
    try {
      res = await fetch(base + "/chat/completions", {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(cfg.key ? { Authorization: "Bearer " + cfg.key } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e?.name === "AbortError") throw { code: "cancelled" };
      const inClaude = !!window.claude?.use;
      throw {
        code: "network",
        message: inClaude
          ? `Couldn't reach ${host}. Inside claude.ai, Transactions can only talk to Claude. Open the downloaded transactions.html in your browser to use ${label}.`
          : `Couldn't reach ${host}. Check the address, your connection, and that the service allows requests from a web page (for Ollama, set OLLAMA_ORIGINS=*).`,
      };
    }
    if (res.status === 401 || res.status === 403) throw { code: "auth" };
    if (res.status === 429) throw { code: "rate_limited" };
    const j = await res.json().catch(() => null);
    if (!res.ok)
      throw {
        code: "upstream_error",
        message: j?.error?.message || `${host} answered ${res.status}`,
      };
    return j;
  }
  async function call(input, opts = {}) {
    const messages =
      typeof input === "string"
        ? [{ role: "user", content: input }]
        : input.map((m) => ({ role: m.role, content: m.content }));
    const tools = opts.tools?.length
      ? opts.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: "object", properties: {} },
          },
        }))
      : null;
    for (let round = 0; round < 8; round++) {
      const j = await post(
        { model: cfg.model, messages, ...(tools ? { tools } : {}) },
        opts.signal,
      );
      const msg = j?.choices?.[0]?.message;
      if (!msg)
        throw {
          code: "upstream_error",
          message: "The reply had no message in it.",
        };
      if (msg.tool_calls?.length && tools) {
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });
        for (const tc of msg.tool_calls) {
          const tool = opts.tools.find((t) => t.name === tc.function?.name);
          let out;
          try {
            const args = JSON.parse(tc.function?.arguments || "{}");
            out = tool
              ? await tool.execute(args, { signal: opts.signal })
              : "Error: no such tool";
          } catch (e) {
            out = "Error: " + (e?.message || e);
          }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content:
              typeof out === "string"
                ? out
                : JSON.stringify(out).slice(0, 32000),
          });
        }
        continue;
      }
      const text = String(msg.content || "").trim();
      if (!text) throw { code: "empty_completion" };
      opts.onText?.({ text, delta: text });
      return { text, truncated: j.choices[0].finish_reason === "length" };
    }
    throw {
      code: "upstream_error",
      message:
        "It kept asking for more lookups without answering. Try a narrower question.",
    };
  }
  call.json = async (input, opts = {}) =>
    extractJSON((await call(input, opts)).text);
  call.label = label;
  return call;
}
export { makeOpenAI };
