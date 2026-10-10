import { useState } from "react";
import { LogIn } from "lucide-react";
import { api } from "../data/api";
import { COMPANY_URL } from "../brand";

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-page">
      <form
        className="login-card"
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
        <div className="login-brand">
          <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="logo-link" title="Omni Contact website">
            <img src="/omni-logo-white.png" alt="Omni Contact" />
          </a>
          <span>OmniTrack</span>
        </div>
        <div className="login-body">
          <h1>Sign in</h1>
          <p>Projects Tracker</p>

          <label className="field">
            <span>Username</span>
            <input autoFocus autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-amber block" disabled={busy}>
            <LogIn size={17} /> {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
