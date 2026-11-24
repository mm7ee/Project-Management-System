// Chat, shared by the Worker and the UI: direct messages, group chats and project channels.

export type ConversationKind = "direct" | "group" | "project";

/** The longest message, in characters. */
export const MAX_MESSAGE = 4000;
/** The longest group name. */
export const MAX_GROUP_NAME = 60;
/** The most people in a group chat, its creator included. */
export const MAX_GROUP_SIZE = 50;
/** How many messages one page holds (the newest first, then older ones on request). */
export const PAGE_SIZE = 50;

/** How often the UI checks for news: the open conversation, the list beside it, and the sidebar badge. */
export const POLL_OPEN_MS = 3_000;
export const POLL_LIST_MS = 15_000;
export const POLL_BADGE_MS = 60_000;

export interface Conversation {
  id: string;
  kind: ConversationKind;
  /** A group's name, or the project's name for a project channel. Direct messages leave it empty. */
  name: string;
  systemId?: string;
  memberIds: string[];
  createdBy?: string;
  lastMessage?: { userId: string; body: string; at: string; kind: MessageKind };
  lastMessageAt?: string;
  unread: number;
  /** Whether you're in it. A project channel you haven't joined can still be read. */
  member: boolean;
}

export type MessageKind = "text" | "event";

/** A file sent in a conversation. */
export interface ChatFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** A GIF from GIPHY: only its id and GIPHY's own media address are kept. */
export interface ChatGif {
  id: string;
  url: string;
  width: number;
  height: number;
  title: string;
}

export interface ChatReaction {
  emoji: string;
  userIds: string[];
}

export interface ChatMessage {
  id: number;
  conversationId: string;
  userId: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  /** The message this one answers, as a short quote. */
  replyTo?: { id: number; userId: string; body: string; deleted?: boolean };
  files?: ChatFile[];
  gif?: ChatGif;
  sticker?: string;
  reactions?: ChatReaction[];
  pinnedAt?: string;
  pinnedBy?: string;
}

// ---------- files, GIFs, stickers, reactions ----------

/** The largest file one message can carry, and how many files. */
export const MAX_CHAT_FILE = 10 * 1024 * 1024;
export const MAX_CHAT_FILES = 10;
/** The most different emojis on one message. */
export const MAX_REACTIONS = 20;
/** One click on a message's toolbar. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"];

/**
 * Pulse's own sticker set (original artwork drawn in the UI, src/components/ChatExtras.tsx).
 * Only these ids are accepted.
 */
export const STICKERS: { id: string; label: string }[] = [
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
export const isSticker = (id: unknown): id is string => typeof id === "string" && STICKERS.some((s) => s.id === id);

/** A single emoji (with skin tones, flags, keycaps and joined sequences), never words. */
export function isEmoji(s: unknown): s is string {
  if (typeof s !== "string" || !s || s.length > 16) return false;
  if (/[\sA-Za-z<>&"'`]/.test(s)) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(s);
}

/** GIPHY's own media servers only: a GIF can't be used to load an image from anywhere else. */
export const GIPHY_MEDIA = /^https:\/\/media[0-9]?\.giphy\.com\/media\/[A-Za-z0-9/_.-]{1,200}$/;
export function validGif(g: unknown): ChatGif | null {
  if (!g || typeof g !== "object") return null;
  const x = g as Record<string, unknown>;
  const id = String(x.id ?? "");
  const url = String(x.url ?? "");
  const width = Math.round(Number(x.width));
  const height = Math.round(Number(x.height));
  if (!/^[A-Za-z0-9]{4,40}$/.test(id) || !GIPHY_MEDIA.test(url)) return null;
  if (!(width > 0 && width <= 1000 && height > 0 && height <= 1000)) return null;
  return { id, url, width, height, title: String(x.title ?? "").slice(0, 120) };
}

/** What a message says in a list or a notification when it has no words of its own. */
export function messagePreview(m: { body: string; gif?: unknown; sticker?: string | null; files?: { name: string }[]; fileName?: string | null }): string {
  if (m.body) return m.body;
  if (m.sticker) return `Sticker: ${STICKERS.find((s) => s.id === m.sticker)?.label ?? "sticker"}`;
  if (m.gif) return "GIF";
  const name = m.fileName ?? m.files?.[0]?.name;
  if (name) return `📎 ${name}`;
  return "";
}

/** Images that open in the browser; every other file downloads. */
export const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;

/** 1.2 MB, 340 KB. */
export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** One poll of an open conversation. */
export interface MessagesPage {
  messages: ChatMessage[]; // newer than `after`, or the newest page (or the page before `before`)
  changed: ChatMessage[]; // older messages edited or deleted since `since`
  readers: { userId: string; lastReadId: number }[];
  hasOlder: boolean;
  now: string; // the next poll's `since`
}

/** The key that makes a direct conversation between two people unique. */
export const directKey = (a: string, b: string) => [a, b].sort().join(":");

/** What a conversation is called for the person looking at it. */
export function conversationTitle(c: Pick<Conversation, "kind" | "name" | "memberIds">, meId: string, nameOf: (id: string) => string): string {
  if (c.kind !== "direct") return c.name;
  const other = c.memberIds.find((id) => id !== meId) ?? meId;
  return nameOf(other);
}

/** A message tidied for storing: trailing spaces gone, no more than two blank lines in a row. */
export function cleanMessage(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
