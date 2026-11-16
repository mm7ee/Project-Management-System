// Sign-in security: how many wrong passwords lock an account, and for how long. Shared by the Worker
// (which enforces it) and Settings → Sign-in security (where an administrator changes it).

import { MFA_EXEMPT_USER, type Role } from "./roles";

export interface SigninRules {
  attempts: number; // wrong passwords on one account, within the window, before it locks
  lockMinutes: number; // how long a locked account stays locked
  ipAttempts: number; // failed sign-ins from one address, within the window, before it's refused
}

/** Failures older than this don't count towards a lock. */
export const SIGNIN_WINDOW_MINUTES = 15;
/** The built-in admin account always unlocks itself within this long, whatever the setting. */
export const ADMIN_MAX_LOCK_MINUTES = 15;

export const DEFAULT_SIGNIN_RULES: SigninRules = { attempts: 5, lockMinutes: 15, ipAttempts: 20 };

export const SIGNIN_BOUNDS: { [K in keyof SigninRules]: [number, number] } = {
  attempts: [3, 20],
  lockMinutes: [5, 1440],
  ipAttempts: [10, 500],
};

/** Keeps whole numbers within bounds; anything missing or unreadable falls back to the default. */
export function cleanSigninRules(raw: unknown): SigninRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SIGNIN_RULES };
  for (const k of Object.keys(SIGNIN_BOUNDS) as (keyof SigninRules)[]) {
    const n = Number(r[k]);
    if (Number.isFinite(n)) out[k] = Math.min(SIGNIN_BOUNDS[k][1], Math.max(SIGNIN_BOUNDS[k][0], Math.round(n)));
  }
  return out;
}

/** How long this account is locked for: the setting, but never more than 15 minutes for the built-in admin. */
export function lockMinutesFor(user: { id: string; role: Role }, rules: SigninRules): number {
  return user.id === MFA_EXEMPT_USER && user.role === "admin" ? Math.min(rules.lockMinutes, ADMIN_MAX_LOCK_MINUTES) : rules.lockMinutes;
}

/** The one message for a wrong password, an unknown username and a locked account, so none can be told apart. */
export const signinRefusal = (rules: SigninRules) =>
  `Wrong username or password. After ${rules.attempts} wrong tries, sign-in pauses for a while.`;
