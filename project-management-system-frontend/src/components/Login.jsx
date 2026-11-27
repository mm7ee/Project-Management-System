import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
/** @import { Tenant } from '../data/api' */
/** @import { BrandingView } from '../data/branding' */
import { ArrowRight, Fingerprint, KeyRound, Layers, LifeBuoy, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { ApiError, api } from "../data/api";
import { cleanCode, codeInLink, forgetOrg, initialOrgCode, lastWorkspace, rememberOrg, rememberWorkspace } from "../data/tenant";
import { passkeysSupported, signWithPasskey } from "../data/passkeys";
import { BRAND } from "../data/brand";
import { applyBranding, setTitle } from "../brandTheme";
import OrgMark, { pageSurface } from "./OrgMark";
import { ForgotPassword, ResetPassword } from "./PasswordReset";
import { resetTokenIn } from "../data/passwordReset";
import LandingPage from "./LandingPage";
import "./landing.css";

/** Whether to animate: not when the person asked for less motion. */
const motionOk = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "reduced";

/** One message for every code nobody may see: unknown, suspended, archived, mistyped. */
const NOT_FOUND = "We couldn't find that organisation. Check the code with your administrator.";

/**
 * Signing in, in two states (docs/branding-plan.md):
 *  - A, the platform page: no organisation chosen yet. Neutral: the PMS wordmark, one line of value and the
 *    organisation code. It never lists or looks up organisations by anything but the code someone types.
 *  - B, the organisation's page: its logo, name and accent (from the public branding lookup, which returns only
 *    those), then the usual sign-in. A wrong, suspended or archived code goes back to A with one message.
 * Workspaces are chosen after signing in, never before.
 * @param {{ onSignedIn: () => void }} arg1
 */
export default function Login({ onSignedIn }) {
  // Which organisation: a sign-in link (#/o/<code>) opens its page straight away. Otherwise the platform page comes
  // first, with the code last used on this device already filled in: one Continue away.
  const [orgCode, setOrgCode] = useState(codeInLink);
  const [orgDraft, setOrgDraft] = useState(initialOrgCode);
  const [branding, setBranding] = useState(/** @type {BrandingView | null} */ (null));
  // Each refusal on the platform page counts up, so its card shakes again.
  const [errorKey, setErrorKey] = useState(0);
  // Where Continue was, so the organisation's colour can flood out from it as its page opens.
  const [floodFrom, setFloodFrom] = useState(/** @type {{ x: number; y: number } | null} */ (null));
  // After signing in, someone in several workspaces chooses which to open.
  const [choices, setChoices] = useState(/** @type {Tenant | null} */ (null));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set once the password checked out for an account with two-step verification.
  const [ticket, setTicket] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [methods, setMethods] = useState(/** @type {Methods | (() => Methods)} */ ({ app: true, passkey: false }));
  // Forgot password: the request form, or the screen an emailed link opens.
  const [forgot, setForgot] = useState(false);
  const [resetToken, setResetToken] = useState(() => resetTokenIn(window.location.hash));
  const [notice, setNotice] = useState("");

  // The organisation's branding, once there is a code. Until then, and if the code leads nowhere, the page is the
  // neutral platform page.
  useEffect(() => {
    if (!orgCode) {
      setBranding(null);
      applyBranding(null);
      setTitle(null);
      return;
    }
    let live = true;
    api(`/public/org/${encodeURIComponent(orgCode)}/branding`)
      .then((b) => {
        if (!live) return;
        const view = /** @type {BrandingView} */ (b);
        // The moment the neutral platform becomes the organisation's system: the card morphs into its sign-in
        // page (View Transitions where the browser has them, else a crossfade), and its colour floods in.
        const become = () => {
          setBranding(view);
          applyBranding(view);
          setTitle(view.name);
        };
        const doc = /** @type {Document & { startViewTransition?: (cb: () => void) => unknown }} */ (document);
        if (motionOk() && typeof doc.startViewTransition === "function") doc.startViewTransition(() => flushSync(become));
        else become();
      })
      .catch((err) => {
        if (!live) return;
        forgetOrg();
        if (window.location.hash.startsWith("#/o/")) history.replaceState(null, "", window.location.pathname + window.location.search);
        setOrgDraft(orgCode);
        setOrgCode("");
        setFloodFrom(null);
        setError(err instanceof ApiError && err.status === 429 ? err.message : err instanceof ApiError ? NOT_FOUND : "Couldn't reach the server. Check your connection and try again.");
        setErrorKey((k) => k + 1);
      });
    return () => {
      live = false;
    };
  }, [orgCode]);

  useEffect(() => {
    // A reset link opened in a tab that already shows the sign-in page.
    const onHash = () => {
      const t = resetTokenIn(window.location.hash);
      if (t) setResetToken(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const finish = async () => {
    rememberOrg(orgCode);
    try {
      const t = /** @type {Tenant} */ (/** @type {unknown} */ (await api("/me/workspaces")));
      if (t.workspaces.length > 1) {
        setChoices(t);
        return;
      }
      if (t.workspace && t.organization) rememberWorkspace(t.organization.id, t.workspace.id);
    } catch {
      // Nothing to choose: go on with the workspace the session opened.
    }
    onSignedIn();
  };
  const leaveReset = (message = "", done = false) => {
    // The link's secret shouldn't linger in the address bar or history.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setResetToken(null);
    setForgot(false);
    setPassword("");
    setError(done ? "" : message);
    setNotice(done ? message : "");
  };
  const backToPassword = (message = "") => {
    setTicket(null);
    setPassword("");
    setError(message);
  };
  /** "Not your organisation?": back to the platform page, forgetting the code on this device. */
  const notYours = () => {
    forgetOrg();
    if (window.location.hash.startsWith("#/o/")) history.replaceState(null, "", window.location.pathname + window.location.search);
    setOrgDraft("");
    setOrgCode("");
    setTicket(null);
    setForgot(false);
    setPassword("");
    setError("");
    setNotice("");
  };

  const errorLine = error && (
    <p className="lp-error" role="alert">
      {error}
    </p>
  );

  // State A: no organisation yet, or checking the code (LandingPage.jsx).
  if (!branding) {
    return (
      <LandingPage
        draft={orgDraft}
        onDraft={setOrgDraft}
        checking={!!orgCode}
        error={error}
        errorKey={errorKey}
        notice={notice}
        onSubmit={(from) => {
          const code = cleanCode(orgDraft);
          if (!code) {
            setError("Enter your organisation's code: letters, numbers and dashes, as your administrator gave it to you.");
            setErrorKey((k) => k + 1);
            return;
          }
          setError("");
          setNotice("");
          setFloodFrom(from ? { x: from.left + from.width / 2, y: from.top + from.height / 2 } : null);
          setOrgCode(code);
        }}
      >
        {resetToken ? <ResetPassword token={resetToken} onDone={() => leaveReset("Your password has been changed and every device signed out. Sign in with your new password.", true)} onBack={(m) => leaveReset(m)} /> : null}
      </LandingPage>
    );
  }

  // State B: the organisation's own sign-in page.
  return (
    <div className="landing lp-branded">
      {floodFrom && motionOk() && (
        <span className="lp-flood" aria-hidden="true" style={/** @type {any} */ ({ "--fx": `${floodFrom.x}px`, "--fy": `${floodFrom.y}px` })} onAnimationEnd={() => setFloodFrom(null)} />
      )}
      <main className="lp-center">
        <div className="lp-org-mark">
          <OrgMark branding={branding} surface={pageSurface()} size="lg" />
        </div>
        <h1 className="lp-org-title">Sign in to {branding.name}</h1>
        {resetToken ? (
          <ResetPassword token={resetToken} onDone={() => leaveReset("Your password has been changed and every device signed out. Sign in with your new password.", true)} onBack={(m) => leaveReset(m)} />
        ) : choices ? (
          <ChooseWorkspace tenant={choices} onChosen={onSignedIn} />
        ) : forgot ? (
          <ForgotPassword initial={username} organization={orgCode} onBack={() => leaveReset()} />
        ) : ticket ? (
          <SecondStep ticket={ticket} methods={methods} onSignedIn={finish} onBack={backToPassword} />
        ) : (
          <form
            className="lp-card lp-morph"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const r = await /** @type {Promise<{ ok?: boolean; mfa?: boolean; ticket?: string; methods?: Methods; }>} */ (/** @type {unknown} */ (api("/login", "POST", { organization: orgCode, username, password })));
                if (r.mfa && r.ticket) {
                  setMethods(r.methods ?? { app: true, passkey: false });
                  setTicket(r.ticket);
                  setBusy(false);
                  return;
                }
                await finish();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Sign-in failed");
                setBusy(false);
              }
            }}
          >
            <label className="lp-field">
              <span>Username</span>
              <span className="lp-input">
                <UserRound size={17} aria-hidden="true" />
                <input autoFocus autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
              </span>
            </label>
            <label className="lp-field">
              <span>Password</span>
              <span className="lp-input">
                <LockKeyhole size={17} aria-hidden="true" />
                <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </span>
            </label>
            {notice && (
              <p className="lp-ok" role="status">
                {notice}
              </p>
            )}
            {errorLine}
            <button type="submit" className="lp-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"} {!busy && <ArrowRight size={18} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="lp-link"
              onClick={() => {
                setError("");
                setNotice("");
                setForgot(true);
              }}
            >
              Forgot your password?
            </button>
            <p className="lp-help">Need an account? Ask your administrator. Never share your password, including with the IT helpdesk.</p>
          </form>
        )}
        {!choices && (
          <button type="button" className="lp-link lp-switch" onClick={notYours}>
            Not your organisation?
          </button>
        )}
      </main>
      <footer className="lp-foot">{BRAND.poweredBy}</footer>
    </div>
  );
}
/**
 * After signing in: which of your workspaces to open, the last one used on this device first. Only your own are
 * listed, and only now, after the password and any second step.
 * @param {{ tenant: Tenant; onChosen: () => void }} props
 */
function ChooseWorkspace({ tenant, onChosen }) {
  const orgId = tenant.organization?.id ?? "";
  const last = lastWorkspace(orgId);
  const ordered = [...tenant.workspaces].sort((a, b) => Number(b.id === last) - Number(a.id === last));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const open = /** @param {string} id */ async (id) => {
    setBusy(id);
    setError("");
    try {
      if (id !== tenant.workspace?.id) await api("/me/workspace", "POST", { workspaceId: id });
      rememberWorkspace(orgId, id);
      onChosen();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that workspace");
      setBusy("");
    }
  };
  return (
    <div className="lp-card">
      <div className="lp-card-head">
        <span className="lp-card-icon">
          <Layers size={20} />
        </span>
        <div>
          <h2>Choose a workspace</h2>
          <p>{tenant.organization?.name ?? "Your organisation"}: you can switch later from the top bar.</p>
        </div>
      </div>
      <ul className="lp-workspaces" aria-label="Your workspaces">
        {ordered.map((w, i) => (
          <li key={w.id}>
            <button type="button" className="lp-workspace" autoFocus={i === 0} disabled={!!busy} onClick={() => open(w.id)}>
              <span>
                <b>{w.name}</b>
                {w.id === last && <span className="lp-workspace-last"> · last used</span>}
              </span>
              {busy === w.id ? <span aria-live="polite">Opening…</span> : <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="lp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
/**
 * Set after signing in with a recovery code, so the app can suggest moving to a new phone.
 * @type {"pms:recovery-signin"}
 */
export const RECOVERY_SIGNIN = "pms:recovery-signin";
/**
 * The second sign-in step. Offers whichever methods the account has (authenticator app,
 * passkey or security key), recovery codes for a lost phone, and, when nothing is left, a
 * request to an administrator.
 * @param {{ ticket: string; methods: Methods; onSignedIn: () => void; onBack: (message?: string) => void }} props
 */
function SecondStep({ ticket, methods, onSignedIn, onBack }) {
  const canPasskey = methods.passkey && passkeysSupported();
  const [mode, setMode] = useState(/** @type {Mode | (() => Mode)} */ (methods.app ? "app" : canPasskey ? "passkey" : "recovery"));
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const go = /** @param {Mode} m */ (m) => {
    setMode(m);
    setCode("");
    setError("");
  };
  const attempt = /** @param {() => Promise<void>} fn */ async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === "mfa_expired") return onBack(err.message);
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setCode("");
    }
  };
  const signInWithPasskey = () =>
    attempt(async () => {
      const options = await /** @type {Promise<{ challenge: string; rpId: string; allow: string[]; }>} */ (/** @type {unknown} */ (api("/login/passkey/options", "POST", { ticket })));
      const credential = await signWithPasskey(options);
      await api("/login/passkey", "POST", { ticket, credential });
      onSignedIn();
    });
  const head = {
    app: ["Two-step verification", "Enter the 6-digit code from your authenticator app"],
    passkey: ["Two-step verification", "Use a passkey: Windows Hello, your phone's fingerprint or face, or a security key"],
    recovery: ["Use a recovery code", "Enter one of the codes you saved when you turned on two-step verification"],
    help: ["Ask for help", "An administrator can reset two-step verification once they've confirmed it's you"],
    helpSent: ["Request sent", "Your administrator has been told"],
  }[mode];
  const links = (
    <div className="lp-links">
      {mode !== "passkey" && canPasskey && (
        <button type="button" className="lp-link" onClick={() => go("passkey")}>
          <Fingerprint size={14} /> Use a passkey or security key
        </button>
      )}
      {mode !== "app" && methods.app && (
        <button type="button" className="lp-link" onClick={() => go("app")}>
          Use a code from the app
        </button>
      )}
      {mode !== "recovery" && (
        <button type="button" className="lp-link" onClick={() => go("recovery")}>
          Lost your phone? Use a recovery code
        </button>
      )}
      {mode !== "help" && (
        <button type="button" className="lp-link" onClick={() => go("help")}>
          Can't use any of these? Ask an administrator
        </button>
      )}
      <button type="button" className="lp-link" onClick={() => onBack()}>
        Back
      </button>
    </div>
  );
  return (
    <form
      className="lp-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === "passkey") return signInWithPasskey();
        if (mode === "help")
          return attempt(async () => {
            await api("/login/mfa/help", "POST", { ticket, message: note });
            setBusy(false);
            setMode("helpSent");
          });
        attempt(async () => {
          await api("/login/mfa", "POST", { ticket, code });
          if (mode === "recovery") {
            try {
              sessionStorage.setItem(RECOVERY_SIGNIN, "1");
            } catch {
              // Only a reminder; fine without it.
            }
          }
          onSignedIn();
        });
      }}
    >
      <div className="lp-card-head">
        <span className="lp-card-icon">{mode === "passkey" ? <Fingerprint size={20} /> : mode.startsWith("help") ? <LifeBuoy size={20} /> : <ShieldCheck size={20} />}</span>
        <div>
          <h2>{head[0]}</h2>
          <p>{head[1]}</p>
        </div>
      </div>

      {(mode === "app" || mode === "recovery") && (
        <label className="lp-field">
          <span>{mode === "recovery" ? "Recovery code" : "Code"}</span>
          <span className="lp-input">
            <KeyRound size={17} />
            <input
              key={mode}
              autoFocus
              required
              autoComplete="one-time-code"
              inputMode={mode === "recovery" ? "text" : "numeric"}
              maxLength={mode === "recovery" ? 12 : 7}
              value={code}
              onChange={(e) => setCode(mode === "recovery" ? e.target.value : e.target.value.replace(/[^\d ]/g, ""))}
              placeholder={mode === "recovery" ? "xxxx-xxxx" : "123 456"}
            />
          </span>
        </label>
      )}
      {mode === "recovery" && <p className="lp-help">Each code works once. After signing in, move two-step verification to your new phone in Settings.</p>}

      {mode === "help" && (
        <>
          <label className="lp-field">
            <span>What happened? (optional)</span>
            <span className="lp-input">
              <textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. My phone was stolen and I can't find my recovery codes" />
            </span>
          </label>
          <p className="lp-help">They'll confirm it's really you, for example by phone or in person, before resetting anything. Nobody will ever ask you for your password.</p>
        </>
      )}

      {mode === "helpSent" && <p className="lp-help lp-help-strong">Once an administrator has reset it, sign in with your password and set up two-step verification again: on a new phone, or with a passkey. Found a recovery code in the meantime? You can still use it.</p>}

      {error && (
        <p className="lp-error" role="alert">
          {error}
        </p>
      )}
      {mode !== "helpSent" && (
        <button type="submit" className="lp-submit" disabled={busy}>
          {mode === "passkey" ? (
            busy ? (
              "Waiting for your device…"
            ) : (
              <>
                <Fingerprint size={18} /> Use passkey
              </>
            )
          ) : mode === "help" ? (
            busy ? (
              "Sending…"
            ) : (
              "Send request"
            )
          ) : busy ? (
            "Checking…"
          ) : (
            <>
              Verify <ArrowRight size={18} />
            </>
          )}
        </button>
      )}
      {links}
    </form>
  );
}
/** @typedef {"app" | "passkey" | "recovery" | "help" | "helpSent"} Mode */
/**
 * @typedef {Object} Methods
 * @property {boolean} app
 * @property {boolean} passkey
 */
