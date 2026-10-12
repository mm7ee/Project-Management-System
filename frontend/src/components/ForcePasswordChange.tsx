import { useState } from "react";
import { ArrowRight, KeyRound, LockKeyhole } from "lucide-react";
import { api } from "../data/api";
import ParticleField from "./ParticleField";
import "./landing.css";

interface Props {
  message: string; // from the server, e.g. "Hi Donald, you signed in with a temporary password"
  onDone: () => void;
}

/**
 * Shown after signing in with a temporary password from an administrator. The server refuses
 * every other request until this succeeds, so the dashboard can't be reached around it.
 */
export default function ForcePasswordChange({ message, onDone }: Props) {
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
      <div className="lp-floor" aria-hidden="true" />
      <ParticleField className="lp-particles" />

      <main className="lp-main lp-single">
        <form
          className="lp-card lp-in"
          onSubmit={async (e) => {
            e.preventDefault();
            if (next !== confirm) return setError("The two passwords don't match.");
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
            Your password was reset by an administrator. Choose your own to continue; the temporary one stops working.
          </p>

          <label className="lp-field">
            <span>New password (8+ characters)</span>
            <span className="lp-input">
              <LockKeyhole size={17} />
              <input
                type="password"
                autoFocus
                autoComplete="new-password"
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </span>
          </label>
          <label className="lp-field">
            <span>Confirm new password</span>
            <span className="lp-input">
              <LockKeyhole size={17} />
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </span>
          </label>
          {error && (
            <p className="lp-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="lp-submit" disabled={busy}>
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
