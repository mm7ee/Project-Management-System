/** @import { ChannelAvailability, RequestChannel, RequestDelivery } from '../data/updateRequests' */
import { Check, Mail, MessagesSquare, Users } from "lucide-react";
import { CHANNEL_LABEL, REQUEST_CHANNELS } from "../data/updateRequests";
const ICON = { chat: MessagesSquare, email: Mail, teams: Users };
/** @type {Record<RequestChannel, string>} */ const HINT = {
  chat: "Posts in the project's channel and @mentions the team",
  email: "Emails the project lead and developers",
  teams: "Posts in the team's Teams channel",
};
/** @type {Record<RequestChannel, string>} */ const OFF = {
  chat: "Not available on a view-only link",
  email: "Email isn't connected yet (Settings → Notifications)",
  teams: "Teams isn't connected yet (Settings → Notifications)",
};
/**
 * This browser remembers the last choice, so it's one click next time.
 * @type {"pms:request-via"}
 */
const SAVED = "pms:request-via";
/**
 * @param {ChannelAvailability} [available]
 * @returns {RequestChannel[]}
 */
export function savedChannels(available) {
  const ok = /** @param {RequestChannel} c */ (c) => !available || available[c];
  /** @type {RequestChannel[]} */ let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(SAVED) ?? "[]");
  } catch {
    // Nothing saved, or storage is off: start from the default.
  }
  const kept = REQUEST_CHANNELS.filter((c) => saved.includes(c) && ok(c));
  return kept.length ? kept : REQUEST_CHANNELS.filter(ok).slice(0, 1);
}
/**
 * Choose one or more ways to reach the project team. The bell always tells them too.
 * @param {{ available?: ChannelAvailability; value: RequestChannel[]; onChange: (v: RequestChannel[]) => void }} arg2
 */
export default function RequestChannels({ available, value, onChange }) {
  const toggle = /** @param {RequestChannel} c */ (c) => {
    const next = REQUEST_CHANNELS.filter((x) => (x === c ? !value.includes(c) : value.includes(x)));
    onChange(next);
    try {
      localStorage.setItem(SAVED, JSON.stringify(next));
    } catch {
      // Only a convenience.
    }
  };
  return (
    <fieldset className="request-channels">
      <legend>Send it by</legend>
      <div className="request-channel-list">
        {REQUEST_CHANNELS.map((c) => {
          const Icon = ICON[c];
          const on = value.includes(c);
          const usable = !available || available[c];
          return (
            <button key={c} type="button" role="checkbox" aria-checked={on} disabled={!usable} className={`request-channel ${on ? "on" : ""}`} title={usable ? HINT[c] : OFF[c]} onClick={() => toggle(c)}>
              {on ? <Check size={14} /> : <Icon size={14} />} {CHANNEL_LABEL[c]}
            </button>
          );
        })}
      </div>
      <small className="request-channel-hint">{value.length ? value.map((c) => HINT[c]).join(". ") + ". They're also told under the bell." : "Choose at least one."}</small>
    </fieldset>
  );
}
/**
 * One line saying what happened, after sending.
 * @param {RequestDelivery} sent
 * @returns {{ text: string; chatId?: string }}
 */
export function deliveryNote(sent) {
  /** @type {string[]} */ const parts = [];
  if (sent.chat) parts.push("posted in the project's chat");
  if (sent.email) {
    const { sent: n, noAddress } = sent.email;
    parts.push(`${n ? `emailed ${n} ${n === 1 ? "person" : "people"}` : "no one could be emailed"}${noAddress.length ? ` (${noAddress.join(", ")} ${noAddress.length === 1 ? "has" : "have"} no email address)` : ""}`);
  }
  if (sent.teams) parts.push(sent.teams.ok ? "posted to Teams" : "Teams didn't accept it (an administrator can check Settings → Notifications)");
  const text = parts.length ? `Request sent: ${parts.join("; ")}.` : "Request sent.";
  return { text: text.charAt(0).toUpperCase() + text.slice(1), ...(sent.chat ? { chatId: sent.chat.conversationId } : {}) };
}
