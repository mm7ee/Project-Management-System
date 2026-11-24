import { describe, expect, it } from "vitest";
import type { System } from "../src/data/systems";
import { DEFAULT_LIMITS } from "../src/data/project";
import { RAG_RULES, expectedProgress, needsAttention, ragOf, requestOverdue, workingDaysSince } from "../src/data/projectHealth";
import { buildProjectReport, defaultFilters, filtersToQuery, parseFilters, progressByWeek, weekOf, weeksBetween, type ReportInput } from "../src/data/projectReport";
import { buildShowcase } from "../src/data/showcase";
import { itemCountsQuery } from "../worker/projectReports";
import { columnName, crc32, xlsx, xmlText } from "../worker/xlsx";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-25T10:00:00Z"); // a Wednesday
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const ahead = (d: number) => new Date(NOW + d * DAY).toISOString();
const limits = DEFAULT_LIMITS; // stall after 14 days

const sys = (over: Partial<System> = {}): System => ({
  id: "p1",
  name: "Payroll",
  short: "PR",
  description: "",
  url: "",
  status: "WIP",
  owner: "Systems",
  engagement: 0,
  progress: 50,
  startedAt: ago(50),
  dueAt: ahead(50), // half-way: 50% expected
  updatedAt: ago(1),
  ...over,
});
const none = { openBlockers: 0, oldestBlockerAt: null, openItems: 0, overdueItems: 0 };

describe("RAG health", () => {
  it("is green when on pace, unblocked and recently updated", () => {
    expect(ragOf(sys(), none, NOW, limits).rag).toBe("GREEN");
  });
  it("doesn't rate projects that aren't being built", () => {
    expect(ragOf(sys({ status: "IDEA" }), none, NOW, limits).rag).toBe("NONE");
    expect(ragOf(sys({ status: "LIVE", finishedAt: ago(3) }), none, NOW, limits)).toEqual({ rag: "NONE", reasons: ["Delivered"] });
    expect(ragOf(sys({ startedAt: ahead(3) }), none, NOW, limits).rag).toBe("NONE");
  });
  it("is red past the due date", () => {
    const r = ragOf(sys({ dueAt: ago(4), progress: 99 }), none, NOW, limits);
    expect(r.rag).toBe("RED");
    expect(r.reasons[0]).toMatch(/Past its due date \(4 days\)/);
  });
  it("is amber due soon below 80%, green due soon above it", () => {
    expect(ragOf(sys({ startedAt: ago(93), dueAt: ahead(5), progress: 70 }), none, NOW, limits).rag).toBe("AMBER");
    expect(ragOf(sys({ startedAt: ago(93), dueAt: ahead(5), progress: 95 }), none, NOW, limits).rag).toBe("GREEN");
  });
  it("is amber with a fresh blocker, red once it's older than the limit", () => {
    expect(ragOf(sys(), { ...none, openBlockers: 1, oldestBlockerAt: ago(2) }, NOW, limits).rag).toBe("AMBER");
    const old = ragOf(sys(), { ...none, openBlockers: 2, oldestBlockerAt: ago(RAG_RULES.blockerDaysRed + 1) }, NOW, limits);
    expect(old.rag).toBe("RED");
    expect(old.reasons[0]).toBe("Blocked for 8 days");
  });
  it("is amber when stalled, red at twice the stall limit", () => {
    expect(ragOf(sys({ updatedAt: ago(15) }), none, NOW, limits).rag).toBe("AMBER");
    expect(ragOf(sys({ updatedAt: ago(28) }), none, NOW, limits).rag).toBe("RED");
  });
  it("measures pace against time used", () => {
    expect(expectedProgress(sys(), NOW)).toBe(50);
    expect(ragOf(sys({ progress: 35 }), none, NOW, limits).rag).toBe("AMBER"); // 15 behind
    expect(ragOf(sys({ progress: 20 }), none, NOW, limits).rag).toBe("RED"); // 30 behind
    expect(ragOf(sys({ progress: 41 }), none, NOW, limits).rag).toBe("GREEN"); // 9 behind
  });
  it("counts the share of open work items overdue", () => {
    expect(ragOf(sys(), { ...none, openItems: 20, overdueItems: 2 }, NOW, limits).rag).toBe("GREEN"); // 10%: not above
    expect(ragOf(sys(), { ...none, openItems: 20, overdueItems: 3 }, NOW, limits).rag).toBe("AMBER");
    expect(ragOf(sys(), { ...none, openItems: 20, overdueItems: 5 }, NOW, limits).rag).toBe("RED");
  });
  it("lists red reasons before amber ones", () => {
    const r = ragOf(sys({ dueAt: ago(1) }), { ...none, openBlockers: 1, oldestBlockerAt: ago(1) }, NOW, limits);
    expect(r.rag).toBe("RED");
    // Overdue is also behind pace (100% expected): every reason is listed, red first.
    expect(r.reasons).toEqual(["Past its due date (1 day)", "50 points behind pace (50% against 100% expected)", "1 open blocker"]);
  });
});

