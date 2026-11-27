// The CSV reader behind Settings → Organisation → Import, and how an import names roles and makes usernames.
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../project-management-system-frontend/src/data/csv.js";
import { roleFrom, usernameFor } from "../src/orgadmin.js";

describe("CSV import", () => {
  it("reads quoted fields with commas, quotes and line breaks, and skips blank lines", () => {
    const rows = parseCsv('﻿email,name\r\n"a@x.io","Ade, ""Ann"""\n\n"b@x.io","Line one\nline two"\n');
    expect(rows).toEqual([
      ["email", "name"],
      ["a@x.io", 'Ade, "Ann"'],
      ["b@x.io", "Line one\nline two"],
    ]);
  });
  it("keeps empty fields in place and trims spaces", () => {
    expect(parseCsv("a, ,c\n x ,,")).toEqual([
      ["a", "", "c"],
      ["x", "", ""],
    ]);
  });
  it("names roles the way Pulse shows them: Viewer is read-only, Standard user is the old viewer", () => {
    expect(roleFrom("Viewer")).toBe("reader");
    expect(roleFrom("viewer (read-only)")).toBe("reader");
    expect(roleFrom("Standard user")).toBe("viewer");
    expect(roleFrom("Team Leader")).toBe("team_lead");
    expect(roleFrom("team_lead")).toBe("team_lead");
    expect(roleFrom("Workspace Admin")).toBe("admin");
    expect(roleFrom("Chief")).toBeNull();
    expect(roleFrom("")).toBeNull();
  });
  it("makes a unique username from an email address", () => {
    const taken = new Set(["ann"]);
    expect(usernameFor("Ann@example.com", taken)).toBe("ann2");
    expect(usernameFor("ann@other.com", taken)).toBe("ann3");
    expect(usernameFor("j@x.io", taken)).toBe("j-user");
    expect(usernameFor("++@x.io", taken)).toBe("user");
  });
});
