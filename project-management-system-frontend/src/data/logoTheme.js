// Logo-driven themes (docs/adaptive-theming-plan.md). Pure functions, no DOM, shared by the app and the Worker:
//   analyseLogo(pixels)        → what colours the logo has, and what kind of logo it is
//   specFromAnalysis(analysis) → a ThemeSpec: the only thing ever stored (validated by cleanThemeSpec)
//   themeTokens(spec, mode)    → every colour of the theme, each pair checked (and fixed) for WCAG contrast
//   chartPalette(spec, mode)   → 8 chart colours kept apart under simulated colour-vision deficiencies
//   themeCss(spec)             → the style sheet: known CSS variables with #rrggbb values, nothing else
// All colour work is in OKLab / OKLCH (L 0–1, C chroma, h hue in degrees). Status colours are never generated.

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {"subtle" | "balanced" | "immersive"} Variation */
/** @typedef {"sharp" | "default" | "round"} Radius */
/** @typedef {"inter" | "system" | "serif" | "rounded"} Font */
/** @typedef {"light" | "dark"} Mode */
/**
 * @typedef {Object} ThemeSource  what the analysis found (shown to admins; never used for CSS)
 * @property {"monochrome" | "single-colour" | "duotone" | "multicolour"} kind
 * @property {"light-on-transparent" | "dark-on-transparent" | "mid-tone"} tone
 * @property {"wide wordmark" | "square mark" | "lockup"} shape
 */
/**
 * @typedef {Object} ThemeSpec
 * @property {1} v
 * @property {Vec3} primary     OKLCH
 * @property {Vec3} secondary   OKLCH
 * @property {Variation} variation
 * @property {number} vibrancy  0.5–1.5, multiplies the brand chroma
 * @property {Radius} radius
 * @property {Font} font
 * @property {ThemeSource | null} source
 * @property {boolean} askAdmin  a monochrome logo: the admin is invited to pick a brand colour
 */

export const VARIATIONS = /** @type {const} */ (["subtle", "balanced", "immersive"]);
export const RADII = /** @type {const} */ ({ sharp: [3, 5, 8], default: [6, 10, 14], round: [10, 16, 22] });
// System font stacks only: choosing a font never adds a download.
export const FONTS = /** @type {const} */ ({
  inter: '"Inter", "Inter Fallback", system-ui, -apple-system, "Segoe UI", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif',
});
const KINDS = ["monochrome", "single-colour", "duotone", "multicolour"];
const TONES = ["light-on-transparent", "dark-on-transparent", "mid-tone"];
const SHAPES = ["wide wordmark", "square mark", "lockup"];