describe("update requests", () => {
  it("counts working days only", () => {
    expect(workingDaysSince("2026-11-20T09:00:00Z", NOW)).toBe(3); // Fri → Mon, Tue, Wed
    expect(workingDaysSince("2026-11-25T08:00:00Z", NOW)).toBe(0);
  });
  it("is overdue after three working days", () => {
    expect(requestOverdue("2026-11-20T09:00:00Z", NOW)).toBe(false);
    expect(requestOverdue("2026-11-19T09:00:00Z", NOW)).toBe(true);
  });
});

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  systems: [
    sys({ id: "a", name: "Alpha", lead: "u1", workspace: "HR" }),
    sys({ id: "b", name: "Bravo", lead: "u2", workspace: "Finance", dueAt: ago(2) }),
    sys({ id: "c", name: "Charlie", status: "LIVE", finishedAt: ago(10), workspace: "HR" }),
    sys({ id: "d", name: "Delta", status: "IDEA", startedAt: ahead(20) }),
    sys({ id: "old", name: "Old", status: "COMPLETED", startedAt: ago(800), finishedAt: ago(400) }),
  ],
  users: [
    { id: "u1", name: "Tariro", role: "team_lead" },
    { id: "u2", name: "Farai", role: "manager" },
    { id: "d1", name: "Dev One", role: "developer" },
    { id: "d2", name: "Dev Two", role: "developer" },
  ],
  assignments: [
    { userId: "d1", systemId: "a" },
    { userId: "d1", systemId: "b" },
    { userId: "d1", systemId: "c" },
    { userId: "d1", systemId: "old" },
    { userId: "d2", systemId: "a" },
  ],
  items: { a: { open: 10, overdue: 1, done: 5 }, b: { open: 4, overdue: 4, done: 0 } },
  blockers: [{ systemId: "a", raisedAt: ago(1) }],
  requests: [
    { systemId: "a", createdAt: ago(1) },
    { systemId: "b", createdAt: ago(9) },
  ],
  openFeatures: { d2: 7 },
  limits,
  now: NOW,
  filters: defaultFilters(NOW),
  ...over,
});

