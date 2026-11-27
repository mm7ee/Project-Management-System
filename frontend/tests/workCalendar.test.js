// Working time (src/data/workCalendar.js): SLA clocks count only the organisation's working hours, in its time zone,
// skipping days off and holidays.
import { describe, expect, it } from "vitest";
import { addWorkingMinutes, formatWorking, localMoment, slaTarget, workingMinutes } from "../src/data/workCalendar.js";

const harare = { timeZone: "Africa/Harare", workDays: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", holidays: new Set(["2026-12-25"]) };
const at = (/** @type {string} */ iso) => Date.parse(iso);

describe("working time", () => {
  it("counts only working hours, in the organisation's time zone", () => {
    // Monday 2026-11-30, 09:00 to 11:30 Harare (07:00–09:30 UTC).
    expect(workingMinutes(at("2026-11-30T07:00:00Z"), at("2026-11-30T09:30:00Z"), harare)).toBe(150);
    // Before 08:00 and after 17:00 don't count: 07:00–18:00 Harare is 9 hours.
    expect(workingMinutes(at("2026-11-30T05:00:00Z"), at("2026-11-30T16:00:00Z"), harare)).toBe(540);
  });
  it("skips the weekend and holidays", () => {
    // Friday 16:00 to Monday 09:00 Harare: 1 h Friday + 1 h Monday.
    expect(workingMinutes(at("2026-12-04T14:00:00Z"), at("2026-12-07T07:00:00Z"), harare)).toBe(120);
    // Christmas (Friday) is a holiday.
    expect(workingMinutes(at("2026-12-24T14:00:00Z"), at("2026-12-28T07:00:00Z"), harare)).toBe(120);
  });
  it("follows another time zone, and other working days", () => {
    const london = { ...harare, timeZone: "Europe/London", workDays: [1, 2, 3, 4, 5, 6], holidays: new Set() };
    expect(localMoment("2026-11-28", "08:00", "Europe/London")).toBe(at("2026-11-28T08:00:00Z"));
    // Saturday counts there.
    expect(workingMinutes(at("2026-11-28T08:00:00Z"), at("2026-11-28T10:00:00Z"), london)).toBe(120);
    // Summer time: 08:00 London in July is 07:00 UTC.
    expect(localMoment("2026-07-06", "08:00", "Europe/London")).toBe(at("2026-07-06T07:00:00Z"));
  });
  it("adds working minutes: 4 working hours from Friday 15:00 is Monday 10:00", () => {
    expect(new Date(addWorkingMinutes(at("2026-12-04T13:00:00Z"), 240, harare)).toISOString()).toBe("2026-12-07T08:00:00.000Z");
  });
  it("an SLA target: on track, at risk, breached, met, missed", () => {
    const base = { target: /** @type {const} */ ("resolution"), start: at("2026-11-30T06:00:00Z"), targetMinutes: 120, warnPercent: 80, cal: harare };
    expect(slaTarget({ ...base, stoppedAt: null, now: at("2026-11-30T06:30:00Z") }).state).toBe("running");
    expect(slaTarget({ ...base, stoppedAt: null, now: at("2026-11-30T07:40:00Z") }).state).toBe("warning");
    expect(slaTarget({ ...base, stoppedAt: null, now: at("2026-11-30T08:30:00Z") }).state).toBe("breached");
    expect(slaTarget({ ...base, stoppedAt: at("2026-11-30T07:00:00Z"), now: at("2026-12-01T00:00:00Z") }).state).toBe("met");
    expect(slaTarget({ ...base, stoppedAt: at("2026-11-30T09:00:00Z"), now: at("2026-12-01T00:00:00Z") }).state).toBe("missed");
    expect(slaTarget({ ...base, stoppedAt: null, now: at("2026-11-30T06:30:00Z") }).dueAt).toBe("2026-11-30T08:00:00.000Z");
    expect(formatWorking(600, harare)).toBe("1 day 1 h");
  });
});
