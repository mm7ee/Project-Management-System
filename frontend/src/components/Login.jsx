import { useEffect, useState } from "react";
/** @import { Tenant } from '../data/api' */
import { ArrowRight, BellRing, Building2, FileBarChart, Fingerprint, KeyRound, Layers, LifeBuoy, LockKeyhole, Radio, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { ApiError, api } from "../data/api";
import { cleanCode, forgetOrg, initialOrgCode, lastWorkspace, rememberOrg, rememberWorkspace } from "../data/tenant";
import { passkeysSupported, signWithPasskey } from "../data/passkeys";
import { COMPANY_URL } from "../brand";
import PulseMark from "./PulseMark";
import { ForgotPassword, ResetPassword } from "./PasswordReset";
import { resetTokenIn } from "../data/passwordReset";
import "./landing.css";
// The lifecycle as one heartbeat trace: each beat is stronger as a project comes to life.
const STAGES = [
  { label: "Idea", height: 10 },
  { label: "Build", height: 16 },
  { label: "Test", height: 22 },
  { label: "Deploy", height: 28 },
  { label: "Live", height: 36 },
];
const TRACE_W = 520;
const TRACE_MID = 44;
const SLOT = TRACE_W / STAGES.length;
const TRACE =
  STAGES.reduce((d, { height }, i) => {
    const x = SLOT * i + SLOT / 2;
    return `${d} H${x - 16} L${x - 8} ${TRACE_MID + height * 0.2} L${x} ${TRACE_MID - height} L${x + 8} ${TRACE_MID + height * 0.45} L${x + 16} ${TRACE_MID}`;
  }, `M0 ${TRACE_MID}`) + ` H${TRACE_W}`;
const TRACE_SECONDS = 5; // keep in step with lp-trace-run and lp-stage-lit in landing.css
const TRACE_DASH = 0.16;
/** How far through its loop the travelling signal reaches stage i (0–1). */
const stagePhase =
  /** @param {number} i
   * @returns {number}
   */ (i) => (((i + 0.5) / STAGES.length - TRACE_DASH) / (1 + TRACE_DASH) + 1) % 1;
const FEATURES = [
  { icon: Radio, label: "Live progress" },
  { icon: ShieldCheck, label: "Role-based access" },
  { icon: BellRing, label: "Update requests" },
  { icon: FileBarChart, label: "Instant reports" },
];
// Real questions Ask Pulse answers from the live data.
const AI_QUESTIONS = ["Which projects are blocked or stalled, and why?", "What's due in the next 30 days?", "Who has the most projects right now?"];
/**
 */
function PulseAI() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setShown((i) => (i + 1) % AI_QUESTIONS.length), 4000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="lp-ai lp-in" style={{ animationDelay: "0.55s" }}>
      <span className="lp-ai-icon" aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <div>
        <strong>Pulse AI</strong>
        <p>Ask Pulse in plain English, answered from the live data.</p>
        <q key={shown}>{AI_QUESTIONS[shown]}</q>
      </div>
    </div>
  );
}
/**
 * @param {{ onSignedIn: () => void }} arg1
 */
