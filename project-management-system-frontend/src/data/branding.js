// An organisation's branding: its display name, logos, square icon, accent colour and sign-in tint. Shared by the
// screens and the Worker, so the server checks exactly what the settings page shows.
//
// The rules (docs/DECISIONS.md, branding):
//   - The platform is neutral. Before an organisation is chosen nothing carries any organisation's branding.
//   - An organisation brands its own space, and only that.
//   - The accent drives a small set of tokens (buttons, links, active navigation, focus). Status colours
//     (success, warning, danger, info) and the chart palette never change with the brand.
//   - Every accent is made safe: for each theme, the shade that reaches WCAG AA against that theme's surfaces.

/** @typedef {"light" | "dark" | "futuristic"} Theme */
/** @type {readonly Theme[]} */
export const THEMES = ["light", "dark", "futuristic"];

/** The page and card colours of each theme (styles.css: --canvas and --card). Text on them needs 4.5:1. */
export const SURFACES = /** @type {Record<Theme, readonly string[]>} */ ({
  light: ["#f7f9fd", "#ffffff"],
  dark: ["#0b0c22", "#13163a"],
  futuristic: ["#0b0c22", "#13163a"],
});

/** Text on an accent button is one of these, whichever contrasts more. */
export const ON_LIGHT = "#ffffff";
export const ON_DARK = "#0b0c22";

/** WCAG AA for normal text. */
export const AA = 4.5;

/** The platform's own neutral accent (steel blue), used when an organisation hasn't chosen one. */
export const PLATFORM_ACCENT = "#3e5c76";

/**
 * @typedef {Object} BrandingView    what the public endpoint and the signed-in shell receive
 * @property {string} name           the display name
 * @property {string} code           the organisation's code
 * @property {string} accent         as the administrator chose it (#rrggbb)
 * @property {Record<Theme, string>} shades   the contrast-safe accent per theme
 * @property {string | null} tint    the sign-in background tint, if any
 * @property {string | null} [sidebar]    its own sidebar colour, if any (else neutral graphite)
 * @property {string | null} [highlight]  its sidebar's highlight (the active page), if any (else the accent)
 * @property {string | null} logo    the logo for light backgrounds (an address), if uploaded
 * @property {string | null} logoDark  the logo for dark backgrounds, if uploaded
 * @property {string | null} icon    the square icon, if uploaded
 */

/**
 * #rgb or #rrggbb, lower case and six digits, or null.
 * @param {unknown} v
 * @returns {string | null}
 */
export function cleanHex(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map((c) => c + c).join("");
  return null;
}

/** @param {string} hex  #rrggbb  @returns {[number, number, number]} 0–255 */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {number} n 0–255 */
const hex2 = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/**
 * Relative luminance (WCAG 2.x).
 * @param {string} hex
 */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The contrast ratio of two colours, 1 to 21.
 * @param {string} a
 * @param {string} b
 */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * White or near-black, whichever reads better on this colour.
 * @param {string} bg
 */
export function textOn(bg) {
  return contrast(bg, ON_LIGHT) >= contrast(bg, ON_DARK) ? ON_LIGHT : ON_DARK;
}

