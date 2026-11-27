/** @import { DeliveryStatus } from '../data/notifications' */
/** @import { Prefs } from '../data/roles' */
import { BRAND } from "../data/brand";
import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { Bell, Download, Send, Smartphone } from "lucide-react";
import { api } from "../data/api";
import { canPromptInstall, isInstalled, isIos, onInstallChange, promptInstall } from "../data/install";
import { Choice, Section } from "./SettingsParts";
const ON_OFF = [
  { value: /** @type {const} */ ("on"), label: "On" },
  { value: /** @type {const} */ ("off"), label: "Off" },
];
/**
 * Which emails this person gets. The bell always shows everything.
 * @param {{ prefs: Prefs; hasEmail: boolean; setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void }} props
 */
export function NotificationPrefs({ prefs, hasEmail, setPref }) {
  return (
    <Section icon={<Bell size={18} />} title="Emails to you" sub="The bell at the top always shows everything. These choose what's also emailed to you.">
      <div className="set-row">
        <div>
          <b>Email me alerts</b>
          <span>When you're assigned something, a manager asks for an update or your signature is needed.</span>
        </div>
        <Choice label="Email me alerts" value={prefs.emailAlerts} onChange={(v) => setPref("emailAlerts", v)} options={ON_OFF} />
      </div>
      <div className="set-row">
        <div>
          <b>Email me summaries</b>
          <span>The daily digest for developers (weekdays, 07:00) and the Monday Briefing for managers (Mondays, 08:00).</span>
        </div>
        <Choice label="Email me summaries" value={prefs.emailSummaries} onChange={(v) => setPref("emailSummaries", v)} options={ON_OFF} />
      </div>
      {!hasEmail && <p className="set-note">Add your work email under Profile to receive these by email.</p>}
    </Section>
  );
}
/**
 * Adding PMS to a phone's home screen.
 */
export function InstallSection() {
  const [, redraw] = useState(0);
  useEffect(() => onInstallChange(() => redraw((n) => n + 1)), []);
  // The address of this page, so a view-only link installs as that same link.
  const address = window.location.origin + window.location.pathname;
  const phone = window.matchMedia("(max-width: 800px)").matches;
  const qr = qrcode(0, "M");
  qr.addData(address);
  qr.make();
  return (
    <Section icon={<Smartphone size={18} />} title={`Install ${BRAND.shortName}`} sub="Add it to your home screen and it opens like an app, without the browser's bars.">
      {isInstalled() ? (
        <p className="set-note">You're using {BRAND.shortName} from your home screen.</p>
      ) : (
        <div className="install">
          <div className="install-steps">
            {canPromptInstall() && (
              <button className="btn btn-navy" onClick={() => promptInstall()}>
                <Download size={16} /> Install {BRAND.shortName}
              </button>
            )}
            {isIos() ? (
              <ol>
                <li>Open this page in Safari.</li>
                <li>Tap the Share button.</li>
                <li>Tap Add to Home Screen, then Add.</li>
              </ol>
            ) : (
              !canPromptInstall() && (
                <ol>
                  <li>Open this page in Chrome on your phone.</li>
                  <li>Tap the menu (three dots).</li>
                  <li>Tap Add to Home screen, then Install.</li>
                </ol>
              )
            )}
          </div>
          {!phone && (
            <figure className="install-qr">
              <div role="img" aria-label="QR code that opens this site on your phone" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true }) }} />
              <figcaption>Scan with your phone to open it there.</figcaption>
            </figure>
          )}
        </div>
      )}
    </Section>
  );
}
/**
 * Administrators: connect email and Teams, and send a summary on demand.
 */
