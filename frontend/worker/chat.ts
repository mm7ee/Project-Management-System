// Chat: direct messages, group chats and a channel per project, for everyone signed in (not view-only
// links). People reach new messages by polling (src/data/chat.ts says how often).
//
// Who sees what:
// - a direct message or group chat: only the people in it;
// - a project channel: anyone signed in may read it and join it. The project's lead and developers are
//   added when they open Chat, unless they've left it before.
// Messages aren't written to the activity log; creating a group and changing who is in it are.

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import type { ItemContext } from "./workitems";
import type { Alert } from "./notify";
import { mentionsIn } from "../src/data/workitems";
import {
  MAX_GROUP_NAME,
  MAX_GROUP_SIZE,
  MAX_MESSAGE,
  PAGE_SIZE,
  cleanMessage,
  directKey,
  type ChatMessage,
  type Conversation,
  type ConversationKind,
  type MessageKind,
  type MessagesPage,
} from "../src/data/chat";

interface ConversationRow {
  id: string;
  kind: ConversationKind;
  name: string;
  system_id: string | null;
  system_name: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
}

interface MessageRow {
  id: number;
  conversation_id: string;
  user_id: string;
  kind: MessageKind;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

const toMessage = (r: MessageRow): ChatMessage => ({
  id: Number(r.id),
  conversationId: r.conversation_id,
  userId: r.user_id,
  kind: r.kind,
  // A deleted message keeps its place in the conversation, without its words.
  body: r.deleted_at ? "" : r.body,
  createdAt: r.created_at,
  ...(r.edited_at ? { editedAt: r.edited_at } : {}),
  ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
});

const MESSAGE_COLUMNS = "id, conversation_id, user_id, kind, body, created_at, edited_at, deleted_at";
const CONVERSATION_SELECT = `SELECT c.id, c.kind, c.name, c.system_id, c.created_by, c.created_at, c.last_message_at, (s.data::jsonb ->> 'name') AS system_name
  FROM chat_conversations c LEFT JOIN systems s ON s.id = c.system_id`;
/** A poll asks for changes since its last answer; this much overlap covers clocks a little apart. */
const SINCE_OVERLAP_MS = 10_000;
/** Someone who read a conversation this recently is reading it now (an open one polls every 3 s). */
const WATCHING_MS = 12_000;

const ID = "[A-Za-z0-9_-]{4,80}";
const projectChannelId = (systemId: string) => `p-${systemId}`;

export async function chatApi(c: ItemContext, path: string, method: string): Promise<Response | null> {
  if (path !== "/api/chat" && !path.startsWith("/api/chat/")) return null;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const { db, req, me } = c;
  const url = new URL(req.url);

  // ----- helpers -----
  const memberIds = async (ids: string[]) => {
    const byConversation = new Map<string, string[]>(ids.map((id) => [id, []]));
    if (!ids.length) return byConversation;
    const rows = await db
      .prepare(`SELECT conversation_id, user_id FROM chat_members WHERE left_at IS NULL AND conversation_id IN (${ids.map(() => "?").join(", ")}) ORDER BY joined_at`)
      .bind(...ids)
      .all<{ conversation_id: string; user_id: string }>();
    for (const r of rows.results) byConversation.get(r.conversation_id)?.push(r.user_id);
    return byConversation;
  };
  const realPeople = async (ids: unknown): Promise<string[]> => {
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => id !== me.id).slice(0, MAX_GROUP_SIZE);
    if (!wanted.length) return [];
    const found = await db.prepare(`SELECT id FROM users WHERE id IN (${wanted.map(() => "?").join(", ")})`).bind(...wanted).all<{ id: string }>();
    if (found.results.length !== wanted.length) throw new HttpError(400, "One of those people isn't in Pulse");
    return wanted;
  };
  const namesOf = async (ids: string[]) => {
    if (!ids.length) return [];
    const rows = await db.prepare(`SELECT name FROM users WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY name`).bind(...ids).all<{ name: string }>();
    return rows.results.map((r) => r.name);
  };
  const listJoin = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

