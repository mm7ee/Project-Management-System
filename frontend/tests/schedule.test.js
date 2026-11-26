// The cron's timetable (worker/schedule.js): every 5 minutes, hourly jobs in the first run of the hour. Run with: npm test
import { describe, expect, it } from "vitest";
import { dueJobs } from "../worker/schedule";
const at =
  /** @param {string} iso
   * @returns {DueJobs}
   */ (iso) => dueJobs(Date.parse(iso));
describe("dueJobs", () => {
  it("runs the hourly jobs every hour", () => {
    expect(at("2026-11-18T13:00:00Z")).toEqual({ every: true, hourly: true, dailyDigest: false, mondayBriefing: false });
    // The other runs of the hour do only the every-run jobs.
    expect(at("2026-11-18T13:05:00Z")).toEqual({ every: true, hourly: false, dailyDigest: false, mondayBriefing: false });
    expect(at("2026-11-16T06:30:00Z").mondayBriefing).toBe(false);
  });
  it("sends daily digests at 07:00 Harare on weekdays only", () => {
    expect(at("2026-11-16T05:00:00Z").dailyDigest).toBe(true); // Monday
    expect(at("2026-11-20T05:00:00Z").dailyDigest).toBe(true); // Friday
    expect(at("2026-11-21T05:00:00Z").dailyDigest).toBe(false); // Saturday
    expect(at("2026-11-22T05:00:00Z").dailyDigest).toBe(false); // Sunday
    expect(at("2026-11-18T06:00:00Z").dailyDigest).toBe(false); // 08:00 Harare
  });
  it("sends the Monday Briefing at 08:00 Harare on Mondays only", () => {
    expect(at("2026-11-16T06:00:00Z").mondayBriefing).toBe(true);
    expect(at("2026-11-16T05:00:00Z").mondayBriefing).toBe(false);
    expect(at("2026-11-17T06:00:00Z").mondayBriefing).toBe(false);
  });
  it("is not thrown by a run that starts a little late", () => {
    expect(at("2026-11-16T06:00:42.500Z").mondayBriefing).toBe(true);
  });
});
