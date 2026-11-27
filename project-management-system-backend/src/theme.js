// Logo-driven themes, as versions (migration 0024, docs/adaptive-theming-plan.md):
//   GET    /api/org/theme             the published version, the draft and the history (last 30)
//   PUT    /api/org/theme/draft       save the draft { spec, note?, fromLogo? }. With fromLogo (the logo just changed),
//                                    an organisation that has never published a theme gets it published at once
//                                    (Balanced, from its logo); otherwise it stays a draft and the other
//                                    administrators are told.
//   DELETE /api/org/theme/draft       throw the draft away
//   POST   /api/org/theme/publish     publish the draft (or { spec } directly); the old version becomes history
//   POST   /api/org/theme/rollback    { version }: publishes a copy of an old version
//   POST   /api/org/theme/off         stop using a theme: back to the accent colour (the version stays in history)
// Organisation Administrators reach these through worker/orgadmin.js; Platform Administrators through
// /api/platform/organizations/:id/theme… (worker/platform.js), with the same rules. Only a ThemeSpec that passes
// cleanThemeSpec is stored, and it is checked again whenever it is read: no CSS is ever stored or sent.
/** @import { ThemeSpec } from '../../project-management-system-frontend/src/data/logoTheme' */
import { HttpError, body, json } from "./http";
import { cleanThemeSpec } from "../../project-management-system-frontend/src/data/logoTheme";
import { raise } from "./notify";

const HISTORY = 30;

/**
 * @typedef {Object} ThemeRow
 * @property {string} id
 * @property {number} version
 * @property {"draft" | "published" | "archived"} status
 * @property {string} spec
 * @property {string | null} note
 * @property {string} created_at
 * @property {string | null} created_by
 * @property {string | null} published_at
 * @property {string | null} published_by
 */
/**
 * @typedef {Object} ThemeVersion
 * @property {number} version
 * @property {"draft" | "published" | "archived"} status
 * @property {ThemeSpec} spec
 * @property {string | null} note
 * @property {string} createdAt
 * @property {string | null} createdBy   the person's name
 * @property {string | null} publishedAt
 */

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const now = () => new Date().toISOString();

/**
 * @param {D1Database} db
 * @param {string} orgId
 * @returns {Promise<ThemeVersion[]>}
 */
async function versions(db, orgId) {
  const rows = /** @type {D1Result<ThemeRow & { by_name: string | null }>} */ (
    await db
      .prepare(
        `SELECT t.id, t.version, t.status, t.spec, t.note, t.created_at, t.created_by, t.published_at, t.published_by,
                a.name AS by_name
         FROM organization_themes t
         LEFT JOIN accounts a ON a.id = COALESCE(t.published_by, t.created_by)
         WHERE t.organization_id = ? ORDER BY t.version DESC LIMIT ?`,
      )
      .bind(orgId, HISTORY)
      .all()
  ).results;
  /** @type {ThemeVersion[]} */ const out = [];
  for (const r of rows) {
    const spec = cleanThemeSpec(r.spec);
    if (spec) out.push({ version: Number(r.version), status: r.status, spec, note: r.note, createdAt: r.created_at, createdBy: r.by_name ?? (r.created_by ? "Platform Administrator" : null), publishedAt: r.published_at });
  }
  return out;
}

/**
 * The published theme of an organisation, or null (it uses its accent colour).
 * @param {D1Database} db
 * @param {string} orgId
 */
export async function publishedTheme(db, orgId) {
  const r = /** @type {{ spec: string } | null} */ (await db.prepare("SELECT spec FROM organization_themes WHERE organization_id = ? AND status = 'published'").bind(orgId).first());
  return r ? cleanThemeSpec(r.spec) : null;
}

/** @param {unknown} v */
function specOrRefuse(v) {
  const spec = cleanThemeSpec(v);
  if (!spec) throw new HttpError(400, "That theme isn't valid");
  return spec;
}
/** @param {unknown} v */
const cleanNote = (v) => (v == null || v === "" ? null : String(v).replace(/\s+/g, " ").trim().slice(0, 200) || null);

/**
 * @param {D1Database} db
 * @param {string} orgId
 */
