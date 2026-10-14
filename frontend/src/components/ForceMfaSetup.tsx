import { ShieldCheck } from "lucide-react";
import { api } from "../data/api";
import MfaSetup from "./MfaSetup";

/**
 * Shown when an administrator requires two-step verification for this user's role and it isn't
 * on yet. The server refuses everything else until it is, so this can't be skipped.
 */
export default function ForceMfaSetup({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <div className="mfa-gate">
      <section className="set-card mfa-gate-card">
        <header className="set-head">
          <span className="set-icon">
            <ShieldCheck size={18} />
          </span>
          <div>
            <h3>Set up two-step verification</h3>
            <p>{message}</p>
          </div>
        </header>
        <p className="mfa-step-text">
          From now on you'll sign in with your password and a code from your phone, so a stolen password alone can't get into
          your account.
        </p>
        {/* Username isn't known here without data; the codes file is named generically. */}
        <MfaSetup username="account" onDone={onDone} />
        <button
          type="button"
          className="link-btn mfa-signout"
          onClick={async () => {
            await api("/logout", "POST").catch(() => undefined);
            window.location.reload();
          }}
        >
          Sign out instead
        </button>
      </section>
    </div>
  );
}
