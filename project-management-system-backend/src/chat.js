/** @import { ItemContext } from './workitems' */
/** @import { Alert } from './notify' */
/** @import { ChatFile, ChatGif, ChatMessage, Conversation, ConversationKind, MessageKind, MessagesPage } from '../../project-management-system-frontend/src/data/chat' */
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
import { mentionsIn } from "../../project-management-system-frontend/src/data/workitems";
import { INLINE_IMAGE, MAX_CHAT_FILE, MAX_CHAT_FILES, MAX_GROUP_NAME, MAX_GROUP_SIZE, MAX_MESSAGE, MAX_REACTIONS, PAGE_SIZE, cleanMessage, directKey, fileSize, isEmoji, isSticker, messagePreview, validGif } from "../../project-management-system-frontend/src/data/chat";
const parseMeta =
  /**
   * @param {string | null} s
   * @returns {Meta}
   */ (s) => {
    if (!s) return {};
    try {
      return /** @type {Meta} */ (JSON.parse(s));
    } catch {
      return {};
    }
  };
const toMessage =
  /**
   * @param {MessageRow} r
   * @returns {ChatMessage}
   */ (r) => {
    const meta = r.deleted_at ? {} : parseMeta(r.meta);
    return {
      id: Number(r.id),
      conversationId: r.conversation_id,
      userId: r.user_id,
      kind: r.kind,
      // A deleted message keeps its place in the conversation, without its words, files, GIF or sticker.
      body: r.deleted_at ? "" : r.body,
      createdAt: r.created_at,
      ...(r.edited_at ? { editedAt: r.edited_at } : {}),
      ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
      ...(meta.gif ? { gif: meta.gif } : {}),
      ...(meta.sticker ? { sticker: meta.sticker } : {}),
      ...(r.pinned_at && !r.deleted_at ? { pinnedAt: r.pinned_at, pinnedBy: r.pinned_by ?? undefined } : {}),
    };
  };
const MESSAGE_COLUMNS = "id, conversation_id, user_id, kind, body, created_at, edited_at, deleted_at, meta, reply_to, pinned_at, pinned_by";
const marks =
  /** @param {number} n
   * @returns {string}
   */ (n) => Array.from({ length: n }, () => "?").join(", ");
const CONVERSATION_SELECT = `SELECT c.id, c.kind, c.name, c.system_id, c.created_by, c.created_at, c.last_message_at, (s.data::jsonb ->> 'name') AS system_name
  FROM chat_conversations c LEFT JOIN systems s ON s.id = c.system_id`;
/**
 * A poll asks for changes since its last answer; this much overlap covers clocks a little apart.
 * @type {10000}
 */
const SINCE_OVERLAP_MS = 10_000;
/**
 * Someone who read a conversation this recently is reading it now (an open one polls every 3 s).
 * @type {12000}
 */
const WATCHING_MS = 12_000;
const ID = "[A-Za-z0-9_-]{4,80}";
const projectChannelId =
  /** @param {string} systemId
   * @returns {string}
   */ (systemId) => `p-${systemId}`;