async function nextVersion(db, orgId) {
  const r = /** @type {{ v: number | null } | null} */ (await db.prepare("SELECT MAX(version) AS v FROM organization_themes WHERE organization_id = ?").bind(orgId).first());
  return Number(r?.v ?? 0) + 1;
}

/**
 * Publishes a spec as a new version (the published one, and any draft, become history).
 * @param {D1Database} db
 * @param {string} orgId
 * @param {ThemeSpec} spec
 * @param {string} actorId
 * @param {string | null} note
 */
async function publish(db, orgId, spec, actorId, note) {
  const at = now();
  const version = await nextVersion(db, orgId);
  await db.batch([
    db.prepare("UPDATE organization_themes SET status = 'archived' WHERE organization_id = ? AND status IN ('published', 'draft')").bind(orgId),
    db
      .prepare("INSERT INTO organization_themes (id, organization_id, version, status, spec, note, created_at, created_by, published_at, published_by) VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?, ?)")
      .bind(newId(), orgId, version, JSON.stringify(spec), note, at, actorId, at, actorId),
  ]);
  return version;
}

/**
 * Saves the draft (replacing any earlier one).
 * @param {D1Database} db
 * @param {string} orgId
 * @param {ThemeSpec} spec
 * @param {string} actorId
 * @param {string | null} note
 */
async function saveDraft(db, orgId, spec, actorId, note) {
  const draft = /** @type {{ id: string; version: number } | null} */ (await db.prepare("SELECT id, version FROM organization_themes WHERE organization_id = ? AND status = 'draft'").bind(orgId).first());
  if (draft) {
    await db.prepare("UPDATE organization_themes SET spec = ?, note = ?, created_at = ?, created_by = ? WHERE id = ?").bind(JSON.stringify(spec), note, now(), actorId, draft.id).run();
    return Number(draft.version);
  }
  const version = await nextVersion(db, orgId);
  await db
    .prepare("INSERT INTO organization_themes (id, organization_id, version, status, spec, note, created_at, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)")
    .bind(newId(), orgId, version, JSON.stringify(spec), note, now(), actorId)
    .run();
  return version;
}

/**
 * @typedef {Object} ThemeContext
 * @property {Env} env
 * @property {Request} req
 * @property {string} method
 * @property {string} sub        the part after …/theme ("", "/draft", "/publish", "/rollback" or "/off")
 * @property {D1Database} db     the organisation's handle (its administrators) or the owner (a Platform Administrator)
 * @property {string} orgId
 * @property {{ id: string; name: string }} me
 * @property {boolean} [platform] a Platform Administrator: nobody in the organisation is told about drafts
 * @property {(action: string, detail: Record<string, unknown>) => Promise<unknown>} audit
 */

/**
 * The theme routes, for an organisation's administrators or a Platform Administrator.
 * @param {ThemeContext} c
 * @returns {Promise<Response>}
 */
