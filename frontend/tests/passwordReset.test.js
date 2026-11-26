// Self-service password reset rules (src/data/passwordReset.ts). Run with: npm test
import { describe, expect, it } from "vitest";
import { RESET_PER_ACCOUNT_HOUR, RESET_PER_ADDRESS, resetOutcome, resetTokenIn } from "../src/data/passwordReset";
const base = { found: true, fromAddress: 0, sentToAccount: 0, canEmail: true };
describe("resetOutcome", () => {
  it("emails a link to an account that has an address", () => {
    expect(resetOutcome(base)).toBe("emailed");
  });
  it("tells administrators when there's nowhere to email", () => {
    expect(resetOutcome({ ...base, canEmail: false })).toBe("admins_told");
  });
  it("sends nothing for a name that isn't an account", () => {
    expect(resetOutcome({ ...base, found: false })).toBe("unknown");
  });
  it("stops one address asking over and over, whatever it names", () => {
    expect(resetOutcome({ ...base, fromAddress: RESET_PER_ADDRESS })).toBe("limited");
    expect(resetOutcome({ ...base, found: false, fromAddress: RESET_PER_ADDRESS })).toBe("limited");
  });
  it("stops flooding one person's inbox", () => {
    expect(resetOutcome({ ...base, sentToAccount: RESET_PER_ACCOUNT_HOUR - 1 })).toBe("emailed");
    expect(resetOutcome({ ...base, sentToAccount: RESET_PER_ACCOUNT_HOUR })).toBe("limited");
  });
});
describe("resetTokenIn", () => {
  const token = "ab".repeat(32);
  it("reads the secret from a reset link", () => {
    expect(resetTokenIn(`#/reset-password/${token}`)).toBe(token);
  });
  it("ignores anything else", () => {
    expect(resetTokenIn("#/reset-password/short")).toBeNull();
    expect(resetTokenIn(`#/chat/${token}`)).toBeNull();
    expect(resetTokenIn("")).toBeNull();
  });
});
