// The tenant scoping in the database adapter (worker/pg.js), without a database: what a handle accepts as a
// tenant, and that scoping never connects or leaks into other handles. The database side (row-level security)
// is tested against a real database in tests/tenancy.isolation.test.js.
import { describe, expect, it } from "vitest";
import { NO_TENANT, numberPlaceholders, pgDatabase, tenantEnv } from "../src/pg.js";

// Never connects: handles connect on their first query, and these tests make none.
const root = () => pgDatabase("postgres://nobody:nothing@127.0.0.1:1/none");

describe("tenant scope", () => {
  it("the root handle has no scope; a scoped one has exactly its tenant", () => {
    const r = root();
    expect(r.scope).toBeNull();
    const s = r.withScope({ orgId: "org1", workspaceId: "ws_1-A" });
    expect(s.scope).toEqual({ orgId: "org1", workspaceId: "ws_1-A" });
    expect(Object.isFrozen(s.scope)).toBe(true);
    expect(r.scope).toBeNull();
  });

  it("no tenant is a scope too: it sees nothing (row-level security with empty ids)", () => {
    expect(root().withScope(NO_TENANT).scope).toEqual({ orgId: "", workspaceId: "" });
  });

  it("an organisation with no workspace is allowed (organisation-wide work)", () => {
    expect(root().withScope({ orgId: "org1", workspaceId: "" }).scope).toEqual({ orgId: "org1", workspaceId: "" });
  });

  it("refuses a workspace without its organisation", () => {
    expect(() => root().withScope({ orgId: "", workspaceId: "ws1" })).toThrow(/organisation/);
  });

  it("refuses ids that could change the SQL they are written into", () => {
    for (const bad of ["a'b", "x; SET ROLE neondb_owner", "a b", "a\\b", "ü", "a".repeat(65), "'); --"]) {
      expect(() => root().withScope({ orgId: bad, workspaceId: "" }), bad).toThrow();
      expect(() => root().withScope({ orgId: "org1", workspaceId: bad }), bad).toThrow();
    }
    // @ts-expect-error not strings
    expect(() => root().withScope({ orgId: 1, workspaceId: 2 })).toThrow();
    // @ts-expect-error no scope
    expect(() => root().withScope(null)).toThrow();
  });

  it("statements keep the scope of the handle that prepared them", () => {
    const s = root().withScope({ orgId: "o", workspaceId: "w" });
    const st = /** @type {any} */ (s.prepare("SELECT 1").bind(1));
    expect(st.scope).toEqual({ orgId: "o", workspaceId: "w" });
    expect(/** @type {any} */ (root().prepare("SELECT 1")).scope).toBeNull();
  });

  it("a batch refuses statements of another tenant", async () => {
    const r = root();
    const a = r.withScope({ orgId: "o", workspaceId: "a" });
    const b = r.withScope({ orgId: "o", workspaceId: "b" });
    // The check runs inside the transaction, so it needs a connection; here it fails before reaching one or at it.
    await expect(a.batch([a.prepare("SELECT 1"), b.prepare("SELECT 1")])).rejects.toThrow();
  });

  it("tenantEnv scopes DB and keeps ROOT", () => {
    const r = root();
    const env = /** @type {any} */ ({ ROOT: r, DB: r.withScope(NO_TENANT), OTHER: 1 });
    const t = tenantEnv(env, { orgId: "o", workspaceId: "w" });
    expect(t.DB.scope).toEqual({ orgId: "o", workspaceId: "w" });
    expect(t.ROOT).toBe(r);
    expect(/** @type {any} */ (t).OTHER).toBe(1);
    expect(env.DB.scope).toEqual(NO_TENANT);
  });

  it("placeholders are numbered the same way for scoped handles", () => {
    expect(numberPlaceholders("SELECT ? , '?' , ?")).toBe("SELECT $1 , '?' , $2");
  });
});
