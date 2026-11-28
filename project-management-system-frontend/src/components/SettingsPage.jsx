/** @import { ReactNode } from 'react' */
/** @import { LucideIcon } from 'lucide-react' */
/** @import { Passkey, TwoStep } from '../data/api' */
/** @import { RegisterOptions } from '../data/passkeys' */
/** @import { System } from '../data/systems' */
/** @import { Permission, Prefs, User } from '../data/roles' */
import { BRAND } from "../data/brand";
import { useEffect, useRef, useState } from "react";
import { Archive, Bell, Check, Eye, Fingerprint, KeyRound, LayoutDashboard, LifeBuoy, LogOut, MonitorSmartphone, Moon, Palette, Plus, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Sparkles, Sun, UserRound } from "lucide-react";
import { api } from "../data/api";
import { createPasskey, passkeysSupported } from "../data/passkeys";
import { RECOVERY_SIGNIN } from "./Login";
import { formatDate, plural } from "../time";
import { useHistoryTab } from "../history";
import MfaSetup, { RecoveryCodes } from "./MfaSetup";
import PasswordRules from "./PasswordRules";
import { PASSWORD_MIN, passwordProblem } from "../data/password";
import { initials } from "../data/systems";
import { PERMISSIONS, ROLE_LABEL } from "../data/roles";
import { Choice, Section } from "./SettingsParts";
import { InstallSection, NotificationPrefs } from "./NotificationSettings";
import { ApiTokensSection, NotificationOptOuts } from "./AdminSettings";
import { RETENTION } from "../data/retention";
const PAGE_STORE = "pms:settings-page"; // the page last opened, per browser
/** @type {Record<Prefs["glass"], string>} */ const GLASS_LABEL = { 1: "See-through", 2: "Frosted", 3: "Heavy frost", 4: "Nearly solid", 5: "Solid" };
/**
 * @param {Props} props
 */
