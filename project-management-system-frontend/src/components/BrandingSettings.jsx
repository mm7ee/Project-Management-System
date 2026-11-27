/** @import { BrandingView, Theme } from '../data/branding' */
// Settings → Organisation → Branding (Organisation Administrators): the display name, the logo for light and for
// dark backgrounds, the square icon, the accent colour and an optional sign-in tint, with a live preview of the
// platform page, the organisation's sign-in page and the signed-in app, in each theme.
// Images are checked, resized and re-encoded here (which also strips anything hidden in the file), and checked
// again by the Worker. SVG is refused: it can carry script.
import { useEffect, useMemo, useState } from "react";
import { Check, FileUp, ImageOff, Palette, TriangleAlert } from "lucide-react";
import { api } from "../data/api";
import { BRAND } from "../data/brand";
import { IMAGE_BOX, IMAGE_TYPES, STORED_MAX_BYTES, THEMES, UPLOAD_MAX_BYTES, accentShades, cleanHex, contrast, initials, sidebarTheme, solidShade } from "../data/branding";
import { applyBranding } from "../brandTheme";
import OrgMark from "./OrgMark";
import Panel from "./Panel";
import ThemeStudio, { themeFromNewLogo } from "./ThemeStudio";
import { Help, useToast } from "./AdminKit";

/** @typedef {"logo" | "logoDark" | "icon"} Slot */
/** @type {Record<Slot, { label: string; hint: string; box: { w: number; h: number }; square?: boolean }>} */
const SLOTS = {
  logo: { label: "Logo, for light backgrounds", hint: "The sign-in page and printed reports in the light theme.", box: IMAGE_BOX.logo },
  logoDark: { label: "Logo, for dark backgrounds", hint: "The sidebar (always dark), and the dark themes. Usually a white version.", box: IMAGE_BOX.logo },
  icon: { label: "Square icon", hint: "The browser tab and small places. Without one, a monogram of your initials is used.", box: IMAGE_BOX.icon, square: true },
};
const THEME_LABEL = /** @type {Record<Theme, string>} */ ({ light: "Light", dark: "Dark", futuristic: "Futuristic" });

/**
 * A picked file as a checked, resized PNG or WebP data: URL: it must really be a PNG, JPEG or WebP image (never
 * SVG), at most 512 KB; it is drawn into its box (never enlarged) and re-encoded, the smaller of WebP and PNG.
 * @param {File} file
 * @param {{ w: number; h: number }} box
 * @param {boolean} square  centre it in a square canvas (the icon)
 * @returns {Promise<string>}
 */
async function prepareImage(file, box, square) {
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new Error("SVG files can't be used: they can carry script. Choose a PNG, WebP or JPEG image.");
  if (!(/** @type {readonly string[]} */ (IMAGE_TYPES).includes(file.type))) throw new Error("Choose a PNG, WebP or JPEG image.");
  if (file.size > UPLOAD_MAX_BYTES) throw new Error(`That image is ${Math.round(file.size / 1024)} KB: choose one of ${UPLOAD_MAX_BYTES / 1024} KB or less.`);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't an image this browser can read.");
  });
  const scale = Math.min(1, box.w / bitmap.width, box.h / bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = square ? box.w : w;
  canvas.height = square ? box.h : h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, square ? Math.round((box.w - w) / 2) : 0, square ? Math.round((box.h - h) / 2) : 0, w, h);
  bitmap.close();
  const options = [canvas.toDataURL("image/png"), canvas.toDataURL("image/webp", 0.92), canvas.toDataURL("image/webp", 0.8)].filter((u) => /^data:image\/(png|webp);/.test(u));
  const bytes = (/** @type {string} */ u) => Math.floor(((u.length - u.indexOf(",") - 1) * 3) / 4);
  const best = options.sort((a, b) => bytes(a) - bytes(b))[0];
  if (!best || bytes(best) > STORED_MAX_BYTES) throw new Error("That image is still too large after resizing. Try a simpler one.");
  return best;
}

/**
 * @param {{ orgName: string; endpoint?: string; own?: boolean }} p  endpoint: the organisation's own route, or a
 *   Platform Administrator's (/platform/organizations/:id/branding); own: it's the organisation that's open here, so a
 *   save shows at once.
 */
