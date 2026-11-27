import { describe, expect, it } from "vitest";
import { GIPHY_MEDIA, STICKERS, fileSize, isEmoji, isSticker, messagePreview, validGif } from "../src/data/chat";
import { EMOJI_GROUPS, searchEmoji } from "../src/data/emoji";
describe("reactions accept emoji only", () => {
  it("takes single emoji, skin tones, flags, keycaps and joined sequences", () => {
    for (const e of ["👍", "❤️", "👍🏾", "🇿🇼", "1️⃣", "🧑‍💻", "❤️‍🔥", "🎉"]) expect(isEmoji(e), e).toBe(true);
  });
  it("refuses words, markup, blanks and long strings", () => {
    for (const e of ["", "ok", "<b>", "👍 nice", " ", "a👍", "😀".repeat(9), 42, null, undefined]) expect(isEmoji(e), String(e)).toBe(false);
  });
  it("every emoji in the picker would be accepted as a reaction", () => {
    for (const g of EMOJI_GROUPS) for (const [e] of g.emoji) expect(isEmoji(e), e).toBe(true);
  });
});
describe("GIFs come from GIPHY's media servers only", () => {
  const ok = { id: "xT9IgG50Fb7Mi0prBC", url: "https://media2.giphy.com/media/xT9IgG50Fb7Mi0prBC/200.gif", width: 356, height: 200, title: "Thumbs up" };
  it("keeps a GIPHY GIF", () => {
    expect(validGif(ok)).toEqual(ok);
    expect(GIPHY_MEDIA.test("https://media.giphy.com/media/abc/giphy.gif")).toBe(true);
  });
  it("refuses other hosts, http, query strings, odd ids and sizes", () => {
    expect(validGif({ ...ok, url: "https://evil.example/media/x.gif" })).toBeNull();
    expect(validGif({ ...ok, url: "https://media.giphy.com.evil.example/media/x.gif" })).toBeNull();
    expect(validGif({ ...ok, url: "http://media.giphy.com/media/x.gif" })).toBeNull();
    expect(validGif({ ...ok, url: `${ok.url}?track=1` })).toBeNull();
    expect(validGif({ ...ok, id: "../x" })).toBeNull();
    expect(validGif({ ...ok, width: 0 })).toBeNull();
    expect(validGif({ ...ok, height: 5000 })).toBeNull();
    expect(validGif("gif")).toBeNull();
  });
  it("trims a long title", () => {
    expect(/** @type {ChatGif} */ (validGif({ ...ok, title: "x".repeat(300) })).title).toHaveLength(120);
  });
});
describe("stickers", () => {
  it("accepts only the system's own sticker ids", () => {
    expect(STICKERS.length).toBeGreaterThan(10);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    expect(isSticker("thanks")).toBe(true);
    expect(isSticker("../../etc")).toBe(false);
    expect(isSticker(undefined)).toBe(false);
  });
});
describe("message previews (conversation list, notifications)", () => {
  it("uses the words when there are any", () => expect(messagePreview({ body: "Hello", sticker: "thanks" })).toBe("Hello"));
  it("names a sticker, a GIF or the first file", () => {
    expect(messagePreview({ body: "", sticker: "shipped" })).toBe("Sticker: Shipped!");
    expect(messagePreview({ body: "", gif: {} })).toBe("GIF");
    expect(messagePreview({ body: "", files: [{ name: "plan.pdf" }, { name: "b.png" }] })).toBe("📎 plan.pdf");
    expect(messagePreview({ body: "", fileName: "notes.docx" })).toBe("📎 notes.docx");
    expect(messagePreview({ body: "" })).toBe("");
  });
});
describe("helpers", () => {
  it("sizes files in words", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(340 * 1024)).toBe("340 KB");
    expect(fileSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });
  it("finds emoji by every word", () => {
    expect(searchEmoji("thumbs up")).toContain("👍");
    expect(searchEmoji("zimbabwe")).toEqual(["🇿🇼"]);
    expect(searchEmoji("")).toEqual([]);
  });
});
