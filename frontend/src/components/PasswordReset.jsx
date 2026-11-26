import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, LockKeyhole, MailCheck, UserRound } from "lucide-react";
import { ApiError, api } from "../data/api";
import { PASSWORD_MIN, passwordProblem } from "../data/password";
import PasswordRules from "./PasswordRules";
/**
 * "Forgot your password?": asks for a username or email; the reply is the same either way.
 * @param {{ initial: string; onBack: () => void }} props
 */
export function ForgotPassword({ initial, onBack }) {
  const [login, setLogin] = useState(initial);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="lp-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const r = await /** @type {Promise<{ message: string; }>} */ (/** @type {unknown} */ (api("/password/forgot", "POST", { login })));
          setSent(r.message);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't send that request");
        }
        setBusy(false);
      }}
    >
      <div className="lp-card-head">
        <span className="lp-card-icon">{sent ? <MailCheck size={20} /> : <KeyRound size={20} />}</span>
        <div>
          <h2>{sent ? "Check your email" : "Forgot your password?"}</h2>
          <p>{sent ? "If the account exists, a link is on its way" : "We'll email you a link to choose a new one"}</p>
        </div>
      </div>

      {sent ? (
        <p className="lp-help lp-help-strong">{sent}</p>
      ) : (
        <>
          <label className="lp-field">
            <span>Username or email address</span>
            <span className="lp-input">
              <UserRound size={17} />
              <input autoFocus autoComplete="username" required maxLength={120} value={login} onChange={(e) => setLogin(e.target.value)} placeholder="e.g. mutsa" />
            </span>
          </label>
          <p className="lp-help">Two-step verification still applies when you next sign in.</p>
          {error && (
            <p className="lp-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="lp-submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"} {!busy && <ArrowRight size={18} />}
          </button>
        </>
      )}
      <div className="lp-links">
        <button type="button" className="lp-link" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </form>
  );
}
/**
 * Opened from the emailed link (#/reset-password/<token>): choose a new password.
 * @param {{ token: string; onDone: () => void; onBack: (message?: string) => void }} props
 */
export function ResetPassword({ token, onDone, onBack }) {
  const [who, setWho] = useState(/** @type {{ name: string; username: string } | null | (() => { name: string; username: string } | null)} */ (null));
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    /** @type {Promise<{ name: string; username: string; }>} */ (/** @type {unknown} */ (api("/password/reset/check", "POST", { token }))).then(setWho).catch((err) => onBack(err instanceof Error ? err.message : "That reset link doesn't work."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  if (!who) {
    return (
      <div className="lp-card" role="status">
        <p className="lp-help">Checking your reset link…</p>
      </div>
    );
  }
  const problem = passwordProblem(next, who);
  return (
    <form
      className="lp-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (next !== confirm) return setError("The two passwords don't match.");
        if (problem) return setError(problem);
        setBusy(true);
        setError("");
        try {
          await api("/password/reset", "POST", { token, password: next });
          onDone();
        } catch (err) {
          if (err instanceof ApiError && err.code === "reset_invalid") return onBack(err.message);
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
          <h2>Choose a new password</h2>
          <p>
            For {who.name} ({who.username})
          </p>
        </div>
      </div>
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
      <button type="submit" className="lp-submit" disabled={busy || !!problem || next !== confirm}>
        {busy ? "Saving…" : "Save new password"} {!busy && <ArrowRight size={18} />}
      </button>
      <p className="lp-help">Saving signs you out on every device. Never share your password, including with the IT helpdesk.</p>
      <div className="lp-links">
        <button type="button" className="lp-link" onClick={() => onBack()}>
          Back to sign in
        </button>
      </div>
    </form>
  );
}