export function DeliverySection() {
  const [status, setStatus] = useState(/** @type {DeliveryStatus | null | (() => DeliveryStatus | null)} */ (null));
  const [resendKey, setResendKey] = useState("");
  const [from, setFrom] = useState("");
  const [teamsWebhook, setTeamsWebhook] = useState("");
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState(/** @type {{ ok: boolean; text: string } | null | (() => { ok: boolean; text: string } | null)} */ (null));
  const [busy, setBusy] = useState(false);
  const show = /** @param {DeliveryStatus} s */ (s) => {
    setStatus(s);
    setFrom(s.email.from);
    setExtra(s.briefingEmails.join(", "));
    setResendKey("");
    setTeamsWebhook("");
  };
  useEffect(() => {
    /** @type {Promise<DeliveryStatus>} */ (/** @type {unknown} */ (api("/settings/delivery"))).then(show).catch(() => undefined);
  }, []);
  const act = /** @param {() => Promise<string>} work */ async (work) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await work() });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setBusy(false);
    }
  };
  const save = /** @param {Record<string, unknown>} change @param {string} done */ (change, done) =>
    act(async () => {
      show(await /** @type {Promise<DeliveryStatus>} */ (/** @type {unknown} */ (api("/settings/delivery", "PUT", change))));
      return done;
    });
  const run = /** @param {"daily" | "briefing"} kind @param {string} label */ (kind, label) => {
    if (!window.confirm(`Send ${label} now? Everyone it's for will get it straight away.`)) return;
    act(async () => {
      const r = await /** @type {Promise<{ created: number; emailed: number; }>} */ (/** @type {unknown} */ (api("/digests/run", "POST", { kind })));
      return r.created ? `Sent to ${r.created} ${r.created === 1 ? "person" : "people"}, ${r.emailed} by email.` : "Nothing new to send: everyone it's for already has it.";
    });
  };
  if (!status) return null;
  return (
    <Section icon={<Send size={18} />} title="Email and Teams delivery" sub="Everything already appears under the bell. Connect these to send it further too. Keys are encrypted and can't be read back.">
      {status.demoProjects > 0 && <p className="form-error">{status.demoProjects} demo projects are still in the system. Run "npm run demo:remove" before connecting email, or staff will receive summaries about demo work.</p>}
      <form
        className="set-form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ from, briefingEmails: extra, ...(resendKey ? { resendKey } : {}), ...(teamsWebhook ? { teamsWebhook } : {}) }, "Saved.");
        }}
      >
        <div className="field-row">
          <label className="field">
            <span>Email: Resend API key {status.email.configured && "(connected)"}</span>
            <input type="password" autoComplete="off" value={resendKey} onChange={(e) => setResendKey(e.target.value)} placeholder={status.email.configured ? "Saved. Paste a new key to replace it" : "re_..."} />
          </label>
          <label className="field">
            <span>Send from</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={`${BRAND.shortName} <pms@your-company.com>`} />
          </label>
        </div>
        <label className="field">
          <span>Teams: Workflows webhook address {status.teams.configured && "(connected)"}</span>
          <input type="password" autoComplete="off" value={teamsWebhook} onChange={(e) => setTeamsWebhook(e.target.value)} placeholder={status.teams.configured ? "Saved. Paste a new address to replace it" : "https://..."} />
        </label>
        <label className="field">
          <span>Also email the Monday Briefing to (people without an account)</span>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="name.surname@your-company.com, ..." />
        </label>
        <p className="set-note">Teams posts go to one channel for the whole team. Daily digests are personal, so they're never posted there.</p>
        {status.lastError && (
          <p className="form-error">
            Last failure ({status.lastError.channel}, {new Date(status.lastError.at).toLocaleString("en-GB")}): {status.lastError.message}
          </p>
        )}
        {msg && <p className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</p>}
        <div className="set-actions">
          <button type="submit" className="btn btn-navy" disabled={busy}>
            Save
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await /** @type {Promise<{ email: string; teams: string; }>} */ (/** @type {unknown} */ (api("/settings/delivery/test", "POST")));
                show(await /** @type {Promise<DeliveryStatus>} */ (/** @type {unknown} */ (api("/settings/delivery"))));
                return `Email: ${r.email} Teams: ${r.teams}`;
              })
            }
          >
            Send me a test
          </button>
          {status.email.configured && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save({ resendKey: null }, "Email disconnected.")}>
              Disconnect email
            </button>
          )}
          {status.teams.configured && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save({ teamsWebhook: null }, "Teams disconnected.")}>
              Disconnect Teams
            </button>
          )}
        </div>
      </form>
      <div className="set-row">
        <div>
          <b>Send a summary now</b>
          <span>They also go out by themselves: digests on weekdays at 07:00, the briefing on Mondays at 08:00 (Harare time). Nobody gets the same one twice.</span>
        </div>
        <div className="set-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={() => run("daily", "today's developer digests")}>
            Daily digests
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => run("briefing", "this week's Monday Briefing")}>
            Monday Briefing
          </button>
        </div>
      </div>
    </Section>
  );
}
