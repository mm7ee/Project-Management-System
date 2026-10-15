import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  Moon,
  Orbit,
  Palette,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import { api } from "../data/api";
import MfaSetup, { RecoveryCodes } from "./MfaSetup";
import PasswordRules from "./PasswordRules";
import { PASSWORD_MIN, passwordProblem } from "../data/password";
import { initials, type System } from "../data/systems";
import { PERMISSIONS, ROLE_LABEL, type Permission, type Prefs, type User } from "../data/roles";

interface Props {
  me: User;
  prefs: Prefs;
  permissions: Permission[];
  projects: System[]; // assigned to or led by this user
  mfaRequired: boolean; // an administrator requires two-step verification for this role
  recoveryCodesLeft: number;
  onPrefs: (p: Prefs) => Promise<void>;
  onProfileSaved: () => Promise<void>;
  onSignedOut: () => void;
}

function Section({ icon, title, sub, children }: { icon: ReactNode; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="set-card">
      <header className="set-head">
        <span className="set-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  );
}


export default function SettingsPage({ me, prefs, permissions, projects, mfaRequired, recoveryCodesLeft, onPrefs, onProfileSaved, onSignedOut }: Props) {
  const [saved, setSaved] = useState(false);
  const [email, setEmail] = useState(me.email ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(id);
  }, [saved]);

  const setPref = async <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    await onPrefs({ ...prefs, [k]: v });
    setSaved(true);
  };

  const startOptions = [
    { value: "ALL", label: "All projects" },
    ...(projects.length ? [{ value: "MINE", label: "Assigned to me" }] : []),
    { value: "LIVE", label: "Live" },
    { value: "WIP", label: "In progress" },
    { value: "TESTING", label: "Testing" },
    { value: "MAINTENANCE", label: "Maintenance" },
    { value: "OVERDUE", label: "Overdue" },
    { value: "REQUESTED", label: "Update requests" },
  ];

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Preferences are saved to your account, so they follow you to any device.</p>
        </div>
        <span className={`saved-tick ${saved ? "show" : ""}`} aria-live="polite">
          {saved && (
            <>
              <Check size={15} /> Saved
            </>
          )}
        </span>
      </header>

      <div className="set-grid">
        <Section icon={<UserRound size={18} />} title="Profile" sub="Your contact details power the Email, Teams, WhatsApp and Call buttons when you lead a project.">
          <div className="set-profile">
            <span className="avatar xl">{initials(me.name)}</span>
            <div>
              <b>{me.name}</b>
              <span>
                {ROLE_LABEL[me.role]} · {me.username}
              </span>
              {projects.length > 0 && <span>Assigned to: {projects.map((s) => s.name).join(", ")}</span>}
            </div>
          </div>
          <form
            className="set-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/me", "PATCH", { email, phone });
                await onProfileSaved();
                setProfileMsg({ ok: true, text: "Contact details saved." });
              } catch (err) {
                setProfileMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save" });
              }
            }}
          >
            <div className="field-row">
              <label className="field">
                <span>Work email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name.surname@omnicontact.biz" />
              </label>
              <label className="field">
                <span>Phone (adds WhatsApp + Call)</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263 77 123 4567" />
              </label>
            </div>
            {profileMsg && <p className={profileMsg.ok ? "form-ok" : "form-error"}>{profileMsg.text}</p>}
            <button type="submit" className="btn btn-navy">
              Save contact details
            </button>
          </form>
        </Section>

        <Section icon={<Palette size={18} />} title="Appearance">
          <div className="set-row">
            <div>
              <b>Theme</b>
              <span>Dark is easier on the eyes; Futuristic brings the landing page's look to the dashboard.</span>
            </div>
            <Choice
              label="Theme"
              value={prefs.theme}
              onChange={(v) => setPref("theme", v)}
              options={[
                { value: "light", label: "Light", icon: <Sun size={15} /> },
                { value: "dark", label: "Dark", icon: <Moon size={15} /> },
                { value: "futuristic", label: "Futuristic", icon: <Orbit size={15} /> },
                { value: "system", label: "Device", icon: <MonitorSmartphone size={15} /> },
              ]}
            />
          </div>
          <div className="set-row">
            <div>
              <b>Animations</b>
              <span>Reduced turns off count-ups, shimmer, pulses and slide-ins.</span>
            </div>
            <Choice
              label="Animations"
              value={prefs.motion}
              onChange={(v) => setPref("motion", v)}
              options={[
                { value: "full", label: "Full", icon: <Sparkles size={15} /> },
                { value: "reduced", label: "Reduced" },
              ]}
            />
          </div>
          <div className="set-row">
            <div>
              <b>Card density</b>
              <span>Compact fits more projects on screen.</span>
            </div>
            <Choice
              label="Card density"
              value={prefs.density}
              onChange={(v) => setPref("density", v)}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </div>
        </Section>

        <Section icon={<LayoutDashboard size={18} />} title="Dashboard">
          <div className="set-row">
            <div>
              <b>Start section</b>
              <span>What the dashboard opens on after you sign in.</span>
            </div>
            <select className="set-select" value={prefs.start} onChange={(e) => setPref("start", e.target.value)} aria-label="Start section">
              {startOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section
          icon={<KeyRound size={18} />}
          title="Password"
          sub="Never share your password with anyone, including the IT helpdesk. OmniTrack staff will never ask for it."
        >
          <form
            className="set-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (next !== confirm) return setPwMsg({ ok: false, text: "The new passwords don't match." });
              if (passwordProblem(next, me)) return setPwMsg({ ok: false, text: passwordProblem(next, me)! });
              try {
                await api("/me/password", "POST", { current, next });
                setPwMsg({ ok: true, text: "Password changed." });
                setCurrent("");
                setNext("");
                setConfirm("");
              } catch (err) {
                setPwMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't change password" });
              }
            }}
          >
            <label className="field">
              <span>Current password</span>
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>New password</span>
                <input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={next} onChange={(e) => setNext(e.target.value)} />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
            </div>
            <PasswordRules password={next} who={me} showReuse />
            <p className="set-note">Use a password you don't use for any other system.</p>
            {pwMsg && <p className={pwMsg.ok ? "form-ok" : "form-error"}>{pwMsg.text}</p>}
            <button type="submit" className="btn btn-navy" disabled={!!passwordProblem(next, me) || next !== confirm}>
              Change password
            </button>
          </form>
        </Section>

        <TwoStepSection me={me} required={mfaRequired} recoveryCodesLeft={recoveryCodesLeft} onChanged={onProfileSaved} />

        <Section icon={<ShieldCheck size={18} />} title="Your access" sub={`What the ${ROLE_LABEL[me.role]} role can do. An administrator manages roles.`}>
          <ul className="perm-list plain">
            <li className="perm-item">
              <Check size={14} /> View all systems and their progress
            </li>
            {PERMISSIONS.filter((p) => permissions.includes(p.key)).map((p) => (
              <li key={p.key} className="perm-item">
                <Check size={14} /> {p.label}
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={<LogOut size={18} />} title="Sign out">
          <div className="set-actions">
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await api("/logout", "POST").catch(() => undefined);
                onSignedOut();
              }}
            >
              <LogOut size={16} /> Sign out
            </button>
            {confirmAll ? (
              <span className="confirm-inline-row">
                Sign out on every device, including this one?
                <button className="btn btn-ghost sm" onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger sm"
                  onClick={async () => {
                    await api("/logout-all", "POST").catch(() => undefined);
                    onSignedOut();
                  }}
                >
                  Sign out everywhere
                </button>
              </span>
            ) : (
              <button className="btn btn-danger" onClick={() => setConfirmAll(true)}>
                Sign out of all devices
              </button>
            )}
          </div>
          <p className="set-note">Use “all devices” if you signed in on a shared or lost computer.</p>
        </Section>
      </div>
    </div>
  );
}

