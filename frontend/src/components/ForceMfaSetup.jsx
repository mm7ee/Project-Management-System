/** @import { RegisterOptions } from '../data/passkeys' */
import { useState } from "react";
import { Fingerprint, ShieldCheck, Smartphone } from "lucide-react";
import { api } from "../data/api";
import { createPasskey, passkeysSupported } from "../data/passkeys";
import MfaSetup, { RecoveryCodes } from "./MfaSetup";
/**
 * Shown when an administrator requires two-step verification for this user's role and it isn't
 * on yet. The server refuses everything else until it is, so this can't be skipped. Either an
 * authenticator app or a passkey / security key will do.
 * @param {{ message: string; onDone: () => void }} props
 */
export default function ForceMfaSetup({ message, onDone }) {
  const [method, setMethod] = useState(/** @type {"app" | "passkey" | (() => "app" | "passkey")} */ ("app"));
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
        <p className="mfa-step-text">From now on you'll sign in with your password and a second step, so a stolen password alone can't get into your account.</p>
        {passkeysSupported() && (
          <div className="view-toggle mfa-choice" role="tablist" aria-label="Second step">
            <button role="tab" aria-selected={method === "app"} className={method === "app" ? "on" : ""} onClick={() => setMethod("app")}>
              <Smartphone size={15} /> Authenticator app
            </button>
            <button role="tab" aria-selected={method === "passkey"} className={method === "passkey" ? "on" : ""} onClick={() => setMethod("passkey")}>
              <Fingerprint size={15} /> Passkey or security key
            </button>
          </div>
        )}
        {/* Username isn't known here without data; the codes file is named generically. */}
        {method === "app" ? <MfaSetup username="account" onDone={() => onDone()} /> : <PasskeyFirst onDone={onDone} />}
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
/**
 * Two-step verification with a passkey as the first method: name it, confirm, save the codes.
 * @param {{ onDone: () => void }} props
 */
function PasskeyFirst({ onDone }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState(/** @type {string[] | null | (() => string[] | null)} */ (null));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (codes)
    return (
      <div className="mfa-setup">
        <p className="form-ok">
          <ShieldCheck size={16} /> Two-step verification is on.
        </p>
        <p className="mfa-step-text">
          <b>Save your recovery codes.</b> If you can't use your passkey, each one gets you in once. This is the only time they're shown.
        </p>
        <RecoveryCodes codes={codes} username="account" />
        <label className="mfa-check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery codes somewhere safe
        </label>
        <button type="button" className="btn btn-navy" disabled={!saved} onClick={onDone}>
          Done
        </button>
      </div>
    );
  return (
    <form
      className="mfa-setup"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const options = await /** @type {Promise<RegisterOptions>} */ (/** @type {unknown} */ (api("/me/passkeys/options", "POST", { password })));
          const credential = await createPasskey(options);
          const r = await /** @type {Promise<{ recoveryCodes?: string[]; }>} */ (/** @type {unknown} */ (api("/me/passkeys", "POST", { name, credential })));
          if (r.recoveryCodes?.length) setCodes(r.recoveryCodes);
          else onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't add the passkey");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="mfa-step-text">
        <Fingerprint size={16} /> Use Windows Hello, your phone's fingerprint or face, or a USB/NFC security key. Nothing to type at sign-in.
      </p>
      <label className="field">
        <span>Name it</span>
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Work laptop, YubiKey" />
      </label>
      <label className="field">
        <span>Your password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="page-actions">
        <button type="submit" className="btn btn-navy" disabled={busy}>
          {busy ? "Waiting for your device…" : "Add passkey"}
        </button>
      </div>
    </form>
  );
}
