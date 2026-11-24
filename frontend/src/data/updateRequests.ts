// "Request update": how the person asking wants the project team reached. Shared by the Worker and the UI.
// Whatever is chosen, the team is also told under the bell, so the request is never lost.

export type RequestChannel = "chat" | "email" | "teams";
export const REQUEST_CHANNELS: RequestChannel[] = ["chat", "email", "teams"];

export const CHANNEL_LABEL: Record<RequestChannel, string> = {
  chat: "Pulse chat",
  email: "Email",
  teams: "Teams",
};

/** Which ways are open to this person right now (email and Teams need connecting in Settings). */
export type ChannelAvailability = Record<RequestChannel, boolean>;

/** The channels asked for, known ones only, in the usual order, no repeats. */
export const cleanChannels = (v: unknown): RequestChannel[] =>
  Array.isArray(v) ? REQUEST_CHANNELS.filter((c) => v.includes(c)) : [];

/** "Pulse chat", "Pulse chat and email", "Pulse chat, email and Teams". */
export function channelList(cs: RequestChannel[]): string {
  const names = cs.map((c, i) => (i === 0 ? CHANNEL_LABEL[c] : c === "email" ? "email" : CHANNEL_LABEL[c]));
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the person asking is told happened, one line per channel. */
export interface RequestDelivery {
  chat?: { conversationId: string };
  email?: { sent: number; noAddress: string[] };
  teams?: { ok: boolean };
}