/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function chatApi(c, path, method) {
  if (path !== "/api/chat" && !path.startsWith("/api/chat/")) return null;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const { db, req, me } = c;
  const url = new URL(req.url);
  // ----- helpers -----
  const memberIds = /** @param {string[]} ids */ async (ids) => {
    const byConversation = /** @type {Map<string, Array<string>>} */ (/** @type {unknown} */ (new Map(ids.map((id) => [id, []]))));
    if (!ids.length) return byConversation;
    const rows = await /** @type {Promise<D1Result<{ conversation_id: string; user_id: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT conversation_id, user_id FROM chat_members WHERE left_at IS NULL AND conversation_id IN (${ids.map(() => "?").join(", ")}) ORDER BY joined_at`)
          .bind(...ids)
          .all()
      )
    );
    for (const r of rows.results) byConversation.get(r.conversation_id)?.push(r.user_id);
    return byConversation;
  };
  const realPeople = /** @param {unknown} ids @returns {Promise<string[]>} */ async (ids) => {
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => id !== me.id).slice(0, MAX_GROUP_SIZE);
    if (!wanted.length) return [];
    const found = await /** @type {Promise<D1Result<{ id: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT id FROM users WHERE id IN (${wanted.map(() => "?").join(", ")})`)
          .bind(...wanted)
          .all()
      )
    );
    if (found.results.length !== wanted.length) throw new HttpError(400, "One of those people isn't in Pulse");
    return wanted;
  };
  const namesOf = /** @param {string[]} ids */ async (ids) => {
    if (!ids.length) return [];
    const rows = await /** @type {Promise<D1Result<{ name: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT name FROM users WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY name`)
          .bind(...ids)
          .all()
      )
    );
    return rows.results.map((r) => r.name);
  };
  const listJoin = /** @param {string[]} names */ (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  /** The conversation, if you may see it, and whether you're in it. Otherwise "not found", so nothing leaks. */
  const open = /** @param {string} id */ async (id) => {
    const row = await /** @type {Promise<ConversationRow | null>} */ (/** @type {unknown} */ (db.prepare(`${CONVERSATION_SELECT} WHERE c.id = ?`).bind(id).first()));
    const membership = row ? await /** @type {Promise<{ left_at: string | null; last_read_id: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT left_at, last_read_id FROM chat_members WHERE conversation_id = ? AND user_id = ?").bind(id, me.id).first())) : null;
    const member = !!membership && !membership.left_at;
    if (!row || (row.kind !== "project" && !member)) throw new HttpError(404, "Conversation not found");
    return { row, member, lastReadId: Number(membership?.last_read_id ?? 0) };
  };
  /** Adds you to a conversation, or back to one you left. */
  const join = /** @param {string} conversationId */ (conversationId, userId = me.id) =>
    db
      .prepare(
        `INSERT INTO chat_members (conversation_id, user_id, joined_at, last_read_id)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE conversation_id = ?))
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL, joined_at = excluded.joined_at, last_read_id = excluded.last_read_id
         WHERE chat_members.left_at IS NOT NULL`,
      )
      .bind(conversationId, userId, c.now, conversationId);
  /** "Tariro added Farai": a line in the conversation itself. */
  const event = /** @param {string} conversationId @param {string} text */ (conversationId, text) => db.prepare("INSERT INTO chat_messages (conversation_id, user_id, kind, body, created_at, updated_at) VALUES (?, ?, 'event', ?, ?, ?)").bind(conversationId, me.id, text, c.now, c.now);
  const touch = /** @param {string} conversationId */ (conversationId) => db.prepare("UPDATE chat_conversations SET last_message_at = ? WHERE id = ?").bind(c.now, conversationId);
  /** Messages with their files, reactions and the quote of what they reply to: three queries per page. */
  const enrich = /** @param {MessageRow[]} rows @returns {Promise<ChatMessage[]>} */ async (rows) => {
    const live = rows.filter((r) => !r.deleted_at).map((r) => Number(r.id));
    const replyIds = [...new Set(rows.filter((r) => r.reply_to && !r.deleted_at).map((r) => Number(r.reply_to)))];
    const [files, reactions, replies] = await Promise.all([
      live.length
        ? /** @type {Promise<D1Result<{ id: string; message_id: number; name: string; mime: string; size: number; }>>} */ (
            /** @type {unknown} */ (
              db
                .prepare(`SELECT id, message_id, name, mime, size FROM chat_files WHERE message_id IN (${marks(live.length)}) ORDER BY uploaded_at, id`)
                .bind(...live)
                .all()
            )
          )
        : null,
      live.length
        ? /** @type {Promise<D1Result<{ message_id: number; emoji: string; user_id: string; }>>} */ (
            /** @type {unknown} */ (
              db
                .prepare(`SELECT message_id, emoji, user_id FROM chat_reactions WHERE message_id IN (${marks(live.length)}) ORDER BY created_at`)
                .bind(...live)
                .all()
            )
          )
        : null,
      replyIds.length && rows.length
        ? /** @type {Promise<D1Result<MessageRow>>} */ (
            /** @type {unknown} */ (
              db
                .prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? AND id IN (${marks(replyIds.length)})`)
                .bind(rows[0].conversation_id, ...replyIds)
                .all()
            )
          )
        : null,
    ]);
    const filesOf = /** @type {Map<number, Array<ChatFile>>} */ (/** @type {unknown} */ (new Map()));
    for (const f of files?.results ?? []) {
      const list = filesOf.get(Number(f.message_id)) ?? [];
      list.push({ id: f.id, name: f.name, mime: f.mime, size: Number(f.size) });
      filesOf.set(Number(f.message_id), list);
    }
    const reactionsOf = /** @type {Map<number, Map<string, Array<string>>>} */ (/** @type {unknown} */ (new Map()));
    for (const r of reactions?.results ?? []) {
      const byEmoji = reactionsOf.get(Number(r.message_id)) ?? /** @type {Map<string, Array<string>>} */ (/** @type {unknown} */ (new Map()));
      byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.user_id]);
      reactionsOf.set(Number(r.message_id), byEmoji);
    }
    const quoted = new Map((replies?.results ?? []).map((r) => [Number(r.id), r]));
    return rows.map((r) => {
      const m = toMessage(r);
      if (r.deleted_at) return m;
      const id = Number(r.id);
      const f = filesOf.get(id);
      if (f) m.files = f;
      const re = reactionsOf.get(id);
      if (re) m.reactions = [...re].map(([emoji, userIds]) => ({ emoji, userIds }));
      const q = r.reply_to ? quoted.get(Number(r.reply_to)) : undefined;
      if (q) {
        const meta = parseMeta(q.meta);
        m.replyTo = q.deleted_at ? { id: Number(q.id), userId: q.user_id, body: "", deleted: true } : { id: Number(q.id), userId: q.user_id, body: messagePreview({ body: q.body, gif: meta.gif, sticker: meta.sticker, fileName: filesOf.get(Number(q.id))?.[0]?.name }).slice(0, 160) || "Attachment" };
      }
      return m;
    });
  };
  const oneMessage = /** @param {string} conversationId @param {number} id */ async (conversationId, id) => {
    const row = await /** @type {Promise<MessageRow | null>} */ (/** @type {unknown} */ (db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ? AND conversation_id = ?`).bind(id, conversationId).first()));
    return row ? (await enrich([row]))[0] : null;
  };
  /** Your conversations, newest first, with what's unread. */
  const listConversations = /** @returns {Promise<Conversation[]>} */ async () => {
    const rows = await /** @type {Promise<D1Result<ConversationRow & { lm_user: string | null; lm_body: string | null; lm_kind: MessageKind | null; lm_at: string | null; lm_deleted: string | null; lm_meta: string | null; lm_file: string | null; unread: number; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT c.id, c.kind, c.name, c.system_id, c.created_by, c.created_at, c.last_message_at, (s.data::jsonb ->> 'name') AS system_name,
           lm.user_id AS lm_user, lm.body AS lm_body, lm.kind AS lm_kind, lm.created_at AS lm_at, lm.deleted_at AS lm_deleted, lm.meta AS lm_meta,
           (SELECT f.name FROM chat_files f WHERE f.message_id = lm.id ORDER BY f.uploaded_at LIMIT 1) AS lm_file,
           (SELECT COUNT(*) FROM chat_messages x WHERE x.conversation_id = c.id AND x.id > m.last_read_id AND x.user_id <> ? AND x.deleted_at IS NULL) AS unread
         FROM chat_members m
         JOIN chat_conversations c ON c.id = m.conversation_id
         LEFT JOIN systems s ON s.id = c.system_id
         LEFT JOIN LATERAL (SELECT id, user_id, body, kind, created_at, deleted_at, meta FROM chat_messages y WHERE y.conversation_id = c.id ORDER BY y.id DESC LIMIT 1) lm ON TRUE
         WHERE m.user_id = ? AND m.left_at IS NULL
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
         LIMIT 200`,
          )
          .bind(me.id, me.id)
          .all()
      )
    );
    const members = await memberIds(rows.results.map((r) => r.id));
    // A GIF, sticker or file with no words still shows something in the list.
    const preview = /** @param {{ lm_body: string | null; lm_meta: string | null; lm_file: string | null }} r */ (r) => {
      const meta = parseMeta(r.lm_meta);
      return messagePreview({ body: r.lm_body ?? "", gif: meta.gif, sticker: meta.sticker, fileName: r.lm_file }).slice(0, 140);
    };
    return rows.results.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.kind === "project" ? (r.system_name ?? "Project") : r.name,
      ...(r.system_id ? { systemId: r.system_id } : {}),
      memberIds: members.get(r.id) ?? [],
      ...(r.created_by ? { createdBy: r.created_by } : {}),
      ...(r.lm_user && r.lm_at ? { lastMessage: { userId: r.lm_user, body: r.lm_deleted ? "" : preview(r), at: r.lm_at, kind: r.lm_kind ?? "text" } } : {}),
      ...(r.last_message_at ? { lastMessageAt: r.last_message_at } : {}),
      unread: Number(r.unread),
      member: true,
    }));
  };
  /** The channels of the projects you lead or work on, made and joined if they aren't yet (unless you left). */
  const joinMyProjectChannels = async () => {
    const mine = await /** @type {Promise<D1Result<{ id: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT s.id FROM systems s
         WHERE (s.data::jsonb ->> 'lead') = ? OR EXISTS (SELECT 1 FROM assignments a WHERE a.system_id = s.id AND a.user_id = ?)`,
          )
          .bind(me.id, me.id)
          .all()
      )
    );
    if (!mine.results.length) return;
    await db.batch([
      ...mine.results.map((s) => db.prepare("INSERT INTO chat_conversations (id, kind, system_id, created_at) VALUES (?, 'project', ?, ?) ON CONFLICT DO NOTHING").bind(projectChannelId(s.id), s.id, c.now)),
      ...mine.results.map((s) => db.prepare("INSERT INTO chat_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(projectChannelId(s.id), me.id, c.now)),
    ]);
  };
  /**
   * Notifications under the bell for a new message (never by email):
   * - in a direct message or group, the other members hear once per unread run: the key carries how far
   *   each has read, so a burst of messages is one notification and the next comes after they catch up.
   *   Someone reading the conversation right now isn't notified.
   * - anyone @mentioned hears about that message itself, in a project channel too.
   */
  const notifyMessage = /** @param {ConversationRow} row @param {number} messageId @param {string} text */ async (row, messageId, text) => {
    const names = mentionsIn(text);
    const mentioned = names.length
      ? (
          await /** @type {Promise<D1Result<{ id: string; }>>} */ (
            /** @type {unknown} */ (
              db
                .prepare(`SELECT id FROM users WHERE lower(username) IN (${names.map(() => "?").join(", ")})`)
                .bind(...names)
                .all()
            )
          )
        ).results.map((p) => p.id)
      : [];
    const members = (
      await /** @type {Promise<D1Result<{ user_id: string; last_read_id: number; read_at: string | null; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT user_id, last_read_id, read_at FROM chat_members WHERE conversation_id = ? AND left_at IS NULL AND user_id <> ?").bind(row.id, me.id).all()))
    ).results;
    const where = row.kind === "direct" ? "a direct message" : row.kind === "project" ? `#${row.system_name ?? "project"}` : row.name;
    const body = text.length > 160 ? `${text.slice(0, 157)}…` : text;
    const link = `#/chat/${row.id}`;
    const watching = /** @param {{ read_at: string | null }} m */ (m) => !!m.read_at && Date.now() - Date.parse(m.read_at) < WATCHING_MS;
    /** @type {Alert[]} */ const alerts = [];
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
    const row = await /** @type {Promise<{ n: number; } | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM chat_members m
         JOIN chat_messages x ON x.conversation_id = m.conversation_id AND x.id > m.last_read_id
         WHERE m.user_id = ? AND m.left_at IS NULL AND x.user_id <> ? AND x.deleted_at IS NULL`,
          )
          .bind(me.id, me.id)
          .first()
      )
    );
    return json({ unread: Number(row?.n ?? 0) });
  }
  // ----- project channels: browse and join -----
  if (path === "/api/chat/channels" && method === "GET") {
    const rows = await /** @type {Promise<D1Result<{ id: string; name: string | null; conversation_id: string | null; member: boolean | number; members: number; }>>} */ (
      /** @type {unknown} */ (
        db
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
          .all()
      )
    );
    return json(rows.results.map((r) => ({ systemId: r.id, name: r.name ?? r.id, conversationId: r.conversation_id ?? projectChannelId(r.id), member: !!r.member, members: Number(r.members ?? 0) })));
  }
  const joinMatch = path.match(/^\/api\/chat\/projects\/([a-z0-9-]+)\/join$/);
  if (joinMatch && method === "POST") {
    const system = await /** @type {Promise<{ id: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id FROM systems WHERE id = ?").bind(joinMatch[1]).first()));
    if (!system) throw new HttpError(404, "Project not found");
    const id = projectChannelId(system.id);
    await db.batch([db.prepare("INSERT INTO chat_conversations (id, kind, system_id, created_at) VALUES (?, 'project', ?, ?) ON CONFLICT DO NOTHING").bind(id, system.id, c.now), join(id)]);
    return json({ id });
  }
  // ----- GIFs: GIPHY search, through the Worker so the browser never calls GIPHY with the key -----
  // Off until an administrator sets the GIPHY_API_KEY secret. Only G-rated results.
  if (path === "/api/chat/gifs" && method === "GET") {
    const key = c.env?.GIPHY_API_KEY;
    if (!key) return json({ enabled: false, results: [] });
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
    const offset = Math.min(500, Math.max(0, Number(url.searchParams.get("offset")) || 0));
    const giphy = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
    giphy.search = new URLSearchParams({ api_key: key, limit: "24", offset: String(offset), rating: "g", lang: "en", bundle: "messaging_non_clips", ...(q ? { q } : {}) }).toString();
    const res = await fetch(giphy.toString(), { headers: { accept: "application/json" } }).catch(() => null);
    if (!res || !res.ok) throw new HttpError(502, "GIF search isn't answering right now. Try again in a moment.");
    const data = /** @type {{ data?: { id: string; title?: string; images?: Record<string, Img> }[] }} */ (await res.json().catch(() => ({})));
    const results = (data.data ?? [])
      .map((g) => {
        const full = g.images?.fixed_height ?? g.images?.downsized;
        const small = g.images?.fixed_height_small ?? full;
        const gif = validGif({ id: g.id, url: full?.url?.split("?")[0], width: full?.width, height: full?.height, title: g.title });
        const preview = small?.url?.split("?")[0];
        return gif && preview && validGif({ ...gif, url: preview }) ? { ...gif, preview } : null;
      })
      .filter(Boolean);
    return new Response(JSON.stringify({ enabled: true, results }), { headers: { "content-type": "application/json", "cache-control": "private, max-age=60" } });
  }
  // ----- starting conversations -----
  if (path === "/api/chat/direct" && method === "POST") {
    const [other] = await realPeople([(await /** @type {Promise<{ userId?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).userId]);
    if (!other) throw new HttpError(400, "Choose someone to message");
    const key = directKey(me.id, other);
    const existing = await /** @type {Promise<{ id: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id FROM chat_conversations WHERE direct_key = ?").bind(key).first()));
    if (existing) return json({ id: existing.id });
    const id = newToken().slice(0, 16);
    await db.batch([
      db.prepare("INSERT INTO chat_conversations (id, kind, direct_key, created_by, created_at) VALUES (?, 'direct', ?, ?, ?) ON CONFLICT DO NOTHING").bind(id, key, me.id, c.now),
      db.prepare("INSERT INTO chat_members (conversation_id, user_id, joined_at) SELECT id, ?, ? FROM chat_conversations WHERE direct_key = ? ON CONFLICT DO NOTHING").bind(me.id, c.now, key),
      db.prepare("INSERT INTO chat_members (conversation_id, user_id, joined_at) SELECT id, ?, ? FROM chat_conversations WHERE direct_key = ? ON CONFLICT DO NOTHING").bind(other, c.now, key),
    ]);
    // Two people starting the same conversation at once both end up in the one that was saved.
    const saved = await /** @type {Promise<{ id: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id FROM chat_conversations WHERE direct_key = ?").bind(key).first()));
    return json({ id: /** @type {NonNullable<typeof saved>} */ (saved).id }, 201);
  }
  if (path === "/api/chat/groups" && method === "POST") {
    const b = await /** @type {Promise<{ name?: unknown; people?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const name = String(b.name ?? "")
      .trim()
      .slice(0, MAX_GROUP_NAME);
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
    /** @type {Conversation} */ const conversation = {
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
    const name = String((await /** @type {Promise<{ name?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).name ?? "")
      .trim()
      .slice(0, MAX_GROUP_NAME);
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
    const people = (await realPeople((await /** @type {Promise<{ people?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).people)).filter((p) => !current.includes(p));
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
      await db.batch([db.prepare("UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND user_id = ?").bind(c.now, row.id, me.id), ...(row.kind === "group" ? [event(row.id, "left the group"), touch(row.id)] : [])]);
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
    /** @type {MessageRow[]} */ let messages;
    /** @type {MessageRow[]} */ let changed = [];
    let hasOlder = false;
    if (before > 0 || after === null || !Number.isFinite(after)) {
      // The newest page, or the page before an older message.
      const older = await /** @type {Promise<D1Result<MessageRow>>} */ (
        /** @type {unknown} */ (
          db
            .prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ?${before > 0 ? " AND id < ?" : ""} ORDER BY id DESC LIMIT ?`)
            .bind(...(before > 0 ? [row.id, before, PAGE_SIZE + 1] : [row.id, PAGE_SIZE + 1]))
            .all()
        )
      );
      hasOlder = older.results.length > PAGE_SIZE;
      messages = older.results.slice(0, PAGE_SIZE).reverse();
    } else {
      // A poll: what's new since the last message you have, and older messages changed since the last poll.
      const sinceMs = Date.parse(q.get("since") ?? "");
      const since = new Date((Number.isFinite(sinceMs) ? sinceMs : Date.now()) - SINCE_OVERLAP_MS).toISOString();
      const [fresh, edits] = await Promise.all([
        /** @type {Promise<D1Result<MessageRow>>} */ (/** @type {unknown} */ (db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT 200`).bind(row.id, after).all())),
        /** @type {Promise<D1Result<MessageRow>>} */ (/** @type {unknown} */ (db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? AND id <= ? AND updated_at > ? ORDER BY id LIMIT 200`).bind(row.id, after, since).all())),
      ]);
      messages = fresh.results;
      // Edits, deletions, reactions and pins all move updated_at.
      changed = edits.results;
    }
    // Reading the conversation, with the tab in view, marks it read, and its notifications with it.
    if (member && q.get("read") === "1") {
      const read = await /** @type {Promise<{ last_read_id: number; } | null>} */ (
        /** @type {unknown} */ (
          db
            .prepare(
              `UPDATE chat_members SET read_at = ?, last_read_id = GREATEST(last_read_id, (SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE conversation_id = ?))
           WHERE conversation_id = ? AND user_id = ? RETURNING last_read_id`,
            )
            .bind(c.now, row.id, row.id, me.id)
            .first()
        )
      );
      if (read && Number(read.last_read_id) > lastReadId) {
        await db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND link = ? AND read_at IS NULL").bind(c.now, me.id, `#/chat/${row.id}`).run();
      }
    }
    const readers = await /** @type {Promise<D1Result<{ user_id: string; last_read_id: number; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT user_id, last_read_id FROM chat_members WHERE conversation_id = ? AND left_at IS NULL").bind(row.id).all()));
    const [shown, updated] = await Promise.all([enrich(messages), enrich(changed)]);
    /** @type {MessagesPage} */ const page = {
      messages: shown,
      changed: updated,
      readers: readers.results.map((r) => ({ userId: r.user_id, lastReadId: Number(r.last_read_id) })),
      hasOlder,
      now: new Date().toISOString(),
    };
    return json(page);
  }
  if (rest === "/messages" && method === "POST") {
    const { row, member } = await open(conversationId);
    const b = await /** @type {Promise<{ body?: unknown; replyTo?: unknown; files?: unknown; gif?: unknown; sticker?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const text = cleanMessage(String(b.body ?? ""));
    if (text.length > MAX_MESSAGE) throw new HttpError(400, `Messages are up to ${MAX_MESSAGE.toLocaleString("en-GB")} characters`);
    const gif = b.gif === undefined || b.gif === null ? null : validGif(b.gif);
    if (b.gif && !gif) throw new HttpError(400, "That GIF can't be sent");
    const sticker = b.sticker === undefined || b.sticker === null ? null : isSticker(b.sticker) ? b.sticker : undefined;
    if (sticker === undefined) throw new HttpError(400, "That sticker doesn't exist");
    if (gif && sticker) throw new HttpError(400, "Send a GIF or a sticker, not both");
    const fileIds = [...new Set((Array.isArray(b.files) ? b.files : []).map(String))];
    if (fileIds.length > MAX_CHAT_FILES) throw new HttpError(400, `Up to ${MAX_CHAT_FILES} files in one message`);
    if (fileIds.length) {
      // Only your own uploads to this conversation that aren't on a message yet.
      const mine = await /** @type {Promise<D1Result<{ id: string; }>>} */ (
        /** @type {unknown} */ (
          db
            .prepare(`SELECT id FROM chat_files WHERE id IN (${marks(fileIds.length)}) AND conversation_id = ? AND uploaded_by = ? AND message_id IS NULL`)
            .bind(...fileIds, row.id, me.id)
            .all()
        )
      );
      if (mine.results.length !== fileIds.length) throw new HttpError(400, "One of those files isn't ready. Attach it again.");
    }
    if (!text && !gif && !sticker && !fileIds.length) throw new HttpError(400, "Write a message first");
    /** @type {number | null} */ let replyTo = null;
    if (b.replyTo !== undefined && b.replyTo !== null) {
      const target = await /** @type {Promise<{ id: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id FROM chat_messages WHERE id = ? AND conversation_id = ? AND kind = 'text' AND deleted_at IS NULL").bind(Number(b.replyTo), row.id).first()));
      if (!target) throw new HttpError(400, "The message you're replying to has gone");
      replyTo = Number(target.id);
    }
    /** @type {Meta} */ const meta = { ...(gif ? { gif } : {}), ...(sticker ? { sticker } : {}) };
    // Writing in a project channel joins it.
    if (!member) await join(row.id).run();
    const saved = await /** @type {Promise<MessageRow | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`INSERT INTO chat_messages (conversation_id, user_id, kind, body, meta, reply_to, created_at, updated_at) VALUES (?, ?, 'text', ?, ?, ?, ?, ?) RETURNING ${MESSAGE_COLUMNS}`)
          .bind(row.id, me.id, text, Object.keys(meta).length ? JSON.stringify(meta) : null, replyTo, c.now, c.now)
          .first()
      )
    );
    await db.batch([
      touch(row.id),
      db.prepare("UPDATE chat_members SET last_read_id = GREATEST(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?").bind(/** @type {NonNullable<typeof saved>} */ (saved).id, row.id, me.id),
      ...(fileIds.length ? [db.prepare(`UPDATE chat_files SET message_id = ? WHERE id IN (${marks(fileIds.length)}) AND uploaded_by = ?`).bind(/** @type {NonNullable<typeof saved>} */ (saved).id, ...fileIds, me.id)] : []),
    ]);
    const [message] = await enrich([/** @type {NonNullable<typeof saved>} */ (saved)]);
    const said = messagePreview({ body: text, gif, sticker, files: message.files });
    c.defer?.(notifyMessage(row, Number(/** @type {NonNullable<typeof saved>} */ (saved).id), text ? text : said));
    return json(message, 201);
  }
  const messageMatch = rest.match(/^\/messages\/(\d{1,15})(\/reactions|\/pin)?$/);
  const findMessage = /** @param {string} conversation */ async (conversation) => {
    const msg = await /** @type {Promise<MessageRow | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL`)
          .bind(Number(/** @type {NonNullable<typeof messageMatch>} */ (messageMatch)[1]), conversation)
          .first()
      )
    );
    if (!msg || msg.kind !== "text") throw new HttpError(404, "Message not found");
    return msg;
  };
  // Reactions: one click adds your emoji, the next takes it away.
  if (messageMatch?.[2] === "/reactions" && method === "POST") {
    const { row, member } = await open(conversationId);
    const msg = await findMessage(row.id);
    const emoji = (await /** @type {Promise<{ emoji?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).emoji;
    if (!isEmoji(emoji)) throw new HttpError(400, "Choose an emoji");
    if (!member) await join(row.id).run();
    const removed = await db.prepare("DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").bind(msg.id, me.id, emoji).run();
    if (!removed.meta.changes) {
      const kinds = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(DISTINCT emoji) AS n FROM chat_reactions WHERE message_id = ? AND emoji <> ?").bind(msg.id, emoji).first()));
      if (Number(kinds?.n ?? 0) >= MAX_REACTIONS) throw new HttpError(400, `A message can have up to ${MAX_REACTIONS} different reactions`);
      await db.prepare("INSERT INTO chat_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(msg.id, me.id, emoji, c.now).run();
    }
    // Moving updated_at is how everyone else's next poll hears about it.
    await db.prepare("UPDATE chat_messages SET updated_at = ? WHERE id = ?").bind(c.now, msg.id).run();
    return json(await oneMessage(row.id, Number(msg.id)));
  }
  // Pins: anyone in the conversation may pin or unpin a message for everyone.
  if (messageMatch?.[2] === "/pin" && method === "POST") {
    const { row, member } = await open(conversationId);
    if (!member) throw new HttpError(403, "Join the channel to pin messages");
    const msg = await findMessage(row.id);
    const pin = !msg.pinned_at;
    await db
      .prepare("UPDATE chat_messages SET pinned_at = ?, pinned_by = ?, updated_at = ? WHERE id = ?")
      .bind(pin ? c.now : null, pin ? me.id : null, c.now, msg.id)
      .run();
    return json(await oneMessage(row.id, Number(msg.id)));
  }
  if (messageMatch && !messageMatch[2] && (method === "PUT" || method === "DELETE")) {
    const { row } = await open(conversationId);
    const msg = await findMessage(row.id);
    if (method === "PUT") {
      if (msg.user_id !== me.id) throw new HttpError(403, "You can only edit your own messages");
      const text = cleanMessage(String((await /** @type {Promise<{ body?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).body ?? ""));
      const hasFiles = await db.prepare("SELECT 1 AS x FROM chat_files WHERE message_id = ? LIMIT 1").bind(msg.id).first();
      // Words can be cleared from a message that still carries a file, GIF or sticker.
      if (!text && !msg.meta && !hasFiles) throw new HttpError(400, "A message can't be empty. Delete it instead.");
      if (text.length > MAX_MESSAGE) throw new HttpError(400, `Messages are up to ${MAX_MESSAGE.toLocaleString("en-GB")} characters`);
      await db.prepare("UPDATE chat_messages SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?").bind(text, c.now, c.now, msg.id).run();
      return json(await oneMessage(row.id, Number(msg.id)));
    }
    // Your own messages; in a group or project channel, someone who manages users may remove any.
    const moderating = msg.user_id !== me.id;
    if (moderating && (row.kind === "direct" || !c.can("manage_users"))) throw new HttpError(403, "You can only delete your own messages");
    // A deleted message's files and reactions go with it (the chunks follow by ON DELETE CASCADE).
    await db.batch([
      db.prepare("UPDATE chat_messages SET deleted_at = ?, updated_at = ?, pinned_at = NULL, pinned_by = NULL WHERE id = ?").bind(c.now, c.now, msg.id),
      db.prepare("DELETE FROM chat_files WHERE message_id = ?").bind(msg.id),
      db.prepare("DELETE FROM chat_reactions WHERE message_id = ?").bind(msg.id),
    ]);
    if (moderating) await c.audit("chat_message_removed", null, { where: row.kind === "project" ? `#${row.system_name ?? "project"}` : row.name });
    return json({ ok: true });
  }
  // ----- pinned messages, and searching one conversation -----
  if (rest === "/pins" && method === "GET") {
    const { row } = await open(conversationId);
    const rows = await /** @type {Promise<D1Result<MessageRow>>} */ (/** @type {unknown} */ (db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? AND pinned_at IS NOT NULL AND deleted_at IS NULL ORDER BY pinned_at DESC LIMIT 50`).bind(row.id).all()));
    return json(await enrich(rows.results));
  }
  if (rest === "/search" && method === "GET") {
    const { row } = await open(conversationId);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (q.length < 2) return json([]);
    // The words are a bound value; % and _ are matched literally.
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = await /** @type {Promise<D1Result<MessageRow>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT ${MESSAGE_COLUMNS.split(", ")
              .map((col) => `m.${col}`)
              .join(", ")} FROM chat_messages m
         WHERE m.conversation_id = ? AND m.kind = 'text' AND m.deleted_at IS NULL
           AND (m.body ILIKE ? OR EXISTS (SELECT 1 FROM chat_files f WHERE f.message_id = m.id AND f.name ILIKE ?))
         ORDER BY m.id DESC LIMIT 50`,
          )
          .bind(row.id, like, like)
          .all()
      )
    );
    return json(await enrich(rows.results));
  }
  // ----- files: uploaded first, then sent with a message -----
  if (rest === "/files" && method === "POST") {
    const { row, member } = await open(conversationId);
    if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) throw new HttpError(400, "Send the file as a form upload");
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "Couldn't read the upload");
    });
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "Choose a file to upload");
    if (file.size === 0) throw new HttpError(400, "That file is empty");
    if (file.size > MAX_CHAT_FILE) throw new HttpError(413, `Files can be up to ${fileSize(MAX_CHAT_FILE)}`);
    if (!member) await join(row.id).run();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = newToken().slice(0, 20);
    const name =
      (file.name || "file")
        .replace(/[\r\n\\/]+/g, " ")
        .trim()
        .slice(0, 200) || "file";
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream";
    const CHUNK = 1024 * 1024;
    const stmts = [db.prepare("INSERT INTO chat_files (id, conversation_id, name, mime, size, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, row.id, name, mime, bytes.length, me.id, c.now)];
    for (let i = 0, seq = 0; i < bytes.length; i += CHUNK, seq++) {
      stmts.push(db.prepare("INSERT INTO chat_file_chunks (file_id, seq, data) VALUES (?, ?, ?)").bind(id, seq, bytes.slice(i, i + CHUNK)));
    }
    await db.batch(stmts);
    /** @type {ChatFile} */ const saved = { id, name, mime, size: bytes.length };
    return json(saved, 201);
  }
  const fileMatch = rest.match(/^\/files\/([A-Za-z0-9_-]{8,40})$/);
  if (fileMatch && method === "GET") {
    const { row } = await open(conversationId);
    const file = await /** @type {Promise<{ id: string; name: string; mime: string; message_id: number | null; uploaded_by: string; deleted_at: string | null; } | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT f.id, f.name, f.mime, f.message_id, f.uploaded_by, m.deleted_at FROM chat_files f LEFT JOIN chat_messages m ON m.id = f.message_id
         WHERE f.id = ? AND f.conversation_id = ?`,
          )
          .bind(fileMatch[1], row.id)
          .first()
      )
    );
    // Not yet sent: only its uploader sees it. Deleted with its message: gone.
    if (!file || file.deleted_at || (!file.message_id && file.uploaded_by !== me.id)) throw new HttpError(404, "File not found");
    const chunks = await /** @type {Promise<D1Result<{ data: ArrayBuffer | number[]; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT data FROM chat_file_chunks WHERE file_id = ? ORDER BY seq").bind(file.id).all()));
    const parts = chunks.results.map((x) => new Uint8Array(/** @type {ArrayBuffer} */ (x.data)));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    // Uploads are untrusted: only raster images and PDFs open in the browser; everything else downloads,
    // and nothing served here may run script on this origin.
    const inline = (INLINE_IMAGE.test(file.mime) || file.mime === "application/pdf") && url.searchParams.get("download") === null;
    return new Response(out, {
      headers: {
        "content-type": inline ? file.mime : "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "cache-control": "private, max-age=3600",
      },
    });
  }
  throw new HttpError(404, "Not found");
}
/**
 * @typedef {Object} Meta
 * @property {ChatGif} [gif]
 * @property {string} [sticker]
 */
/**
 * @typedef {Object} Img
 * @property {string} [url]
 * @property {string} [width]
 * @property {string} [height]
 */
/**
 * @typedef {Object} ConversationRow
 * @property {string} id
 * @property {ConversationKind} kind
 * @property {string} name
 * @property {string | null} system_id
 * @property {string | null} system_name
 * @property {string | null} created_by
 * @property {string} created_at
 * @property {string | null} last_message_at
 */
/**
 * @typedef {Object} MessageRow
 * @property {number} id
 * @property {string} conversation_id
 * @property {string} user_id
 * @property {MessageKind} kind
 * @property {string} body
 * @property {string} created_at
 * @property {string | null} edited_at
 * @property {string | null} deleted_at
 * @property {string | null} meta
 * @property {number | null} reply_to
 * @property {string | null} pinned_at
 * @property {string | null} pinned_by
 */
