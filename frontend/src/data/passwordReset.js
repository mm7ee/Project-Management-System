// Self-service password reset, shared by the Worker (which enforces it) and the sign-in screen.
// "Forgot your password?" emails a single-use link; with no email to send to, administrators are
// told instead. The reply never says which happened, so it can't reveal whether an account exists.
/**
 * How long an emailed reset link works.
 * @type {30}
 */
export const RESET_LINK_MINUTES = 30;
/**
 * Reset emails one account can be sent per hour. Further requests are quietly ignored.
 * @type {3}
 */
export const RESET_PER_ACCOUNT_HOUR = 3;
/**
 * Reset requests one address may make per 15 minutes, whatever account they name.
 * @type {5}
 */
export const RESET_PER_ADDRESS = 5;
export const RESET_ADDRESS_MINUTES = 15;
/**
 * Reset requests are kept this long, for the limits above, then removed.
 * @type {24}
 */
export const RESET_KEEP_HOURS = 24;
/**
 * The secret in a reset link: #/reset-password/<64 hex characters>.
 * @type {RegExp}
 */
export const RESET_ROUTE = /^#\/reset-password\/([a-f0-9]{64})$/;
export const resetTokenIn =
  /**
   * @param {string} hash
   * @returns {string | null}
   */ (hash) => hash.match(RESET_ROUTE)?.[1] ?? null;
/**
 * What to do with a request: the counts are recent requests from this address and recent sends
 * to this account. `canEmail` is whether the account has an address and email is connected.
 * @param {{ found: boolean; fromAddress: number; sentToAccount: number; canEmail: boolean }} o
 * @returns {ResetOutcome}
 */
export function resetOutcome(o) {
  if (o.fromAddress >= RESET_PER_ADDRESS) return "limited";
  if (!o.found) return "unknown";
  if (o.sentToAccount >= RESET_PER_ACCOUNT_HOUR) return "limited";
  return o.canEmail ? "emailed" : "admins_told";
}
/**
 * What the person sees after asking, whatever happened.
 */
export const RESET_REPLY = "If that matches an account, we've emailed a link to reset its password. It works for 30 minutes. No email from Pulse? Your administrator has been asked to help.";
// ---------- by text message (SMS through Twilio) ----------

/** How long a texted code works, how many tries it allows, and how many digits it has. */
export const RESET_CODE_MINUTES = 10;
export const RESET_CODE_TRIES = 5;
export const RESET_CODE_LENGTH = 6;
/** Once the code is right, how long the person has to choose the new password. */
export const RESET_AFTER_CODE_MINUTES = 15;

/** The country numbers without one belong to: Zimbabwe. */
export const DEFAULT_COUNTRY_CODE = "263";

/**
 * A phone number in international form (+263771234567), or null if it isn't one. Accepts the ways people
 * write numbers here: "077 123 4567", "0771234567", "+263 77 123 4567", "00263771234567", "263771234567".
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizePhone(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(s)) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+${DEFAULT_COUNTRY_CODE}${s.slice(1)}`;
  else if (!s.startsWith("+")) s = s.startsWith(DEFAULT_COUNTRY_CODE) ? `+${s}` : `+${DEFAULT_COUNTRY_CODE}${s}`;
  // Zimbabwean numbers have exactly 9 digits after +263; others follow the international limits.
  if (s.startsWith(`+${DEFAULT_COUNTRY_CODE}`)) return /^\+263\d{9}$/.test(s) ? s : null;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/**
 * Whether what was typed is a phone number rather than a username: digits (with + spaces brackets dots and
 * dashes) and at least 9 of them.
 * @param {string} s
 * @returns {boolean}
 */
export const looksLikePhone = (s) => /^\+?[\d\s().-]+$/.test(s.trim()) && s.replace(/\D/g, "").length >= 9;

/**
 * What to do with a request for a texted code. `canText` is whether the account has a usable phone number
 * and texting is set up.
 * @param {{ found: boolean; fromAddress: number; sentToAccount: number; canText: boolean }} o
 * @returns {ResetOutcome}
 */
export function smsOutcome(o) {
  if (o.fromAddress >= RESET_PER_ADDRESS) return "limited";
  if (!o.found) return "unknown";
  if (o.sentToAccount >= RESET_PER_ACCOUNT_HOUR) return "limited";
  return o.canText ? "texted" : "no_phone";
}

/** What the person sees after asking for a code, whatever happened. */
export const RESET_SMS_REPLY = `If that matches an account with a mobile number, we've texted it a ${RESET_CODE_LENGTH}-digit code. It works for ${RESET_CODE_MINUTES} minutes.`;

/** What a wrong, used, expired or unknown code gets: never which. */
export const RESET_CODE_WRONG = "That code isn't right, or it has expired. Check the text, or ask for a new code.";

/**
 * The text message itself.
 * @param {string} code
 */
export const resetSmsText = (code) => `Your Pulse password reset code is ${code}. It works for ${RESET_CODE_MINUTES} minutes. If you didn't ask for it, ignore this text.`;

/** @typedef {"emailed" | "admins_told" | "texted" | "no_phone" | "limited" | "unknown"} ResetOutcome */
