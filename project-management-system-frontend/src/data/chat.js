// Chat, shared by the Worker and the UI: direct messages, group chats and project channels.
/**
 * The longest message, in characters.
 * @type {4000}
 */
export const MAX_MESSAGE = 4000;
/**
 * The longest group name.
 * @type {60}
 */
export const MAX_GROUP_NAME = 60;
/**
 * The most people in a group chat, its creator included.
 * @type {50}
 */
export const MAX_GROUP_SIZE = 50;
/**
 * How many messages one page holds (the newest first, then older ones on request).
 * @type {50}
 */
export const PAGE_SIZE = 50;
/**
 * How often the UI checks for news: the open conversation, the list beside it, and the sidebar badge.
 * @type {3000}
 */
export const POLL_OPEN_MS = 3000;
export const POLL_LIST_MS = 15000;
export const POLL_BADGE_MS = 60000;
// ---------- files, GIFs, stickers, reactions ----------
/**
 * The largest file one message can carry, and how many files.
 * @type {number}
 */
export const MAX_CHAT_FILE = 10 * 1024 * 1024;
export const MAX_CHAT_FILES = 10;
/**
 * The most different emojis on one message.
 * @type {20}
 */
export const MAX_REACTIONS = 20;
/**
 * One click on a message's toolbar.
 * @type {string[]}
 */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"];
/**
 * the system's own sticker set (original artwork drawn in the UI, src/components/ChatExtras.tsx).
 * Only these ids are accepted.
 */
/** @type {{ id: string; label: string }[]} */ export const STICKERS = [
  { id: "thanks", label: "Thank you!" },
  { id: "great-job", label: "Great job" },
  { id: "on-it", label: "On it" },
  { id: "shipped", label: "Shipped!" },
  { id: "looks-good", label: "Looks good" },
  { id: "done", label: "Done" },
  { id: "need-help", label: "Need a hand?" },
  { id: "blocked", label: "Blocked" },
  { id: "idea", label: "Idea!" },
  { id: "coffee", label: "Coffee break" },
  { id: "meeting", label: "In a meeting" },
  { id: "back-soon", label: "Back soon" },
  { id: "celebrate", label: "Woohoo!" },
  { id: "on-fire", label: "On fire" },
  { id: "welcome", label: "Welcome!" },
  { id: "good-morning", label: "Good morning" },
];
export const isSticker =
  /**
   * @param {unknown} id
   * @returns {id is string}
   */ (id) => typeof id === "string" && STICKERS.some((s) => s.id === id);
/**
 * A single emoji (with skin tones, flags, keycaps and joined sequences), never words.
 * @param {unknown} s
 * @returns {s is string}
 */
export function isEmoji(s) {
  if (typeof s !== "string" || !s || s.length > 16) return false;
  if (/[\sA-Za-z<>&"'`]/.test(s)) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(s);
}
/**
 * GIPHY's own media servers only: a GIF can't be used to load an image from anywhere else.
 * @type {RegExp}
 */
export const GIPHY_MEDIA = /^https:\/\/media[0-9]?\.giphy\.com\/media\/[A-Za-z0-9/_.-]{1,200}$/;
/**
 * @param {unknown} g
 * @returns {ChatGif | null}
 */
export function validGif(g) {
  if (!g || typeof g !== "object") return null;
  const x = /** @type {Record<string, unknown>} */ (g);
  const id = String(x.id ?? "");
  const url = String(x.url ?? "");
  const width = Math.round(Number(x.width));
  const height = Math.round(Number(x.height));
  if (!/^[A-Za-z0-9]{4,40}$/.test(id) || !GIPHY_MEDIA.test(url)) return null;
  if (!(width > 0 && width <= 1000 && height > 0 && height <= 1000)) return null;
  return { id, url, width, height, title: String(x.title ?? "").slice(0, 120) };
}
/**
 * What a message says in a list or a notification when it has no words of its own.
 * @param {{ body: string; gif?: unknown; sticker?: string | null; files?: { name: string }[]; fileName?: string | null }} m
 * @returns {string}
 */
export function messagePreview(m) {
  if (m.body) return m.body;
  if (m.sticker) return `Sticker: ${STICKERS.find((s) => s.id === m.sticker)?.label ?? "sticker"}`;
  if (m.gif) return "GIF";
  const name = m.fileName ?? m.files?.[0]?.name;
  if (name) return `📎 ${name}`;
  return "";
}
/**
 * Images that open in the browser; every other file downloads.
 * @type {RegExp}
 */
export const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
/**
 * 1.2 MB, 340 KB.
 * @param {number} n
 * @returns {string}
 */
export function fileSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/** The key that makes a direct conversation between two people unique. */
export const directKey =
  /** @param {string} a
   * @param {string} b
   * @returns {string}
   */ (a, b) => [a, b].sort().join(":");
/**
 * What a conversation is called for the person looking at it.
 * @param {Pick<Conversation, "kind" | "name" | "memberIds">} c
 * @param {string} meId
 * @param {(id: string) => string} nameOf
 * @returns {string}
 */
export function conversationTitle(c, meId, nameOf) {
  if (c.kind !== "direct") return c.name;
  const other = c.memberIds.find((id) => id !== meId) ?? meId;
  return nameOf(other);
}
/**
 * A message tidied for storing: trailing spaces gone, no more than two blank lines in a row.
 * @param {string} text
 * @returns {string}
 */
export function cleanMessage(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** @typedef {"direct" | "group" | "project"} ConversationKind */
/** @typedef {"text" | "event"} MessageKind */
/**
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {ConversationKind} kind
 * @property {string} name A group's name, or the project's name for a project channel. Direct messages leave it empty.
 * @property {string} [systemId]
 * @property {string[]} memberIds
 * @property {string} [createdBy]
 * @property {{ userId: string; body: string; at: string; kind: MessageKind }} [lastMessage]
 * @property {string} [lastMessageAt]
 * @property {number} unread
 * @property {boolean} member Whether you're in it. A project channel you haven't joined can still be read.
 */
/**
 * A file sent in a conversation.
 * @typedef {Object} ChatFile
 * @property {string} id
 * @property {string} name
 * @property {string} mime
 * @property {number} size
 */
/**
 * A GIF from GIPHY: only its id and GIPHY's own media address are kept.
 * @typedef {Object} ChatGif
 * @property {string} id
 * @property {string} url
 * @property {number} width
 * @property {number} height
 * @property {string} title
 */
/**
 * @typedef {Object} ChatReaction
 * @property {string} emoji
 * @property {string[]} userIds
 */
/**
 * @typedef {Object} ChatMessage
 * @property {number} id
 * @property {string} conversationId
 * @property {string} userId
 * @property {MessageKind} kind
 * @property {string} body
 * @property {string} createdAt
 * @property {string} [editedAt]
 * @property {string} [deletedAt]
 * @property {{ id: number; userId: string; body: string; deleted?: boolean }} [replyTo] The message this one answers, as a short quote.
 * @property {ChatFile[]} [files]
 * @property {ChatGif} [gif]
 * @property {string} [sticker]
 * @property {ChatReaction[]} [reactions]
 * @property {string} [pinnedAt]
 * @property {string} [pinnedBy]
 */
/**
 * One poll of an open conversation.
 * @typedef {Object} MessagesPage
 * @property {ChatMessage[]} messages
 * @property {ChatMessage[]} changed
 * @property {{ userId: string; lastReadId: number }[]} readers
 * @property {boolean} hasOlder
 * @property {string} now
 */
