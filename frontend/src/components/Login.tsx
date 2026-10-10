import { useEffect, useState } from "react";
import { ArrowRight, BellRing, FileBarChart, LockKeyhole, Radio, ShieldCheck, UserRound } from "lucide-react";
import { api } from "../data/api";
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
  const word = useRotatingWord();

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
            <span className="lp-dot" /> OmniTrack
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

          <form
            className="lp-card"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/login", "POST", { username, password });
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
                <p>Sign in to OmniTrack</p>
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
            <p className="lp-help">Need an account? Ask your OmniTrack administrator.</p>
          </form>
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