// ---------- colour spaces: sRGB ↔ linear ↔ OKLab ↔ OKLCH ----------
const toLin = (/** @type {number} */ c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (/** @type {number} */ c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
/** @param {Vec3} rgb linear @returns {Vec3} */
export function linToLab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** @param {Vec3} lab @returns {Vec3} */
function labToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** @param {Vec3} lab @returns {Vec3} */
const labToLch = ([L, a, b]) => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
/** @param {Vec3} lch @returns {Vec3} */
const lchToLab = ([L, C, h]) => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
const inGamut = (/** @type {Vec3} */ lin) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

/** OKLCH → #rrggbb, reducing chroma (never lightness or hue) until it fits sRGB. @param {Vec3} lch */
export function lchHex([L, C, h]) {
  L = clamp(L, 0, 1);
  let lo = 0;
  let hi = Math.max(0, C);
  let lin = labToLin(lchToLab([L, hi, h]));
  if (!inGamut(lin)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLin(lchToLab([L, mid, h])))) lo = mid;
      else hi = mid;
    }
    lin = labToLin(lchToLab([L, lo, h]));
  }
  return "#" + lin.map((v) => Math.round(clamp(toGam(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0")).join("");
}
/** @param {string} hex @returns {Vec3} */
const hexLin = (hex) => /** @type {Vec3} */ ([1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255)));
/** #rrggbb → OKLCH. @param {string} hex */
export const hexLch = (hex) => labToLch(linToLab(hexLin(hex)));
const lum = (/** @type {string} */ hex) => {
  const [r, g, b] = hexLin(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2 contrast ratio. @param {string} a @param {string} b */
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Degrees between two hues (0–180). @param {number} a @param {number} b */
export const hueDiff = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const dist = (/** @type {Vec3} */ a, /** @type {Vec3} */ b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- 1. reading the logo ----------
/**
 * @typedef {Object} Cluster
 * @property {Vec3} lch
 * @property {string} hex
 * @property {number} w      weight (area × saturation)
 * @property {number} share  share of the logo's coloured pixels
 */
/**
 * @typedef {Object} LogoAnalysis
 * @property {Cluster[]} clusters
 * @property {Cluster[]} chromatic  the clusters with real colour (C ≥ 0.035)
 * @property {ThemeSource["kind"]} kind
 * @property {ThemeSource["tone"]} tone
 * @property {ThemeSource["shape"]} shape
 * @property {number} ink  the logo's average lightness
 */
/**
 * What colours a logo has. `data` is RGBA bytes of the logo drawn (contain) into a small canvas (at most 96 px).
 * Ignores transparent pixels, anti-aliased edges, a solid background (from the corners) and near-white or near-black
 * greys; groups the rest with k-means in OKLab, each pixel weighted by 1 + 4 × saturation.
 * @param {ArrayLike<number>} data
 * @param {number} width
 * @param {number} height
 * @returns {LogoAnalysis}
 */
export function analyseLogo(data, width, height) {
  const at = (/** @type {number} */ x, /** @type {number} */ y) => (y * width + x) * 4;
  const lab = (/** @type {number} */ i) => linToLab([toLin(data[i] / 255), toLin(data[i + 1] / 255), toLin(data[i + 2] / 255)]);
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const cornerLabs = corners.map(lab);
  // A solid background (the four corners opaque and alike) is skipped when it's white or grey. A coloured one (a red
  // tile with a white letter, say) is the brand colour, so it stays.
  const solidBg =
    corners.every((i) => data[i + 3] > 240) && cornerLabs.every((c) => dist(c, cornerLabs[0]) < 0.03) && labToLch(cornerLabs[0])[1] < 0.03 ? cornerLabs[0] : null;
  /** @type {{ lab: Vec3; w: number }[]} */ const pts = [];
  let inkL = 0;
  let inkN = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = at(x, y);
      if (data[i + 3] < 128) continue;
      const p = lab(i);
      if (solidBg && dist(p, solidBg) < 0.06) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      inkL += p[0];
      inkN++;
      if (data[i + 3] < 230) continue; // an anti-aliased edge
      const [L, C] = labToLch(p);
      if ((L > 0.95 || L < 0.12) && C < 0.03) continue; // near-white or near-black: structure, not brand colour
      pts.push({ lab: p, w: 1 + 4 * Math.min(1, C / 0.15) });
    }
  }
  const ink = inkN ? inkL / inkN : 0.5;
  const aspect = maxX < 0 ? 1 : (maxX - minX + 1) / (maxY - minY + 1);
  const shape = aspect > 2.2 ? "wide wordmark" : aspect < 1.4 ? "square mark" : "lockup";
  const tone = ink > 0.75 ? "light-on-transparent" : ink < 0.45 ? "dark-on-transparent" : "mid-tone";
  // k-means (k ≤ 5) with deterministic seeding: the heaviest point, then each time the farthest weighted point.
  const k = Math.min(5, pts.length);
  /** @type {Vec3[]} */ const cent = [];
  if (k) cent.push(/** @type {Vec3} */ (pts.reduce((a, b) => (b.w > a.w ? b : a)).lab.slice()));
  while (cent.length < k) {
    let best = pts[0];
    let bestD = -1;
    for (const p of pts) {
      const d = Math.min(...cent.map((c) => dist(p.lab, c) ** 2)) * p.w;
      if (d > bestD) [bestD, best] = [d, p];
    }
    if (bestD < 1e-6) break;
    cent.push(/** @type {Vec3} */ (best.lab.slice()));
  }
  /** @type {{ sum: Vec3; w: number; n: number }[]} */ let groups = [];
  for (let it = 0; it < 12; it++) {
    groups = cent.map(() => ({ sum: /** @type {Vec3} */ ([0, 0, 0]), w: 0, n: 0 }));
    for (const p of pts) {
      let j = 0;
      let dj = Infinity;
      cent.forEach((c, ci) => {
        const d = dist(p.lab, c);
        if (d < dj) [dj, j] = [d, ci];
      });
      const g = groups[j];
      g.w += p.w;
      g.n++;
      for (let q = 0; q < 3; q++) g.sum[q] += p.lab[q] * p.w;
    }
    groups.forEach((g, gi) => {
      if (g.w) cent[gi] = /** @type {Vec3} */ (g.sum.map((v) => v / g.w));
    });
  }
  /** @type {{ lab: Vec3; w: number; share: number }[]} */ const merged = [];
  const raw = cent.map((c, i) => ({ lab: c, w: groups[i]?.w ?? 0, share: (groups[i]?.n ?? 0) / Math.max(1, pts.length) })).filter((c) => c.share > 0.02);
  raw.sort((a, b) => b.w - a.w);
  for (const c of raw) {
    const m = merged.find((x) => dist(x.lab, c.lab) < 0.06);
    if (m) {
      m.share += c.share;
      m.w += c.w;
    } else merged.push({ ...c });
  }
  const clusters = merged.map((c) => ({ lch: labToLch(c.lab), hex: lchHex(labToLch(c.lab)), w: c.w, share: c.share }));
  const chromatic = clusters.filter((c) => c.lch[1] >= 0.035).sort((a, b) => b.w - a.w);
  /** @type {number[]} */ const hues = [];
  for (const c of chromatic) if (hues.every((h) => hueDiff(h, c.lch[2]) >= 30)) hues.push(c.lch[2]);
  const kind = !chromatic.length ? "monochrome" : hues.length === 1 ? "single-colour" : hues.length === 2 ? "duotone" : "multicolour";
  return { clusters, chromatic, kind, tone, shape, ink };
}

// ---------- 2. roles ----------
/**
 * The theme a logo suggests: primary, secondary and what was derived, as a ThemeSpec (Balanced by default).
 * @param {LogoAnalysis} a
 * @param {Variation} [variation]
 * @returns {{ spec: ThemeSpec; notes: string[] }}
 */
export function specFromAnalysis(a, variation = "balanced") {
  const score = (/** @type {Cluster} */ c) => c.w * c.lch[1] ** 0.6 * (1 - 0.8 * Math.abs(c.lch[0] - 0.6));
  const ranked = [...a.chromatic].sort((x, y) => score(y) - score(x));
  /** @type {string[]} */ const notes = [];
  /** @type {Vec3} */ let primary;
  /** @type {Vec3} */ let secondary;
  let askAdmin = false;
  if (ranked.length) {
    primary = /** @type {Vec3} */ (ranked[0].lch.slice());
    // A muted brand colour (a dark greyish navy, say) can't carry buttons and links: its hue is kept and its chroma
    // raised for the theme. The logo itself is never recoloured.
    if (primary[1] < 0.1) {
      notes.push(`Your brand colour is muted, so the theme uses a stronger version of the same hue.`);
      primary[1] = 0.12;
    }
    const second = ranked.find((c) => hueDiff(c.lch[2], primary[2]) >= 30);
    if (second) secondary = /** @type {Vec3} */ (second.lch.slice());
    else {
      // A neighbouring (analogous) hue rather than the opposite one: it stays recognisably the same brand.
      secondary = [0.62, Math.min(primary[1], 0.14), (primary[2] + 35) % 360];
      notes.push("Your logo has one colour, so the second colour is a neighbouring hue.");
    }
  } else {
    const tinted = a.clusters.find((c) => c.lch[1] >= 0.01);
    const h = tinted ? tinted.lch[2] : 250;
    primary = [clamp(a.ink, 0.3, 0.55), 0.03, h];
    secondary = [0.6, 0.12, h];
    askAdmin = true;
    notes.push("Your logo has no colour, so the theme is neutral with a steel-blue highlight. You can pick a brand colour instead.");
  }
  const spec = cleanThemeSpec({ v: 1, primary, secondary, variation, vibrancy: 1, radius: "default", font: "inter", source: { kind: a.kind, tone: a.tone, shape: a.shape }, askAdmin });
  return { spec: /** @type {ThemeSpec} */ (spec), notes };
}

/**
 * A ThemeSpec from a brand colour someone picked (a monochrome logo, or no logo).
 * @param {string} hex
 * @param {Variation} [variation]
 */
export function specFromColour(hex, variation = "balanced") {
  const [L, C, h] = hexLch(hex);
  /** @type {Vec3} */ const primary = [L, Math.max(C, 0.06), h];
  return /** @type {ThemeSpec} */ (cleanThemeSpec({ v: 1, primary, secondary: [0.62, Math.min(Math.max(C, 0.06), 0.14), (h + 35) % 360], variation, vibrancy: 1, radius: "default", font: "inter", source: null, askAdmin: false }));
}

/**
 * The only shape a theme may have, from anything (a request body, a database row). Unknown keys are dropped,
 * numbers are clamped and rounded, and anything else is refused: null.
 * @param {unknown} raw
 * @returns {ThemeSpec | null}
 */
export function cleanThemeSpec(raw) {
  let r = raw;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = /** @type {Record<string, unknown>} */ (r);
  if (o.v !== 1) return null;
  /** @returns {Vec3 | null} */
  const lch = (/** @type {unknown} */ v) => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
    const round = (/** @type {number} */ x, /** @type {number} */ d) => Math.round(x * 10 ** d) / 10 ** d;
    return [round(clamp(v[0], 0, 1), 4), round(clamp(v[1], 0, 0.37), 4), round(((v[2] % 360) + 360) % 360, 2)];
  };
  const primary = lch(o.primary);
  const secondary = lch(o.secondary);
  if (!primary || !secondary) return null;
  const pick = (/** @type {unknown} */ v, /** @type {readonly string[]} */ list) => (typeof v === "string" && list.includes(v) ? v : null);
  const variation = pick(o.variation, VARIATIONS);
  const radius = pick(o.radius ?? "default", Object.keys(RADII));
  const font = pick(o.font ?? "inter", Object.keys(FONTS));
  const vib = o.vibrancy ?? 1;
  if (!variation || !radius || !font || typeof vib !== "number" || !Number.isFinite(vib)) return null;
  /** @type {ThemeSource | null} */ let source = null;
  if (o.source && typeof o.source === "object") {
    const s = /** @type {Record<string, unknown>} */ (o.source);
    const kind = pick(s.kind, KINDS);
    const tone = pick(s.tone, TONES);
    const shape = pick(s.shape, SHAPES);
    if (kind && tone && shape) source = /** @type {ThemeSource} */ ({ kind, tone, shape });
  }
  return {
    v: 1,
    primary,
    secondary,
    variation: /** @type {Variation} */ (variation),
    vibrancy: Math.round(clamp(vib, 0.5, 1.5) * 100) / 100,
    radius: /** @type {Radius} */ (radius),
    font: /** @type {Font} */ (font),
    source,
    askAdmin: o.askAdmin === true,
  };
}

// ---------- 3. generation ----------
const STEPS = /** @type {const} */ ({ 50: 0.975, 100: 0.945, 200: 0.885, 300: 0.8, 400: 0.71, 500: 0.62, 600: 0.54, 700: 0.46, 800: 0.38, 900: 0.3, 950: 0.22 });
/** A 50–950 scale: fixed lightness steps, chroma following the seed and easing off at the ends. @param {Vec3} seed */
export function scale([, C, h]) {
  /** @type {Record<string, string>} */ const out = {};
  for (const [k, L] of Object.entries(STEPS)) out[k] = lchHex([L, C * Math.max(0.25, 1 - ((L - 0.58) / 0.48) ** 2), h]);
  return out;
}
/**
 * The contrast fixer: moves a colour's OKLCH lightness (hue and chroma kept) away from its backgrounds until every
 * pair reaches `min`, and records the change.
 * @param {string[]} log
 * @param {string} name
 * @param {string} fg
 * @param {string[]} bgs
 * @param {number} min
 */
function ensure(log, name, fg, bgs, min) {
  if (bgs.every((b) => contrast(fg, b) >= min)) return fg;
  const [L, C, h] = hexLch(fg);
  const darker = lum(bgs[0]) > 0.18;
  for (let x = L, i = 0; i < 100; i++) {
    x += darker ? -0.01 : 0.01;
    const c = lchHex([x, C, h]);
    if (bgs.every((b) => contrast(c, b) >= min)) {
      log.push(`${name}: ${fg} → ${c} (${min}:1)`);
      return c;
    }
  }
  return darker ? "#000000" : "#ffffff";
}
const WHITE = "#ffffff";
/** The light text the sidebar always carries. */
export const SIDEBAR_INK = "#eef2f6";

/**
 * @typedef {Object} ThemeTokens
 * @property {string} page
 * @property {string} card
 * @property {string} text
 * @property {string} muted
 * @property {string} faint
 * @property {string} border
 * @property {string} track
 * @property {string} grid
 * @property {string} inputBg
 * @property {string} inputLine
 * @property {string} button     a fill that carries white text (4.5:1)
 * @property {string} link
 * @property {string} focus
 * @property {string} secondary
 * @property {string} sidebarTop
 * @property {string} sidebar
 * @property {string} sidebarEnd
 * @property {string} navActive  the active page's edge and icons on the sidebar
 * @property {string} header     the page header band (or the card colour)
 * @property {string | null} headerEnd  the band's gradient end (Immersive)
 * @property {string | null} glow
 */

/**
 * Every colour of the theme for one mode, each pair checked: body text 7:1 (AAA), other text, links and button text
 * 4.5:1, focus, the secondary accent and the active page 3:1 or more. With `highContrast` (prefers-contrast: more)
 * every text pair is 7:1 and borders are drawn darker.
 * @param {ThemeSpec} spec
 * @param {Mode} mode
 * @param {{ highContrast?: boolean }} [o]
 * @returns {{ tokens: ThemeTokens; log: string[] }}
 */
export function themeTokens(spec, mode, { highContrast = false } = {}) {
  /** @type {string[]} */ const log = [];
  const [Lp, C0, hp] = spec.primary;
  const [, Cs0, hs] = spec.secondary;
  const Cp = Math.min(0.3, C0 * spec.vibrancy);
  const Cs = Math.min(0.3, Cs0 * spec.vibrancy);
  const variation = spec.variation;
  const dark = mode === "dark";
  const n = (/** @type {number} */ L, C = dark ? 0.014 : 0.01) => lchHex([L, C, hp]); // a neutral leaning to the brand
  const page = dark ? n(0.17) : n(0.975, 0.006);
  const card = dark ? n(0.21) : WHITE;
  const surfaces = [page, card];
  const text = ensure(log, "text", dark ? n(0.95, 0.006) : n(0.21, 0.02), surfaces, 7);
  const muted = ensure(log, "muted text", dark ? n(0.78) : n(0.45), surfaces, highContrast ? 7 : 4.5);
  const faint = ensure(log, "faint text", dark ? n(0.68) : n(0.52), surfaces, highContrast ? 7 : 4.5);
  const border = highContrast ? ensure(log, "border", dark ? n(0.55) : n(0.55), surfaces, 3) : dark ? n(0.31) : n(0.9);
  const track = dark ? n(0.27) : n(0.945);
  const grid = dark ? n(0.245) : n(0.955);
  const inputBg = dark ? n(0.19) : WHITE;
  const inputLine = highContrast ? border : dark ? n(0.36) : n(0.86);
  // The brand, re-tuned per mode: on dark surfaces lighter and a little less chroma, so it glows rather than vibrates.
  /** @type {Vec3} */ const brandDark = [clamp(Lp + 0.2, 0.7, 0.8), Cp * 0.85, hp];
  // Buttons carry white text in both modes (the app's rule), so the fill is the light-mode brand, darkened if needed.
  const button = ensure(log, "button", lchHex([Math.min(0.56, Lp), Cp, hp]), [WHITE], highContrast ? 7 : 4.5);
  const linkMin = highContrast ? 7 : 4.5;
  const link = ensure(log, "link", lchHex(dark ? brandDark : [Math.min(0.5, Lp), Cp, hp]), surfaces, linkMin);
  const focus = ensure(log, "focus ring", lchHex(dark ? brandDark : [0.55, Cp, hp]), surfaces, 3);
  const secondary = ensure(log, "secondary accent", lchHex(dark ? [0.74, Cs * 0.85, hs] : [0.55, Cs, hs]), surfaces, 3);
  // Sidebar: always dark, with light text; how much brand it carries is the variation.
  const sbC = variation === "subtle" ? (dark ? 0.012 : 0.015) : variation === "balanced" ? Math.min(Cp * 0.55, 0.085) : Math.min(Cp, 0.13);
  // Its gradient's three stops (a lighter top, the base, a darker end) are darkened together, hue and chroma kept,
  // until the sidebar's light text passes on every one of them.
  const stops = (/** @type {number} */ L) => [
    lchHex([L + 0.05, sbC, variation === "immersive" ? hs : hp]),
    lchHex([L, sbC, hp]),
    variation === "immersive" ? lchHex([L - 0.04, Math.min(Cs, 0.12), hs]) : lchHex([L - 0.05, sbC, hp]),
  ];
  let sbL = dark ? (variation === "immersive" ? 0.26 : 0.2) : variation === "immersive" ? 0.32 : 0.25;
  let sbStops = stops(sbL);
  while (sbStops.some((s) => contrast(s, SIDEBAR_INK) < (highContrast ? 7 : 4.5)) && sbL > 0.1) sbStops = stops((sbL -= 0.01));
  const sidebar = sbStops[1];
  const sidebarEnd = sbStops[2];
  const navActive = ensure(log, "active page (sidebar)", lchHex([0.8, Math.min(variation === "subtle" ? Cp : Cs, 0.14), variation === "subtle" ? hp : hs]), sbStops, 4.5);
  const header = variation === "subtle" ? card : variation === "balanced" ? (dark ? n(0.23, Math.min(Cp * 0.3, 0.03)) : lchHex([0.965, Math.min(Cp * 0.25, 0.025), hp])) : dark ? lchHex([0.26, Math.min(Cp * 0.5, 0.06), hp]) : lchHex([0.94, Math.min(Cp * 0.4, 0.04), hp]);
  const headerEnd = variation === "immersive" ? (dark ? lchHex([0.26, Math.min(Cs * 0.5, 0.06), hs]) : lchHex([0.94, Math.min(Cs * 0.4, 0.04), hs])) : null;
  // Headings sit on the header band too.
  for (const bg of [header, headerEnd].filter(Boolean)) if (contrast(text, /** @type {string} */ (bg)) < 7) log.push(`text on header ${bg}: ${contrast(text, /** @type {string} */ (bg)).toFixed(2)}:1`);
  const glow = variation === "immersive" && !highContrast ? lchHex([dark ? 0.7 : 0.6, Cp, hp]) : null;
  return {
    tokens: { page, card, text, muted, faint, border, track, grid, inputBg, inputLine, button, link, focus, secondary, sidebarTop: sbStops[0], sidebar, sidebarEnd, navActive, header, headerEnd, glow },
    log,
  };
}

/**
 * The pairs that must pass, with their target, for tests and the admin page's checklist.
 * @param {ThemeTokens} t
 * @param {{ highContrast?: boolean }} [o]
 * @returns {{ name: string; fg: string; bg: string; min: number; ratio: number; ok: boolean }[]}
 */
export function contrastChecks(t, { highContrast = false } = {}) {
  const hc = highContrast ? 7 : 4.5;
  /** @type {[string, string, string, number][]} */ const pairs = [
    ["text on page", t.text, t.page, 7],
    ["text on card", t.text, t.card, 7],
    ["muted text on page", t.muted, t.page, hc],
    ["muted text on card", t.muted, t.card, hc],
    ["faint text on card", t.faint, t.card, hc],
    ["link on page", t.link, t.page, hc],
    ["link on card", t.link, t.card, hc],
    ["button text", WHITE, t.button, hc],
    ["focus ring on card", t.focus, t.card, 3],
    ["secondary on card", t.secondary, t.card, 3],
    ["sidebar text", SIDEBAR_INK, t.sidebar, hc],
    ["sidebar text (top)", SIDEBAR_INK, t.sidebarTop, hc],
    ["sidebar text (end)", SIDEBAR_INK, t.sidebarEnd, hc],
    ["active page on sidebar", t.navActive, t.sidebar, 4.5],
    ["text on header", t.text, t.header, 7],
  ];
  if (t.headerEnd) pairs.push(["text on header end", t.text, t.headerEnd, 7]);
  return pairs.map(([name, fg, bg, min]) => {
    const ratio = contrast(fg, bg);
    return { name, fg, bg, min, ratio, ok: ratio >= min - 0.005 };
  });
}

// ---------- charts, checked under colour-vision deficiencies ----------
// Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear sRGB.
const CVD = /** @type {const} */ ({
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
});
/** @param {string} hex @param {readonly (readonly number[])[]} M @returns {Vec3} */
const simulate = (hex, M) => {
  const l = hexLin(hex);
  return linToLab(/** @type {Vec3} */ (M.map((row) => clamp(row[0] * l[0] + row[1] * l[1] + row[2] * l[2], 0, 1))));
};
/** The minimum OKLab distance between series colours that sit side by side in a chart. */
export const CHART_MIN_DISTANCE = 0.06;
/**
 * The closest pair of a palette, with normal vision and under each simulated deficiency.
 * @param {string[]} pal
 * @returns {Record<"normal" | keyof typeof CVD, { min: number; pair: [number, number] }>}
 */
export function cvdReport(pal) {
  /** @type {any} */ const out = {};
  for (const [name, M] of /** @type {[string, readonly (readonly number[])[] | null][]} */ ([["normal", null], ...Object.entries(CVD)])) {
    const labs = pal.map((h) => (M ? simulate(h, M) : linToLab(hexLin(h))));
    let min = Infinity;
    /** @type {[number, number]} */ let pair = [0, 1];
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const d = dist(labs[i], labs[j]);
        if (d < min) [min, pair] = [d, [i, j]];
      }
    }
    out[name] = { min, pair };
  }
  return out;
}
/**
 * 8 series colours: the primary and secondary hues first, then golden-angle hues, alternating lightness. Then, while
 * any pair is closer than CHART_MIN_DISTANCE with normal vision or under a simulated deficiency, the one lightness
 * change that best raises the closest distance is made. Series that still clash are listed for a pattern.
 * @param {ThemeSpec} spec
 * @param {Mode} mode
 * @returns {{ palette: string[]; patterns: number[]; fixes: string[] }}
 */
