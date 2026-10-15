import { Check, X } from "lucide-react";
import { PASSWORD_HISTORY, passwordRules } from "../data/password";

/** The password policy as a live checklist, ticked off while typing. */
export default function PasswordRules({
  password,
  who,
  showReuse = false,
  className = "",
}: {
  password: string;
  who?: { username?: string; name?: string };
  showReuse?: boolean; // mention the no-reuse rule (checked on the server)
  className?: string;
}) {
  return (
    <ul className={`pw-rules ${className}`} aria-label="Password requirements">
      {passwordRules(password, who).map((r) => (
        <li key={r.label} className={r.ok ? "ok" : ""}>
          {r.ok ? <Check size={13} /> : <X size={13} />} {r.label}
        </li>
      ))}
      {showReuse && <li className="pw-note">Not one of your last {PASSWORD_HISTORY} passwords</li>}
    </ul>
  );
}

/** A random password that meets the policy, for an administrator to issue as a temporary one. */
export function generatePassword(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%-_";
  const all = letters + digits + symbols;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(letters), pick(digits), pick(symbols), ...Array.from({ length: 12 }, () => pick(all))];
  // Shuffle so the guaranteed characters aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