export async function themeApi(c) {
  const { db, orgId, me, method, sub } = c;
  const reply = async (/** @type {Record<string, unknown>} */ extra = {}) => {
    const all = await versions(db, orgId);
    return json({ published: all.find((v) => v.status === "published") ?? null, draft: all.find((v) => v.status === "draft") ?? null, history: all, ...extra });
  };
  if (sub === "" && method === "GET") return reply();
  if (sub === "/draft" && method === "PUT") {
    const b = /** @type {{ spec?: unknown; note?: unknown; fromLogo?: unknown }} */ (await body(c.req));
    const spec = specOrRefuse(b.spec);
    const note = cleanNote(b.note);
    if (b.fromLogo === true) {
      const ever = /** @type {{ n: number }} */ (await db.prepare("SELECT COUNT(*) AS n FROM organization_themes WHERE organization_id = ? AND status <> 'draft'").bind(orgId).first());
      // A new organisation (never published a theme): its logo's Balanced theme is applied straight away.
      if (Number(ever.n) === 0) {
        const version = await publish(db, orgId, spec, me.id, note ?? "Generated from the logo");
        await c.audit("organization_theme_published", { version, automatic: true });
        return reply({ autoPublished: true });
      }
    }
    const version = await saveDraft(db, orgId, spec, me.id, note);
    await c.audit("organization_theme_draft_saved", { version, fromLogo: b.fromLogo === true });
    if (b.fromLogo === true && !c.platform) await tellAdmins(c, version);
    return reply();
  }
  if (sub === "/draft" && method === "DELETE") {
    // The draft becomes history rather than disappearing (the app's role can't delete rows).
    const r = await db.prepare("UPDATE organization_themes SET status = 'archived', note = COALESCE(note, 'Draft discarded') WHERE organization_id = ? AND status = 'draft'").bind(orgId).run();
    if (r.meta.changes) await c.audit("organization_theme_draft_discarded", {});
    return reply();
  }
  if (sub === "/publish" && method === "POST") {
    const b = /** @type {{ spec?: unknown; note?: unknown }} */ (await body(c.req));
    /** @type {number} */ let version;
    if (b.spec !== undefined) version = await publish(db, orgId, specOrRefuse(b.spec), me.id, cleanNote(b.note));
    else {
      // The draft itself is published, keeping its version number.
      const d = /** @type {{ id: string; version: number; spec: string } | null} */ (await db.prepare("SELECT id, version, spec FROM organization_themes WHERE organization_id = ? AND status = 'draft'").bind(orgId).first());
      if (!d || !cleanThemeSpec(d.spec)) throw new HttpError(409, "There's no draft to publish");
      const at = now();
      await db.batch([
        db.prepare("UPDATE organization_themes SET status = 'archived' WHERE organization_id = ? AND status = 'published'").bind(orgId),
        db.prepare("UPDATE organization_themes SET status = 'published', published_at = ?, published_by = ? WHERE id = ?").bind(at, me.id, d.id),
      ]);
      version = Number(d.version);
    }
    await c.audit("organization_theme_published", { version });
    return reply();
  }
  if (sub === "/rollback" && method === "POST") {
    const b = /** @type {{ version?: unknown }} */ (await body(c.req));
    const v = Number(b.version);
    if (!Number.isInteger(v) || v < 1) throw new HttpError(400, "Choose a version to go back to");
    const old = /** @type {{ spec: string } | null} */ (await db.prepare("SELECT spec FROM organization_themes WHERE organization_id = ? AND version = ?").bind(orgId, v).first());
    const spec = old ? cleanThemeSpec(old.spec) : null;
    // Another organisation's version, or one that doesn't exist, looks the same: not found.
    if (!spec) throw new HttpError(404, "Not found");
    const version = await publish(db, orgId, spec, me.id, `Back to version ${v}`);
    await c.audit("organization_theme_rolled_back", { version, from: v });
    return reply();
  }
  if (sub === "/off" && method === "POST") {
    const r = await db.prepare("UPDATE organization_themes SET status = 'archived' WHERE organization_id = ? AND status = 'published'").bind(orgId).run();
    if (r.meta.changes) await c.audit("organization_theme_turned_off", {});
    return reply();
  }
  throw new HttpError(405, "Method not allowed");
}

/**
 * The logo changed, so a new theme is waiting as a draft: the organisation's other administrators are told.
 * @param {ThemeContext} c
 * @param {number} version
 */
async function tellAdmins(c, version) {
  const admins = /** @type {{ id: string }[]} */ ((await c.db.prepare("SELECT id FROM accounts WHERE org_admin = 1 AND deactivated_at IS NULL AND id <> ?").bind(c.me.id).all()).results);
  if (!admins.length) return;
  await raise(
    // The organisation's handle (no workspace): each administrator's bell is in their first workspace.
    { ...c.env, DB: /** @type {TenantDatabase} */ (/** @type {unknown} */ (c.db)) },
    admins.map((a) => ({
      userId: a.id,
      kind: /** @type {const} */ ("theme"),
      title: "A new theme is ready to review",
      body: `${c.me.name} changed the logo, so a theme was generated from it (draft, version ${version}). Nothing changes until an administrator publishes it.`,
      link: "view:settings",
      dedupe: `theme-draft-${version}`,
      email: false,
    })),
  ).catch((e) => console.error("Couldn't tell the administrators about a theme draft", e));
}