export function chartPalette(spec, mode) {
  const dark = mode === "dark";
  const hp = spec.primary[2];
  const hs = spec.secondary[2];
  const Ls = dark ? [0.7, 0.82, 0.62, 0.76, 0.88, 0.66, 0.8, 0.58] : [0.52, 0.7, 0.6, 0.44, 0.78, 0.56, 0.66, 0.4];
  const hues = [hp, hs];
  for (let k = 1; hues.length < 8; k++) {
    const h = (hp + k * 137.508) % 360;
    if (k > 40 || hues.every((x) => hueDiff(x, h) >= 22)) hues.push(h);
  }
  const pal = hues.map((h, i) => lchHex([Ls[i], 0.14, h]));
  /** @type {string[]} */ const fixes = [];
  const worstOf = (/** @type {string[]} */ p) => Math.min(...Object.values(cvdReport(p)).map((v) => v.min));
  for (let pass = 0; pass < 10; pass++) {
    const worst = Object.entries(cvdReport(pal)).sort((a, b) => a[1].min - b[1].min)[0];
    if (worst[1].min >= CHART_MIN_DISTANCE) break;
    /** @type {{ j: number; hex: string; score: number } | null} */ let best = null;
    for (const j of worst[1].pair) {
      const [, C, h] = hexLch(pal[j]);
      // Kept within a band that still reads against the page: not too dark on dark, not too pale on light.
      for (let L = dark ? 0.55 : 0.38; L <= (dark ? 0.9 : 0.78); L += 0.03) {
        const cand = pal.slice();
        cand[j] = lchHex([L, C, h]);
        const score = worstOf(cand);
        if (!best || score > best.score) best = { j, hex: cand[j], score };
      }
    }
    if (!best || best.score <= worstOf(pal) + 1e-4) break;
    fixes.push(`series ${best.j + 1}: ${pal[best.j]} → ${best.hex} (${worst[0]})`);
    pal[best.j] = best.hex;
  }
  /** @type {Set<number>} */ const patterns = new Set();
  for (const v of Object.values(cvdReport(pal))) if (v.min < CHART_MIN_DISTANCE) v.pair.forEach((i) => patterns.add(i));
  return { palette: pal, patterns: [...patterns].sort(), fixes };
}

