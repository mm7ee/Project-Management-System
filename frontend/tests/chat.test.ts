// Chat's shared helpers (src/data/chat.ts). Run with: npm test
import { describe, expect, it } from "vitest";
import { cleanMessage, conversationTitle, directKey } from "../src/data/chat";

describe("directKey", () => {
  it("is the same whoever starts the conversation", () => {
    expect(directKey("tariro", "farai")).toBe(directKey("farai", "tariro"));
    expect(directKey("tariro", "farai")).toBe("farai:tariro");
  });
});

describe("conversationTitle", () => {
  const names: Record<string, string> = { me: "Mutsa", farai: "Farai Moyo" };
  const nameOf = (id: string) => names[id] ?? "Someone";
  it("names a direct message after the other person", () => {
    expect(conversationTitle({ kind: "direct", name: "", memberIds: ["me", "farai"] }, "me", nameOf)).toBe("Farai Moyo");
  });
  it("keeps a group's or channel's own name", () => {
    expect(conversationTitle({ kind: "group", name: "Release planning", memberIds: ["me", "farai"] }, "me", nameOf)).toBe("Release planning");
    expect(conversationTitle({ kind: "project", name: "Payroll", memberIds: [] }, "me", nameOf)).toBe("Payroll");
  });
});

describe("cleanMessage", () => {
  it("trims, drops trailing spaces and squeezes blank lines", () => {
    expect(cleanMessage("  hello  \r\n\r\n\r\n\r\nworld \t\n")).toBe("hello\n\nworld");
  });
  it("leaves nothing for a blank message", () => {
    expect(cleanMessage(" \n\n \t")).toBe("");
  });
});
