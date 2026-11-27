// Branding per organisation (migration 0021, src/branding.js): the public lookup before sign-in, the images, who
// may change it, what an upload must be, and that no organisation's branding reaches another.
// Organisation A (an administrator and a Viewer), organisation B (an administrator), a suspended organisation and
// an archived one. Runs the real Worker on PGlite (npm test), or the Neon dev branch with PULSE_DB=dev.
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { sniffImage } from "../src/branding.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Branding-Test-Pass-47!";
const PLATFORM_TEMP = "Platform-Brand-Pass-42!";

// Real images, built byte by byte: a PNG of any size (only its header is read), a 1×1 JPEG and 1×1 WebPs.
const b64 = (/** @type {Uint8Array | number[]} */ b) => Buffer.from(b).toString("base64");
function png(/** @type {number} */ w, /** @type {number} */ h) {
  const b = Buffer.alloc(45);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8;
  b[25] = 6;
  return `data:image/png;base64,${b64(b)}`;
}
const JPEG_1X1 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const WEBP_LOSSLESS_1X1 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
const SVG = `data:image/svg+xml;base64,${b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))}`;
const HTML_AS_PNG = `data:image/png;base64,${b64(Buffer.from("<html><script>alert(1)</script></html>"))}`;

/** The 6-digit code an authenticator app shows for a base32 secret (RFC 6238). */
function totp(/** @type {string} */ secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((x) => parseInt(x, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe("branding per organisation", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const orgs = {
    a: { id: `zzba${tag}`, code: `zz-ba-${tag}`, name: `Alpha ${tag}`, status: "active" },
    b: { id: `zzbb${tag}`, code: `zz-bb-${tag}`, name: `Bravo ${tag}`, status: "active" },
    s: { id: `zzbs${tag}`, code: `zz-bs-${tag}`, name: `Suspended ${tag}`, status: "suspended" },
    x: { id: `zzbx${tag}`, code: `zz-bx-${tag}`, name: `Archived ${tag}`, status: "archived" },
  };
  const people = {
    ada: { org: orgs.a.id, orgAdmin: 1, role: "admin" },
    val: { org: orgs.a.id, orgAdmin: 0, role: "reader" },
    bob: { org: orgs.b.id, orgAdmin: 1, role: "admin" },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  const pub = (/** @type {string} */ code, what = "branding") => api.call(`/api/public/org/${code}/${what}`);

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      for (const o of Object.values(orgs)) {
        await tx`INSERT INTO organizations (id, name, code, status, created_at, updated_at) VALUES (${o.id}, ${o.name}, ${o.code}, ${o.status}, ${now}, ${now})`;
        await tx`SELECT tenancy_seed_organization(${o.id}, ${source})`;
        await tx`INSERT INTO workspaces (id, organization_id, name, key, created_at, updated_at) VALUES (${`${o.id}-ws`}, ${o.id}, 'Projects', 'PRJ', ${now}, ${now})`;
      }
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin, email)
                 VALUES (${id(p)}, ${id(p)}, ${`${p} person`}, 'admin', ${hash}, ${d.org}, ${d.orgAdmin}, ${`${p}-${tag}@example.test`})`;
        await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${d.org}, ${`${d.org}-ws`}, ${id(p)}, ${d.role}, ${now})`;
      }
      await tx`INSERT INTO platform_admins (id, username, name, password_hash, must_change_password, created_at)
               VALUES (${`pa-${tag}`}, ${`pa-${tag}`}, 'Platform Test', ${await hashPassword(PLATFORM_TEMP)}, 0, ${now})`;
    });
    api = workerClient(backend);
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id IN (${orgs.a.id}, ${orgs.b.id}, ${orgs.s.id}, ${orgs.x.id})`;
    await purgeDueOrganizations(backend.root);
    await db`DELETE FROM platform_admins WHERE id = ${`pa-${tag}`}`;
    await backend.close();
  }, SLOW);

  it("before sign-in, an organisation's code gives its name, colours and image addresses, and nothing else", async () => {
    const r = await pub(orgs.a.code);
    expect(r.status).toBe(200);
    expect(Object.keys(r.data).sort()).toEqual(["accent", "code", "icon", "logo", "logoDark", "name", "shades", "tint"]);
    expect(r.data).toMatchObject({ name: orgs.a.name, code: orgs.a.code, logo: null, logoDark: null, icon: null, tint: null });
    expect(r.data.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(Object.keys(r.data.shades).sort()).toEqual(["dark", "futuristic", "light"]);
    expect(r.headers.get("cache-control")).toContain("public");
    // No workspaces, people, ids or settings.
    expect(JSON.stringify(r.data)).not.toMatch(/Projects|ws|ada|val|@example/);
  }, SLOW);

  it("unknown, suspended, archived and template organisations all get the same 404", async () => {
    const replies = await Promise.all([pub("no-such-org"), pub(orgs.s.code), pub(orgs.x.code), pub("pulse-template"), pub("NOT A CODE"), pub(orgs.s.code, "logo"), pub(orgs.x.code, "icon")]);
    for (const r of replies) {
      expect(r.status).toBe(404);
      expect(r.data).toEqual({ error: "Not found" });
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    // An organisation without a logo has no image either, with the same reply.
    expect((await pub(orgs.a.code, "logo")).data).toEqual({ error: "Not found" });
  }, SLOW);

  it("a burst of lookups from one address is refused with 429", async () => {
    let left = 3;
    api.env.BRANDING_LIMIT = { limit: async () => ({ success: left-- > 0 }) };
    try {
      const codes = [orgs.a.code, "guess-1", "guess-2", "guess-3", orgs.a.code];
      const statuses = [];
      for (const c of codes) statuses.push((await pub(c)).status);
      expect(statuses).toEqual([200, 404, 404, 429, 429]);
    } finally {
      delete api.env.BRANDING_LIMIT;
    }
  }, SLOW);

  it("reads the real type and size of an image from its bytes", () => {
    const bytes = (/** @type {string} */ u) => Uint8Array.from(Buffer.from(u.split(",")[1], "base64"));
    expect(sniffImage(bytes(png(480, 160)))).toEqual({ type: "image/png", w: 480, h: 160 });
    expect(sniffImage(Uint8Array.from(Buffer.from(JPEG_1X1, "base64")))).toEqual({ type: "image/jpeg", w: 1, h: 1 });
    expect(sniffImage(Uint8Array.from(Buffer.from(WEBP_LOSSLESS_1X1, "base64")))).toEqual({ type: "image/webp", w: 1, h: 1 });
    expect(sniffImage(bytes(HTML_AS_PNG))).toBeNull();
  });

  it("only that organisation's administrators may change it, and uploads must be real, small PNG, WebP or JPEG images", async () => {
    expect((await as("val", "/api/org/branding", { method: "PUT", body: { accent: "#ff0000" } })).status).toBe(403);
    expect((await api.call("/api/org/branding", { method: "PUT", body: { accent: "#ff0000" } })).status).toBe(401);
    const refused = async (/** @type {Record<string, unknown>} */ b, /** @type {RegExp} */ msg) => {
      const r = await as("ada", "/api/org/branding", { method: "PUT", body: b });
      expect(r.status, JSON.stringify(b).slice(0, 60)).toBe(400);
      expect(r.data.error).toMatch(msg);
    };
    await refused({ logo: SVG }, /SVG/);
    await refused({ icon: HTML_AS_PNG }, /readable PNG/);
    await refused({ logo: `data:image/jpeg;base64,${b64(Buffer.from(png(10, 10).split(",")[1], "base64"))}` }, /readable JPEG/);
    await refused({ logo: png(900, 80) }, /480 × 160/);
    await refused({ icon: png(256, 400) }, /256 × 256/);
    await refused({ logo: `data:image/png;base64,${"A".repeat(300_000)}` }, /too large|PNG/);
    await refused({ accent: "red" }, /accent/);
    await refused({ accent: "#123456", tint: "url(x)" }, /tint/);
    await refused({ displayName: "  " }, /display name/);

    const saved = await as("ada", "/api/org/branding", {
      method: "PUT",
      body: { displayName: "Alpha Co", accent: "#2C3280", tint: "#2c3280", logo: png(480, 160), logoDark: `data:image/webp;base64,${WEBP_LOSSLESS_1X1}`, icon: `data:image/jpeg;base64,${JPEG_1X1}` },
    });
    expect(saved.status, JSON.stringify(saved.data)).toBe(200);
    expect(saved.data.branding).toMatchObject({ name: "Alpha Co", accent: "#2c3280", tint: "#2c3280" });
    expect(saved.data.branding.shades.light).toBe("#2c3280");
    expect(saved.data.branding.shades.dark).not.toBe("#2c3280"); // lightened for the dark themes
    expect(saved.data.branding.logo).toMatch(new RegExp(`^/api/public/org/${orgs.a.code}/logo\\?v=\\d+$`));

    // The images are public (the sign-in page shows them), with their real type, cached for good at this version.
    const img = await api.call(saved.data.branding.logo);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await api.call(saved.data.branding.icon)).headers.get("content-type")).toBe("image/jpeg");
    expect((await api.call(`/api/public/org/${orgs.a.code}/logo?v=0`)).headers.get("cache-control")).not.toContain("immutable");

    // Recorded, without the images themselves.
    const [entry] = await db`SELECT before, after, actor_id FROM audit_log WHERE organization_id = ${orgs.a.id} AND action = 'organization_branding_updated'`;
    expect(entry.actor_id).toBe(id("ada"));
    expect(JSON.parse(entry.after)).toMatchObject({ displayName: "Alpha Co", accent: "#2c3280", logo: "added", logoDark: "added", icon: "added" });
    expect(entry.after).not.toContain("base64");

    // Removing an image.
    const removed = await as("ada", "/api/org/branding", { method: "PUT", body: { icon: null } });
    expect(removed.data.branding.icon).toBeNull();
    expect(removed.data.branding.logo).not.toBeNull();
  }, SLOW);

  it("nothing of one organisation's branding reaches another", async () => {
    // B's administrator changes only B: their handle can't see or write A's row.
    const b = await as("bob", "/api/org/branding", { method: "PUT", body: { displayName: "Bravo Co", accent: "#0e7c66" } });
    expect(b.status).toBe(200);
    expect(b.data.branding.code).toBe(orgs.b.code);
    expect((await pub(orgs.a.code)).data.name).toBe("Alpha Co");
    // Signed in, each sees only their own.
    const tenantB = JSON.stringify((await as("bob", "/api/me/workspaces")).data);
    expect(tenantB).toContain("Bravo Co");
    expect(tenantB).not.toContain("Alpha");
    expect(tenantB).not.toContain(orgs.a.code);
    const tenantA = JSON.stringify((await as("val", "/api/me/workspaces")).data);
    expect(tenantA).toContain("Alpha Co");
    expect(tenantA).not.toContain("Bravo");
    // B's public branding carries nothing of A, and the app's manifest (the platform, before any organisation)
    // carries no organisation at all.
    expect(JSON.stringify((await pub(orgs.b.code)).data)).not.toMatch(/Alpha|2c3280/);
    const manifest = JSON.stringify((await api.call("/api/manifest")).data);
    expect(manifest).not.toMatch(/Alpha|Bravo|Omni/i);
    // Row-level security: B's handle sees one branding row, its own.
    const rows = await db.begin(async (/** @type {any} */ tx) => {
      await tx`SET LOCAL ROLE pulse_app`;
      await tx`SELECT set_config('app.org_id', ${orgs.b.id}, true)`;
      return tx`SELECT organization_id FROM organization_branding`;
    });
    expect(rows.map((/** @type {any} */ r) => r.organization_id)).toEqual([orgs.b.id]);
  }, SLOW);

  it("a Platform Administrator may change any organisation's branding, with the same checks", async () => {
    const first = await api.call("/api/platform/login", { method: "POST", body: { username: `pa-${tag}`, password: PLATFORM_TEMP } });
    expect(first.status).toBe(200);
    const ok = await api.call("/api/platform/login/code", { method: "POST", body: { ticket: first.data.ticket, code: totp(first.data.setup.secret) } });
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    const pcall = (/** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: /** @type {string} */ (ok.cookie) });
    expect((await pcall(`/api/platform/organizations/${orgs.b.id}/branding`, { method: "PUT", body: { logo: SVG } })).status).toBe(400);
    const r = await pcall(`/api/platform/organizations/${orgs.b.id}/branding`, { method: "PUT", body: { accent: "#ffd400" } });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.branding).toMatchObject({ name: "Bravo Co", accent: "#ffd400" });
    expect(r.data.branding.shades.light).not.toBe("#ffd400"); // too pale on white: darkened
    const [log] = await db`SELECT action, target FROM platform_activity WHERE action = 'organization_branding_updated' AND target = ${orgs.b.id}`;
    expect(log).toBeTruthy();
    // An organisation's own administrator can't use the platform route.
    expect((await as("bob", `/api/platform/organizations/${orgs.b.id}/branding`, { method: "PUT", body: { accent: "#000000" } })).status).toBe(401);
  }, SLOW);
});