// ---------- 4. the style sheet ----------
/** The only CSS variables a theme may set (tests/noOrgBranding.test.js checks status colours are never among them). */
export const THEME_VARIABLES = /** @type {const} */ ([
  "accent-solid", "accent-light", "accent-dark", "canvas", "card", "text", "heading", "muted", "faint", "border", "track", "grid",
  "input-bg", "input-line", "focus", "org-secondary", "org-sb-top", "org-sb", "org-sb-end", "org-sb-hi", "org-sb-ink",
  "org-header", "org-header-end", "org-glow", "org-font", "r-sm", "r-md", "r-lg",
  "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6", "cat-7", "cat-8",
]);
/** The futuristic theme keeps its own surfaces: only its link colour comes from the brand, checked against them. */
const FUTURISTIC_SURFACES = ["#0b0c22", "#13163a"];

/**
 * @param {ThemeTokens} t
 * @param {string[]} chart
 * @param {"light" | "dark"} mode
 */
function declarations(t, chart, mode) {
  /** @type {[string, string][]} */ const d = [
    [mode === "light" ? "accent-light" : "accent-dark", t.link],
    ["canvas", t.page], ["card", t.card], ["text", t.text], ["heading", t.text], ["muted", t.muted], ["faint", t.faint],
    ["border", t.border], ["track", t.track], ["grid", t.grid], ["input-bg", t.inputBg], ["input-line", t.inputLine], ["focus", t.focus],
    ["org-secondary", t.secondary], ["org-sb-top", t.sidebarTop], ["org-sb", t.sidebar], ["org-sb-end", t.sidebarEnd],
    ["org-sb-hi", t.navActive], ["org-sb-ink", t.navActive], ["org-header", t.header], ["org-header-end", t.headerEnd ?? t.header],
    ["org-glow", t.glow ?? "transparent"],
    ...chart.map((c, i) => /** @type {[string, string]} */ ([`cat-${i + 1}`, c])),
  ];
  if (mode === "light") d.unshift(["accent-solid", t.button]);
  return d.map(([k, v]) => `--${k}: ${v};`).join(" ");
}

