// "Request update" channels (src/data/updateRequests.ts). Run with: npm test
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/data/brand";
import { channelList, cleanChannels } from "../src/data/updateRequests";
describe("cleanChannels", () => {
  it("keeps known channels once, in the usual order", () => {
    expect(cleanChannels(["teams", "chat", "teams", "fax"])).toEqual(["chat", "teams"]);
    expect(cleanChannels("chat")).toEqual([]);
    expect(cleanChannels(undefined)).toEqual([]);
  });
});
describe("channelList", () => {
  it("reads as a sentence", () => {
    expect(channelList(["chat"])).toBe(`${BRAND.shortName} chat`);
    expect(channelList(["email"])).toBe("Email");
    expect(channelList(["chat", "email"])).toBe(`${BRAND.shortName} chat and email`);
    expect(channelList(["chat", "email", "teams"])).toBe(`${BRAND.shortName} chat, email and Teams`);
  });
});