export default function BrandingSettings({ orgName, endpoint = "/org/branding", own = true }) {
  const toast = useToast();
  const [saved, setSaved] = useState(/** @type {BrandingView | null} */ (null));
  const [displayName, setDisplayName] = useState("");
  const [accent, setAccent] = useState("#3e5c76");
  const [tint, setTint] = useState(/** @type {string | null} */ (null));
  // Its own sidebar (optional): the colour, and the highlight on the active page.
  const [sidebar, setSidebar] = useState(/** @type {string | null} */ (null));
  const [highlight, setHighlight] = useState(/** @type {string | null} */ (null));
  // A new image (data: URL), null to remove it, or undefined: unchanged.
  const [images, setImages] = useState(/** @type {Partial<Record<Slot, string | null>>} */ ({}));
  const [saving, setSaving] = useState(false);
  const [previewTheme, setPreviewTheme] = useState(/** @type {Theme} */ ("light"));
  // Bumped when the logo's new theme is saved, so the Theme panel below reloads.
  const [themeKey, setThemeKey] = useState(0);
  const themeBase = endpoint.replace(/\/branding$/, "/theme");

  const load = (/** @type {BrandingView} */ b) => {
    setSaved(b);
    setDisplayName(b.name);
    setAccent(b.accent);
    setTint(b.tint);
    setSidebar(b.sidebar ?? null);
    setHighlight(b.highlight ?? null);
    setImages({});
  };
  useEffect(() => {
    api(endpoint)
      .then((r) => load(/** @type {{ branding: BrandingView }} */ (r).branding))
      .catch((e) => toast(e instanceof Error ? e.message : "Couldn't load the branding", false));
  }, [endpoint]);

  const cleanAccent = cleanHex(accent) ?? saved?.accent ?? "#3e5c76";
  const check = useMemo(() => accentShades(cleanAccent), [cleanAccent]);
  /** The draft, as the app would see it. @type {BrandingView | null} */
  const draft = saved && {
    ...saved,
    name: displayName.trim() || saved.name,
    accent: cleanAccent,
    shades: check.shades,
    tint: tint ? cleanHex(tint) : null,
    sidebar: sidebar ? cleanHex(sidebar) : null,
    highlight: highlight ? cleanHex(highlight) : null,
    logo: images.logo === undefined ? saved.logo : images.logo,
    logoDark: images.logoDark === undefined ? saved.logoDark : images.logoDark,
    icon: images.icon === undefined ? saved.icon : images.icon,
  };
  if (!saved || !draft) return <p className="muted">Loading…</p>;
  const changed =
    draft.name !== saved.name ||
    draft.accent !== saved.accent ||
    draft.tint !== saved.tint ||
    (draft.sidebar ?? null) !== (saved.sidebar ?? null) ||
    (draft.highlight ?? null) !== (saved.highlight ?? null) ||
    Object.keys(images).length > 0;

  const pick = async (/** @type {Slot} */ slot, /** @type {File | undefined} */ file) => {
    if (!file) return;
    try {
      const url = await prepareImage(file, SLOTS[slot].box, !!SLOTS[slot].square);
      setImages((m) => ({ ...m, [slot]: url }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "That image can't be used", false);
    }
  };

  return (
    <>
    <Panel title="Branding" icon={Palette}>
      <Help>
        How {orgName} looks to its own people: on its sign-in page ({`/#/o/${saved.code}`}), inside the app, in emails, exports, view-only links and the
        service desk portal. The platform's own page stays neutral and never shows any organisation. Status colours (on track, at risk, overdue) never
        change.
      </Help>
      <form
        className="org-new brand-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            const body = { displayName: draft.name, accent: draft.accent, tint: draft.tint, sidebar: draft.sidebar ?? null, highlight: draft.highlight ?? null, ...images };
            const r = /** @type {{ branding: BrandingView }} */ (await api(endpoint, "PUT", body));
            load(r.branding);
            if (own) applyBranding(r.branding);
            // A new logo: a theme is generated from it (published at once for an organisation that has never had
            // one; otherwise a draft, and the other administrators are told).
            const newLogo = typeof images.logo === "string" ? images.logo : null;
            const made = newLogo ? await themeFromNewLogo(themeBase, newLogo).catch(() => null) : null;
            if (made?.autoPublished && own) applyBranding({ ...r.branding, theme: made.published?.spec ?? null });
            if (made) setThemeKey((k) => k + 1);
            toast(
              made?.autoPublished
                ? "The branding is saved, and a theme generated from your logo is now in use. Fine-tune it under Theme below."
                : made
                  ? "The branding is saved. A theme was generated from the new logo: review it under Theme below, then publish it."
                  : "The branding is saved. Everyone sees it on their next page load.",
            );
          } catch (err) {
            toast(err instanceof Error ? err.message : "Couldn't save", false);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="org-grid">
          <label className="field">
            Display name
            <input value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} required />
            <small className="muted">On the sign-in page ("Sign in to {draft.name}"), tab titles and emails.</small>
          </label>
          <div className="field">
            Accent colour
            <span className="org-colour">
              <input type="color" value={cleanAccent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent colour" />
              <input className="brand-hex" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent colour as hex" spellCheck={false} />
            </span>
            <small className="muted">Main buttons, links, the active page and focus rings.</small>
          </div>
          <div className="field">
            Sign-in background tint (optional)
            <span className="org-colour">
              <input type="color" value={tint ?? cleanAccent} onChange={(e) => setTint(e.target.value)} aria-label="Sign-in tint" />
              <code>{tint ?? "the accent"}</code>
              {tint && (
                <button type="button" className="btn btn-ghost sm" onClick={() => setTint(null)}>
                  Use the accent
                </button>
              )}
            </span>
          </div>
          <div className="field">
            Sidebar colour (optional)
            <span className="org-colour">
              <input type="color" value={sidebar ?? "#18202b"} onChange={(e) => setSidebar(e.target.value)} aria-label="Sidebar colour" />
              <code>{sidebar ?? "neutral graphite"}</code>
              {sidebar && (
                <button type="button" className="btn btn-ghost sm" onClick={() => setSidebar(null)}>
                  Use the neutral sidebar
                </button>
              )}
            </span>
            <small className="muted">Darkened if needed, so its text stays readable.</small>
          </div>
          <div className="field">
            Sidebar highlight (optional)
            <span className="org-colour">
              <input type="color" value={highlight ?? cleanAccent} onChange={(e) => setHighlight(e.target.value)} aria-label="Sidebar highlight" />
              <code>{highlight ?? "the accent"}</code>
              {highlight && (
                <button type="button" className="btn btn-ghost sm" onClick={() => setHighlight(null)}>
                  Use the accent
                </button>
              )}
            </span>
            <small className="muted">The active page's edge, glow and icons in the sidebar. Lightened if needed.</small>
          </div>
        </div>

        <ContrastCheck accent={cleanAccent} shades={check.shades} adjusted={check.adjusted} />

        <div className="brand-uploads">
          {/** @type {Slot[]} */ (["logo", "logoDark", "icon"]).map((slot) => {
            const src = draft[slot];
            return (
              <div key={slot} className={`brand-upload ${slot === "logoDark" ? "on-dark" : ""}`}>
                <b>{SLOTS[slot].label}</b>
                <div className={`brand-slot ${SLOTS[slot].square ? "square" : ""}`}>
                  {src ? (
                    <img src={src} alt="" />
                  ) : slot === "icon" ? (
                    <span className="org-monogram md" style={{ background: solidShade(cleanAccent) }} aria-label="Monogram">
                      {initials(draft.name)}
                    </span>
                  ) : (
                    <span className="muted brand-none">
                      <ImageOff size={16} aria-hidden="true" /> None: {slot === "logo" ? "the monogram is shown" : "the light logo is shown on a white plate"}
                    </span>
                  )}
                </div>
                <small className="muted">
                  {SLOTS[slot].hint} PNG, WebP or JPEG up to {UPLOAD_MAX_BYTES / 1024} KB; resized to fit {SLOTS[slot].box.w} × {SLOTS[slot].box.h}.
                </small>
                <span className="org-row">
                  <label className="btn btn-ghost sm">
                    <FileUp size={14} aria-hidden="true" /> Choose…
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(slot, e.target.files?.[0])} />
                  </label>
                  {src && (
                    <button type="button" className="btn btn-ghost sm" onClick={() => setImages((m) => ({ ...m, [slot]: null }))}>
                      Remove
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="brand-preview-head">
          <b>Preview</b>
          <span className="seg" role="group" aria-label="Preview theme">
            {THEMES.map((t) => (
              <button key={t} type="button" className={previewTheme === t ? "on" : ""} aria-pressed={previewTheme === t} onClick={() => setPreviewTheme(t)}>
                {THEME_LABEL[t]}
              </button>
            ))}
          </span>
        </div>
        <BrandPreview branding={draft} theme={previewTheme} />

        <div className="org-row">
          <button className="btn btn-navy sm" disabled={saving || !changed}>
            {saving ? "Saving…" : "Save branding"}
          </button>
          {changed && (
            <button type="button" className="btn btn-ghost sm" onClick={() => load(saved)}>
              Undo changes
            </button>
          )}
        </div>
      </form>
    </Panel>
    <ThemeStudio base={themeBase} branding={saved} own={own} reloadKey={themeKey} />
    </>
  );
}

/**
 * What the contrast check decided, per theme: the colour is used as chosen where it passes WCAG AA, and a safe
 * shade of the same hue where it doesn't.
 * @param {{ accent: string; shades: Record<Theme, string>; adjusted: Theme[] }} p
 */
function ContrastCheck({ accent, shades, adjusted }) {
  return (
    <div className={`brand-check ${adjusted.length ? "adjusted" : ""}`} role="status">
      {adjusted.length ? <TriangleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
      <div>
        <p>
          {adjusted.length
            ? `${accent} doesn't have enough contrast in the ${adjusted.map((t) => THEME_LABEL[t].toLowerCase()).join(" and ")} theme${adjusted.length > 1 ? "s" : ""}, so a safe shade of it is used there. Nothing is refused.`
            : `${accent} passes WCAG AA in every theme.`}
        </p>
        <ul className="brand-shades">
          {THEMES.map((t) => (
            <li key={t}>
              <span className="brand-swatch" style={{ background: shades[t] }} aria-hidden="true" /> {THEME_LABEL[t]}: <code>{shades[t]}</code>{" "}
              <span className="muted">({contrast(shades[t], t === "light" ? "#ffffff" : "#13163a").toFixed(1)}:1)</span>
            </li>
          ))}
          <li>
            <span className="brand-swatch" style={{ background: solidShade(accent) }} aria-hidden="true" /> Buttons: <code>{solidShade(accent)}</code>{" "}
            <span className="muted">(white text {contrast(solidShade(accent), "#ffffff").toFixed(1)}:1)</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * The three states, small: A, the platform page (neutral, the same for every organisation); B, the organisation's
 * sign-in page; C, inside the app. Drawn from the draft, so it changes as you edit.
 * @param {{ branding: BrandingView; theme: Theme }} p
 */
function BrandPreview({ branding: b, theme }) {
  const dark = theme !== "light";
  const ink = b.shades[theme];
  const solid = solidShade(b.accent);
  const sb = sidebarTheme(b.sidebar, b.highlight, b.accent);
  const vars = /** @type {import("react").CSSProperties} */ ({
    "--bp-ink": ink,
    "--bp-dark-ink": sb?.ink ?? b.shades.dark,
    "--bp-solid": solid,
    "--bp-tint": b.tint ?? ink,
    ...(sb ? { "--bp-sb": `radial-gradient(170% 90% at 20% 0%, ${sb.top} 0%, ${sb.base} 45%, ${sb.end} 100%)` } : {}),
  });
  return (
    <div className={`bp bp-${theme}`} style={vars}>
      <figure className="bp-state">
        <figcaption>A · Platform page (no organisation)</figcaption>
        <div className="bp-screen bp-a">
          <div className="bp-wordmark">
            <b>{BRAND.shortName}</b>
            <span>{BRAND.productName}</span>
          </div>
          <span className="bp-input">Organisation code</span>
          <span className="bp-btn bp-btn-neutral">Continue</span>
        </div>
      </figure>
      <figure className="bp-state">
        <figcaption>B · {b.name} sign-in</figcaption>
        <div className="bp-screen bp-b">
          <OrgMark branding={b} surface={dark ? "dark" : "light"} size="md" />
          <b className="bp-title">Sign in to {b.name}</b>
          <span className="bp-input bp-focus">Username</span>
          <span className="bp-btn">Sign in</span>
          <small className="bp-powered">{BRAND.poweredBy}</small>
        </div>
      </figure>
      <figure className="bp-state">
        <figcaption>C · Signed in</figcaption>
        <div className="bp-screen bp-c">
          <div className="bp-side">
            <OrgMark branding={b} surface="dark" size="sm" />
            <span className="bp-pill">Projects</span>
            <span className="bp-nav on">Dashboard</span>
            <span className="bp-nav">Projects</span>
            <span className="bp-nav">Reports</span>
          </div>
          <div className="bp-main">
            <b>Dashboard</b>
            <span className="bp-chips">
              <i className="ok">Live</i>
              <i className="warn">At risk</i>
              <i className="bad">Overdue</i>
            </span>
            <span className="bp-link">View all projects</span>
            <span className="bp-btn sm">New work item</span>
          </div>
        </div>
      </figure>
    </div>
  );
}
