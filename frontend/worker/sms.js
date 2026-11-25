// Text messages through Twilio's REST API (no SDK: one form POST). Used for password reset codes.
// Set up with three Worker secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (a Twilio
// number such as +12025550123, or a Messaging Service SID starting "MG").

/**
 * Whether texting is set up.
 * @param {Env} env
 * @returns {boolean}
 */
export const smsReady = (env) => !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);

/**
 * Sends one text. Throws with Twilio's reason if it's refused.
 * @param {Env} env
 * @param {string} to an international number, +263…
 * @param {string} body
 * @returns {Promise<void>}
 */
export async function sendSms(env, to, body) {
  if (!smsReady(env)) throw new Error("Texting isn't set up (TWILIO_* secrets)");
  const sid = /** @type {string} */ (env.TWILIO_ACCOUNT_SID);
  const from = /** @type {string} */ (env.TWILIO_FROM);
  const form = new URLSearchParams({ To: to, Body: body, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${sid}:${env.TWILIO_AUTH_TOKEN}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const detail = /** @type {{ message?: string; code?: number }} */ (await res.json().catch(() => ({})));
    throw new Error(`Twilio refused the text (${res.status}${detail.code ? `, code ${detail.code}` : ""}): ${detail.message ?? "no reason given"}`);
  }
}

/**
 * The stored form of a texted code: HMAC-SHA256 keyed with MFA_KEY, over the account and the code, so a
 * copy of the database alone can't be used to work codes out.
 * @param {string} key
 * @param {string} userId
 * @param {string} code
 * @returns {Promise<string>}
 */
export async function codeHash(key, userId, code) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`pwreset-sms:${userId}:${code}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Equal strings, compared in time that doesn't depend on where they differ.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A random code of `length` digits, from the platform's secure random source (no bias).
 * @param {number} length
 * @returns {string}
 */
export function randomCode(length) {
  const max = 10 ** length;
  const limit = Math.floor(2 ** 32 / max) * max; // reject the top sliver so every code is equally likely
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % max).padStart(length, "0");
}
