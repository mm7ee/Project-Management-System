// Ask AI as an assistant (docs/assistant-plan.md): the rules shared by the Worker (src/assistant.js) and the tests.
// The model plans and calls tools; each tool runs as the person asking. Here: reading the model's tool calls whatever
// shape its reply takes, checking tool arguments against their schemas, fencing data so it can't act as instructions,
// checking that every number in an answer came from what the tools returned, and keeping only citations that exist.

/** Tool calls one request may make. */
export const MAX_TOOL_CALLS = 8;
/** How long one request may run, in milliseconds. */
export const RUN_MS = 60_000;
/** Requests one person may make in the window (the limit Ask AI has always had). */
export const ASSISTANT_LIMIT = 20;
export const ASSISTANT_WINDOW_MS = 10 * 60_000;
/** The most of one tool's result sent to the model, in characters. */
export const TOOL_RESULT_CHARS = 7000;
export const MAX_QUESTION_CHARS = 2000;

/**
 * The tool calls in a model's reply. Workers AI models answer in different shapes: `tool_calls` at the top level
 * (`{ name, arguments }` or `{ id, type, function: { name, arguments } }`), or OpenAI's
 * `choices[0].message.tool_calls`; `arguments` is an object or a JSON string.
 * @param {any} out
 * @returns {ToolCall[]}
 */
export function parseToolCalls(out) {
  const list = Array.isArray(out?.tool_calls) ? out.tool_calls : Array.isArray(out?.choices?.[0]?.message?.tool_calls) ? out.choices[0].message.tool_calls : [];
  /** @type {ToolCall[]} */ const calls = [];
  list.forEach((/** @type {any} */ t, /** @type {number} */ i) => {
    const name = String(t?.function?.name ?? t?.name ?? "");
    if (!name) return;
    const raw = t?.function?.arguments ?? t?.arguments ?? {};
    /** @type {unknown} */ let args = raw;
    if (typeof raw === "string") {
      try {
        args = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        args = { __unparsable: raw.slice(0, 200) };
      }
    }
    calls.push({ id: String(t?.id ?? `call_${i}`), name, args: args && typeof args === "object" && !Array.isArray(args) ? /** @type {Record<string, unknown>} */ (args) : {} });
  });
  return calls;
}
/**
 * The text in a model's reply (`response`, or OpenAI's `choices[0].message.content`).
 * @param {any} out
 * @returns {string}
 */
export function parseText(out) {
  const raw = out?.response ?? out?.choices?.[0]?.message?.content ?? "";
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}
/**
 * Tokens used, when the model reports them.
 * @param {any} out
 * @returns {{ input: number; output: number }}
 */
export function parseUsage(out) {
  const u = out?.usage ?? {};
  return { input: Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0, output: Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0 };
}

/**
 * Checks arguments against a tool's schema: an object with typed properties (string, integer, number, boolean, an
 * enum, or an array of strings), required ones, lengths and ranges. Anything not in the schema is dropped.
 * @param {ToolSchema} schema
 * @param {Record<string, unknown>} raw
 * @returns {{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }}
 */
export function validateArgs(schema, raw) {
  if ("__unparsable" in raw) return { ok: false, error: "The arguments weren't valid JSON." };
  /** @type {Record<string, unknown>} */ const value = {};
  for (const [key, p] of Object.entries(schema.properties ?? {})) {
    const v = raw[key];
    if (v === undefined || v === null || v === "") {
      if (schema.required?.includes(key)) return { ok: false, error: `"${key}" is required.` };
      continue;
    }
    if (p.enum) {
      if (!p.enum.includes(/** @type {any} */ (v))) return { ok: false, error: `"${key}" must be one of: ${p.enum.join(", ")}.` };
      value[key] = v;
    } else if (p.type === "string") {
      if (typeof v !== "string" && typeof v !== "number") return { ok: false, error: `"${key}" must be text.` };
      const s = String(v).trim();
      if (p.maxLength && s.length > p.maxLength) return { ok: false, error: `"${key}" is too long (at most ${p.maxLength} characters).` };
      if (p.pattern && !new RegExp(p.pattern).test(s)) return { ok: false, error: `"${key}" isn't in the expected form.` };
      value[key] = s;
    } else if (p.type === "integer" || p.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || (p.type === "integer" && !Number.isInteger(n))) return { ok: false, error: `"${key}" must be a ${p.type === "integer" ? "whole number" : "number"}.` };
      if (p.minimum !== undefined && n < p.minimum) return { ok: false, error: `"${key}" must be at least ${p.minimum}.` };
      if (p.maximum !== undefined && n > p.maximum) return { ok: false, error: `"${key}" must be at most ${p.maximum}.` };
      value[key] = n;
    } else if (p.type === "boolean") {
      if (typeof v !== "boolean") return { ok: false, error: `"${key}" must be true or false.` };
      value[key] = v;
    } else if (p.type === "array" && p.items && "properties" in p.items) {
      // A list of objects (several work items in one proposal): each checked against the item schema.
      if (!Array.isArray(v) || !v.length) return { ok: false, error: `"${key}" must be a list.` };
      if (p.maxItems && v.length > p.maxItems) return { ok: false, error: `"${key}" has too many items (at most ${p.maxItems}).` };
      /** @type {Record<string, unknown>[]} */ const list = [];
      for (const [i, x] of v.entries()) {
        if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, error: `"${key}" item ${i + 1} must be an object.` };
        const r = validateArgs(/** @type {ToolSchema} */ (p.items), /** @type {Record<string, unknown>} */ (x));
        if (!r.ok) return { ok: false, error: `"${key}" item ${i + 1}: ${r.error}` };
        list.push(r.value);
      }
      value[key] = list;
    } else if (p.type === "array") {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { ok: false, error: `"${key}" must be a list of text.` };
      if (p.maxItems && v.length > p.maxItems) return { ok: false, error: `"${key}" has too many items (at most ${p.maxItems}).` };
      value[key] = v.map((x) => String(x).trim());
    } else if (p.type === "object" && p.properties) {
      // A nested object (the changes in an update).
      if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: `"${key}" must be an object.` };
      const r = validateArgs(/** @type {ToolSchema} */ ({ type: "object", properties: p.properties, required: p.required }), /** @type {Record<string, unknown>} */ (v));
      if (!r.ok) return { ok: false, error: `"${key}": ${r.error}` };
      value[key] = r.value;
    }
  }
  return { ok: true, value };
}

