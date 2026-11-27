/** @import { Role } from './roles' */
// Sign-in security: how many wrong passwords lock an account, and for how long. Shared by the Worker
// (which enforces it) and Settings → Sign-in security (where an administrator changes it).
import { MFA_EXEMPT_USER } from "./roles";
/**
 * Failures older than this don't count towards a lock.
 * @type {15}
 */
export const SIGNIN_WINDOW_MINUTES = 15;
/**
 * The built-in admin account always unlocks itself within this long, whatever the setting.
 * @type {15}
 */
export const ADMIN_MAX_LOCK_MINUTES = 15;
/** @type {SigninRules} */ export const DEFAULT_SIGNIN_RULES = { attempts: 5, lockMinutes: 15, ipAttempts: 20 };
/** @type {{ [K in keyof SigninRules]: [number, number] }} */ export const SIGNIN_BOUNDS = {
  attempts: [3, 20],
  lockMinutes: [5, 1440],
  ipAttempts: [10, 500],
};
/**
 * Keeps whole numbers within bounds; anything missing or unreadable falls back to the default.
 * @param {unknown} raw
 * @returns {SigninRules}
 */
export function cleanSigninRules(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const out = { ...DEFAULT_SIGNIN_RULES };
  for (const k of /** @type {(keyof SigninRules)[]} */ (Object.keys(SIGNIN_BOUNDS))) {
    const n = Number(r[k]);
    if (Number.isFinite(n)) out[k] = Math.min(SIGNIN_BOUNDS[k][1], Math.max(SIGNIN_BOUNDS[k][0], Math.round(n)));
  }
  return out;
}
/**
 * How long this account is locked for: the setting, but never more than 15 minutes for the built-in admin.
 * @param {{ id: string; role: Role }} user
 * @param {SigninRules} rules
 * @returns {number}
 */
export function lockMinutesFor(user, rules) {
  return user.id === MFA_EXEMPT_USER && user.role === "admin" ? Math.min(rules.lockMinutes, ADMIN_MAX_LOCK_MINUTES) : rules.lockMinutes;
}
/** The one message for a wrong password, an unknown username and a locked account, so none can be told apart. */
export const signinRefusal =
  /** @param {SigninRules} rules
   * @returns {string}
   */ (rules) => `Wrong username or password. After ${rules.attempts} wrong tries, sign-in pauses for a while.`;
/**
 * @typedef {Object} SigninRules
 * @property {number} attempts
 * @property {number} lockMinutes
 * @property {number} ipAttempts
 */
