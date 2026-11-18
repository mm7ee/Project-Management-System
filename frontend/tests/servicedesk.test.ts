// The service desk's SLA clock (src/data/servicedesk.ts): business hours Mon–Fri 08:00–17:00 Harare
// (UTC+2), public holidays, pauses while waiting for the customer, and the 75% warning. Run with: npm test
import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutes, formatBusinessMinutes, slaClock } from "../src/data/servicedesk";

const t = (iso: string) => Date.parse(iso);
const none = new Set<string>();

describe("businessMinutes", () => {
  it("counts only 08:00–17:00 Harare on a weekday", () => {
    // Wednesday 18 November 2026, 07:00 to 18:00 Harare = 05:00 to 16:00 UTC: the 9-hour day.
    expect(businessMinutes(t("2026-11-18T05:00:00Z"), t("2026-11-18T16:00:00Z"), none)).toBe(540);
    // 09:30 to 10:15 Harare.
    expect(businessMinutes(t("2026-11-18T07:30:00Z"), t("2026-11-18T08:15:00Z"), none)).toBe(45);
  });
  it("skips weekends", () => {
    // Friday 16:00 Harare to Monday 09:00 Harare: one hour on Friday, one on Monday.
    expect(businessMinutes(t("2026-11-20T14:00:00Z"), t("2026-11-23T07:00:00Z"), none)).toBe(120);
  });
  it("skips public holidays", () => {
    // Christmas Day 2026 is a Friday.
    const xmas = new Set(["2026-12-25"]);
    expect(businessMinutes(t("2026-12-24T14:00:00Z"), t("2026-12-28T07:00:00Z"), xmas)).toBe(120);
  });
  it("leaves out paused time", () => {
    const pause: [number, number][] = [[t("2026-11-18T08:00:00Z"), t("2026-11-18T10:00:00Z")]];
    expect(businessMinutes(t("2026-11-18T06:00:00Z"), t("2026-11-18T12:00:00Z"), none, pause)).toBe(240);
  });
});

describe("addBusinessMinutes", () => {
  it("rolls over to the next business day", () => {
    // Friday 16:30 Harare + 60 business minutes = Monday 08:30 Harare (06:30 UTC).
    expect(new Date(addBusinessMinutes(t("2026-11-20T14:30:00Z"), 60, none)).toISOString()).toBe("2026-11-23T06:30:00.000Z");
  });
  it("starts at opening time when raised out of hours", () => {
    // Tuesday 20:00 Harare + 30 = Wednesday 08:30 Harare.
    expect(new Date(addBusinessMinutes(t("2026-11-17T18:00:00Z"), 30, none)).toISOString()).toBe("2026-11-18T06:30:00.000Z");
  });
});

describe("slaClock", () => {
  const start = t("2026-11-18T06:00:00Z"); // Wednesday 08:00 Harare
  it("is on track, then at risk at 75%, then breached", () => {
    expect(slaClock({ start, now: start + 30 * 60_000, targetMinutes: 60, holidays: none, pauses: [] })).toMatchObject({ state: "running", atRisk: false, elapsedMinutes: 30 });
    expect(slaClock({ start, now: start + 45 * 60_000, targetMinutes: 60, holidays: none, pauses: [] })).toMatchObject({ state: "running", atRisk: true });
    expect(slaClock({ start, now: start + 61 * 60_000, targetMinutes: 60, holidays: none, pauses: [] }).state).toBe("breached");
  });
  it("is met or breached once stopped", () => {
    expect(slaClock({ start, stoppedAt: start + 50 * 60_000, now: start + 600 * 60_000, targetMinutes: 60, holidays: none, pauses: [] }).state).toBe("met");
    expect(slaClock({ start, stoppedAt: start + 70 * 60_000, now: start + 600 * 60_000, targetMinutes: 60, holidays: none, pauses: [] }).state).toBe("breached");
  });
  it("pauses while waiting for the customer", () => {
    const c = slaClock({ start, now: start + 120 * 60_000, targetMinutes: 60, holidays: none, pauses: [[start + 20 * 60_000, null]] });
    expect(c).toMatchObject({ state: "paused", elapsedMinutes: 20 });
    expect(c.dueAt).toBeUndefined();
  });
  it("gives the moment it will breach", () => {
    expect(slaClock({ start, now: start, targetMinutes: 600, holidays: none, pauses: [] }).dueAt).toBe("2026-11-19T07:00:00.000Z");
  });
});

describe("formatBusinessMinutes", () => {
  it("speaks in business days of nine hours", () => {
    expect(formatBusinessMinutes(30)).toBe("30 min");
    expect(formatBusinessMinutes(150)).toBe("2 h 30 min");
    expect(formatBusinessMinutes(540 + 180)).toBe("1 day 3 h");
  });
});
