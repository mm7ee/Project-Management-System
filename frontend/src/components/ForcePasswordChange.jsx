import { useState } from "react";
import { ArrowRight, KeyRound, LockKeyhole } from "lucide-react";
import { api } from "../data/api";
import ParticleField from "./ParticleField";
import PasswordRules from "./PasswordRules";
import { PASSWORD_MIN, passwordProblem } from "../data/password";
import "./landing.css";
/**
 * Shown after signing in with a temporary password from an administrator. The server refuses
 * every other request until this succeeds, so the dashboard can't be reached around it.
 * @param {Props} props
 */
export default function ForcePasswordChange({ message, who, onDone }) {
  // The server says why: an administrator-issued password, or one that predates the policy.
  const policyChange = /password policy/i.test(message);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="landing">
      <div className="lp-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-paper" aria-hidden="true" />
      <ParticleField className="lp-particles" />

      <main className="lp-main lp-single">
        <form
          className="lp-card lp-in"
          onSubmit={async (e) => {
            e.preventDefault();
            if (next !== confirm) return setError("The two passwords don't match.");
            if (passwordProblem(next, who)) return setError(/** @type {string} */ (passwordProblem(next, who)));
            setBusy(true);
            setError("");
            try {
              await api("/me/password", "POST", { next });
              onDone();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't set the password");
              setBusy(false);
            }
          }}
        >
          <div className="lp-card-head">
            <span className="lp-card-icon">
              <KeyRound size={20} />
            </span>
            <div>
              <h2>Set a new password</h2>
              <p>{message}</p>
            </div>
          </div>
          <p className="lp-note">
            {policyChange ? "Pulse now follows the Omni Contact password policy (ISO 27001 A.5.17). Choose a new password to continue." : "You signed in with a password issued by an administrator. Choose your own to continue; the temporary one stops working."} Never share it with anyone, including
            the IT helpdesk.
          </p>

          <label className="lp-field">
            <span>New password</span>
            <span className="lp-input">
              <LockKeyhole size={17} />
              <input type="password" autoFocus autoComplete="new-password" required minLength={PASSWORD_MIN} value={next} onChange={(e) => setNext(e.target.value)} />
            </span>
          </label>
          <label className="lp-field">
            <span>Confirm new password</span>
            <span className="lp-input">
              <LockKeyhole size={17} />
              <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </span>
          </label>
          <PasswordRules password={next} confirm={confirm} who={who} showReuse className="lp-rules" />
          {error && (
            <p className="lp-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="lp-submit" disabled={busy || !!passwordProblem(next, who) || next !== confirm}>
            {busy ? "Saving…" : "Save and continue"} {!busy && <ArrowRight size={18} />}
          </button>
          <button
            type="button"
            className="lp-link"
            onClick={async () => {
              await api("/logout", "POST").catch(() => undefined);
              window.location.reload();
            }}
          >
            Sign out instead
          </button>
        </form>
      </main>
    </div>
  );
}
/**
 * @typedef {Object} Props
 * @property {string} message
 * @property {{ username?: string; name?: string }} [who]
 * @property {() => void} onDone
 */
