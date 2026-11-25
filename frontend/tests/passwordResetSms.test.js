import { describe, expect, it } from "vitest";
import { RESET_CODE_LENGTH, RESET_PER_ACCOUNT_HOUR, RESET_PER_ADDRESS, looksLikePhone, normalizePhone, resetSmsText, smsOutcome } from "../src/data/passwordReset";
import { codeHash, randomCode, sameText } from "../worker/sms";

describe("phone numbers", () => {
  it("reads the ways people write Zimbabwean numbers as one international form", () => {
    for (const n of ["077 123 4567", "0771234567", "+263 77 123 4567", "+263771234567", "00263771234567", "263771234567", "(077) 123-4567", "77 123 4567"]) {
      expect(normalizePhone(n), n).toBe("+263771234567");
    }
  });
  it("keeps other countries' numbers as written", () => {
    expect(normalizePhone("+27 82 123 4567")).toBe("+27821234567");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
  });
  it("refuses what isn't a phone number", () => {
    for (const n of ["", "mutsa", "077-abc", "+12", "12345", "+263 77 123 4567 8901 2345", null, undefined, 771234567]) expect(normalizePhone(n), String(n)).toBeNull();
  });
  it("tells a number from a username", () => {
    expect(looksLikePhone("077 123 4567")).toBe(true);
    expect(looksLikePhone("+263771234567")).toBe(true);
    expect(looksLikePhone("mutsa")).toBe(false);
    expect(looksLikePhone("mutsa2026")).toBe(false);
    expect(looksLikePhone("12345")).toBe(false); // too short to be a number
  });
});

describe("what a texted-code request does", () => {
  const base = { found: true, fromAddress: 0, sentToAccount: 0, canText: true };
  it("texts a known account that has a number", () => expect(smsOutcome(base)).toBe("texted"));
  it("does nothing visible for an unknown account or one without a number", () => {
    expect(smsOutcome({ ...base, found: false })).toBe("unknown");
    expect(smsOutcome({ ...base, canText: false })).toBe("no_phone");
  });
  it("stops at the address and account limits", () => {
    expect(smsOutcome({ ...base, fromAddress: RESET_PER_ADDRESS })).toBe("limited");
    expect(smsOutcome({ ...base, found: false, fromAddress: RESET_PER_ADDRESS })).toBe("limited");
    expect(smsOutcome({ ...base, sentToAccount: RESET_PER_ACCOUNT_HOUR })).toBe("limited");
  });
  it("the text names the code and how long it lasts", () => expect(resetSmsText("042913")).toMatch(/042913.*10 minutes/));
});

describe("codes", () => {
  it("are always the right number of digits, leading zeros kept", () => {
    for (let i = 0; i < 2000; i++) expect(randomCode(RESET_CODE_LENGTH)).toMatch(/^\d{6}$/);
  });
  it("spread evenly over the digits", () => {
    const counts = Array(10).fill(0);
    for (let i = 0; i < 20000; i++) counts[Number(randomCode(1))]++;
    for (const c of counts) expect(c).toBeGreaterThan(1700); // ~2000 each
  });
  it("are stored as a keyed hash tied to the account", async () => {
    const a = await codeHash("key-1", "user-a", "123456");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(await codeHash("key-1", "user-a", "123456"));
    expect(a).not.toBe(await codeHash("key-1", "user-b", "123456")); // another account
    expect(a).not.toBe(await codeHash("key-2", "user-a", "123456")); // another key
    expect(a).not.toBe(await codeHash("key-1", "user-a", "123457"));
  });
  it("compare without shortcuts", () => {
    expect(sameText("abc", "abc")).toBe(true);
    expect(sameText("abc", "abd")).toBe(false);
    expect(sameText("abc", "ab")).toBe(false);
  });
});
