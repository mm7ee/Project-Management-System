/** @import { BrandingView } from '../data/branding' */
/** @import { LogoAnalysis, Mode, ThemeSpec, Variation } from '../data/logoTheme' */
// Settings → Organisation → Branding → Theme (Organisation Administrators; Platform Administrators for any
// organisation): "We generated a theme from your logo". The logo is read here, in the browser (only the
// organisation's own uploaded logo), into a ThemeSpec; the three variations are shown in light and dark; it can be
// fine-tuned (swap colours, vibrancy, corners, font); then saved as a draft, previewed as me, published. Every
// version stays in the history and any of them can be restored. The Worker validates the spec again (worker/theme.js).
import { useEffect, useMemo, useState } from "react";
import { Check, History, Monitor, Paintbrush, RotateCcw, Smartphone, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { api } from "../data/api";
import { applyBranding, currentBranding } from "../brandTheme";
import {
  FONTS,
  VARIATIONS,
  analyseLogo,
  chartPalette,
  contrastChecks,
  lchHex,
  hexLch,
  specFromAnalysis,
  specFromColour,
  themeTokens,
} from "../data/logoTheme";
import OrgMark from "./OrgMark";
import Panel from "./Panel";
import { Help, useToast } from "./AdminKit";

/**
 * @typedef {Object} ThemeVersion
 * @property {number} version
 * @property {"draft" | "published" | "archived"} status
 * @property {ThemeSpec} spec
 * @property {string | null} note
 * @property {string} createdAt
 * @property {string | null} createdBy
 * @property {string | null} publishedAt
 */
/** @typedef {{ published: ThemeVersion | null; draft: ThemeVersion | null; history: ThemeVersion[]; autoPublished?: boolean }} ThemeState */

const VARIATION_LABEL = /** @type {Record<Variation, { name: string; hint: string }>} */ ({
  subtle: { name: "Subtle", hint: "Your colour on buttons, links and focus; a neutral sidebar." },
  balanced: { name: "Balanced", hint: "A branded sidebar and header band; calm content. Recommended." },
  immersive: { name: "Immersive", hint: "Strong brand presence: gradients and a soft glow." },
});
const KIND_LABEL = { monochrome: "no colour", "single-colour": "one colour", duotone: "two colours", multicolour: "several colours" };
const SURFACES = /** @type {const} */ (["dashboard", "board", "report", "sign-in", "email", "pdf"]);
const SURFACE_LABEL = { dashboard: "Dashboard", board: "Board", report: "Report", "sign-in": "Sign-in", email: "Email", pdf: "PDF" };

/**
 * Reads a logo (an address or a data: URL) into a small canvas and analyses it.
 * @param {string} src
 * @returns {Promise<LogoAnalysis>}
 */
export async function analyseLogoUrl(src) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const scale = Math.min(1, 96 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { willReadFrequently: true }));
  ctx.drawImage(img, 0, 0, w, h);
  return analyseLogo(ctx.getImageData(0, 0, w, h).data, w, h);
}

/**
 * The logo just changed: a theme is generated from it and saved. A new organisation (never published one) gets it
 * published at once; otherwise it waits as a draft and the other administrators are told (worker/theme.js).
 * @param {string} base  the theme route (/org/theme or /platform/organizations/:id/theme)
 * @param {string} logo
 * @returns {Promise<ThemeState>}
 */
export async function themeFromNewLogo(base, logo) {
  const { spec, notes } = specFromAnalysis(await analyseLogoUrl(logo));
  return /** @type {ThemeState} */ (await api(`${base}/draft`, "PUT", { spec, fromLogo: true, note: notes[0] ?? "Generated from the new logo" }));
}

/**
 * @param {{ base: string; branding: BrandingView; own: boolean; reloadKey?: number }} p
 */
