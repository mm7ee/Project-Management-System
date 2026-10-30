import { useEffect, useState } from "react";
import { ArrowRight, BellRing, FileBarChart, Fingerprint, KeyRound, LifeBuoy, LockKeyhole, Radio, ShieldCheck, UserRound } from "lucide-react";
import { ApiError, api } from "../data/api";
import { passkeysSupported, signWithPasskey } from "../data/passkeys";
import { COMPANY_URL } from "../brand";
import ParticleField from "./ParticleField";
import "./landing.css";

const STAGES = ["Idea", "Build", "Deploy", "Live"];
const WORDS = ["idea", "build", "testing", "deploy"];
const FEATURES = [
  { icon: Radio, label: "Live progress" },
  { icon: ShieldCheck, label: "Role-based access" },
  { icon: BellRing, label: "Update requests" },
  { icon: FileBarChart, label: "Instant reports" },
];

/** Cycles through WORDS for the headline. */
function useRotatingWord(ms = 2200) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % WORDS.length), ms);
    return () => clearInterval(id);
  }, [ms]);
  return i;
}

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set once the password checked out for an account with two-step verification.
  const [ticket, setTicket] = useState<string | null>(null);
  const [methods, setMethods] = useState<Methods>({ app: true, passkey: false });
  const word = useRotatingWord();

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
      <div className="lp-floor" aria-hidden="true" />
      <ParticleField className="lp-particles" />

      <header className="lp-top">
        <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="logo-link" title="Omni Contact website">
          <img src="/omni-logo-white.png" alt="Omni Contact" />
        </a>
        <span className="lp-status">
          <i /> Systems team · Projects Tracker
        </span>
      </header>

      <main className="lp-main">
        <section className="lp-hero">
          <span className="lp-eyebrow lp-in" style={{ animationDelay: "0.05s" }}>
            <span className="lp-dot" /> Pulse
          </span>
          <h1 className="lp-in" style={{ animationDelay: "0.15s" }}>
            Track every system
            <br />
            from{" "}
            <span className="lp-rotator" aria-live="polite">
              <span key={word} className="lp-word">
                {WORDS[word]}
              </span>
            </span>
            <br />
            to <span className="lp-grad">live.</span>
          </h1>
          <p className="lp-lede lp-in" style={{ animationDelay: "0.25s" }}>
            One place for the Omni Contact systems team to follow progress, reach project leads, request updates and
            report on every build.
          </p>

          <div className="lp-pipeline lp-in" style={{ animationDelay: "0.35s" }} aria-label="Idea, build, deploy, live">
            <div className="lp-track">
              <span className="lp-pulse" />
            </div>
            {STAGES.map((s, i) => (
              <div key={s} className="lp-stage" style={{ ["--i" as string]: i }}>
                <span className="lp-node" />
                <span className="lp-stage-label">{s}</span>
              </div>
            ))}
          </div>

          <ul className="lp-features lp-in" style={{ animationDelay: "0.45s" }}>
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label}>
                <Icon size={16} /> {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-panel lp-in" style={{ animationDelay: "0.3s" }}>
          <div className="lp-orbits" aria-hidden="true">
            <span className="lp-orbit o1">
              <i />
            </span>
            <span className="lp-orbit o2">
              <i />
            </span>
            <span className="lp-orbit o3">
              <i />
            </span>
          </div>

          {ticket ? (
            <SecondStep ticket={ticket} methods={methods} onSignedIn={onSignedIn} onBack={backToPassword} />
          ) : (
          <form
            className="lp-card"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const r = await api<{ ok?: boolean; mfa?: boolean; ticket?: string; methods?: Methods }>("/login", "POST", { username, password });
                if (r.mfa && r.ticket) {
                  setMethods(r.methods ?? { app: true, passkey: false });
                  setTicket(r.ticket);
                  setBusy(false);
                  return;
                }
                onSignedIn();
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

            <label className="lp-field">
              <span>Username</span>
              <span className="lp-input">
                <UserRound size={17} />
                <input
                  autoFocus
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. mutsa"
                />
              </span>
            </label>
            <label className="lp-field">
              <span>Password</span>
              <span className="lp-input">
                <LockKeyhole size={17} />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </span>
            </label>
            {error && (
              <p className="lp-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="lp-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"} {!busy && <ArrowRight size={18} />}
            </button>
            <p className="lp-help">
              Need an account? Ask your Pulse administrator. Never share your password, including with the IT helpdesk.
            </p>
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

interface Methods {
  app: boolean;
  passkey: boolean;
}

/** Set after signing in with a recovery code, so the app can suggest moving to a new phone. */
export const RECOVERY_SIGNIN = "omnitrack:recovery-signin";

/**
 * The second sign-in step. Offers whichever methods the account has (authenticator app,
 * passkey or security key), recovery codes for a lost phone, and, when nothing is left, a
 * request to an administrator.
 */
function SecondStep({ ticket, methods, onSignedIn, onBack }: { ticket: string; methods: Methods; onSignedIn: () => void; onBack: (message?: string) => void }) {
  type Mode = "app" | "passkey" | "recovery" | "help" | "helpSent";
  const canPasskey = methods.passkey && passkeysSupported();
  const [mode, setMode] = useState<Mode>(methods.app ? "app" : canPasskey ? "passkey" : "recovery");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (m: Mode) => {
    setMode(m);
    setCode("");
    setError("");
  };
  const attempt = async (fn: () => Promise<void>) => {
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
      const options = await api<{ challenge: string; rpId: string; allow: string[] }>("/login/passkey/options", "POST", { ticket });
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
              <textarea
                rows={3}
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. My phone was stolen and I can't find my recovery codes"
              />
            </span>
          </label>
          <p className="lp-help">They'll confirm it's really you, for example by phone or in person, before resetting anything. Nobody from Pulse will ever ask for your password.</p>
        </>
      )}

      {mode === "helpSent" && (
        <p className="lp-help lp-help-strong">
          Once an administrator has reset it, sign in with your password and set up two-step verification again: on a new phone, or with a passkey. Found a recovery code in the meantime? You can still use it.
        </p>
      )}

      {error && (
        <p className="lp-error" role="alert">
          {error}
        </p>
      )}
      {mode !== "helpSent" && (
        <button type="submit" className="lp-submit" disabled={busy}>
          {mode === "passkey" ? (
            busy ? "Waiting for your device…" : <><Fingerprint size={18} /> Use passkey</>
          ) : mode === "help" ? (
            busy ? "Sending…" : "Send request"
          ) : busy ? (
            "Checking…"
          ) : (
            <>Verify <ArrowRight size={18} /></>
          )}
        </button>
      )}
      {links}
    </form>
  );
}
