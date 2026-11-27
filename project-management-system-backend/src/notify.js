/** @import { Digest, NotificationKind } from '../../project-management-system-frontend/src/data/notifications' */
// Notifications: every alert lands under the person's bell, then goes out by email (Resend) and to
// a Teams channel when an administrator has connected them in Settings. Until then, nothing leaves
// Pulse. The API key and webhook address are sealed with MFA_KEY and never sent back to the browser.
import { brandingFor } from "./branding";
import { initials, solidShade } from "../../project-management-system-frontend/src/data/branding";
import { BRAND } from "../../project-management-system-frontend/src/data/brand";
import { newToken, openSecret } from "./auth";
import { START_KEYS, cleanPrefs } from "../../project-management-system-frontend/src/data/roles";
import { settingRow, saveSetting } from "./settings";
/**
 * @param {D1Database} db
 * @returns {Promise<Delivery>}
 */
export async function readDelivery(db) {
  // Email and Teams are set up per organisation; with none known there's nothing to send through.
  if (!(/** @type {TenantDatabase} */ (db).scope?.orgId)) return {};
  const row = await /** @type {Promise<{ value: string; } | null>} */ (/** @type {unknown} */ (settingRow(db, "delivery")));
  return row ? /** @type {Delivery} */ (JSON.parse(row.value)) : {};
}
/**
 * Remembers the last failure, so an administrator can see it in Settings.
 * @param {D1Database} db
 * @param {string} channel
 * @param {unknown} e
 * @returns {Promise<void>}
 */
