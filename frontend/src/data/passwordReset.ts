// Self-service password reset, shared by the Worker (which enforces it) and the sign-in screen.
// "Forgot your password?" emails a single-use link; with no email to send to, administrators are
// told instead. The reply never says which happened, so it can't reveal whether an account exists.

/** How long an emailed reset link works. */
export const RESET_LINK_MINUTES = 30;
/** Reset emails one account can be sent per hour. Further requests are quietly ignored. */
export const RESET_PER_ACCOUNT_HOUR = 3;
/** Reset requests one address may make per 15 minutes, whatever account they name. */
export const RESET_PER_ADDRESS = 5;
export const RESET_ADDRESS_MINUTES = 15;
/** Reset requests are kept this long, for the limits above, then removed. */
export const RESET_KEEP_HOURS = 24;

/** The secret in a reset link: #/reset-password/<64 hex characters>. */
export const RESET_ROUTE = /^#\/reset-password\/([a-f0-9]{64})$/;
export const resetTokenIn = (hash: string): string | null => hash.match(RESET_ROUTE)?.[1] ?? null;

export type ResetOutcome = "emailed" | "admins_told" | "limited" | "unknown";

/**
 * What to do with a request: the counts are recent requests from this address and recent sends
 * to this account. `canEmail` is whether the account has an address and email is connected.
 */
export function resetOutcome(o: { found: boolean; fromAddress: number; sentToAccount: number; canEmail: boolean }): ResetOutcome {
  if (o.fromAddress >= RESET_PER_ADDRESS) return "limited";
  if (!o.found) return "unknown";
  if (o.sentToAccount >= RESET_PER_ACCOUNT_HOUR) return "limited";
  return o.canEmail ? "emailed" : "admins_told";
}

/** What the person sees after asking, whatever happened. */
export const RESET_REPLY =
  "If that matches an account, we've emailed a link to reset its password. It works for 30 minutes. No email from Pulse? Your administrator has been asked to help.";
