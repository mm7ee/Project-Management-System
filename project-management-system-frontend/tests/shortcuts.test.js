// The project page's keyboard shortcuts.
import { describe, expect, it } from "vitest";
import { SHORTCUTS, isTyping, nextShortcut } from "../src/data/shortcuts";

describe("keyboard shortcuts", () => {
  it("g then a letter goes to a section", () => {
    const first = nextShortcut(null, "g");
    expect(first).toEqual({ pending: "g", action: null });
    expect(nextShortcut(first.pending, "o").action).toEqual({ go: "overview" });
    expect(nextShortcut("g", "w").action).toEqual({ go: "items" });
    expect(nextShortcut("g", "W").action).toEqual({ go: "items" });
    // An unknown second key does nothing and starts over.
    expect(nextShortcut("g", "z")).toEqual({ pending: null, action: null });
  });
  it("single keys: add, search, help", () => {
    expect(nextShortcut(null, "a").action).toEqual({ do: "add" });
    expect(nextShortcut(null, "/").action).toEqual({ do: "search" });
    expect(nextShortcut(null, "?").action).toEqual({ do: "help" });
    expect(nextShortcut(null, "x")).toEqual({ pending: null, action: null });
  });
  it("never while typing in a box", () => {
    expect(isTyping(/** @type {any} */ ({ tagName: "INPUT" }))).toBe(true);
    expect(isTyping(/** @type {any} */ ({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isTyping(/** @type {any} */ ({ tagName: "SELECT" }))).toBe(true);
    expect(isTyping(/** @type {any} */ ({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    expect(isTyping(/** @type {any} */ ({ tagName: "BUTTON" }))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
  it("every shortcut has a label, and no two share keys", () => {
    const seen = new Set(SHORTCUTS.map((s) => s.keys.join(" ")));
    expect(seen.size).toBe(SHORTCUTS.length);
    expect(SHORTCUTS.every((s) => s.label.length > 5)).toBe(true);
  });
});