export async function noteFailure(db, channel, e) {
  const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  console.error(`${channel} delivery failed: ${message}`);
  // Kept for the organisation's administrators; a handle with no organisation has nowhere to keep it.
  if (!(/** @type {TenantDatabase} */ (db).scope?.orgId)) return;
  await saveSetting(db, "delivery_error")
    .bind(JSON.stringify({ channel, message, at: new Date().toISOString() }))
    .run()
    .catch(() => undefined);
}
const esc =
  /** @param {string} s
   * @returns {string}
   */ (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Links in a notification are addresses inside Pulse; view-page links just open Pulse. */
const fullLink =
  /** @param {Env} env
   * @param {string} [link]
   * @returns {string}
   */ (env, link) => `${env.PUBLIC_URL ?? ""}/${link?.startsWith("#") ? link : ""}`;
/**
 * One email layout for alerts and digests. Everything typed by users is escaped.
 * @param {Env} env
 * @param {string} title
 * @param {string} intro
 * @param {Digest | undefined} digest
 * @param {string | undefined} link
 * @returns {string}
 */
function emailHtml(env, title, intro, digest, link) {
  const sections = (digest?.sections ?? []).map((s) => `<h3 style="margin:22px 0 6px;font-size:15px;color:#pmsink">${esc(s.title)}</h3>` + `<ul style="margin:0;padding-left:20px">${s.items.map((i) => `<li style="margin:4px 0">${esc(i.text)}</li>`).join("")}</ul>`).join("");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1c2b45;background:#ffffff;padding:24px;border-radius:12px;max-width:600px">
<!--pms:header-->
<h2 style="margin:0 0 10px;font-size:20px;color:#1f2933">${esc(title)}</h2>
${intro ? `<p style="margin:0">${esc(intro)}</p>` : ""}
${sections}
<p style="margin:24px 0"><a href="${esc(fullLink(env, link))}" style="background:#pmsacc;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open ${esc(BRAND.shortName)}</a></p>
<p style="margin:0;font-size:12px;color:#6b7a90">${esc(BRAND.poweredBy)}. You can turn these emails off in Settings.${digest?.aiWritten ? " The opening paragraph is AI-written; the lists come straight from the live data." : ""}</p>
</div>`;
}
/**
 * @param {Env} env
 * @param {string} title
 * @param {string} intro
 * @param {Digest | undefined} digest
 * @param {string | undefined} link
 * @returns {string}
 */
function emailText(env, title, intro, digest, link) {
  const sections = (digest?.sections ?? []).map((s) => `${s.title}\n${s.items.map((i) => `- ${i.text}`).join("\n")}`);
  return [title, intro, ...sections, `Open ${BRAND.shortName}: ${fullLink(env, link)}`].filter(Boolean).join("\n\n");
}
/**
 * @param {Env} env
 * @param {Delivery} delivery
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {string} text
 * @param {string | null} [forOrg]  the organisation, when env isn't scoped to it
 * @returns {Promise<void>}
 */
export async function sendEmail(env, delivery, to, subject, html, text, forOrg) {
  if (!delivery.resendKey || !delivery.from || !env.MFA_KEY) throw new Error("Email isn't connected yet");
  // The organisation's branding: from the handle's scope, or given (password resets run as the owner).
  const orgId = forOrg ?? /** @type {TenantDatabase | undefined} */ (env.DB)?.scope?.orgId ?? null;
  const brand = orgId ? await brandingFor(env.ROOT, orgId).catch(() => null) : null;
  ({ subject, html } = brandEmail(env, brand, subject, html));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${await openSecret(delivery.resendKey, env.MFA_KEY)}`, "content-type": "application/json" },
    body: JSON.stringify({ from: delivery.from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = /** @type {{ message?: string }} */ (await res.json().catch(() => ({})));
    throw new Error(`The email service refused it (${res.status})${detail.message ? `: ${detail.message}` : ""}`);
  }
}
/**
 * Fills an email's branding markers: the organisation's logo (or monogram) and name in the header, its accent on
 * the button and headings, and its name before the subject. Without an organisation, the neutral PMS header.
 * @param {Env} env
 * @param {import("../../project-management-system-frontend/src/data/branding").BrandingView | null} b
 * @param {string} subject
 * @param {string} html
 * @returns {{ subject: string; html: string }}
 */
export function brandEmail(env, b, subject, html) {
  const solid = b ? solidShade(b.accent) : "#2f4a60";
  const ink = b ? b.shades.light : "#3e5c76";
  const base = env.PUBLIC_URL ?? "";
  const header = !b
    ? `<p style="margin:0 0 14px;font-weight:900;font-size:15px;letter-spacing:-0.01em;color:#1f2933">${esc(BRAND.shortName)}</p>`
    : b.logo
      ? `<p style="margin:0 0 16px"><img src="${esc(base + b.logo)}" alt="${esc(b.name)}" height="36" style="height:36px;max-width:220px;width:auto;display:block;border:0"></p>`
      : `<p style="margin:0 0 16px"><span style="display:inline-block;width:36px;height:36px;line-height:36px;border-radius:9px;background:${solid};color:#fff;font-weight:800;font-size:15px;text-align:center;vertical-align:middle">${esc(initials(b.name))}</span> <b style="vertical-align:middle;font-size:15px;color:#1f2933">${esc(b.name)}</b></p>`;
  return {
    subject: b && subject.startsWith(`${BRAND.shortName}: `) ? `${b.name}: ${subject.slice(BRAND.shortName.length + 2)}` : subject,
    html: html.split("<!--pms:header-->").join(header).split("#pmsacc").join(solid).split("#pmsink").join(ink),
  };
}
/**
 * An account-security email (password reset, password changed): always sent, whatever the
 * person's email settings, with an optional button. `url` is a full address.
 * @param {string} title
 * @param {string[]} lines
 * @param {{ label: string; url: string }} [button]
 * @returns {{ subject: string; html: string; text: string; }}
 */
export function securityEmail(title, lines, button) {
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1c2b45;background:#ffffff;padding:24px;border-radius:12px;max-width:600px">
<!--pms:header-->
<h2 style="margin:0 0 10px;font-size:20px;color:#1f2933">${esc(title)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join("")}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#pmsacc;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>` : ""}
<p style="margin:0;font-size:12px;color:#6b7a90">Sent about your account's security. Nobody will ever ask you for your password. ${esc(BRAND.poweredBy)}.</p>
</div>`;
  const text = [title, ...lines, ...(button ? [`${button.label}: ${button.url}`] : [])].join("\n\n");
  return { subject: `${BRAND.shortName}: ${title}`, html, text };
}
/**
 * Posts an Adaptive Card to a Teams "Workflows" webhook. Square brackets are dropped so typed text can't become links.
 * @param {Env} env
 * @param {Delivery} delivery
 * @param {ChannelPost} post
 * @returns {Promise<void>}
 */
export async function postToTeams(env, delivery, post) {
  if (!delivery.teams || !env.MFA_KEY) throw new Error("Teams isn't connected yet");
  // Posted as the organisation: its name on the button.
  const orgId = /** @type {TenantDatabase | undefined} */ (env.DB)?.scope?.orgId ?? null;
  const brand = orgId ? await brandingFor(env.ROOT, orgId).catch(() => null) : null;
  const plain = /** @param {string} s */ (s) => s.replace(/[[\]]/g, "");
  const res = await fetch(await openSecret(delivery.teams, env.MFA_KEY), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [{ type: "TextBlock", text: plain(post.title), weight: "Bolder", wrap: true }, ...(post.body ? [{ type: "TextBlock", text: plain(post.body), wrap: true }] : [])],
            actions: [{ type: "Action.OpenUrl", title: `Open in ${brand?.name ?? BRAND.shortName}`, url: fullLink(env, post.link) }],
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Teams refused the message (${res.status})`);
}
export const pause =
  /** @param {number} ms
   * @returns {Promise<unknown>}
   */ (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * @param {Env} env
 * @param {string} title
 * @param {string} intro
 * @param {Digest} [digest]
 * @param {string} [link]
 * @returns {{ subject: string; html: string; text: string; }}
 */
export function emailFor(env, title, intro, digest, link) {
  return { subject: `${BRAND.shortName}: ${title}`, html: emailHtml(env, title, intro, digest, link), text: emailText(env, title, intro, digest, link) };
}
/**
 * Records alerts and sends them on. A `dedupe` key that person already has is skipped, along with
 * its email. A failed send never loses the in-app notification. Returns how many were new and emailed.
 * @param {Env} env
 * @param {Alert[]} alerts
 * @param {ChannelPost} [channel]
 * @returns {Promise<{ created: number; emailed: number }>}
 */
export async function raise(env, alerts, channel) {
  const db = env.DB;
  if (!alerts.length) {
    if (channel) {
      const delivery = await readDelivery(db);
      if (delivery.teams) await postToTeams(env, delivery, channel).catch((e) => noteFailure(db, "Teams", e));
    }
    return { created: 0, emailed: 0 };
  }
  const at = new Date().toISOString();
  const all = alerts.map((a) => ({ ...a, id: newToken().slice(0, 16) }));
  // Email-only alerts (a scheme with the bell off) aren't stored; they go straight to email.
  const rows = all.filter((a) => a.bell !== false);
  const emailOnly = all.filter((a) => a.bell === false && a.email !== false);
  // The bell belongs to a workspace. Alerts raised with one open land there; organisation-wide ones (an account
  // locked, a forgotten password: raised before anyone has a workspace open) land in each person's first workspace.
  const scope = /** @type {TenantDatabase} */ (db).scope;
  /** @type {Map<string, TenantDatabase>} */ const where = new Map();
  if (rows.length && scope?.orgId && !scope.workspaceId) {
    const ids = [...new Set(rows.map((a) => a.userId))];
    const homes = /** @type {D1Result<{ user_id: string; workspace_id: string }>} */ (
      await db
        .prepare(`SELECT m.user_id, m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE w.status = 'active' AND m.user_id IN (${ids.map(() => "?").join(", ")}) ORDER BY w.position, w.name`)
        .bind(...ids)
        .all()
    );
    for (const h of homes.results) if (!where.has(h.user_id)) where.set(h.user_id, env.ROOT.withScope({ orgId: scope.orgId, workspaceId: h.workspace_id }));
  }
  /** @type {Set<string>} */ const created = new Set();
  /** @type {Map<TenantDatabase | D1Database, typeof rows>} */ const groups = new Map();
  for (const a of rows) {
    const target = scope?.workspaceId ? db : where.get(a.userId);
    if (!target) continue; // no workspace to show it in
    groups.set(target, [...(groups.get(target) ?? []), a]);
  }
  for (const [target, group] of groups) {
    const results = await target.batch(
      group.map((a) =>
        target
          .prepare("INSERT INTO notifications (id, user_id, kind, title, body, link, digest, dedupe, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(a.id, a.userId, a.kind, a.title.slice(0, 200), (a.body ?? "").slice(0, 500), a.link ?? null, a.digest ? JSON.stringify(a.digest) : null, a.dedupe ?? null, at),
      ),
    );
    group.forEach((a, i) => results[i]?.meta.changes && created.add(a.id));
  }
  const stored = rows.filter((a) => created.has(a.id));
  const fresh = [...stored, ...emailOnly];
  if (!fresh.length) return { created: 0, emailed: 0 };
  const delivery = await readDelivery(db);
  let emailed = 0;
  if (delivery.resendKey && delivery.from) {
    const ids = [...new Set(fresh.map((a) => a.userId))];
    const people = await /** @type {Promise<D1Result<{ id: string; email: string | null; prefs: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT id, email, prefs FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`)
          .bind(...ids)
          .all()
      )
    );
    const byId = new Map(people.results.map((p) => [p.id, p]));
    for (const a of fresh.filter((x) => x.email !== false)) {
      const person = byId.get(a.userId);
      if (!person?.email) continue;
      const prefs = cleanPrefs(JSON.parse(person.prefs || "{}"), START_KEYS);
      if ((a.digest ? prefs.emailSummaries : prefs.emailAlerts) === "off") continue;
      const mail = emailFor(env, a.title, a.digest ? a.digest.summary : (a.body ?? ""), a.digest, a.link);
      try {
        await sendEmail(env, delivery, person.email, mail.subject, mail.html, mail.text);
        emailed++;
      } catch (e) {
        await noteFailure(db, "Email", e);
      }
      // The email service takes about two a second.
      if (fresh.length > 1) await pause(550);
    }
  }
  if (channel && delivery.teams) await postToTeams(env, delivery, channel).catch((e) => noteFailure(db, "Teams", e));
  return { created: stored.length, emailed };
}
/**
 * @typedef {Object} Alert
 * @property {string} userId
 * @property {NotificationKind} kind
 * @property {string} title
 * @property {string} [body]
 * @property {string} [link]
 * @property {Digest} [digest]
 * @property {string} [dedupe]
 * @property {boolean} [bell] Under the bell (default yes). A notification scheme can turn it off for an event.
 * @property {boolean} [email] By email, following the person's settings (default yes). A scheme can turn it off.
 */
/**
 * What goes to the team's Teams channel: written for the team, not "you".
 * @typedef {Object} ChannelPost
 * @property {string} title
 * @property {string} [body]
 * @property {string} [link]
 */
/**
 * @typedef {Object} Delivery
 * @property {string} [resendKey]
 * @property {string} [from]
 * @property {string} [teams]
 * @property {string[]} [briefingEmails]
 */