/**
 * The style sheet for a theme: light and dark, the high-contrast versions (prefers-contrast: more), and the
 * futuristic theme's link colour. Every value is a #rrggbb this file made, a radius in px or a font stack from FONTS.
 * @param {ThemeSpec} spec
 */
export function themeCss(spec) {
  const light = themeTokens(spec, "light").tokens;
  const dark = themeTokens(spec, "dark").tokens;
  const hcLight = themeTokens(spec, "light", { highContrast: true }).tokens;
  const hcDark = themeTokens(spec, "dark", { highContrast: true }).tokens;
  const chartL = chartPalette(spec, "light").palette;
  const chartD = chartPalette(spec, "dark").palette;
  const [sm, md, lg] = RADII[spec.radius];
  const futuristicLink = ensure([], "link", dark.link, FUTURISTIC_SURFACES, 4.5);
  return [
    `:root { ${declarations(light, chartL, "light")} --org-font: ${FONTS[spec.font]}; --r-sm: ${sm}px; --r-md: ${md}px; --r-lg: ${lg}px; }`,
    `:root[data-theme="dark"] { ${declarations(dark, chartD, "dark")} }`,
    `:root[data-theme="futuristic"] { --accent-dark: ${futuristicLink}; }`,
    `@media (prefers-contrast: more) { :root { ${declarations(hcLight, chartL, "light")} } :root[data-theme="dark"] { ${declarations(hcDark, chartD, "dark")} } }`,
  ].join("\n");
}

/**
 * How a logo should be shown on a dark surface when there's no dark version: a dark single-colour or monochrome logo
 * is recoloured white; anything with several colours sits on a light plate.
 * @param {ThemeSpec | null | undefined} spec
 * @returns {"recolour" | "plate"}
 */
export function darkLogoTreatment(spec) {
  const s = spec?.source;
  return s && s.tone === "dark-on-transparent" && (s.kind === "monochrome" || s.kind === "single-colour") ? "recolour" : "plate";
}