  /** The conversation, if you may see it, and whether you're in it. Otherwise "not found", so nothing leaks. */
  const open = async (id: string) => {
    const row = await db.prepare(`${CONVERSATION_SELECT} WHERE c.id = ?`).bind(id).first<ConversationRow>();
    const membership = row
      ? await db.prepare("SELECT left_at, last_read_id FROM chat_members WHERE conversation_id = ? AND user_id = ?").bind(id, me.id).first<{ left_at: string | null; last_read_id: number }>()
      : null;
    const member = !!membership && !membership.left_at;
    if (!row || (row.kind !== "project" && !member)) throw new HttpError(404, "Conversation not found");
    return { row, member, lastReadId: Number(membership?.last_read_id ?? 0) };
  };

  /** Adds you to a conversation, or back to one you left. */
  const join = (conversationId: string, userId = me.id) =>
    db
      .prepare(
        `INSERT INTO chat_members (conversation_id, user_id, joined_at, last_read_id)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE conversation_id = ?))
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL, joined_at = excluded.joined_at, last_read_id = excluded.last_read_id
         WHERE chat_members.left_at IS NOT NULL`,
      )
      .bind(conversationId, userId, c.now, conversationId);

  /** "Tariro added Farai": a line in the conversation itself. */
  const event = (conversationId: string, text: string) =>
    db
      .prepare("INSERT INTO chat_messages (conversation_id, user_id, kind, body, created_at, updated_at) VALUES (?, ?, 'event', ?, ?, ?)")
      .bind(conversationId, me.id, text, c.now, c.now);
  const touch = (conversationId: string) => db.prepare("UPDATE chat_conversations SET last_message_at = ? WHERE id = ?").bind(c.now, conversationId);

