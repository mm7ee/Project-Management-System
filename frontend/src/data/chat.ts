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

export interface ChatMessage {
  id: number;
  conversationId: string;
  userId: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
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
