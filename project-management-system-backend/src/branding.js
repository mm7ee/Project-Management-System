/** @import { BrandingView } from '../../project-management-system-frontend/src/data/branding' */
// Branding per organisation (migration 0021, docs/branding-plan.md):
//   - GET /api/public/org/:code/branding: before sign-in, the organisation someone has already identified by its
//     code: its display name, accent (and the safe shade for each theme), sign-in tint and image addresses. Nothing
//     else. Unknown, suspended, archived and the template organisation all get the same 404. Rate-limited per
//     address, so codes can't be tried in bulk.
//   - GET /api/public/org/:code/logo | logo-dark | icon: the images, cached for a year (the address carries ?v=).
//   - GET and PUT /api/org/branding: the organisation's own administrators read and change it.
//   - A Platform Administrator changes it through saveBranding (worker/platform.js).
import { HttpError, body, json } from "./http";
import { auditEntry, changed } from "./audit";
import { IMAGE_BOX, IMAGE_TYPES, PLATFORM_ACCENT, STORED_MAX_BYTES, accentShades, cleanHex } from "../../project-management-system-frontend/src/data/branding";

/**
 * An organisation code as the sign-in page cleans it (src/data/tenant.js cleanCode, which is browser-only), or "".
 * @param {unknown} v
 */
const cleanCode = (v) => {
  const code = String(v ?? "").trim().toLowerCase().slice(0, 32);
  return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(code) ? code : "";
};

/** Codes that led nowhere, per address, before every lookup from it is refused (publicBrandingApi). */
export const ORG_CODE_MISSES = 30;
export const ORG_CODE_WINDOW_MS = 10 * 60_000;

/** The template organisation is never shown to anyone. */
const TEMPLATE_ORG = "pulse-template";

/** @typedef {"logo" | "logoDark" | "icon"} Slot */
/** @type {Record<Slot, { column: "logo" | "logo_dark" | "icon"; path: string; box: { w: number; h: number }; label: string }>} */
const SLOTS = {
  logo: { column: "logo", path: "logo", box: IMAGE_BOX.logo, label: "The logo" },
  logoDark: { column: "logo_dark", path: "logo-dark", box: IMAGE_BOX.logo, label: "The logo for dark backgrounds" },
  icon: { column: "icon", path: "icon", box: IMAGE_BOX.icon, label: "The icon" },
};

/**
 * @typedef {Object} BrandingRow
 * @property {string} id
 * @property {string} name
 * @property {string} code
 * @property {string | null} display_name
 * @property {string | null} accent
 * @property {string | null} signin_tint
 * @property {string | null} sidebar
 * @property {string | null} highlight
 * @property {boolean | number | null} has_logo
 * @property {boolean | number | null} has_logo_dark
 * @property {boolean | number | null} has_icon
 * @property {number | null} version
 * @property {string | null} updated_at
 */

const SELECT = `SELECT o.id, o.name, o.code, b.display_name, b.accent, b.signin_tint, b.sidebar, b.highlight, b.logo IS NOT NULL AS has_logo,
  b.logo_dark IS NOT NULL AS has_logo_dark, b.icon IS NOT NULL AS has_icon, b.version, b.updated_at
  FROM organizations o LEFT JOIN organization_branding b ON b.organization_id = o.id`;

/**
 * What anyone may see of an organisation's branding.
 * @param {BrandingRow} r
 * @returns {BrandingView}
 */
export function brandingView(r) {
  const accent = cleanHex(r.accent) ?? PLATFORM_ACCENT;
  const v = r.version ?? 0;
  const url = (/** @type {string} */ p) => `/api/public/org/${r.code}/${p}?v=${v}`;
  return {
    name: r.display_name || r.name,
    code: r.code,
    accent,
    shades: accentShades(accent).shades,
    tint: cleanHex(r.signin_tint),
    sidebar: cleanHex(r.sidebar),
    highlight: cleanHex(r.highlight),
    logo: r.has_logo ? url("logo") : null,
    logoDark: r.has_logo_dark ? url("logo-dark") : null,
    icon: r.has_icon ? url("icon") : null,
  };
}

/**
 * An organisation's branding by its id, for the signed-in shell and the settings page.
 * @param {D1Database} db  its own handle, or the owner
 * @param {string} orgId
 * @returns {Promise<BrandingView | null>}
 */
export async function brandingFor(db, orgId) {
  const r = /** @type {BrandingRow | null} */ (await db.prepare(`${SELECT} WHERE o.id = ?`).bind(orgId).first());
  return r ? brandingView(r) : null;
}

