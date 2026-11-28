// The project page's keyboard shortcuts. Two-key ones start with "g" ("go to"); the second key must follow within a
// moment. Typing in a box, or holding Alt, never triggers one; Ctrl/Cmd+K opens search from anywhere on the page.
export const SHORTCUTS = /** @type {const} */ ([
  { keys: ["g", "o"], label: "Go to the Overview", action: { go: "overview" } },
  { keys: ["g", "w"], label: "Go to the Work list", action: { go: "items" } },
  { keys: ["g", "l"], label: "Go to the Lifecycle", action: { go: "lifecycle" } },
  { keys: ["g", "t"], label: "Go to the Timeline", action: { go: "timeline" } },
  { keys: ["g", "r"], label: "Go to Risks & Security", action: { go: "risks" } },
  { keys: ["g", "d"], label: "Go to Documents", action: { go: "docs" } },
  { keys: ["g", "m"], label: "Go to the Team", action: { go: "team" } },
  { keys: ["g", "a"], label: "Go to Activity", action: { go: "activity" } },
  { keys: ["g", "c"], label: "Go to Chat", action: { go: "chat" } },
  { keys: ["a"], label: "Add a work item", action: { do: "add" } },
  { keys: ["/"], label: "Search this project (or Ctrl/Cmd+K)", action: { do: "search" } },
  { keys: ["?"], label: "Show these shortcuts", action: { do: "help" } },
]);
/** How long the second key of "g …" may take, in milliseconds. */
export const SEQUENCE_MS = 1200;

/**
 * The next state after a key: a shortcut to run, or the first key of one still waiting.
 * @param {string | null} pending  the first key pressed so far ("g"), or null
 * @param {string} key  KeyboardEvent.key
 * @returns {{ pending: string | null; action: Action | null }}
 */
export function nextShortcut(pending, key) {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const keyName = key === "?" || key === "/" ? key : k;
  if (pending) {
    const hit = SHORTCUTS.find((s) => s.keys.length === 2 && s.keys[0] === pending && s.keys[1] === keyName);
    return { pending: null, action: hit ? hit.action : null };
  }
  if (SHORTCUTS.some((s) => s.keys.length === 2 && s.keys[0] === keyName)) return { pending: keyName, action: null };
  const one = SHORTCUTS.find((s) => s.keys.length === 1 && s.keys[0] === keyName);
  return { pending: null, action: one ? one.action : null };
}
/**
 * Whether a key press belongs to what someone is typing (a box, a list, an editable area), so no shortcut runs.
 * @param {EventTarget | null} target
 */
export function isTyping(target) {
  const el = /** @type {HTMLElement | null} */ (target);
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}
/** @typedef {{ go: string } | { do: "add" | "search" | "help" }} Action */