/** Turn two-step verification on or off, and replace recovery codes. */
function TwoStepSection({ me, required, recoveryCodesLeft, onChanged }: { me: User; required: boolean; recoveryCodesLeft: number; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<"idle" | "setup" | "disable" | "codes">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reset = () => {
    setMode("idle");
    setPassword("");
    setCode("");
    setFresh(null);
  };
  const attempt = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    }
  };

  return (
    <Section
      icon={<Smartphone size={18} />}
      title="Two-step verification"
      sub="Sign in with your password and a code from an authenticator app, so a stolen password alone can't get in."
    >
      {me.mfaEnabled ? (
        <>
          <p className="form-ok">
            <ShieldCheck size={16} /> On · {recoveryCodesLeft} recovery code{recoveryCodesLeft === 1 ? "" : "s"} left
            {required && " · required for your role"}
          </p>
          {recoveryCodesLeft <= 3 && mode === "idle" && <p className="form-warn">You're running low on recovery codes. Make new ones below.</p>}
          {mode === "codes" && fresh ? (
            <>
              <p className="set-note">Your old recovery codes no longer work. Save these:</p>
              <RecoveryCodes codes={fresh} username={me.username} />
              <button className="btn btn-navy" onClick={() => onChanged().then(reset)}>
                Done
              </button>
            </>
          ) : mode === "codes" || mode === "disable" ? (
            <form
              className="set-form"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(async () => {
                  if (mode === "codes") {
                    setFresh((await api<{ recoveryCodes: string[] }>("/me/mfa/recovery", "POST", { code })).recoveryCodes);
                  } else {
                    await api("/me/mfa/disable", "POST", { password, code });
                    await onChanged();
                    reset();
                    setMsg({ ok: true, text: "Two-step verification is off." });
                  }
                });
              }}
            >
              {mode === "disable" && (
                <label className="field">
                  <span>Your password</span>
                  <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
              <label className="field">
                <span>{mode === "codes" ? "Current code from your app" : "Code from your app (or a recovery code)"}</span>
                <input autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
              </label>
              <div className="page-actions">
                <button type="submit" className={`btn ${mode === "disable" ? "btn-danger" : "btn-navy"}`}>
                  {mode === "disable" ? "Turn off" : "Make new codes"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="page-actions">
              <button className="btn btn-ghost" onClick={() => setMode("codes")}>
                <KeyRound size={15} /> New recovery codes
              </button>
              {!required && (
                <button className="btn btn-ghost danger-text" onClick={() => setMode("disable")}>
                  Turn off
                </button>
              )}
            </div>
          )}
        </>
      ) : mode === "setup" ? (
        <MfaSetup
          username={me.username}
          onCancel={reset}
          onDone={() =>
            onChanged().then(() => {
              reset();
              setMsg({ ok: true, text: "Two-step verification is on. You'll be asked for a code next time you sign in." });
            })
          }
        />
      ) : (
        <>
          <p className="set-note">Off. Anyone with your password can sign in as you.</p>
          <button className="btn btn-navy" onClick={() => setMode("setup")}>
            <ShieldCheck size={16} /> Turn on
          </button>
        </>
      )}
      {msg && <p className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</p>}
    </Section>
  );
}