/** The same reply for every organisation nobody may see. */
const gone = () => json({ error: "Not found" }, 404, { "cache-control": "no-store" });

/**
 * The public routes, before sign-in. Null for any other path.
 * @param {Env} env
 * @param {Request} req
 * @param {string} path
 * @returns {Promise<Response | null>}
 */
export async function publicBrandingApi(env, req, path) {
  const m = path.match(/^\/api\/public\/org\/([^/]{1,64})\/(branding|logo|logo-dark|icon)$/);
  if (!m) return null;
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
  const tooMany = () => json({ error: "Too many requests. Wait a few minutes and try again." }, 429, { "retry-after": "600", "cache-control": "no-store" });
  const ip = req.headers.get("cf-connecting-ip");
  const root = env.ROOT;
  // Two limits per address, checked before anything is looked up, so a refusal says nothing about any code:
  //  1. Cloudflare's rate-limit binding (30 a minute). It counts per Cloudflare location, so it is only a first,
  //     cheap line.
  //  2. The one that holds everywhere: codes that led nowhere, counted in the database (login_failures, reason
  //     "org_code", with no organisation). After ORG_CODE_MISSES in ORG_CODE_WINDOW_MS from one address, every
  //     lookup from it is refused until the window passes. Looking up a real code doesn't count: guessing is the
  //     threat. Sign-in's own address limits leave these rows out, so mistyped codes never pause anyone's sign-in.
  if (env.BRANDING_LIMIT) {
    const { success } = await env.BRANDING_LIMIT.limit({ key: ip ?? "unknown" });
    if (!success) return tooMany();
  }
  const now = Date.now();
  if (ip) {
    const misses = /** @type {{ n: number } | null} */ (await root.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND reason = 'org_code' AND at > ?").bind(ip, now - ORG_CODE_WINDOW_MS).first());
    if (Number(misses?.n ?? 0) >= ORG_CODE_MISSES) return tooMany();
  }
  /** A code that led nowhere: recorded for the limit, and the same 404 as always. */
  const miss = async (/** @type {string} */ tried) => {
    if (ip) {
      await root
        .batch([
          root.prepare("INSERT INTO login_failures (id, at, username, user_id, ip, reason) VALUES (?, ?, ?, NULL, ?, 'org_code')").bind(crypto.randomUUID().replace(/-/g, "").slice(0, 16), now, `orgcode:${tried.slice(0, 40)}`, ip),
          root.prepare("DELETE FROM login_failures WHERE reason = 'org_code' AND at < ?").bind(now - 86_400_000),
        ])
        .catch((e) => console.error("Couldn't record an organisation code miss", e));
    }
    return gone();
  };
  const code = cleanCode(decodeURIComponent(m[1]));
  if (!code) return miss(decodeURIComponent(m[1]).toLowerCase());
  if (m[2] === "branding") {
    const r = /** @type {BrandingRow | null} */ (await root.prepare(`${SELECT} WHERE o.code = ? AND o.status = 'active' AND o.id <> ?`).bind(code, TEMPLATE_ORG).first());
    if (!r) return miss(code);
    return json(brandingView(r), 200, { "cache-control": "public, max-age=60" });
  }
  const slot = /** @type {Slot} */ (m[2] === "logo-dark" ? "logoDark" : m[2]);
  const r = /** @type {{ img: string | null; version: number } | null} */ (
    await root
      .prepare(`SELECT b.${SLOTS[slot].column} AS img, b.version FROM organizations o JOIN organization_branding b ON b.organization_id = o.id WHERE o.code = ? AND o.status = 'active' AND o.id <> ?`)
      .bind(code, TEMPLATE_ORG)
      .first()
  );
  const parsed = r?.img ? parseDataUrl(r.img) : null;
  // (A real organisation's page never asks for an image it doesn't have, so this counts as a miss too.)
  if (!r || !parsed) return miss(code);
  const current = new URL(req.url).searchParams.get("v") === String(r.version);
  return new Response(parsed.bytes, {
    headers: {
      "content-type": parsed.type,
      // The address changes with each new image, so the current one can be kept for good.
      "cache-control": current ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      // Email clients and other sites show it too.
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

// ---------- images ----------

/**
 * A PNG, JPEG or WebP data: URL's type and bytes, or null.
 * @param {string} url
 * @returns {{ type: string; bytes: Uint8Array } | null}
 */
export function parseDataUrl(url) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  try {
    return { type: m[1], bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) };
  } catch {
    return null;
  }
}

/**
 * The real type and size of an image, from its bytes (never from what the browser said), or null if it isn't a
 * PNG, JPEG or WebP image this code can read.
 * @param {Uint8Array} b
 * @returns {{ type: string; w: number; h: number } | null}
 */
export function sniffImage(b) {
  const at = (/** @type {number} */ i) => b[i] ?? 0;
  const ascii = (/** @type {number} */ i, /** @type {number} */ n) => String.fromCharCode(...b.subarray(i, i + n));
  // PNG: the signature, then the IHDR chunk's width and height.
  if (b.length > 24 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) && ascii(12, 4) === "IHDR") {
    return { type: "image/png", w: ((at(16) << 24) | (at(17) << 16) | (at(18) << 8) | at(19)) >>> 0, h: ((at(20) << 24) | (at(21) << 16) | (at(22) << 8) | at(23)) >>> 0 };
  }
  // JPEG: walk the segments to the frame header (SOF).
  if (b.length > 4 && at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = (at(i + 2) << 8) | at(i + 3);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { type: "image/jpeg", h: (at(i + 5) << 8) | at(i + 6), w: (at(i + 7) << 8) | at(i + 8) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP, then a VP8, VP8L or VP8X chunk.
  if (b.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { type: "image/webp", w: ((at(26) | (at(27) << 8)) & 0x3fff) >>> 0, h: ((at(28) | (at(29) << 8)) & 0x3fff) >>> 0 };
    if (chunk === "VP8L" && at(20) === 0x2f) {
      const bits = (at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24)) >>> 0;
      return { type: "image/webp", w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { type: "image/webp", w: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)), h: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)) };
  }
  return null;
}

/**
 * An uploaded image, checked: a data: URL of a PNG, JPEG or WebP image whose bytes really are that type, within the
 * size limit and the slot's box. SVG and everything else is refused.
 * @param {Slot} slot
 * @param {unknown} v
 * @returns {string}
 */
export function cleanImage(slot, v) {
  const { label, box } = SLOTS[slot];
  const s = String(v ?? "");
  if (/^data:image\/svg/i.test(s)) throw new HttpError(400, `${label} can't be an SVG file: use PNG, WebP or JPEG`);
  const parsed = parseDataUrl(s);
  if (!parsed || !(/** @type {readonly string[]} */ (IMAGE_TYPES).includes(parsed.type))) throw new HttpError(400, `${label} must be a PNG, WebP or JPEG image`);
  if (parsed.bytes.length > STORED_MAX_BYTES) throw new HttpError(400, `${label} is too large: at most ${Math.round(STORED_MAX_BYTES / 1024)} KB after resizing`);
  const real = sniffImage(parsed.bytes);
  if (!real || real.type !== parsed.type) throw new HttpError(400, `${label} isn't a readable ${parsed.type.slice(6).toUpperCase()} image`);
  if (!real.w || !real.h || real.w > box.w || real.h > box.h) throw new HttpError(400, `${label} must fit in ${box.w} × ${box.h} pixels (it is ${real.w} × ${real.h})`);
  return s;
}

// ---------- changing it ----------

/**
 * @typedef {Object} BrandingInput
 * @property {unknown} [displayName]
 * @property {unknown} [accent]
 * @property {unknown} [tint]      null to remove
 * @property {unknown} [sidebar]   its own sidebar colour, or null for the neutral one
 * @property {unknown} [highlight] its sidebar's highlight, or null for the accent
 * @property {unknown} [logo]      a data: URL, or null to remove
 * @property {unknown} [logoDark]
 * @property {unknown} [icon]
 */

/**
 * Saves an organisation's branding. `db` is the organisation's own handle (its administrators; row-level security
 * keeps them to their own row) or the owner (a Platform Administrator). Returns the new view and what changed, for
 * the audit log.
 * @param {D1Database} db
 * @param {string} orgId
 * @param {BrandingInput} b
 * @param {string} actorId
 * @returns {Promise<{ view: BrandingView; diff: { before: Record<string, unknown>; after: Record<string, unknown> } | null }>}
 */
export async function saveBranding(db, orgId, b, actorId) {
  const r = /** @type {BrandingRow | null} */ (await db.prepare(`${SELECT} WHERE o.id = ?`).bind(orgId).first());
  if (!r) throw new HttpError(404, "Not found");
  const before = {
    displayName: r.display_name || r.name,
    accent: cleanHex(r.accent) ?? PLATFORM_ACCENT,
    tint: cleanHex(r.signin_tint),
    sidebar: cleanHex(r.sidebar),
    highlight: cleanHex(r.highlight),
  };
  /** An optional colour: unchanged, cleared (null or ""), or a colour. @param {unknown} v @param {string | null} was @param {string} label */
  const optional = (v, was, label) => {
    if (v === undefined) return was;
    if (v === null || v === "") return null;
    const c = cleanHex(v);
    if (!c) throw new HttpError(400, `${label} is # and six hex digits`);
    return c;
  };
  const sidebar = optional(b.sidebar, before.sidebar, "The sidebar colour");
  const highlight = optional(b.highlight, before.highlight, "The highlight colour");
  const displayName = b.displayName === undefined ? before.displayName : String(b.displayName ?? "").replace(/\s+/g, " ").trim();
  if (!displayName || displayName.length > 80) throw new HttpError(400, "The display name is 1 to 80 characters");
  const accent = b.accent === undefined ? before.accent : cleanHex(b.accent);
  if (!accent) throw new HttpError(400, "The accent colour is # and six hex digits, such as #2c3280");
  const tint = b.tint === undefined ? before.tint : b.tint === null || b.tint === "" ? null : cleanHex(b.tint);
  if (b.tint !== undefined && b.tint !== null && b.tint !== "" && !tint) throw new HttpError(400, "The sign-in tint is # and six hex digits");
  /** @type {Record<Slot, string | null | undefined>} */
  const images = { logo: undefined, logoDark: undefined, icon: undefined };
  /** @type {Record<string, string>} */ const imageBefore = {};
  /** @type {Record<string, string>} */ const imageAfter = {};
  for (const slot of /** @type {Slot[]} */ (Object.keys(SLOTS))) {
    const v = b[slot];
    if (v === undefined) continue;
    const had = !!(slot === "logo" ? r.has_logo : slot === "logoDark" ? r.has_logo_dark : r.has_icon);
    if (v === null || v === "") {
      images[slot] = null;
      if (had) [imageBefore[slot], imageAfter[slot]] = ["set", "removed"];
    } else {
      images[slot] = cleanImage(slot, v);
      [imageBefore[slot], imageAfter[slot]] = [had ? "set" : "none", had ? "replaced" : "added"];
    }
  }
  const after = { displayName, accent, tint, sidebar, highlight };
  const fields = changed(before, after);
  const diff = fields || Object.keys(imageAfter).length ? { before: { ...(fields?.before ?? {}), ...imageBefore }, after: { ...(fields?.after ?? {}), ...imageAfter } } : null;
  if (!diff) return { view: brandingView(r), diff: null };
  const set = (/** @type {Slot} */ s) => images[s] !== undefined;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO organization_branding (organization_id, display_name, accent, signin_tint, sidebar, highlight, logo, logo_dark, icon, version, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (organization_id) DO UPDATE SET display_name = excluded.display_name, accent = excluded.accent, signin_tint = excluded.signin_tint,
         sidebar = excluded.sidebar, highlight = excluded.highlight,
         logo = CASE WHEN ? THEN excluded.logo ELSE organization_branding.logo END,
         logo_dark = CASE WHEN ? THEN excluded.logo_dark ELSE organization_branding.logo_dark END,
         icon = CASE WHEN ? THEN excluded.icon ELSE organization_branding.icon END,
         version = organization_branding.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(orgId, displayName, accent, tint, sidebar, highlight, images.logo ?? null, images.logoDark ?? null, images.icon ?? null, now, actorId, set("logo"), set("logoDark"), set("icon"))
    .run();
  const view = await brandingFor(db, orgId);
  return { view: /** @type {BrandingView} */ (view), diff };
}

/**
 * GET and PUT /api/org/branding, for the organisation's administrators (worker/orgadmin.js checks that first).
 * @param {{ req: Request; method: string; odb: D1Database; scope: Scope; me: { id: string; name: string } }} c
 * @returns {Promise<Response>}
 */
export async function orgBrandingApi(c) {
  if (c.method === "GET") return json({ branding: await brandingFor(c.odb, c.scope.orgId) });
  if (c.method !== "PUT") throw new HttpError(405, "Method not allowed");
  const b = /** @type {BrandingInput} */ (await body(c.req));
  const { view, diff } = await saveBranding(c.odb, c.scope.orgId, b, c.me.id);
  if (diff) await auditEntry(c.odb, c.req, c.me, { action: "organization_branding_updated", type: "organization", id: c.scope.orgId, before: diff.before, after: diff.after }).run();
  return json({ branding: view });
}
