import { BRAND } from "./brand";
// "Request update": how the person asking wants the project team reached. Shared by the Worker and the UI.
// Whatever is chosen, the team is also told under the bell, so the request is never lost.
/** @type {RequestChannel[]} */ export const REQUEST_CHANNELS = ["chat", "email", "teams"];
/** @type {Record<RequestChannel, string>} */ export const CHANNEL_LABEL = {
  chat: `${BRAND.shortName} chat`,
  email: "Email",
  teams: "Teams",
};
/** The channels asked for, known ones only, in the usual order, no repeats. */
export const cleanChannels =
  /**
   * @param {unknown} v
   * @returns {RequestChannel[]}
   */ (v) => (Array.isArray(v) ? REQUEST_CHANNELS.filter((c) => v.includes(c)) : []);
/**
 * "Pulse chat", "Pulse chat and email", "Pulse chat, email and Teams".
 * @param {RequestChannel[]} cs
 * @returns {string}
 */
export function channelList(cs) {
  const names = cs.map((c, i) => (i === 0 ? CHANNEL_LABEL[c] : c === "email" ? "email" : CHANNEL_LABEL[c]));
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
/** @typedef {"chat" | "email" | "teams"} RequestChannel */
/**
 * Which ways are open to this person right now (email and Teams need connecting in Settings).
 * @typedef {Record<RequestChannel, boolean>} ChannelAvailability
 */
/**
 * What the person asking is told happened, one line per channel.
 * @typedef {Object} RequestDelivery
 * @property {{ conversationId: string }} [chat]
 * @property {{ sent: number; noAddress: string[] }} [email]
 * @property {{ ok: boolean }} [teams]
 */
