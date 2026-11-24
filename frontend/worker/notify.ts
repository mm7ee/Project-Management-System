// Notifications: every alert lands under the person's bell, then goes out by email (Resend) and to
// a Teams channel when an administrator has connected them in Settings. Until then, nothing leaves
// Pulse. The API key and webhook address are sealed with MFA_KEY and never sent back to the browser.

import { newToken, openSecret } from "./auth";
import { START_KEYS, cleanPrefs } from "../src/data/roles";
import type { Digest, NotificationKind } from "../src/data/notifications";

export interface Alert {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  digest?: Digest;
  dedupe?: string;
  /** Under the bell (default yes). A notification scheme can turn it off for an event. */
  bell?: boolean;
  /** By email, following the person's settings (default yes). A scheme can turn it off. */
  email?: boolean;
}

/** What goes to the team's Teams channel: written for the team, not "you". */
export interface ChannelPost {
  title: string;
  body?: string;
  link?: string;
}

export interface Delivery {
  resendKey?: string; // sealed
  from?: string;
  teams?: string; // sealed
  briefingEmails?: string[];
}

export async function readDelivery(db: D1Database): Promise<Delivery> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'delivery'").first<{ value: string }>();
  return row ? (JSON.parse(row.value) as Delivery) : {};
}

/** Remembers the last failure, so an administrator can see it in Settings. */
export async function noteFailure(db: D1Database, channel: string, e: unknown) {
  const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  console.error(`${channel} delivery failed: ${message}`);
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('delivery_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify({ channel, message, at: new Date().toISOString() }))
    .run()
    .catch(() => undefined);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Links in a notification are addresses inside Pulse; view-page links just open Pulse. */
const fullLink = (env: Env, link?: string) => `${env.PUBLIC_URL ?? ""}/${link?.startsWith("#") ? link : ""}`;

/** One email layout for alerts and digests. Everything typed by users is escaped. */
function emailHtml(env: Env, title: string, intro: string, digest: Digest | undefined, link: string | undefined): string {
  const sections = (digest?.sections ?? [])
    .map(
      (s) =>
        `<h3 style="margin:22px 0 6px;font-size:15px;color:#2c3280">${esc(s.title)}</h3>` +
        `<ul style="margin:0;padding-left:20px">${s.items.map((i) => `<li style="margin:4px 0">${esc(i.text)}</li>`).join("")}</ul>`,
    )
    .join("");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1c2b45;background:#ffffff;padding:24px;border-radius:12px;max-width:600px">
<p style="margin:0 0 14px;font-weight:800;font-size:13px;letter-spacing:.08em;color:#ed0000">PULSE</p>
<h2 style="margin:0 0 10px;font-size:20px;color:#101553">${esc(title)}</h2>
${intro ? `<p style="margin:0">${esc(intro)}</p>` : ""}
${sections}
<p style="margin:24px 0"><a href="${esc(fullLink(env, link))}" style="background:#2c3280;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open Pulse</a></p>
<p style="margin:0;font-size:12px;color:#6b7a90">Sent by Pulse, Omni Contact's project tracker. You can turn these emails off in Settings.${digest?.aiWritten ? " The opening paragraph is AI-written; the lists come straight from Pulse's data." : ""}</p>
</div>`;
}

function emailText(env: Env, title: string, intro: string, digest: Digest | undefined, link: string | undefined): string {
  const sections = (digest?.sections ?? []).map((s) => `${s.title}\n${s.items.map((i) => `- ${i.text}`).join("\n")}`);
  return [title, intro, ...sections, `Open Pulse: ${fullLink(env, link)}`].filter(Boolean).join("\n\n");
}

export async function sendEmail(env: Env, delivery: Delivery, to: string, subject: string, html: string, text: string) {
  if (!delivery.resendKey || !delivery.from || !env.MFA_KEY) throw new Error("Email isn't connected yet");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${await openSecret(delivery.resendKey, env.MFA_KEY)}`, "content-type": "application/json" },
    body: JSON.stringify({ from: delivery.from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`The email service refused it (${res.status})${detail.message ? `: ${detail.message}` : ""}`);
  }
}

/**
 * An account-security email (password reset, password changed): always sent, whatever the
 * person's email settings, with an optional button. `url` is a full address.
 */
export function securityEmail(title: string, lines: string[], button?: { label: string; url: string }) {
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1c2b45;background:#ffffff;padding:24px;border-radius:12px;max-width:600px">
<p style="margin:0 0 14px;font-weight:800;font-size:13px;letter-spacing:.08em;color:#ed0000">PULSE</p>
<h2 style="margin:0 0 10px;font-size:20px;color:#101553">${esc(title)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join("")}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#2c3280;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>` : ""}
<p style="margin:0;font-size:12px;color:#6b7a90">Sent by Pulse, Omni Contact's project tracker, about your account's security. Nobody from Pulse will ever ask for your password.</p>
</div>`;
  const text = [title, ...lines, ...(button ? [`${button.label}: ${button.url}`] : [])].join("\n\n");
  return { subject: `Pulse: ${title}`, html, text };
}

/** Posts an Adaptive Card to a Teams "Workflows" webhook. Square brackets are dropped so typed text can't become links. */
export async function postToTeams(env: Env, delivery: Delivery, post: ChannelPost) {
  if (!delivery.teams || !env.MFA_KEY) throw new Error("Teams isn't connected yet");
  const plain = (s: string) => s.replace(/[[\]]/g, "");
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
            body: [
              { type: "TextBlock", text: plain(post.title), weight: "Bolder", wrap: true },
              ...(post.body ? [{ type: "TextBlock", text: plain(post.body), wrap: true }] : []),
            ],
            actions: [{ type: "Action.OpenUrl", title: "Open Pulse", url: fullLink(env, post.link) }],
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Teams refused the message (${res.status})`);
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function emailFor(env: Env, title: string, intro: string, digest?: Digest, link?: string) {
  return { subject: `Pulse: ${title}`, html: emailHtml(env, title, intro, digest, link), text: emailText(env, title, intro, digest, link) };
}

/**
 * Records alerts and sends them on. A `dedupe` key that person already has is skipped, along with
 * its email. A failed send never loses the in-app notification. Returns how many were new and emailed.
 */
export async function raise(env: Env, alerts: Alert[], channel?: ChannelPost): Promise<{ created: number; emailed: number }> {
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
  const results = rows.length
    ? await db.batch(
        rows.map((a) =>
          db
            .prepare("INSERT INTO notifications (id, user_id, kind, title, body, link, digest, dedupe, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
            .bind(a.id, a.userId, a.kind, a.title.slice(0, 200), (a.body ?? "").slice(0, 500), a.link ?? null, a.digest ? JSON.stringify(a.digest) : null, a.dedupe ?? null, at),
        ),
      )
    : [];
  const stored = rows.filter((_, i) => results[i]?.meta.changes);
  const fresh = [...stored, ...emailOnly];
  if (!fresh.length) return { created: 0, emailed: 0 };

  const delivery = await readDelivery(db);
  let emailed = 0;
  if (delivery.resendKey && delivery.from) {
    const ids = [...new Set(fresh.map((a) => a.userId))];
    const people = await db
      .prepare(`SELECT id, email, prefs FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`)
      .bind(...ids)
      .all<{ id: string; email: string | null; prefs: string }>();
    const byId = new Map(people.results.map((p) => [p.id, p]));
    for (const a of fresh.filter((x) => x.email !== false)) {
      const person = byId.get(a.userId);
      if (!person?.email) continue;
      const prefs = cleanPrefs(JSON.parse(person.prefs || "{}"), START_KEYS);
      if ((a.digest ? prefs.emailSummaries : prefs.emailAlerts) === "off") continue;
      const mail = emailFor(env, a.title, a.digest ? a.digest.summary : a.body ?? "", a.digest, a.link);
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