export default function Login({ onSignedIn }) {
  // Which organisation: from a link (#/o/<code>), else the last one used on this device, else asked first.
  // The code isn't checked on its own (that would let anyone test codes); it goes with the password, and a wrong
  // code gets the same message as a wrong password.
  const [orgCode, setOrgCode] = useState(initialOrgCode);
  const [orgDraft, setOrgDraft] = useState("");
  // After signing in, someone in several workspaces chooses which to open.
  const [choices, setChoices] = useState(/** @type {Tenant | null} */ (null));
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
  useEffect(() => {
    // A reset link opened in a tab that already shows the sign-in page.
    const onHash = () => {
      const t = resetTokenIn(window.location.hash);
      if (t) setResetToken(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
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
  return (
    <div className="landing">
      <div className="lp-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-paper" aria-hidden="true" />

      <header className="lp-top">
        <span className="lp-brand">
          <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="logo-link" title="Omni Contact website">
            <img src="/omni-logo-white.png" alt="Omni Contact" />
          </a>
          <PulseMark />
        </span>
        <span className="lp-status">
          <i /> Systems team · Projects Tracker
        </span>
      </header>

      <main className="lp-main">
        <section className="lp-hero">
          <h1 className="lp-in" style={{ animationDelay: "0.1s" }}>
            Every project
            <br />
            has a <span className="lp-beat">pulse.</span>
          </h1>
          <p className="lp-lede lp-in" style={{ animationDelay: "0.2s" }}>
            The live heartbeat of Omni Contact's projects. Follow every build from idea to live, catch what's stalling before it flatlines, and report on all of it in one click.
          </p>

          <div className="lp-vitals lp-in" style={{ animationDelay: "0.3s" }} role="img" aria-label="Idea, build, test, deploy, live">
            <svg viewBox={`0 0 ${TRACE_W} 62`} aria-hidden="true">
              <path className="lp-trace-base" d={TRACE} pathLength={1} />
              <path className="lp-trace-run" d={TRACE} pathLength={1} />
            </svg>
            <ol>
              {STAGES.map((st, i) => (
                <li key={st.label} style={{ animationDelay: `${(stagePhase(i) - 1) * TRACE_SECONDS}s` }}>
                  {st.label}
                </li>
              ))}
            </ol>
          </div>

          <ul className="lp-features lp-in" style={{ animationDelay: "0.45s" }}>
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label}>
                <Icon size={16} /> {label}
              </li>
            ))}
          </ul>

          <PulseAI />
        </section>

        <section className="lp-panel lp-in" style={{ animationDelay: "0.3s" }}>
          {/* Rings ripple out from behind the card, like a heartbeat. */}
          <div className="lp-ripples" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          {resetToken ? (
            <ResetPassword token={resetToken} onDone={() => leaveReset("Your password has been changed and every device signed out. Sign in with your new password.", true)} onBack={(m) => leaveReset(m)} />
          ) : choices ? (
            <ChooseWorkspace tenant={choices} onChosen={onSignedIn} />
          ) : !orgCode ? (
            <form
              className="lp-card"
              onSubmit={(e) => {
                e.preventDefault();
                const code = cleanCode(orgDraft);
                if (!code) {
                  setError("Enter your organisation's code: letters, numbers and dashes, as your administrator gave it to you.");
                  return;
                }
                setError("");
                setOrgCode(code);
              }}
            >
              <div className="lp-card-head">
                <span className="lp-card-icon">
                  <Building2 size={20} />
                </span>
                <div>
                  <h2>Welcome</h2>
                  <p>Which organisation are you signing in to?</p>
                </div>
              </div>
              <label className="lp-field">
                <span>Organisation code</span>
                <span className="lp-input">
                  <Building2 size={17} />
                  <input autoFocus autoComplete="organization" autoCapitalize="none" spellCheck={false} required value={orgDraft} onChange={(e) => setOrgDraft(e.target.value)} placeholder="e.g. omnicontact" aria-describedby="org-help" />
                </span>
              </label>
              <p className="lp-help" id="org-help">
                Your administrator gives you this code, or a sign-in link with it. This device remembers it.
              </p>
              {error && (
                <p className="lp-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="lp-submit">
                Continue <ArrowRight size={18} />
              </button>
            </form>
          ) : forgot ? (
            <ForgotPassword initial={username} organization={orgCode} onBack={() => leaveReset()} />
          ) : ticket ? (
            <SecondStep ticket={ticket} methods={methods} onSignedIn={finish} onBack={backToPassword} />
          ) : (
            <form
              className="lp-card"
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
              <div className="lp-card-head">
                <span className="lp-card-icon">
                  <LockKeyhole size={20} />
                </span>
                <div>
                  <h2>Welcome back</h2>
                  <p>Sign in to Pulse</p>
                </div>
              </div>
              <p className="lp-org">
                <Building2 size={15} aria-hidden="true" /> Organisation <b>{orgCode}</b>
                <button
                  type="button"
                  className="lp-link"
                  onClick={() => {
                    forgetOrg();
                    setOrgDraft(orgCode);
                    setOrgCode("");
                    setError("");
                    setNotice("");
                  }}
                >
                  Change
                </button>
              </p>

              <label className="lp-field">
                <span>Username</span>
                <span className="lp-input">
                  <UserRound size={17} />
                  <input autoFocus autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. mutsa" />
                </span>
              </label>
              <label className="lp-field">
                <span>Password</span>
                <span className="lp-input">
                  <LockKeyhole size={17} />
                  <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </span>
              </label>
              {notice && (
                <p className="lp-ok" role="status">
                  {notice}
                </p>
              )}
              {error && (
                <p className="lp-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="lp-submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"} {!busy && <ArrowRight size={18} />}
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
              <p className="lp-help">Need an account? Ask your Pulse administrator. Never share your password, including with the IT helpdesk.</p>
            </form>
          )}
        </section>
      </main>

      <footer className="lp-foot">
        © {new Date().getFullYear()} Omni Contact ·{" "}
        <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer">
          omnicontact.biz
        </a>
      </footer>
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
 * @type {"omnitrack:recovery-signin"}
 */
export const RECOVERY_SIGNIN = "omnitrack:recovery-signin";
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
          <p className="lp-help">They'll confirm it's really you, for example by phone or in person, before resetting anything. Nobody from Pulse will ever ask for your password.</p>
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