/**
 * Wraps text that came from records, documents, comments or chat, so the model reads it as data. The marker is
 * random for each request, so text inside can't close it.
 * @param {string} text
 * @param {string} nonce
 */
export const fence = (text, nonce) => `<data id="${nonce}">\n${text.split(`</data id="${nonce}">`).join("")}\n</data id="${nonce}">`;

/** Numbers in a text, ignoring citation marks ([S2]), list numbering and thousands separators. @param {string} text */
export function numbersIn(text) {
  const plain = text
    .replace(/\[S\d+\]/g, " ")
    .replace(/^\s*\d+[.)]\s/gm, " ")
    .replace(/(\d),(\d{3})\b/g, "$1$2");
  return plain.match(/\d+(?:\.\d+)?/g) ?? [];
}
/**
 * The numbers in an answer that nothing the tools returned (or the question) contains. They're flagged to the
 * person, as the digests' rule (a number has to come from the data).
 * @param {string} answer
 * @param {string} evidence  the question, the page context and every tool result
 * @returns {string[]}
 */
export function unverifiedNumbers(answer, evidence) {
  const known = new Set(numbersIn(evidence));
  // A number may also be written without its decimals ("38%" for 38.4) or as part of a date or key in the data.
  for (const n of [...known]) if (n.includes(".")) known.add(n.split(".")[0]);
  return [...new Set(numbersIn(answer).filter((n) => !known.has(n) && !known.has(n.replace(/\.0+$/, ""))))];
}
/**
 * Keeps the citations that name a real source and removes the rest.
 * @param {string} answer
 * @param {Set<string>} ids  source ids the tools gave out ("S1", "S2"…)
 * @returns {{ text: string; used: string[] }}
 */
export function checkCitations(answer, ids) {
  /** @type {string[]} */ const used = [];
  const text = answer.replace(/\s?\[(S\d+)\]/g, (whole, id) => {
    if (!ids.has(id)) return "";
    if (!used.includes(id)) used.push(id);
    return whole;
  });
  return { text, used };
}
/** Removes credentials from text before it reaches a model: API tokens, bearer tokens, passwords in URLs. @param {string} text */
export const stripSecrets = (text) =>
  text
    .replace(/\b(pms|pulse)_[A-Za-z0-9_-]{16,}/g, "[token removed]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [removed]")
    .replace(/\b(api[_-]?key|secret|password|token)(["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, "$1$2[removed]")
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/g, "$1[removed]@");

/**
 * Reads server-sent events (`data: {json}` blocks), calling `onEvent` with each parsed event. A partial or non-JSON
 * line is skipped. `onEvent` returning true stops reading.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: any) => boolean | void} onEvent
 */
export async function readEvents(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** @param {string} block */
  const handle = (block) => {
    const data = block.replace(/^data:\s*/m, "").trim();
    if (!data || data === "[DONE]") return false;
    try {
      return onEvent(JSON.parse(data)) === true;
    } catch {
      return false;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const b of blocks)
      if (handle(b)) {
        await reader.cancel().catch(() => undefined);
        return;
      }
  }
  if (buffer.trim()) handle(buffer);
}

/** Models people see by name; anything else shows its own id's last part. */
const MODEL_LABELS = /** @type {Record<string, string>} */ ({
  "@cf/meta/llama-4-scout-17b-16e-instruct": "Llama 4 Scout",
  "@cf/zai-org/glm-4.7-flash": "GLM 4.7 Flash",
  "@cf/google/gemma-4-26b-a4b-it": "Gemma 4",
  "@cf/zai-org/glm-5.2": "GLM 5.2",
});
/** @param {string} model */
export const modelLabel = (model) => MODEL_LABELS[model] ?? model.split("/").pop() ?? model;

/**
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {Record<string, unknown>} args
 */
/**
 * @typedef {Object} ToolProperty
 * @property {"string" | "integer" | "number" | "boolean" | "array" | "object"} [type]
 * @property {Record<string, ToolProperty>} [properties]  a nested object's
 * @property {string[]} [required]  a nested object's
 * @property {string} [description]
 * @property {readonly string[]} [enum]
 * @property {number} [maxLength]
 * @property {string} [pattern]
 * @property {number} [minimum]
 * @property {number} [maximum]
 * @property {number} [maxItems]
 * @property {{ type: "string" } | ToolSchema} [items]  a list of text, or of objects
 */
/**
 * @typedef {Object} ToolSchema
 * @property {"object"} type
 * @property {Record<string, ToolProperty>} properties
 * @property {string[]} [required]
 */
