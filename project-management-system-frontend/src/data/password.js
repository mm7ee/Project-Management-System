// The password policy (ISO 27001 A.5.17), shared by the
// Worker (which enforces it) and the UI (which shows it while typing).
export const PASSWORD_MIN = 12;
/**
 * A new password can't be any of this many most recent ones, the current one included.
 * @type {5}
 */
export const PASSWORD_HISTORY = 5;
/**
 * Each rule and whether `pw` meets it. `who` adds the "not your name" rule.
 * @param {string} pw
 * @param {{ username?: string; name?: string }} [who]
 * @returns {PasswordRule[]}
 */
export function passwordRules(pw, who) {
  const lower = pw.toLowerCase();
  const personal = [who?.username ?? "", ...(who?.name ?? "").split(/\s+/)].map((s) => s.toLowerCase().trim()).filter((s) => s.length >= 3);
  return [
    { label: `At least ${PASSWORD_MIN} characters`, ok: pw.length >= PASSWORD_MIN },
    { label: "A letter", ok: /[A-Za-z]/.test(pw) },
    { label: "A number", ok: /\d/.test(pw) },
    { label: "A symbol, such as ! @ # $ - _", ok: /[^A-Za-z0-9\s]/.test(pw) },
    ...(personal.length ? [{ label: "Doesn't contain your name or username", ok: !personal.some((p) => lower.includes(p)) }] : []),
  ];
}
/**
 * Why `pw` breaks the policy, in one sentence, or null when it's fine.
 * @param {string} pw
 * @param {{ username?: string; name?: string }} [who]
 * @returns {string | null}
 */
export function passwordProblem(pw, who) {
  const failed = passwordRules(pw, who).filter((r) => !r.ok);
  if (!failed.length) return null;
  const personal = failed.find((r) => r.label.startsWith("Doesn't"));
  const missing = failed.filter((r) => r !== personal).map((r) => r.label.charAt(0).toLowerCase() + r.label.slice(1));
  return [...(missing.length ? [`Your password needs ${missing.join("; ")}.`] : []), ...(personal ? ["It must not contain your name or username."] : [])].join(" ");
}
/**
 * @typedef {Object} PasswordRule
 * @property {string} label
 * @property {boolean} ok
 */