describe("the Projects report", () => {
  const r = buildProjectReport(input());
  it("keeps projects alive in the period (Old finished long before it)", () => {
    expect(r.rows.map((x) => x.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(r.totals.portfolio).toBe(5);
  });
  it("puts the worst health first and explains it", () => {
    expect(r.rows[0].id).toBe("b");
    expect(r.rows[0].rag).toBe("RED");
    expect(r.rows[0].reasons[0]).toMatch(/Past its due date/);
    expect(r.rows.find((x) => x.id === "a")!.rag).toBe("AMBER"); // fresh blocker
  });
  it("adds up totals from the rows", () => {
    expect(r.totals.byRag).toEqual({ RED: 1, AMBER: 1, GREEN: 0, NONE: 2 });
    expect(r.totals.openItems).toBe(14);
    expect(r.totals.overdueItems).toBe(5);
    expect(r.totals.openBlockers).toBe(1);
    expect(r.totals.openRequests).toBe(2);
    expect(r.totals.overdueRequests).toBe(1);
    expect(r.totals.averageProgress).toBe(50);
  });
  it("counts developers per project and flags anyone over the limit, counting all their projects", () => {
    expect(r.rows.find((x) => x.id === "a")!.developers).toBe(2);
    const d1 = r.developers.find((d) => d.id === "d1")!;
    expect(d1.projects).toBe(4); // includes the old project, as the workload limit does everywhere
    expect(d1.overloaded).toBe(true);
    expect(r.developers.find((d) => d.id === "d2")!.reasons).toEqual([`7 open feature requests (limit ${limits.features})`]);
    expect(r.totals.overloadedDevelopers).toBe(2);
  });
  it("filters by stage, lead, workspace and health", () => {
    expect(buildProjectReport(input({ filters: { ...defaultFilters(NOW), stage: "LIVE" } })).rows.map((x) => x.id)).toEqual(["c"]);
    expect(buildProjectReport(input({ filters: { ...defaultFilters(NOW), lead: "u2" } })).rows.map((x) => x.id)).toEqual(["b"]);
    expect(buildProjectReport(input({ filters: { ...defaultFilters(NOW), workspace: "HR" } })).rows.map((x) => x.id).sort()).toEqual(["a", "c"]);
    expect(buildProjectReport(input({ filters: { ...defaultFilters(NOW), rag: "AMBER" } })).rows.map((x) => x.id)).toEqual(["a"]);
  });
  it("only counts the work items it was given: what the viewer may see", () => {
    // The Worker counts items with itemAccess; an item the viewer can't see never reaches here.
    const hidden = buildProjectReport(input({ items: { a: { open: 10, overdue: 1, done: 5 } } }));
    expect(hidden.rows.find((x) => x.id === "b")!.openItems).toBe(0);
    expect(hidden.totals.openItems).toBe(10);
  });
  it("agrees with the dashboard and executive page on 'needs attention'", () => {
    const i = input();
    const blocked = new Set(i.blockers.map((b) => b.systemId));
    const shared = i.systems.filter((s) => needsAttention(s, blocked.has(s.id), NOW, limits)).length;
    const showcase = buildShowcase(i.systems, [], [], blocked, limits, NOW);
    expect(showcase.needsAttention).toBe(shared);
    const all = buildProjectReport({ ...i, filters: { ...defaultFilters(NOW), from: "2020-01-01" } });
    expect(all.totals.needsAttention).toBe(shared);
  });
});

describe("filters in the address", () => {
  it("round-trips and keeps links short", () => {
    const f = { ...defaultFilters(NOW), stage: "WIP" as const, rag: "RED" as const, lead: "u1" };
    const q = filtersToQuery(f, NOW);
    expect(q).toBe("stage=WIP&lead=u1&rag=RED");
    expect(parseFilters(new URLSearchParams(q), NOW)).toEqual(f);
    expect(filtersToQuery(defaultFilters(NOW), NOW)).toBe("");
  });
  it("drops nonsense and puts dates in order", () => {
    const f = parseFilters(new URLSearchParams("stage=NOPE&rag=PURPLE&from=2026-12-01&to=2026-01-01&schedule=x"), NOW);
    expect(f.stage).toBe("");
    expect(f.rag).toBe("");
    expect(f.schedule).toBe("");
    expect([f.from, f.to]).toEqual(["2026-01-01", "2026-12-01"]);
  });
});

describe("trends", () => {
  it("weeks start on Monday", () => {
    expect(weekOf("2026-11-25")).toBe("2026-11-23");
    expect(weekOf("2026-11-23T23:00:00Z")).toBe("2026-11-23");
    expect(weeksBetween("2026-11-01", "2026-11-25")).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  });
  it("averages each project's progress as it was at the end of each week", () => {
    const rows = [
      { id: "a", progress: 60, startedAt: "2026-10-01", finishedAt: "" },
      { id: "b", progress: 30, startedAt: "2026-11-10", finishedAt: "" },
    ];
    const events = [
      { systemId: "a", at: "2026-11-04T09:00:00Z", from: 10, to: 20 },
      { systemId: "a", at: "2026-11-18T09:00:00Z", from: 20, to: 60 },
    ];
    // Week of 26 Oct: a was 10 (before its first change); b not started. Week of 9 Nov: a 20, b 30 (no log).
    expect(progressByWeek(rows, events, ["2026-10-26", "2026-11-09", "2026-11-16"])).toEqual([10, 25, 45]);
    expect(progressByWeek([], [], ["2026-10-26"])).toEqual([null]);
  });
});

describe("work items are always counted through the access rule", () => {
  it("limits a developer to their own items and to security levels they hold", () => {
    const q = itemCountsQuery({ id: "dev1", role: "developer", ownOnly: true }, "2026-11-25");
    expect(q.sql).toContain("w.security_level IS NULL");
    expect(q.sql).toContain("(w.assignee = ? OR w.reporter = ?)");
    expect(q.args).toEqual(["2026-11-25", "dev1", "dev1", "developer", "dev1", "dev1", "dev1"]);
  });
  it("hides every secured item from a view-only link", () => {
    expect(itemCountsQuery({ id: "", role: "viewer", ownOnly: false, guest: true }, "2026-11-25").sql).toContain("w.security_level IS NULL)");
  });
  it("lets an administrator count everything", () => {
    const q = itemCountsQuery({ id: "a1", role: "admin", ownOnly: false }, "2026-11-25");
    expect(q.sql).toContain("WHERE TRUE");
    expect(q.args).toEqual(["2026-11-25"]);
  });
});

describe("the Excel writer", () => {
  it("computes the standard CRC-32", () => expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926));
  it("names columns like a spreadsheet", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });
  it("escapes text and strips characters XML forbids", () => expect(xmlText(`a<b>&"c"\u0001`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;"));
  it("writes a ZIP whose entries all check out", () => {
    const bytes = xlsx([
      { name: "Summary", rows: [["Figure", "Value"], ["Projects", 4]] },
      { name: "Bad/name:[x]*?", rows: [["A"], ["<script>"]] },
    ]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // Walk the local headers: each entry's CRC matches its data.
    const names: string[] = [];
    let at = 0;
    while (view.getUint32(at, true) === 0x04034b50) {
      const crc = view.getUint32(at + 14, true);
      const size = view.getUint32(at + 18, true);
      const nameLen = view.getUint16(at + 26, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
      const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
      expect(crc32(data), name).toBe(crc);
      names.push(name);
      if (name === "xl/workbook.xml") expect(new TextDecoder().decode(data)).toContain('name="Bad name  x"');
      if (name === "xl/worksheets/sheet2.xml") expect(new TextDecoder().decode(data)).toContain("&lt;script&gt;");
      if (name === "xl/worksheets/sheet1.xml") expect(new TextDecoder().decode(data)).toContain("<v>4</v>");
      at += 30 + nameLen + size;
    }
    expect(names).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
  });
});