  /** Your conversations, newest first, with what's unread. */
  const listConversations = async (): Promise<Conversation[]> => {
    const rows = await db
      .prepare(
        `SELECT c.id, c.kind, c.name, c.system_id, c.created_by, c.created_at, c.last_message_at, (s.data::jsonb ->> 'name') AS system_name,
           lm.user_id AS lm_user, lm.body AS lm_body, lm.kind AS lm_kind, lm.created_at AS lm_at, lm.deleted_at AS lm_deleted,
           (SELECT COUNT(*) FROM chat_messages x WHERE x.conversation_id = c.id AND x.id > m.last_read_id AND x.user_id <> ? AND x.deleted_at IS NULL) AS unread
         FROM chat_members m
         JOIN chat_conversations c ON c.id = m.conversation_id
         LEFT JOIN systems s ON s.id = c.system_id
         LEFT JOIN LATERAL (SELECT user_id, body, kind, created_at, deleted_at FROM chat_messages y WHERE y.conversation_id = c.id ORDER BY y.id DESC LIMIT 1) lm ON TRUE
         WHERE m.user_id = ? AND m.left_at IS NULL
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
         LIMIT 200`,
      )
      .bind(me.id, me.id)
      .all<ConversationRow & { lm_user: string | null; lm_body: string | null; lm_kind: MessageKind | null; lm_at: string | null; lm_deleted: string | null; unread: number }>();
    const members = await memberIds(rows.results.map((r) => r.id));
    return rows.results.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.kind === "project" ? (r.system_name ?? "Project") : r.name,
      ...(r.system_id ? { systemId: r.system_id } : {}),
      memberIds: members.get(r.id) ?? [],
      ...(r.created_by ? { createdBy: r.created_by } : {}),
      ...(r.lm_user && r.lm_at ? { lastMessage: { userId: r.lm_user, body: r.lm_deleted ? "" : (r.lm_body ?? "").slice(0, 140), at: r.lm_at, kind: r.lm_kind ?? "text" } } : {}),
      ...(r.last_message_at ? { lastMessageAt: r.last_message_at } : {}),
      unread: Number(r.unread),
      member: true,
    }));
  };

  /** The channels of the projects you lead or work on, made and joined if they aren't yet (unless you left). */
  const joinMyProjectChannels = async () => {
    const mine = await db
      .prepare(
        `SELECT s.id FROM systems s
         WHERE (s.data::jsonb ->> 'lead') = ? OR EXISTS (SELECT 1 FROM assignments a WHERE a.system_id = s.id AND a.user_id = ?)`,
      )
      .bind(me.id, me.id)
      .all<{ id: string }>();
    if (!mine.results.length) return;
    await db.batch([
      ...mine.results.map((s) =>
        db
          .prepare("INSERT INTO chat_conversations (id, kind, system_id, created_at) VALUES (?, 'project', ?, ?) ON CONFLICT DO NOTHING")
          .bind(projectChannelId(s.id), s.id, c.now),
      ),
      ...mine.results.map((s) =>
        db.prepare("INSERT INTO chat_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(projectChannelId(s.id), me.id, c.now),
      ),
    ]);
  };

  /**
   * Notifications under the bell for a new message (never by email):
   * - in a direct message or group, the other members hear once per unread run: the key carries how far
   *   each has read, so a burst of messages is one notification and the next comes after they catch up.
   *   Someone reading the conversation right now isn't notified.
   * - anyone @mentioned hears about that message itself, in a project channel too.
   */
  const notifyMessage = async (row: ConversationRow, messageId: number, text: string) => {
    const names = mentionsIn(text);
    const mentioned = names.length
      ? (
          await db
            .prepare(`SELECT id FROM users WHERE lower(username) IN (${names.map(() => "?").join(", ")})`)
            .bind(...names)
            .all<{ id: string }>()
        ).results.map((p) => p.id)
      : [];
    const members = (
      await db
        .prepare("SELECT user_id, last_read_id, read_at FROM chat_members WHERE conversation_id = ? AND left_at IS NULL AND user_id <> ?")
        .bind(row.id, me.id)
        .all<{ user_id: string; last_read_id: number; read_at: string | null }>()
    ).results;
    const where = row.kind === "direct" ? "a direct message" : row.kind === "project" ? `#${row.system_name ?? "project"}` : row.name;
    const body = text.length > 160 ? `${text.slice(0, 157)}…` : text;
    const link = `#/chat/${row.id}`;
    const watching = (m: { read_at: string | null }) => !!m.read_at && Date.now() - Date.parse(m.read_at) < WATCHING_MS;
    const alerts: Alert[] = [];
    // @mentions: members of a direct message or group, anyone for a project channel.
    for (const id of mentioned) {
      const m = members.find((x) => x.user_id === id);
      if (row.kind !== "project" && !m) continue;
      if (m && watching(m)) continue;
      alerts.push({ userId: id, kind: "chat", title: `${me.name} mentioned you in ${where}`, body, link, dedupe: `chat:${messageId}`, email: false });
    }
    if (row.kind !== "project") {
      for (const m of members) {
        if (mentioned.includes(m.user_id) || watching(m)) continue;
        alerts.push({
          userId: m.user_id,
          kind: "chat",
          title: row.kind === "direct" ? `New message from ${me.name}` : `${me.name} in ${row.name}`,
          body,
          link,
          dedupe: `chat-unread:${row.id}:${Number(m.last_read_id)}`,
          email: false,
        });
      }
    }
    c.alert(alerts);
  };

  // ----- the conversation list and the badge -----
  if (path === "/api/chat" && method === "GET") {
    if (url.searchParams.get("sync") === "1") await joinMyProjectChannels();
    const conversations = await listConversations();
    return json({ conversations, unread: conversations.reduce((n, x) => n + x.unread, 0) });
  }

  if (path === "/api/chat/unread" && method === "GET") {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM chat_members m
         JOIN chat_messages x ON x.conversation_id = m.conversation_id AND x.id > m.last_read_id
         WHERE m.user_id = ? AND m.left_at IS NULL AND x.user_id <> ? AND x.deleted_at IS NULL`,
      )
      .bind(me.id, me.id)
      .first<{ n: number }>();
    return json({ unread: Number(row?.n ?? 0) });
  }

  // ----- project channels: browse and join -----
  if (path === "/api/chat/channels" && method === "GET") {
    const rows = await db
      .prepare(
        `SELECT s.id, (s.data::jsonb ->> 'name') AS name, c.id AS conversation_id,
           (m.user_id IS NOT NULL AND m.left_at IS NULL) AS member,
           (SELECT COUNT(*) FROM chat_members y WHERE y.conversation_id = c.id AND y.left_at IS NULL) AS members
         FROM systems s
         LEFT JOIN chat_conversations c ON c.system_id = s.id
         LEFT JOIN chat_members m ON m.conversation_id = c.id AND m.user_id = ?
         ORDER BY lower(s.data::jsonb ->> 'name')`,
      )
      .bind(me.id)
      .all<{ id: string; name: string | null; conversation_id: string | null; member: boolean | number; members: number }>();
    return json(
      rows.results.map((r) => ({ systemId: r.id, name: r.name ?? r.id, conversationId: r.conversation_id ?? projectChannelId(r.id), member: !!r.member, members: Number(r.members ?? 0) })),
    );
  }

  const joinMatch = path.match(/^\/api\/chat\/projects\/([a-z0-9-]+)\/join$/);
  if (joinMatch && method === "POST") {
    const system = await db.prepare("SELECT id FROM systems WHERE id = ?").bind(joinMatch[1]).first<{ id: string }>();
    if (!system) throw new HttpError(404, "Project not found");
    const id = projectChannelId(system.id);
    await db.batch([db.prepare("INSERT INTO chat_conversations (id, kind, system_id, created_at) VALUES (?, 'project', ?, ?) ON CONFLICT DO NOTHING").bind(id, system.id, c.now), join(id)]);
    return json({ id });
  }

  // ----- starting conversations -----
  if (path === "/api/chat/direct" && method === "POST") {
    const [other] = await realPeople([(await body<{ userId?: unknown }>(req)).userId]);
    if (!other) throw new HttpError(400, "Choose someone to message");
    const key = directKey(me.id, other);
    const existing = await db.prepare("SELECT id FROM chat_conversations WHERE direct_key = ?").bind(key).first<{ id: string }>();
    if (existing) return json({ id: existing.id });
    const id = newToken().slice(0, 16);
    await db.batch([
      db.prepare("INSERT INTO chat_conversations (id, kind, direct_key, created_by, created_at) VALUES (?, 'direct', ?, ?, ?) ON CONFLICT DO NOTHING").bind(id, key, me.id, c.now),
      db
        .prepare("INSERT INTO chat_members (conversation_id, user_id, joined_at) SELECT id, ?, ? FROM chat_conversations WHERE direct_key = ? ON CONFLICT DO NOTHING")
        .bind(me.id, c.now, key),
      db
        .prepare("INSERT INTO chat_members (conversation_id, user_id, joined_at) SELECT id, ?, ? FROM chat_conversations WHERE direct_key = ? ON CONFLICT DO NOTHING")
        .bind(other, c.now, key),
    ]);
    // Two people starting the same conversation at once both end up in the one that was saved.
    const saved = await db.prepare("SELECT id FROM chat_conversations WHERE direct_key = ?").bind(key).first<{ id: string }>();
    return json({ id: saved!.id }, 201);
  }

  if (path === "/api/chat/groups" && method === "POST") {
    const b = await body<{ name?: unknown; people?: unknown }>(req);
    const name = String(b.name ?? "").trim().slice(0, MAX_GROUP_NAME);
    if (!name) throw new HttpError(400, "Give the group a name");
    const people = await realPeople(b.people);
    if (!people.length) throw new HttpError(400, "Add at least one other person");
    const id = newToken().slice(0, 16);
    await db.batch([
      db.prepare("INSERT INTO chat_conversations (id, kind, name, created_by, created_at, last_message_at) VALUES (?, 'group', ?, ?, ?, ?)").bind(id, name, me.id, c.now, c.now),
      ...[me.id, ...people].map((u) => db.prepare("INSERT INTO chat_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, u, c.now)),
      event(id, `created the group "${name}"`),
    ]);
    await c.audit("chat_group_created", null, { group: name, people: await namesOf(people) });
    return json({ id }, 201);
  }

  // ----- one conversation -----
  const conv = path.match(new RegExp(`^/api/chat/(${ID})(/.*)?$`));
  if (!conv) throw new HttpError(404, "Not found");
  const conversationId = conv[1];
  const rest = conv[2] ?? "";

  if (rest === "" && method === "GET") {
    // One conversation, e.g. a project channel you're reading but haven't joined.
    const { row, member } = await open(conversationId);
    const conversation: Conversation = {
      id: row.id,
      kind: row.kind,
      name: row.kind === "project" ? (row.system_name ?? "Project") : row.name,
      ...(row.system_id ? { systemId: row.system_id } : {}),
      memberIds: (await memberIds([row.id])).get(row.id) ?? [],
      ...(row.created_by ? { createdBy: row.created_by } : {}),
      ...(row.last_message_at ? { lastMessageAt: row.last_message_at } : {}),
      unread: 0,
      member,
    };
    return json(conversation);
  }

  if (rest === "" && method === "PUT") {
    const { row } = await open(conversationId);
    if (row.kind !== "group") throw new HttpError(400, "Only group chats can be renamed");
    const name = String((await body<{ name?: unknown }>(req)).name ?? "").trim().slice(0, MAX_GROUP_NAME);
    if (!name) throw new HttpError(400, "Give the group a name");
    if (name === row.name) return json({ ok: true });
    await db.batch([db.prepare("UPDATE chat_conversations SET name = ? WHERE id = ?").bind(name, row.id), event(row.id, `renamed the group "${name}"`), touch(row.id)]);
    await c.audit("chat_group_renamed", null, { from: row.name, to: name });
    return json({ ok: true });
  }

  if (rest === "/members" && method === "POST") {
    const { row } = await open(conversationId);
    if (row.kind !== "group") throw new HttpError(400, "People can only be added to group chats");
    const current = (await memberIds([row.id])).get(row.id) ?? [];
    const people = (await realPeople((await body<{ people?: unknown }>(req)).people)).filter((p) => !current.includes(p));
    if (!people.length) return json({ ok: true });
    if (current.length + people.length > MAX_GROUP_SIZE) throw new HttpError(400, `A group chat holds up to ${MAX_GROUP_SIZE} people`);
    const names = await namesOf(people);
    await db.batch([...people.map((p) => join(row.id, p)), event(row.id, `added ${listJoin(names)}`), touch(row.id)]);
    await c.audit("chat_members_added", null, { group: row.name, people: names });
    return json({ ok: true });
  }

  const memberMatch = rest.match(/^\/members\/([A-Za-z0-9_.-]{1,80})$/);
  if (memberMatch && method === "DELETE") {
    const { row, member } = await open(conversationId);
    const who = memberMatch[1] === "me" ? me.id : memberMatch[1];
    if (row.kind === "direct") throw new HttpError(400, "You can't leave a direct message");
    if (who === me.id) {
      if (!member) return json({ ok: true });
      await db.batch([
        db.prepare("UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND user_id = ?").bind(c.now, row.id, me.id),
        ...(row.kind === "group" ? [event(row.id, "left the group"), touch(row.id)] : []),
      ]);
      if (row.kind === "group") await c.audit("chat_left", null, { group: row.name });
      return json({ ok: true });
    }
    // Only a group's creator, or someone who manages users, may remove someone else.
    if (row.kind !== "group") throw new HttpError(400, "People leave project channels themselves");
    if (row.created_by !== me.id && !c.can("manage_users")) throw new HttpError(403, "Only the person who made the group can remove people");
    const [name] = await namesOf([who]);
    const res = await db.prepare("UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL").bind(c.now, row.id, who).run();
    if (res.meta.changes) {
      await db.batch([event(row.id, `removed ${name ?? "someone"}`), touch(row.id)]);
      await c.audit("chat_members_removed", null, { group: row.name, people: [name ?? who] });
    }
    return json({ ok: true });
  }

  if (rest === "/messages" && method === "GET") {
    const { row, member, lastReadId } = await open(conversationId);
    const q = url.searchParams;
    const before = Number(q.get("before"));
    const afterRaw = q.get("after");
    const after = afterRaw === null ? null : Number(afterRaw);
    let messages: MessageRow[];
    let changed: MessageRow[] = [];
    let hasOlder = false;
    if (before > 0 || after === null || !Number.isFinite(after)) {
      // The newest page, or the page before an older message.
      const older = await db
        .prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ?${before > 0 ? " AND id < ?" : ""} ORDER BY id DESC LIMIT ?`)
        .bind(...(before > 0 ? [row.id, before, PAGE_SIZE + 1] : [row.id, PAGE_SIZE + 1]))
        .all<MessageRow>();
      hasOlder = older.results.length > PAGE_SIZE;
      messages = older.results.slice(0, PAGE_SIZE).reverse();
    } else {
      // A poll: what's new since the last message you have, and older messages changed since the last poll.
      const sinceMs = Date.parse(q.get("since") ?? "");
      const since = new Date((Number.isFinite(sinceMs) ? sinceMs : Date.now()) - SINCE_OVERLAP_MS).toISOString();
      const [fresh, edits] = await Promise.all([
        db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT 200`).bind(row.id, after).all<MessageRow>(),
        db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? AND id <= ? AND updated_at > ? ORDER BY id LIMIT 200`).bind(row.id, after, since).all<MessageRow>(),
      ]);
      messages = fresh.results;
      changed = edits.results.filter((m) => m.edited_at || m.deleted_at);
    }
    // Reading the conversation, with the tab in view, marks it read, and its notifications with it.
    if (member && q.get("read") === "1") {
      const read = await db
        .prepare(
          `UPDATE chat_members SET read_at = ?, last_read_id = GREATEST(last_read_id, (SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE conversation_id = ?))
           WHERE conversation_id = ? AND user_id = ? RETURNING last_read_id`,
        )
        .bind(c.now, row.id, row.id, me.id)
        .first<{ last_read_id: number }>();
      if (read && Number(read.last_read_id) > lastReadId) {
        await db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND link = ? AND read_at IS NULL").bind(c.now, me.id, `#/chat/${row.id}`).run();
      }
    }
    const readers = await db
      .prepare("SELECT user_id, last_read_id FROM chat_members WHERE conversation_id = ? AND left_at IS NULL")
      .bind(row.id)
      .all<{ user_id: string; last_read_id: number }>();
    const page: MessagesPage = {
      messages: messages.map(toMessage),
      changed: changed.map(toMessage),
      readers: readers.results.map((r) => ({ userId: r.user_id, lastReadId: Number(r.last_read_id) })),
      hasOlder,
      now: new Date().toISOString(),
    };
    return json(page);
  }

  if (rest === "/messages" && method === "POST") {
    const { row, member } = await open(conversationId);
    const text = cleanMessage(String((await body<{ body?: unknown }>(req)).body ?? ""));
    if (!text) throw new HttpError(400, "Write a message first");
    if (text.length > MAX_MESSAGE) throw new HttpError(400, `Messages are up to ${MAX_MESSAGE.toLocaleString("en-GB")} characters`);
    // Writing in a project channel joins it.
    if (!member) await join(row.id).run();
    const saved = await db
      .prepare(`INSERT INTO chat_messages (conversation_id, user_id, kind, body, created_at, updated_at) VALUES (?, ?, 'text', ?, ?, ?) RETURNING ${MESSAGE_COLUMNS}`)
      .bind(row.id, me.id, text, c.now, c.now)
      .first<MessageRow>();
    await db.batch([
      touch(row.id),
      db.prepare("UPDATE chat_members SET last_read_id = GREATEST(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?").bind(saved!.id, row.id, me.id),
    ]);
    c.defer?.(notifyMessage(row, Number(saved!.id), text));
    return json(toMessage(saved!), 201);
  }

  const messageMatch = rest.match(/^\/messages\/(\d{1,15})$/);
  if (messageMatch && (method === "PUT" || method === "DELETE")) {
    const { row } = await open(conversationId);
    const msg = await db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL`)
      .bind(Number(messageMatch[1]), row.id)
      .first<MessageRow>();
    if (!msg || msg.kind !== "text") throw new HttpError(404, "Message not found");
    if (method === "PUT") {
      if (msg.user_id !== me.id) throw new HttpError(403, "You can only edit your own messages");
      const text = cleanMessage(String((await body<{ body?: unknown }>(req)).body ?? ""));
      if (!text) throw new HttpError(400, "A message can't be empty. Delete it instead.");
      if (text.length > MAX_MESSAGE) throw new HttpError(400, `Messages are up to ${MAX_MESSAGE.toLocaleString("en-GB")} characters`);
      const updated = await db
        .prepare(`UPDATE chat_messages SET body = ?, edited_at = ?, updated_at = ? WHERE id = ? RETURNING ${MESSAGE_COLUMNS}`)
        .bind(text, c.now, c.now, msg.id)
        .first<MessageRow>();
      return json(toMessage(updated!));
    }
    // Your own messages; in a group or project channel, someone who manages users may remove any.
    const moderating = msg.user_id !== me.id;
    if (moderating && (row.kind === "direct" || !c.can("manage_users"))) throw new HttpError(403, "You can only delete your own messages");
    await db.prepare("UPDATE chat_messages SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(c.now, c.now, msg.id).run();
    if (moderating) await c.audit("chat_message_removed", null, { where: row.kind === "project" ? `#${row.system_name ?? "project"}` : row.name });
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found");
}
