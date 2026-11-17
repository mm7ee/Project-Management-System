// Unit tests for the PQL parser (src/data/pql.ts) and the SQL it compiles to (worker/pql.ts).
// Run with: npm test

import { describe, expect, it } from "vitest";
import { PqlError, basicToPql, parse, relativeDate, suggestAt, tokenize, weekBounds } from "../src/data/pql";
import { compile, epicKeys, type Lookup } from "../worker/pql";

const NOW = Date.parse("2026-11-18T10:00:00.000Z"); // a Wednesday
const lookup: Lookup = {
  meId: "qa-dev",
  now: NOW,
  statuses: [
    { id: "TODO", name: "To Do", category: "TODO" },
    { id: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS" },
    { id: "IN_REVIEW", name: "In Review", category: "IN_PROGRESS" },
    { id: "DONE", name: "Done", category: "DONE" },
  ],
  users: [
    { id: "qa-dev", username: "qa-dev", name: "QA Developer" },
    { id: "anesu", username: "anesu", name: "Anesu Mashonga" },
  ],
  projectKeys: ["INFRA", "LP", "WCC"],
  sprints: [
    { id: "sp1", name: "WCC Sprint 1", state: "CLOSED" },
    { id: "sp2", name: "WCC Sprint 2", state: "ACTIVE" },
  ],
  workspaces: ["Projects", "HR"],
  epics: new Map([["WCC-1", "epic-1"]]),
};
const sql = (text: string) => compile(parse(text), lookup);

/** Where an error points. */
function errorAt(text: string): { message: string; at: string } {
  try {
    sql(text);
  } catch (e) {
    if (e instanceof PqlError) return { message: e.message, at: text.slice(e.start, e.end) };
    throw e;
  }
  throw new Error("expected an error");
}

describe("tokenizer", () => {
  it("splits words, operators, strings, lists and relative dates", () => {
    const t = tokenize(`status != "In Progress" AND updated >= -7d AND key IN (INFRA-1, LP-2)`);
    expect(t.map((x) => x.type)).toEqual(["word", "op", "string", "word", "word", "op", "reldate", "word", "word", "word", "lparen", "word", "comma", "word", "rparen"]);
    expect(t[2].value).toBe("In Progress");
  });
  it("keeps dates and keys as single words", () => {
    expect(tokenize("due < 2026-11-01").map((x) => x.value)).toEqual(["due", "<", "2026-11-01"]);
    expect(tokenize("key = INFRA-12")[2].value).toBe("INFRA-12");
  });
  it("reports an unclosed quote", () => {
    expect(() => tokenize(`text ~ "half`)).toThrow(/isn't closed/);
  });
});

describe("parser", () => {
  it("builds AND/OR/NOT with the usual precedence and brackets", () => {
    const q = parse("type = Bug OR type = Task AND NOT priority = Low");
    expect(q.where?.type).toBe("or");
    const r = parse("(type = Bug OR type = Task) AND priority = Low");
    expect(r.where?.type).toBe("and");
  });
  it("reads ORDER BY with directions", () => {
    const q = parse("updated >= -7d ORDER BY priority DESC, created");
    expect(q.orderBy.map((o) => `${o.field.name} ${o.dir}`)).toEqual(["priority DESC", "created ASC"]);
  });
  it("allows an empty query, or ordering alone", () => {
    expect(parse("").where).toBeNull();
    expect(parse("ORDER BY due").orderBy[0].field.name).toBe("due");
  });
  it("suggests the field meant", () => {
    const e = errorAt("statsu = Done");
    expect(e.message).toBe("Unknown field 'statsu' — did you mean 'status'?");
    expect(e.at).toBe("statsu");
  });
  it("points at an operator a field can't use", () => {
    const e = errorAt("text = hello");
    expect(e.message).toMatch(/text can't use =/);
    expect(e.at).toBe("=");
  });
  it("points at an unknown function", () => {
    const e = errorAt("assignee = currentUsr()");
    expect(e.message).toMatch(/Unknown function 'currentUsr\(\)' — did you mean 'currentUser'/);
  });
  it("needs AND or OR between conditions", () => {
    expect(errorAt("status = Done priority = High").message).toMatch(/Join conditions with AND or OR/);
  });
  it("refuses EMPTY on fields that always have a value", () => {
    expect(errorAt("reporter IS EMPTY").message).toMatch(/always has a value/);
  });
  it("points at an unclosed bracket", () => {
    expect(errorAt("(status = Done").message).toMatch(/isn't closed/);
  });
});

describe("compiler", () => {
  it("compiles the documented examples", () => {
    const a = sql("project = INFRA AND status != Done AND assignee = currentUser()");
    expect(a.where).toBe("((s.key = ? AND w.status <> ?) AND w.assignee = ?)");
    expect(a.params).toEqual(["INFRA", "DONE", "qa-dev"]);

    const b = sql("priority = High AND due < now() AND resolution IS EMPTY");
    expect(b.where).toBe("((w.priority = ? AND w.due_date < ?) AND w.resolution IS NULL)");
    expect(b.params).toEqual(["HIGH", "2026-11-18"]);

    const c = sql("sprint IN openSprints() AND type = Bug");
    expect(c.where).toBe("(w.sprint_id IN (SELECT sp.id FROM sprints sp WHERE sp.state IN ('ACTIVE', 'FUTURE')) AND w.type = ?)");
    expect(c.params).toEqual(["BUG"]);

    const d = sql("updated >= -7d ORDER BY priority DESC");
    expect(d.where).toBe("w.updated_at >= ?");
    expect(d.params).toEqual([relativeDate("-7d", NOW)]);
    expect(d.orderBy.startsWith("(CASE w.priority")).toBe(true);
    expect(d.orderBy).toContain("DESC NULLS LAST");
  });

  it("never puts typed text into the SQL", () => {
    const evil = `text ~ "'; DROP TABLE users; --" AND component = "x' OR '1'='1"`;
    const r = sql(evil);
    expect(r.where).not.toMatch(/DROP|1'='1/);
    expect(r.params).toContain("%'; DROP TABLE users; --%");
    expect(r.params).toContain("x' or '1'='1");
    // As many placeholders as parameters, in the same order.
    expect((r.where.match(/\?/g) ?? []).length).toBe(r.params.length);
  });

  it("searches the summary or the description on their own", () => {
    const r = sql('summary ~ "login" AND description IS EMPTY ORDER BY summary');
    expect(r.where).toContain("w.summary ILIKE ?");
    expect(r.where).toContain("(w.description IS NULL OR w.description = '')");
    expect(r.params).toEqual(["%login%"]);
    expect(r.orderBy).toMatch(/^lower\(w\.summary\) ASC/);
    expect(errorAt("summary = x").at).toBe("=");
  });

  it("escapes LIKE wildcards in contains", () => {
    expect(sql(`text ~ "100%_done"`).params[0]).toBe("%100\\%\\_done%");
  });

  it("compares priority by importance", () => {
    const r = sql("priority >= High");
    expect(r.where).toContain("(CASE w.priority");
    expect(r.params).toEqual([4]);
  });

  it("handles lists, NOT IN and labels", () => {
    expect(sql("priority IN (High, Highest)").params).toEqual(["HIGH", "HIGHEST"]);
    expect(sql("status NOT IN (Done, \"In Review\")").where).toBe("w.status NOT IN (?, ?)");
    expect(sql("labels = Bug-Fix").where).toContain("EXISTS (SELECT 1 FROM work_item_labels");
    expect(sql("labels = Bug-Fix").params).toEqual(["bug-fix"]);
    expect(sql("labels != urgent").where.startsWith("NOT EXISTS")).toBe(true);
  });

  it("compares plain dates by day and moments exactly", () => {
    expect(sql("created = 2026-11-01").where).toBe("substr(w.created_at, 1, 10) = ?");
    expect(sql("created > startOfWeek()").params).toEqual([weekBounds(NOW).start]);
    expect(sql("due <= endOfWeek()").params).toEqual([weekBounds(NOW).end.slice(0, 10)]);
  });

  it("resolves people by username or name", () => {
    expect(sql("assignee = anesu").params).toEqual(["anesu"]);
    expect(sql('assignee = "Anesu Mashonga"').params).toEqual(["anesu"]);
  });

  it("knows sprints and epics", () => {
    expect(sql('sprint = "WCC Sprint 2"').params).toEqual(["sp2", "sp2"]);
    expect(sql("sprint IN closedSprints()").where).toContain("sp.state = 'CLOSED'");
    expect(sql("epic = WCC-1").params).toEqual(["epic-1", "epic-1"]);
    expect(epicKeys(parse("epic = wcc-1 OR epic = WCC-9"))).toEqual(["WCC-1", "WCC-9"]);
  });

  it("reports values that don't exist, with a suggestion", () => {
    expect(errorAt("status = Donne").message).toBe("Unknown status 'Donne' — did you mean 'Done'?");
    expect(errorAt("project = INFRAA").message).toBe("Unknown project 'INFRAA' — did you mean 'INFRA'?");
    expect(errorAt("assignee = anesuu").message).toBe("Unknown person 'anesuu' — did you mean 'anesu'?");
    expect(errorAt("due < tomorrow").message).toMatch(/isn't a date/);
    expect(errorAt("epic = LP-3").message).toBe("'LP-3' isn't an epic");
    expect(errorAt("priority = Urgent").at).toBe("Urgent");
  });

  it("orders by updated, newest first, by default", () => {
    expect(sql("type = Bug").orderBy).toBe("w.updated_at DESC, s.key, w.number");
  });
});

describe("relative dates and weeks", () => {
  it("adds days, weeks, months and years", () => {
    expect(relativeDate("-7d", NOW)).toBe("2026-11-11T10:00:00.000Z");
    expect(relativeDate("2w", NOW)).toBe("2026-12-02T10:00:00.000Z");
    expect(relativeDate("-1m", NOW).slice(0, 10)).toBe("2026-10-18");
  });
  it("starts the week on Monday, Harare time", () => {
    expect(weekBounds(NOW).start).toBe("2026-11-15T22:00:00.000Z"); // Monday 16 Nov, 00:00 in Harare
  });
});

describe("editor helpers", () => {
  it("suggests fields, then operators, then values", () => {
    expect(suggestAt("sta", 3, {}).items.map((s) => s.label)).toContain("status");
    expect(suggestAt("status ", 7, {}).items.map((s) => s.label)).toContain("!=");
    expect(suggestAt("status = ", 9, { status: ["Done", "To Do"] }).items.map((s) => s.label)).toEqual(["Done", "To Do"]);
    expect(suggestAt("assignee = cur", 14, {}).items[0].label).toBe("currentUser()");
    expect(suggestAt("status = Done ", 14, {}).items.map((s) => s.label)).toContain("AND");
  });
  it("builds PQL from the basic mode", () => {
    expect(basicToPql({ projects: ["INFRA"], statuses: ["To Do", "Done"], assignee: "me", text: "login page" })).toBe(
      'project = INFRA AND status IN ("To Do", Done) AND assignee = currentUser() AND text ~ "login page"',
    );
    expect(parse(basicToPql({ priorities: ["High"], open: true }))).toBeTruthy();
  });
});