export default function ThemeStudio({ base, branding, own, reloadKey = 0 }) {
  const toast = useToast();
  const [state, setState] = useState(/** @type {ThemeState | null} */ (null));
  const [spec, setSpec] = useState(/** @type {ThemeSpec | null} */ (null));
  const [notes, setNotes] = useState(/** @type {string[]} */ ([]));
  const [analysis, setAnalysis] = useState(/** @type {LogoAnalysis | null} */ (null));
  const [mode, setMode] = useState(/** @type {Mode} */ ("light"));
  const [mobile, setMobile] = useState(false);
  const [surface, setSurface] = useState(/** @type {(typeof SURFACES)[number]} */ ("dashboard"));
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const take = (/** @type {ThemeState} */ s) => {
    setState(s);
    setSpec(s.draft?.spec ?? s.published?.spec ?? null);
    if (own) applyLive(s.published?.spec ?? null);
  };
  useEffect(() => {
    api(base)
      .then((r) => take(/** @type {ThemeState} */ (r)))
      .catch((e) => toast(e instanceof Error ? e.message : "Couldn't load the theme", false));
  }, [base, reloadKey]);
  // Leaving the page ends a preview.
  useEffect(() => () => void (previewing && own && applyLive(state?.published?.spec ?? null)), [previewing]);

  /** The open organisation's look, with this theme (or none). @param {ThemeSpec | null} s */
  function applyLive(s) {
    const b = currentBranding();
    if (b) applyBranding({ ...b, theme: s });
  }

  const generate = async () => {
    setBusy(true);
    try {
      if (branding.logo) {
        const a = await analyseLogoUrl(branding.logo);
        const r = specFromAnalysis(a, spec?.variation ?? "balanced");
        setAnalysis(a);
        setSpec(r.spec);
        setNotes(r.notes);
      } else {
        setAnalysis(null);
        setSpec(specFromColour(branding.accent, spec?.variation ?? "balanced"));
        setNotes(["There's no logo yet, so the theme comes from your accent colour."]);
      }
    } catch {
      toast("Couldn't read the logo", false);
    } finally {
      setBusy(false);
    }
  };

  const call = async (/** @type {string} */ path, /** @type {string} */ method, /** @type {unknown} */ body, /** @type {string} */ done) => {
    setBusy(true);
    try {
      const r = /** @type {ThemeState} */ (await api(`${base}${path}`, method, body));
      setPreviewing(false);
      take(r);
      toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't do that", false);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <p className="muted">Loading the theme…</p>;
  const draftSaved = !!state.draft && !!spec && JSON.stringify(state.draft.spec) === JSON.stringify(spec);
  const isPublished = !!state.published && !!spec && JSON.stringify(state.published.spec) === JSON.stringify(spec);
  const set = (/** @type {Partial<ThemeSpec>} */ p) => spec && setSpec({ ...spec, ...p });

  return (
    <Panel title="Theme" icon={Paintbrush}>
      <Help>
        A full colour theme for {branding.name}, generated from its logo: sidebar, header, buttons, links, charts, in light and dark, every colour checked
        for readability (WCAG AA, body text AAA) and chart colours checked for colour-blindness. Status colours never change. Nothing reaches anyone until
        it's published, and every version can be restored.
      </Help>
      <div className="ts-status">
        {state.published ? (
          <span>
            <Check size={15} aria-hidden="true" /> Published: version {state.published.version} ({VARIATION_LABEL[state.published.spec.variation].name})
          </span>
        ) : (
          <span className="muted">No theme published: the accent colour is used.</span>
        )}
        {state.draft && <span className="ts-draft-tag">Draft waiting: version {state.draft.version}</span>}
        <button type="button" className="btn btn-ghost sm" onClick={generate} disabled={busy}>
          <Wand2 size={14} aria-hidden="true" /> {spec ? "Generate again from the logo" : branding.logo ? "Generate from the logo" : "Generate from the accent"}
        </button>
      </div>

      {!spec ? (
        <p className="muted">Generate a theme to see your three variations.</p>
      ) : (
        <>
          {(analysis || notes.length > 0) && (
            <div className="ts-found">
              <b>
                <Sparkles size={15} aria-hidden="true" /> We generated a theme from your {branding.logo ? "logo" : "accent colour"}
              </b>
              {analysis && (
                <p className="muted">
                  Your logo has {KIND_LABEL[analysis.kind]}
                  {analysis.chromatic.length > 0 && <>: {analysis.chromatic.map((c) => <span key={c.hex} className="brand-swatch" style={{ background: c.hex }} title={c.hex} />)}</>}
                  {" · "}
                  {analysis.tone === "dark-on-transparent" ? "dark, so it's shown in white on dark surfaces" : analysis.tone === "light-on-transparent" ? "light, for dark surfaces" : "mid-tone"} · {analysis.shape}
                </p>
              )}
              {notes.map((n) => (
                <p key={n} className="muted">
                  {n}
                </p>
              ))}
            </div>
          )}

          <Roles spec={spec} onSwap={() => set({ primary: spec.secondary, secondary: spec.primary })} onPrimary={(hex) => {
            const [L, C, h] = hexLch(hex);
            set({ primary: [L, Math.max(C, 0.04), h], askAdmin: false });
          }} />

          <div className="ts-variations" role="radiogroup" aria-label="Variation">
            {VARIATIONS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={spec.variation === v}
                className={`ts-variation ${spec.variation === v ? "on" : ""}`}
                onClick={() => set({ variation: v })}
              >
                <span className="ts-pair">
                  <Mock spec={{ ...spec, variation: v }} mode="light" surface="dashboard" logo={branding} tiny />
                  <Mock spec={{ ...spec, variation: v }} mode="dark" surface="dashboard" logo={branding} tiny />
                </span>
                <b>
                  {VARIATION_LABEL[v].name}
                  {v === "balanced" && <span className="ts-rec">default</span>}
                </b>
                <small className="muted">{VARIATION_LABEL[v].hint}</small>
              </button>
            ))}
          </div>

          <div className="ts-tune org-grid">
            <label className="field">
              Vibrancy: {Math.round(spec.vibrancy * 100)}%
              <input type="range" min={0.5} max={1.5} step={0.05} value={spec.vibrancy} onChange={(e) => set({ vibrancy: Number(e.target.value) })} />
              <small className="muted">How strongly the brand colour shows. Contrast is checked at every setting.</small>
            </label>
            <label className="field">
              Corners
              <select value={spec.radius} onChange={(e) => set({ radius: /** @type {ThemeSpec["radius"]} */ (e.target.value) })}>
                <option value="sharp">Sharp</option>
                <option value="default">Standard</option>
                <option value="round">Round</option>
              </select>
            </label>
            <label className="field">
              Font
              <select value={spec.font} onChange={(e) => set({ font: /** @type {ThemeSpec["font"]} */ (e.target.value) })}>
                {Object.keys(FONTS).map((f) => (
                  <option key={f} value={f}>
                    {f === "inter" ? "Inter (standard)" : f === "system" ? "System" : f === "serif" ? "Serif" : "Rounded"}
                  </option>
                ))}
              </select>
              <small className="muted">From fonts already on people's devices: no extra download.</small>
            </label>
          </div>

          <Checks spec={spec} />

          <div className="brand-preview-head">
            <b>Preview</b>
            <span className="seg" role="group" aria-label="Preview surface">
              {SURFACES.map((s) => (
                <button key={s} type="button" className={surface === s ? "on" : ""} aria-pressed={surface === s} onClick={() => setSurface(s)}>
                  {SURFACE_LABEL[s]}
                </button>
              ))}
            </span>
            <span className="seg" role="group" aria-label="Preview mode">
              {/** @type {Mode[]} */ (["light", "dark"]).map((m) => (
                <button key={m} type="button" className={mode === m ? "on" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </span>
            <span className="seg" role="group" aria-label="Preview size">
              <button type="button" className={!mobile ? "on" : ""} aria-pressed={!mobile} onClick={() => setMobile(false)} title="Desktop">
                <Monitor size={14} aria-label="Desktop" />
              </button>
              <button type="button" className={mobile ? "on" : ""} aria-pressed={mobile} onClick={() => setMobile(true)} title="Mobile">
                <Smartphone size={14} aria-label="Mobile" />
              </button>
            </span>
          </div>
          <div className={`ts-stage ${mobile ? "mobile" : ""}`}>
            <Mock spec={spec} mode={mode} surface={surface} logo={branding} mobile={mobile} />
          </div>

          <div className="org-row ts-actions">
            <button type="button" className="btn btn-ghost sm" disabled={busy || draftSaved || isPublished} onClick={() => call("/draft", "PUT", { spec, note: notes[0] ?? null }, "The draft is saved. Nobody sees it until it's published.")}>
              Save draft
            </button>
            {own && (
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => {
                  const on = !previewing;
                  setPreviewing(on);
                  applyLive(on ? spec : (state.published?.spec ?? null));
                }}
              >
                {previewing ? "Stop previewing" : "Preview as me"}
              </button>
            )}
            <button
              type="button"
              className="btn btn-navy sm"
              disabled={busy || isPublished}
              onClick={() => call("/publish", "POST", draftSaved ? {} : { spec, note: notes[0] ?? null }, "The theme is published. Everyone sees it on their next page load.")}
            >
              Publish
            </button>
            {state.draft && (
              <button type="button" className="btn btn-ghost sm" disabled={busy} onClick={() => call("/draft", "DELETE", undefined, "The draft is discarded.")}>
                Discard draft
              </button>
            )}
            {state.published && (
              <button type="button" className="btn btn-ghost sm" disabled={busy} onClick={() => call("/off", "POST", {}, "The theme is off: the accent colour is used again.")}>
                Turn the theme off
              </button>
            )}
          </div>
          {previewing && (
            <p className="ts-previewing" role="status">
              You're seeing this theme across the app; nobody else is. Stop previewing or publish it.
            </p>
          )}
        </>
      )}

      {state.history.length > 0 && (
        <details className="ts-history">
          <summary>
            <History size={15} aria-hidden="true" /> History ({state.history.length})
          </summary>
          <ul>
            {state.history.map((v) => (
              <li key={v.version}>
                <span className="ts-dots" aria-hidden="true">
                  <span style={{ background: lchHex(v.spec.primary) }} />
                  <span style={{ background: lchHex(v.spec.secondary) }} />
                </span>
                <b>Version {v.version}</b> <span className={`ts-tag ${v.status}`}>{v.status}</span> {VARIATION_LABEL[v.spec.variation].name}
                <span className="muted">
                  {" · "}
                  {new Date(v.publishedAt ?? v.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {v.createdBy ? ` · ${v.createdBy}` : ""}
                  {v.note ? ` · ${v.note}` : ""}
                </span>
                {v.status === "archived" && (
                  <button type="button" className="btn btn-ghost sm" disabled={busy} onClick={() => call("/rollback", "POST", { version: v.version }, `Version ${v.version} is published again.`)}>
                    <RotateCcw size={13} aria-hidden="true" /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

/**
 * The colour roles, with a way to swap them or pick the brand colour by hand.
 * @param {{ spec: ThemeSpec; onSwap: () => void; onPrimary: (hex: string) => void }} p
 */
function Roles({ spec, onSwap, onPrimary }) {
  const p = lchHex(spec.primary);
  const s = lchHex(spec.secondary);
  const n = lchHex([0.5, 0.012, spec.primary[2]]);
  return (
    <div className="ts-roles">
      <span className="ts-role">
        <label className="ts-chip" style={{ background: p }}>
          <input type="color" value={p} onChange={(e) => onPrimary(e.target.value)} aria-label="Primary colour" />
        </label>
        <b>Primary</b>
        <code>{p}</code>
      </span>
      <span className="ts-role">
        <span className="ts-chip" style={{ background: s }} />
        <b>Secondary</b>
        <code>{s}</code>
      </span>
      <span className="ts-role">
        <span className="ts-chip" style={{ background: n }} />
        <b>Neutral tint</b>
        <code>{n}</code>
      </span>
      <button type="button" className="btn btn-ghost sm" onClick={onSwap}>
        Swap primary and secondary
      </button>
      {spec.askAdmin && <small className="muted">Your logo has no colour: click the primary swatch to choose your brand colour.</small>}
    </div>
  );
}

/**
 * Every contrast pair, in light and dark, summed up; the failures (there should be none) listed.
 * @param {{ spec: ThemeSpec }} p
 */
function Checks({ spec }) {
  const result = useMemo(() => {
    const all = /** @type {Mode[]} */ (["light", "dark"]).flatMap((m) => contrastChecks(themeTokens(spec, m).tokens).map((c) => ({ ...c, mode: m })));
    const charts = /** @type {Mode[]} */ (["light", "dark"]).map((m) => chartPalette(spec, m).patterns.length);
    return { all, bad: all.filter((c) => !c.ok), patterns: charts.some((n) => n > 0) };
  }, [spec]);
  return (
    <div className={`brand-check ${result.bad.length ? "adjusted" : ""}`} role="status">
      {result.bad.length ? <TriangleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
      <div>
        <p>
          {result.bad.length
            ? `${result.bad.length} of ${result.all.length} colour pairs fall short.`
            : `All ${result.all.length} colour pairs pass in light and dark: body text 7:1 (AAA), other text 4.5:1 (AA), focus and accents 3:1.`}{" "}
          {result.patterns ? "Some chart colours look alike to colour-blind people, so those series also get patterns." : "Chart colours stay distinct for colour-blind people."}
        </p>
        {result.bad.length > 0 && (
          <ul className="brand-shades">
            {result.bad.map((c) => (
              <li key={`${c.mode}${c.name}`}>
                {c.mode}: {c.name} {c.ratio.toFixed(2)}:1 (needs {c.min}:1)
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * A small drawing of one surface in the theme (inline colours from the tokens).
 * @param {{ spec: ThemeSpec; mode: Mode; surface: (typeof SURFACES)[number]; logo: BrandingView; mobile?: boolean; tiny?: boolean }} p
 */
function Mock({ spec, mode, surface, logo, mobile = false, tiny = false }) {
  const { tokens: t } = useMemo(() => themeTokens(spec, mode), [spec, mode]);
  const chart = useMemo(() => chartPalette(spec, mode).palette, [spec, mode]);
  const vars = /** @type {import("react").CSSProperties} */ ({
    "--t-page": t.page,
    "--t-card": t.card,
    "--t-text": t.text,
    "--t-muted": t.muted,
    "--t-border": t.border,
    "--t-button": t.button,
    "--t-link": t.link,
    "--t-focus": t.focus,
    "--t-sec": t.secondary,
    "--t-sb": `linear-gradient(180deg, ${t.sidebarTop}, ${t.sidebar} 45%, ${t.sidebarEnd})`,
    "--t-hi": t.navActive,
    "--t-header": `linear-gradient(100deg, ${t.header}, ${t.headerEnd ?? t.header})`,
    "--t-glow": t.glow ?? "transparent",
    "--t-r": spec.radius === "sharp" ? "4px" : spec.radius === "round" ? "14px" : "8px",
    fontFamily: FONTS[spec.font],
  });
  const bars = chart.slice(0, mobile ? 5 : 8).map((c, i) => <i key={c} style={{ background: c, height: `${30 + ((i * 37) % 60)}%` }} />);
  const logoMark = (/** @type {"light" | "dark"} */ on) => <OrgMark branding={{ ...logo, theme: spec }} surface={on} size="sm" />;
  let body;
  if (surface === "sign-in") {
    body = (
      <div className="ts-signin">
        <div className="ts-card">
          {logoMark(mode === "dark" ? "dark" : "light")}
          <b>Sign in to {logo.name}</b>
          <span className="ts-input ts-focus">Username</span>
          <span className="ts-input">Password</span>
          <span className="ts-btn">Sign in</span>
        </div>
      </div>
    );
  } else if (surface === "email" || surface === "pdf") {
    // Emails and PDFs are always light: email clients and printers.
    const light = themeTokens(spec, "light").tokens;
    body = (
      <div className={`ts-paper ${surface}`} style={/** @type {import("react").CSSProperties} */ ({ "--t-text": light.text, "--t-muted": light.muted, "--t-link": light.link, "--t-button": light.button, "--t-border": light.border, "--t-card": "#ffffff", "--t-page": surface === "pdf" ? "#ffffff" : light.page })}>
        <div className="ts-letterhead" style={{ borderColor: light.button }}>
          {logoMark("light")}
          <span>{surface === "pdf" ? "Project report" : "Weekly digest"}</span>
        </div>
        <b>{surface === "pdf" ? "Website relaunch" : "3 items need you this week"}</b>
        <span className="ts-line" />
        <span className="ts-line short" />
        {surface === "email" ? <span className="ts-btn">Open {logo.name}</span> : <span className="ts-bars">{bars}</span>}
      </div>
    );
  } else {
    const main =
      surface === "board" ? (
        <div className="ts-board">
          {["To do", "Doing", "Done"].slice(0, mobile ? 2 : 3).map((col) => (
            <div key={col} className="ts-col">
              <small>{col}</small>
              <span className="ts-card ts-item" />
              <span className="ts-card ts-item" />
            </div>
          ))}
        </div>
      ) : surface === "report" ? (
        <div className="ts-card ts-report">
          <span className="ts-bars">{bars}</span>
          <span className="ts-row" />
          <span className="ts-row" />
          <span className="ts-link">Export</span>
        </div>
      ) : (
        <div className="ts-card">
          <b>Website relaunch</b>
          <small style={{ color: "var(--t-muted)" }}>Due 12 Dec · 64% done</small>
          <span className="ts-act">
            <span className="ts-btn">New item</span> <span className="ts-link">View board</span>
          </span>
          <span className="ts-status-row">
            <i className="ok">On track</i>
            <i className="warn">At risk</i>
            <i className="bad">Overdue</i>
          </span>
          <span className="ts-bars">{bars}</span>
        </div>
      );
    body = (
      <div className="ts-app">
        {!mobile && (
          <div className="ts-side">
            {logoMark("dark")}
            <span className="ts-nav on">Dashboard</span>
            <span className="ts-nav">Projects</span>
            {!tiny && <span className="ts-nav">Reports</span>}
          </div>
        )}
        <div className="ts-main">
          <div className={`ts-head ${spec.variation}`}>{surface === "board" ? "Board" : surface === "report" ? "Reports" : "Projects"}</div>
          {main}
        </div>
      </div>
    );
  }
  return (
    <div className={`ts-mock ${tiny ? "tiny" : ""} ${mode}`} style={vars} aria-hidden={tiny || undefined}>
      {body}
    </div>
  );
}
