import { BRAND } from "../data/brand";
import { useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Copy, Download, ShieldCheck, Smartphone } from "lucide-react";
import { api } from "../data/api";
/**
 * The QR code an authenticator app scans. Drawn locally: the secret never leaves the page.
 * @param {{ uri: string }} props
 */
export function QrCode({ uri }) {
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  return <div className="mfa-qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) }} />;
}
/**
 * @param {{ text: string; label?: string }} props
 */
function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : label}
    </button>
  );
}
/**
 * Shows freshly issued recovery codes once, with copy and download.
 * @param {{ codes: string[]; username: string }} props
 */
export function RecoveryCodes({ codes, username }) {
  const text = `${BRAND.shortName} recovery codes for ${username}\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  return (
    <div className="mfa-codes">
      <ol>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="page-actions">
        <CopyButton text={text} label="Copy codes" />
        <button
          type="button"
          className="btn btn-ghost sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            a.download = `pms-recovery-codes-${username}.txt`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download size={15} /> Download
        </button>
      </div>
    </div>
  );
}
/**
 * Turning on two-step verification: scan a QR code, confirm one code, keep the recovery codes.
 * `onDone` runs after the codes have been acknowledged.
 * @param {{
 *   username: string;
 *   onDone: (codes?: string[]) => void;
 *   onCancel?: () => void;
 *   initial?: { secret: string; uri: string }; // already started (moving to a new phone)
 *   confirmLabel?: string;
 * }} props
 */
export default function MfaSetup({ username, onDone, onCancel, initial, confirmLabel = "Turn on" }) {
  const [setup, setSetup] = useState(/** @type {{ secret: string; uri: string } | null | (() => { secret: string; uri: string } | null)} */ (initial ?? null));
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(/** @type {string[] | null | (() => string[] | null)} */ (null));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = /** @param {() => Promise<void>} fn */ async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  if (codes) {
    return (
      <div className="mfa-setup">
        <p className="form-ok">
          <ShieldCheck size={16} /> Two-step verification is on.
        </p>
        <p className="mfa-step-text">
          <b>Save your recovery codes.</b> If you lose your phone, each one gets you in once. This is the only time they're shown.
        </p>
        <RecoveryCodes codes={codes} username={username} />
        <label className="mfa-check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery codes somewhere safe
        </label>
        <button type="button" className="btn btn-navy" disabled={!saved} onClick={() => onDone()}>
          Done
        </button>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="mfa-setup">
        <p className="mfa-step-text">
          <Smartphone size={16} /> You'll need an authenticator app on your phone, such as Microsoft Authenticator, Google Authenticator or 1Password.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="page-actions">
          <button type="button" className="btn btn-navy" disabled={busy} onClick={() => run(async () => setSetup(await api("/me/mfa/setup", "POST")))}>
            <ShieldCheck size={16} /> {busy ? "Starting…" : "Set up two-step verification"}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <form
      className="mfa-setup"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await /** @type {Promise<{ recoveryCodes?: string[]; }>} */ (/** @type {unknown} */ (api("/me/mfa/enable", "POST", { code })));
          // Adding the app alongside a passkey keeps the existing recovery codes.
          if (r.recoveryCodes?.length && !initial) setCodes(r.recoveryCodes);
          else onDone(r.recoveryCodes);
        });
      }}
    >
      <div className="mfa-scan">
        <QrCode uri={setup.uri} />
        <div className="mfa-scan-text">
          <p className="mfa-step-text">
            <b>1.</b> In your authenticator app, add an account and scan this QR code.
          </p>
          <p className="mfa-step-text small">Can't scan? Enter this key instead:</p>
          <div className="mfa-key">
            <code>{/** @type {RegExpMatchArray} */ (setup.secret.match(/.{1,4}/g)).join(" ")}</code>
            <CopyButton text={setup.secret} />
          </div>
          <label className="field">
            <span>
              <b>2.</b> Enter the 6-digit code the app shows
            </span>
            <input className="mfa-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} placeholder="123 456" />
          </label>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="page-actions">
        <button type="submit" className="btn btn-navy" disabled={busy || code.replace(/\s/g, "").length !== 6}>
          {busy ? "Checking…" : confirmLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
