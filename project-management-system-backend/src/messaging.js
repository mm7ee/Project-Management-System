// WhatsApp and SMS for automation rules, through a provider adapter. No provider is connected yet: the adapter
// below says so, and the rule's run log records what would have been sent and to whom. To connect one (Twilio,
// Africa's Talking, the WhatsApp Business API …), implement MessageProvider and return it from providerFor; its
// keys belong in Worker secrets, never in the database or the browser.

/**
 * @typedef {Object} MessageProvider
 * @property {string} name
 * @property {(to: string, text: string) => Promise<{ sent: true; id?: string } | { sent: false; reason: string }>} send
 */

/**
 * The provider for a channel, or null when none is connected.
 * @param {Env} _env
 * @param {"whatsapp" | "sms"} _channel
 * @returns {MessageProvider | null}
 */
export function providerFor(_env, _channel) {
  return null;
}

/**
 * Sends one message, or explains why it wasn't.
 * @param {Env} env
 * @param {"whatsapp" | "sms"} channel
 * @param {string} to  an international phone number, such as +263 77 123 4567
 * @param {string} text
 * @returns {Promise<{ sent: boolean; note: string }>}
 */
export async function sendMessage(env, channel, to, text) {
  const label = channel === "whatsapp" ? "WhatsApp" : "SMS";
  const phone = to.replace(/[\s()-]/g, "");
  if (!/^\+\d{8,15}$/.test(phone)) return { sent: false, note: `${label} not sent: ${to || "no phone number"} isn't an international number` };
  const provider = providerFor(env, channel);
  if (!provider) return { sent: false, note: `${label} not sent to ${phone}: no ${label} provider is connected yet (it would have said "${text.slice(0, 80)}")` };
  const r = await provider.send(phone, text.slice(0, 1000));
  return r.sent ? { sent: true, note: `${label} sent to ${phone}` } : { sent: false, note: `${label} to ${phone} failed: ${r.reason}` };
}