export default function SettingsPage({ me, prefs, permissions, projects, mfaRequired, recoveryCodesLeft, twoStep, viewOnly, onPrefs, onProfileSaved, onSignedOut, signOutJump = 0, adminPages = [], openPage, onPage }) {
  const [saved, setSaved] = useState(false);
  const [email, setEmail] = useState(me.email ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [profileMsg, setProfileMsg] = useState(/** @type {{ ok: boolean; text: string } | null | (() => { ok: boolean; text: string } | null)} */ (null));
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState(/** @type {{ ok: boolean; text: string } | null | (() => { ok: boolean; text: string } | null)} */ (null));
  const [confirmAll, setConfirmAll] = useState(false);
  const [flash, setFlash] = useState(false);
  /** @type {SettingsPageInfo[]} */ const pages = viewOnly
    ? [
        { key: "appearance", label: "Appearance", icon: Palette },
        { key: "phone", label: "Phone app", icon: Smartphone },
        { key: "link", label: "About this link", icon: Eye },
      ]
    : [
        { key: "profile", label: "Profile", icon: UserRound },
        { key: "appearance", label: "Appearance", icon: Palette },
        { key: "notifications", label: "Notifications", icon: Bell },
        {
          key: "security",
          label: "Security & privacy",
          icon: ShieldCheck,
          // (When two-step is required but missing, PMS shows its setup screen instead of Settings.)
          alert: twoStep.app && recoveryCodesLeft < 3 ? "You're running low on recovery codes" : undefined,
        },
        { key: "phone", label: "Phone app", icon: Smartphone },
      ];
  const everyPage = [...pages, ...adminPages];
  // The open page is a browser-history step: Back returns to the page you were on.
  const [page, goPage, setPage] = useHistoryTab("settings", () => {
    try {
      return openPage ?? localStorage.getItem(PAGE_STORE) ?? "profile";
    } catch {
      return openPage ?? "profile";
    }
  });
  const shown = everyPage.some((p) => p.key === page) ? page : pages[0].key;
  const admin = adminPages.find((p) => p.key === shown);
  const go = /** @param {string} key */ (key) => {
    goPage(key);
    onPage?.(key);
    try {
      localStorage.setItem(PAGE_STORE, key);
    } catch {
      // Remembering the page is only a convenience.
    }
  };
  // Another part of PMS asked for a page (e.g. the dashboard's Rebalance banner opens Users).
  useEffect(() => {
    if (openPage) setPage(openPage);
  }, [openPage]);
  // On a phone the menu scrolls sideways: keep the open page's button in view.
  const navRef = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => {
    const nav = navRef.current;
    const on = /** @type {HTMLElement | null | undefined} */ (/** @type {unknown} */ (nav?.querySelector("button.on")));
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
  }, [shown]);
  // "Sign out" in the sidebar's profile card opens Security & privacy and points at Sessions.
  useEffect(() => {
    if (!signOutJump) return;
    setPage("security");
    const scroll = setTimeout(() => document.getElementById("settings-sessions")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 1600);
    return () => {
      clearTimeout(scroll);
      clearTimeout(id);
    };
  }, [signOutJump]);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(id);
  }, [saved]);
  const setPref = /** @template {keyof Prefs} K @param {K} k @param {Prefs[K]} v */ async (k, v) => {
    await onPrefs({ ...prefs, [k]: v });
    setSaved(true);
  };
  const startOptions = [
    { value: "DASHBOARD", label: "Dashboard" },
    { value: "ALL", label: "All projects" },
    { value: "BLOCKED", label: "Blocked / stalled" },
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
          <p>{viewOnly ? "Display settings for this view-only link, saved in this browser only." : adminPages.length ? "Your own preferences follow you to any device. Administration changes it for everyone." : "Preferences are saved to your account, so they follow you to any device."}</p>
        </div>
        <span className={`saved-tick ${saved ? "show" : ""}`} aria-live="polite">
          {saved && (
            <>
              <Check size={15} /> Saved
            </>
          )}
        </span>
      </header>

      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings pages" ref={navRef}>
          {[
            { group: viewOnly ? "This link" : "Your account", items: pages },
            // Administration pages under their own headings (Organisation, This workspace, Settings), in the order given.
            ...[...new Set(adminPages.map((p) => p.group ?? "Administration"))].map((group) => ({
              group,
              items: /** @type {SettingsPageInfo[]} */ (adminPages.filter((p) => (p.group ?? "Administration") === group)),
            })),
          ]
            .filter((g) => g.items.length)
            .map(({ group, items }) => (
              <div className="set-nav-group" key={group} role="group" aria-label={group}>
                <span className="set-nav-label">{group}</span>
                {items.map(({ key, label, icon: Icon, alert }) => (
                  <button key={key} className={shown === key ? "on" : ""} aria-current={shown === key ? "page" : undefined} onClick={() => go(key)}>
                    <span className="set-nav-icon">
                      <Icon size={17} />
                    </span>
                    <b>{label}</b>
                    {alert && <i className="set-nav-dot" title={alert} aria-label={alert} />}
                  </button>
                ))}
              </div>
            ))}
        </nav>

        <div className={`set-pages ${admin ? "admin" : ""}`} key={shown}>
          {admin?.content}

          {shown === "profile" && (
            <>
              <Section icon={<UserRound size={18} />} title="Contact details" sub="Your contact details power the Email, Teams, WhatsApp and Call buttons when you lead a project.">
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
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name.surname@your-company.com" />
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
              <Section icon={<ShieldCheck size={18} />} title="Your access" sub={`What the ${ROLE_LABEL[me.role]} role can do. An administrator manages roles.`}>
                <ul className="perm-list plain">
                  <li className="perm-item">
                    <Check size={14} /> View all projects and their progress
                  </li>
                  {PERMISSIONS.filter((p) => permissions.includes(p.key)).map((p) => (
                    <li key={p.key} className="perm-item">
                      <Check size={14} /> {p.label}
                    </li>
                  ))}
                </ul>
              </Section>
            </>
          )}

          {shown === "appearance" && (
            <>
              <Section icon={<Palette size={18} />} title="Look and feel">
                <div className="set-row">
                  <div>
                    <b>Theme</b>
                    <span>Dark is easier on the eyes and brings the landing page's look to the dashboard. Device follows your computer or phone.</span>
                  </div>
                  <Choice
                    label="Theme"
                    value={prefs.theme}
                    onChange={(v) => setPref("theme", v)}
                    options={[
                      { value: "light", label: "Light", icon: <Sun size={15} /> },
                      { value: "futuristic", label: "Dark", icon: <Moon size={15} /> },
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
                <div className="set-row">
                  <div>
                    <b>Pop-up transparency</b>
                    <span>How much of the page shows through windows that open: forms, the {BRAND.assistantName} panel, menus and tooltips.</span>
                  </div>
                  <div className="glass-pick">
                    <input type="range" min={1} max={5} step={1} value={Number(prefs.glass)} onChange={(e) => setPref("glass", /** @type {Prefs["glass"]} */ (e.target.value))} aria-label="Pop-up transparency" aria-valuetext={GLASS_LABEL[prefs.glass]} />
                    <div className="glass-ends">
                      <span>See-through</span>
                      <b>{GLASS_LABEL[prefs.glass]}</b>
                      <span>Solid</span>
                    </div>
                  </div>
                </div>
              </Section>
              <Section icon={<LayoutDashboard size={18} />} title="Start page">
                <div className="set-row">
                  <div>
                    <b>Start section</b>
                    <span>{viewOnly ? "What opens first when you open this link." : "What the dashboard opens on after you sign in."}</span>
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
            </>
          )}

          {shown === "notifications" && (
            <>
              <NotificationPrefs prefs={prefs} hasEmail={!!me.email} setPref={setPref} />
              <NotificationOptOuts />
            </>
          )}

          {shown === "security" && (
            <>
              <Section icon={<KeyRound size={18} />} title="Password" sub="Never share your password with anyone, including the IT helpdesk. Administrators will never ask for it.">
                <form
                  className="set-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (next !== confirm) return setPwMsg({ ok: false, text: "The new passwords don't match." });
                    if (passwordProblem(next, me)) return setPwMsg({ ok: false, text: /** @type {string} */ (passwordProblem(next, me)) });
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
                  <PasswordRules password={next} confirm={confirm} who={me} showReuse />
                  <p className="set-note">Use a password you don't use anywhere else.</p>
                  {pwMsg && <p className={pwMsg.ok ? "form-ok" : "form-error"}>{pwMsg.text}</p>}
                  <button type="submit" className="btn btn-navy" disabled={!!passwordProblem(next, me) || next !== confirm}>
                    Change password
                  </button>
                </form>
              </Section>
              <TwoStepSection me={me} required={mfaRequired} recoveryCodesLeft={recoveryCodesLeft} twoStep={twoStep} onChanged={onProfileSaved} />

              <Section id="settings-sessions" flash={flash} icon={<MonitorSmartphone size={18} />} title="Signed-in devices" sub="You're signed in on this device. Sign out of all devices if you used a shared or lost computer.">
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
              </Section>

              <ApiTokensSection canUse={permissions.includes("use_api")} isAdmin={permissions.includes("manage_users")} />

              <Section icon={<Archive size={18} />} title="Data retention" sub="How long each kind of record is kept. Anything older is deleted automatically.">
                <dl className="retention-list">
                  {RETENTION.map((r) => (
                    <div key={r.what}>
                      <dt>{r.what}</dt>
                      <dd>{r.kept}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            </>
          )}

          {shown === "phone" && <InstallSection />}

          {shown === "link" && viewOnly && (
            <Section icon={<Eye size={18} />} title="About this link" sub="You're browsing this workspace through a view-only link.">
              <ul className="perm-list plain">
                <li className="perm-item">
                  <Check size={14} /> See the dashboard, projects, feature requests, Concept Notes and reports, live
                </li>
                <li className="perm-item">
                  <Check size={14} /> Ask {BRAND.assistantName} questions about the work
                </li>
                <li className="perm-item">
                  <Check size={14} /> Request updates on projects (open a project, then Request update)
                </li>
                <li className="perm-item">
                  <Check size={14} /> Change how it looks here (saved in this browser only)
                </li>
              </ul>
              <p className="set-note">Apart from requesting updates, nothing can be changed through this link ({viewOnly.label}). To update projects, ask your administrator for an account.</p>
            </Section>
          )}
        </div>
      </div>
      {/* About: inside an organisation's space, the product is named only here, quietly. */}
      <p className="powered-by settings-about">
        {BRAND.poweredBy}
        {BRAND.supportEmail && (
          <>
            {" · "}
            <a href={`mailto:${BRAND.supportEmail}`}>Platform support</a>
          </>
        )}
      </p>
    </div>
  );
}
/**
 * Two-step verification: an authenticator app and/or passkeys, recovery codes, and what to do
 * when a phone is lost (move to a new phone, or remove it straight away).
 * @param {{
 *   me: User;
 *   required: boolean;
 *   recoveryCodesLeft: number;
 *   twoStep: TwoStep;
 *   onChanged: () => Promise<void>;
 * }} arg3
 */
function TwoStepSection({ me, required, recoveryCodesLeft, twoStep, onChanged }) {
  const [mode, setMode] = useState(/** @type {Mode | (() => Mode)} */ ("idle"));
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [keyName, setKeyName] = useState("");
  const [target, setTarget] = useState(/** @type {Passkey | null | (() => Passkey | null)} */ (null));
  const [scan, setScan] = useState(/** @type {{ secret: string; uri: string } | null | (() => { secret: string; uri: string } | null)} */ (null));
  const [fresh, setFresh] = useState(/** @type {string[] | null | (() => string[] | null)} */ (null));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(/** @type {{ ok: boolean; text: string } | null | (() => { ok: boolean; text: string } | null)} */ (null));
  const [usedRecovery, setUsedRecovery] = useState(() => {
    try {
      return sessionStorage.getItem(RECOVERY_SIGNIN) === "1";
    } catch {
      return false;
    }
  });
  const on = twoStep.app || twoStep.passkeys.length > 0;
  const reset = () => {
    setMode("idle");
    setPassword("");
    setCode("");
    setKeyName("");
    setTarget(null);
    setScan(null);
  };
  const attempt = /** @param {() => Promise<void>} fn */ async (fn) => {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  };
  const done = /** @param {string} text @param {string[]} [codes] */ async (text, codes) => {
    await onChanged();
    reset();
    if (codes?.length) setFresh(codes);
    setMsg({ ok: true, text });
    try {
      sessionStorage.removeItem(RECOVERY_SIGNIN);
    } catch {
      // Only a reminder.
    }
    setUsedRecovery(false);
  };
  const passwordField = (
    <label className="field">
      <span>Your password</span>
      <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
    </label>
  );
  const codeField = /** @param {string} label */ (label) => (
    <label className="field">
      <span>{label}</span>
      <input autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456 or xxxx-xxxx" />
    </label>
  );
  const actions = /** @param {string} submit */ (submit, danger = false) => (
    <div className="page-actions">
      <button type="submit" className={`btn ${danger ? "btn-danger" : "btn-navy"}`} disabled={busy}>
        {busy ? "Working…" : submit}
      </button>
      <button type="button" className="btn btn-ghost" onClick={reset}>
        Cancel
      </button>
    </div>
  );
  // Fresh recovery codes take over the section until they're saved.
  if (fresh) {
    return (
      <Section icon={<Smartphone size={18} />} title="Two-step verification">
        <p className="set-note">
          <b>Save your new recovery codes.</b> Any old ones no longer work. Each code gets you in once if you lose your phone.
        </p>
        <RecoveryCodes codes={fresh} username={me.username} />
        <button className="btn btn-navy" onClick={() => setFresh(null)}>
          I've saved them
        </button>
      </Section>
    );
  }
  return (
    <Section icon={<Smartphone size={18} />} title="Two-step verification" sub="After your password, prove it's you with your phone or a passkey, so a stolen password alone can't get in.">
      {on ? (
        <p className="form-ok">
          <ShieldCheck size={16} /> On · {[twoStep.app && "authenticator app", twoStep.passkeys.length && plural(twoStep.passkeys.length, "passkey")].filter(Boolean).join(" + ")} · {recoveryCodesLeft} recovery code{recoveryCodesLeft === 1 ? "" : "s"} left{required && " · required for your role"}
        </p>
      ) : (
        <p className="set-note">Off. Anyone with your password can sign in as you.</p>
      )}
      {usedRecovery && <p className="form-warn">You signed in with a recovery code. If your phone is lost or stolen, remove it below and set up your new one (or add a passkey).</p>}
      {on && recoveryCodesLeft <= 3 && mode === "idle" && <p className="form-warn">You're running low on recovery codes. Make new ones below.</p>}

      {/* ---- authenticator app ---- */}
      <div className="mfa-method">
        <div className="mfa-method-head">
          <span className="mfa-method-icon">
            <Smartphone size={17} />
          </span>
          <div>
            <b>Authenticator app</b>
            <span>{twoStep.app ? "Codes from the app on your phone" : "Not set up"}</span>
          </div>
        </div>
        {mode === "setup" ? (
          <MfaSetup username={me.username} onCancel={reset} onDone={() => done("Authenticator app added.")} />
        ) : mode === "replace" ? (
          <form
            className="set-form"
            onSubmit={(e) => {
              e.preventDefault();
              attempt(async () => {
                setScan(await /** @type {Promise<{ secret: string; uri: string; }>} */ (/** @type {unknown} */ (api("/me/mfa/replace", "POST", { password, code }))));
                setMode("replaceScan");
              });
            }}
          >
            <p className="set-note">Your old phone keeps working until the new one is confirmed. Lost the old phone? Use a recovery code.</p>
            {passwordField}
            {codeField("Code from your app, or a recovery code")}
            {actions("Next: scan with the new phone")}
          </form>
        ) : mode === "replaceScan" && scan ? (
          <MfaSetup username={me.username} initial={scan} confirmLabel="Switch to this phone" onCancel={reset} onDone={(codes) => done("Moved to your new phone. The old one no longer works, and other browsers were signed out.", codes)} />
        ) : mode === "removeApp" ? (
          <form
            className="set-form"
            onSubmit={(e) => {
              e.preventDefault();
              attempt(() =>
                api("/me/mfa/app", "DELETE", { password, code }).then(() =>
                  done(twoStep.passkeys.length ? "Authenticator app removed. Your passkeys still work, and other browsers were signed out." : "Authenticator app removed and other browsers signed out. Set up your new phone or a passkey now."),
                ),
              );
            }}
          >
            <p className="set-note">
              <b>For a lost or stolen phone.</b> Codes from it stop working at once and every other browser is signed out.
            </p>
            {passwordField}
            {codeField("A recovery code (or a code from the app)")}
            {actions("Remove the app", true)}
          </form>
        ) : (
          <div className="page-actions">
            {twoStep.app ? (
              <>
                <button className="btn btn-ghost" onClick={() => setMode("replace")}>
                  <RefreshCw size={15} /> Move to a new phone
                </button>
                <button className="btn btn-ghost danger-text" onClick={() => setMode("removeApp")}>
                  <ShieldOff size={15} /> Remove (lost or stolen phone)
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setMode("setup")}>
                <Smartphone size={15} /> Set up an authenticator app
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---- passkeys and security keys ---- */}
      <div className="mfa-method">
        <div className="mfa-method-head">
          <span className="mfa-method-icon">
            <Fingerprint size={17} />
          </span>
          <div>
            <b>Passkeys and security keys</b>
            <span>Windows Hello, your phone's fingerprint or face, or a USB/NFC key. A backup that doesn't need codes.</span>
          </div>
        </div>
        {twoStep.passkeys.length > 0 && (
          <ul className="mfa-keys">
            {twoStep.passkeys.map((k) => (
              <li key={k.id}>
                <KeyRound size={15} />
                <span>
                  <b>{k.name}</b>
                  <small>
                    Added {formatDate(k.createdAt)}
                    {k.lastUsedAt ? ` · last used ${formatDate(k.lastUsedAt)}` : " · not used yet"}
                  </small>
                </span>
                {mode !== "removeKey" && (
                  <button
                    className="btn btn-ghost sm danger-text"
                    onClick={() => {
                      setTarget(k);
                      setMode("removeKey");
                    }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {mode === "removeKey" && target ? (
          <form
            className="set-form"
            onSubmit={(e) => {
              e.preventDefault();
              attempt(() => api(`/me/passkeys/${target.id}`, "DELETE", { password }).then(() => done(`Removed "${target.name}". Other browsers were signed out.`)));
            }}
          >
            <p className="set-note">
              Remove <b>{target.name}</b>? It stops working at once.
            </p>
            {passwordField}
            {actions("Remove passkey", true)}
          </form>
        ) : mode === "addKey" ? (
          <form
            className="set-form"
            onSubmit={(e) => {
              e.preventDefault();
              attempt(async () => {
                const options = await /** @type {Promise<RegisterOptions>} */ (/** @type {unknown} */ (api("/me/passkeys/options", "POST", { password })));
                const credential = await createPasskey(options);
                const r = await /** @type {Promise<{ recoveryCodes?: string[]; }>} */ (/** @type {unknown} */ (api("/me/passkeys", "POST", { name: keyName, credential })));
                await done(`Passkey "${keyName || "Passkey"}" added. You can use it at sign-in instead of a code.`, r.recoveryCodes);
              });
            }}
          >
            <label className="field">
              <span>Name it</span>
              <input required maxLength={60} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Work laptop, YubiKey" />
            </label>
            {passwordField}
            <p className="set-note">Your browser will then ask you to confirm with your fingerprint, face, PIN or security key.</p>
            {actions("Add passkey")}
          </form>
        ) : passkeysSupported() ? (
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => setMode("addKey")}>
              <Plus size={15} /> Add a passkey or security key
            </button>
          </div>
        ) : (
          <p className="set-note">This browser can't use passkeys. Try a current Edge, Chrome, Safari or Firefox.</p>
        )}
      </div>

      {/* ---- recovery codes and turning it off ---- */}
      {on && (
        <div className="mfa-method">
          <div className="mfa-method-head">
            <span className="mfa-method-icon">
              <KeyRound size={17} />
            </span>
            <div>
              <b>Recovery codes</b>
              <span>One-time codes for when you don't have your phone. Keep them somewhere safe, away from your phone.</span>
            </div>
          </div>
          {mode === "codes" || mode === "disable" ? (
            <form
              className="set-form"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(async () => {
                  if (mode === "codes") {
                    setFresh((await /** @type {Promise<{ recoveryCodes: string[]; }>} */ (/** @type {unknown} */ (api("/me/mfa/recovery", "POST", { code })))).recoveryCodes);
                    reset();
                  } else {
                    await api("/me/mfa/disable", "POST", { password, code });
                    await done("Two-step verification is off.");
                  }
                });
              }}
            >
              {mode === "disable" && passwordField}
              {codeField(mode === "codes" ? "Current code from your app" : "Code from your app, or a recovery code")}
              {actions(mode === "disable" ? "Turn off two-step verification" : "Make new codes", mode === "disable")}
            </form>
          ) : (
            <div className="page-actions">
              {twoStep.app && (
                <button className="btn btn-ghost" onClick={() => setMode("codes")}>
                  <KeyRound size={15} /> New recovery codes
                </button>
              )}
              {!required && (
                <button className="btn btn-ghost danger-text" onClick={() => setMode("disable")}>
                  Turn off two-step verification
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <details className="mfa-help">
        <summary>
          <LifeBuoy size={15} /> Lost your phone?
        </summary>
        <ol>
          <li>
            On the sign-in screen, after your password, choose <b>Lost your phone? Use a recovery code</b>, or use a passkey.
          </li>
          <li>
            Then here, choose <b>Remove (lost or stolen phone)</b> to cut it off at once, or <b>Move to a new phone</b>.
          </li>
          <li>
            No codes or passkey? On the sign-in screen choose <b>Can't use any of these? Ask an administrator</b>. They'll confirm it's you and reset it.
          </li>
        </ol>
      </details>
      {msg && <p className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</p>}
    </Section>
  );
}
/** @typedef {"idle" | "setup" | "replace" | "replaceScan" | "removeApp" | "addKey" | "removeKey" | "codes" | "disable"} Mode */
/**
 * @typedef {Object} Props
 * @property {User} me
 * @property {Prefs} prefs
 * @property {Permission[]} permissions
 * @property {System[]} projects
 * @property {boolean} mfaRequired
 * @property {TwoStep} twoStep
 * @property {{ label: string }} [viewOnly]
 * @property {number} recoveryCodesLeft
 * @property {(p: Prefs) => Promise<void>} onPrefs
 * @property {() => Promise<void>} onProfileSaved
 * @property {() => void} onSignedOut
 * @property {number} [signOutJump]
 * @property {AdminPage[]} [adminPages]
 * @property {string} [openPage]
 * @property {(key: string) => void} [onPage]
 */
/**
 * An administration page, drawn by the caller, under its group's heading in the menu (Administration if none).
 * @typedef {Object} AdminPage
 * @property {string} key
 * @property {string} label
 * @property {LucideIcon} icon
 * @property {ReactNode} content
 * @property {string} [group]
 */
/**
 * @typedef {Object} SettingsPageInfo
 * @property {string} key
 * @property {string} label
 * @property {LucideIcon} icon
 * @property {string} [alert]
 */