/** @param {string} hex @returns {[number, number, number]} hue 0–360, saturation and lightness 0–1 */
function toHsl(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** @param {number} h @param {number} s @param {number} l @returns {string} */
function fromHsl(h, s, l) {
  const k = (/** @type {number} */ n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (/** @type {number} */ n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${hex2(f(0) * 255)}${hex2(f(8) * 255)}${hex2(f(4) * 255)}`;
}

/**
 * Whether a colour works as the accent on a theme: as text and links on every surface (4.5:1), and as a button
 * with white or dark text on it (4.5:1). A focus ring needs 3:1, which this covers.
 * @param {string} colour
 * @param {Theme} theme
 */
export function passes(colour, theme) {
  return SURFACES[theme].every((s) => contrast(colour, s) >= AA) && contrast(colour, textOn(colour)) >= AA;
}

/**
 * The accent for one theme: the colour itself if it passes, else the nearest shade of the same hue that does,
 * darker on light themes and lighter on dark ones.
 * @param {string} accent  #rrggbb
 * @param {Theme} theme
 * @returns {string}
 */
export function safeShade(accent, theme) {
  if (passes(accent, theme)) return accent;
  const [h, s, l] = toHsl(accent);
  const step = theme === "light" ? -0.01 : 0.01;
  for (let x = l + step; x >= 0 && x <= 1; x += step) {
    const c = fromHsl(h, s, Math.min(1, Math.max(0, x)));
    if (passes(c, theme)) return c;
  }
  // Black and white always pass on these surfaces; never reached in practice.
  return theme === "light" ? "#000000" : "#ffffff";
}

/**
 * The accent as a background under white text (buttons, the active page, avatars), in every theme: the colour
 * itself if white text on it reaches AA, else the nearest darker shade of the same hue that does.
 * @param {string} accent
 * @returns {string}
 */
export function solidShade(accent) {
  const a = cleanHex(accent) ?? PLATFORM_ACCENT;
  if (contrast(a, ON_LIGHT) >= AA) return a;
  const [h, s, l] = toHsl(a);
  for (let x = l - 0.01; x >= 0; x -= 0.01) {
    const c = fromHsl(h, s, Math.max(0, x));
    if (contrast(c, ON_LIGHT) >= AA) return c;
  }
  return "#000000";
}

/** The neutral sidebar (graphite), and the light text drawn on any sidebar. */
export const SIDEBAR_DEFAULT = "#18202b";
export const SIDEBAR_TEXT = "#e6ebf1";

/**
 * Moves a colour's lightness (same hue) until `ok` holds: darker with step < 0, lighter with step > 0.
 * @param {string} colour
 * @param {number} step
 * @param {(c: string) => boolean} ok
 */
function shadeUntil(colour, step, ok) {
  if (ok(colour)) return colour;
  const [h, s, l] = toHsl(colour);
  for (let x = l + step; x >= 0 && x <= 1; x += step) {
    const c = fromHsl(h, s, Math.min(1, Math.max(0, x)));
    if (ok(c)) return c;
  }
  return step < 0 ? "#000000" : "#ffffff";
}

/** @param {string} a @param {string} b @param {number} t  0 = a, 1 = b */
function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => hex2(v + (y[i] - v) * t)).join("")}`;
}

/**
 * An organisation's own sidebar, when it sets one (a sidebar colour, a highlight, or both); null for the neutral
 * graphite sidebar with the accent. Every colour is made safe:
 *  - the sidebar is darkened until its light text reaches AA;
 *  - the highlight (the active page's edge and glow) reaches 3:1 on it, and its ink (icons, small text) AA.
 * @param {string | null | undefined} sidebar
 * @param {string | null | undefined} highlight
 * @param {string} accent  the fallback for the highlight
 * @returns {{ top: string; base: string; end: string; hi: string; ink: string } | null}
 */
export function sidebarTheme(sidebar, highlight, accent) {
  const sb = cleanHex(sidebar);
  const hl = cleanHex(highlight);
  if (!sb && !hl) return null;
  const base = shadeUntil(sb ?? SIDEBAR_DEFAULT, -0.01, (c) => contrast(c, SIDEBAR_TEXT) >= AA);
  const seed = hl ?? accentShades(accent).shades.dark;
  const hi = shadeUntil(seed, 0.01, (c) => contrast(c, base) >= 3);
  // The ink: a lighter tint of the highlight, as icons and small text on a dark sidebar read best.
  const ink = mix(shadeUntil(seed, 0.01, (c) => contrast(c, base) >= AA), "#ffffff", 0.45);
  // A soft light from the top-left, tinted by the highlight, fading to a deeper bottom.
  return { top: mix(base, hi, 0.12), base, end: mix(base, "#000000", 0.2), hi, ink };
}

/**
 * The contrast check the settings page shows, and the shades the app uses.
 * @param {string} accent
 * @returns {{ shades: Record<Theme, string>; adjusted: Theme[] }}
 */
export function accentShades(accent) {
  const a = cleanHex(accent) ?? PLATFORM_ACCENT;
  const shades = /** @type {Record<Theme, string>} */ (Object.fromEntries(THEMES.map((t) => [t, safeShade(a, t)])));
  return { shades, adjusted: THEMES.filter((t) => shades[t] !== a) };
}

/**
 * The monogram that stands in for a missing logo: the initials of the first two words that have a letter or digit
 * ("Omnicontact" → "O", "Demo Co" → "DC"), or "?" when there are none.
 * @param {string} name
 */
export function initials(name) {
  const words = String(name ?? "")
    .normalize("NFC")
    .trim()
    .split(/[\s\-_/.&]+/)
    .map((w) => Array.from(w).find((ch) => /[\p{L}\p{N}]/u.test(ch)))
    .filter((ch) => ch !== undefined);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((ch) => String(ch).toLocaleUpperCase())
    .join("");
}

/** @param {string} s */
const xml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * The monogram as an SVG: the initials in a rounded square of the accent, in white or dark text, whichever
 * contrasts more. Used for favicons, the collapsed sidebar and anywhere an icon is missing.
 * @param {string} name
 * @param {string} accent
 * @param {number} [size]
 */
export function monogramSvg(name, accent, size = 64) {
  const fill = cleanHex(accent) ?? PLATFORM_ACCENT;
  const text = initials(name);
  const fs = text.length > 1 ? 0.42 : 0.56;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fill}"/><text x="32" y="${32 + 64 * fs * 0.35}" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${64 * fs}" font-weight="800" fill="${textOn(fill)}" text-anchor="middle">${xml(text)}</text></svg>`;
}

/** The platform's favicon: the letters "PMS", in the neutral ink. */
export function platformIconSvg(size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f2933"/><text x="32" y="40.5" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="22" font-weight="900" letter-spacing="-0.5" fill="#ffffff" text-anchor="middle">PMS</text></svg>`;
}

/** @param {string} svg */
export const svgDataUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

// ---------- uploads ----------

/** The image types a logo or icon may be. Never SVG: it can carry script. */
export const IMAGE_TYPES = /** @type {const} */ (["image/png", "image/jpeg", "image/webp"]);
/** What a person may pick (before the browser resizes it). */
export const UPLOAD_MAX_BYTES = 512 * 1024;
/** What is stored, after resizing and re-encoding. */
export const STORED_MAX_BYTES = 200 * 1024;
/** The box each image is resized into, and the most the server accepts. */
export const IMAGE_BOX = /** @type {const} */ ({ logo: { w: 480, h: 160 }, icon: { w: 256, h: 256 } });
/** The slots an organisation can fill. */
export const IMAGE_SLOTS = /** @type {const} */ (["logo", "logoDark", "icon"]);
