// Puts an organisation's branding on the page, or takes it off: the accent tokens, the favicon and the tab title.
// One organisation at a time. Before an organisation is chosen (the platform page) and on the platform's own pages,
// nothing is set, so the page is neutral (styles.css defaults and the PMS favicon).
//
// An organisation sets only three CSS variables (styles.css explains them): --accent-solid for backgrounds with
// white text, --accent-light and --accent-dark for text, links and focus on light and dark surfaces. All three
// are worked out from its accent by src/data/branding.js and already pass WCAG AA. Status colours never change.
//
// An organisation with a published theme (generated from its logo, src/data/logoTheme.js) gets that instead: the
// style sheet themeCss builds from its validated ThemeSpec, light and dark, with a high-contrast version. Swapping
// one theme for another crossfades (a view transition, 200 ms) unless reduced motion is asked for.
import { BRAND, tabTitle } from "./data/brand";
import { monogramSvg, platformIconSvg, sidebarTheme, solidShade, svgDataUrl } from "./data/branding";
import { themeCss } from "./data/logoTheme";

/** @typedef {import("./data/branding").BrandingView} BrandingView */

const STYLE_ID = "org-brand";
/** @type {BrandingView | null} */
let current = null;

/** The open organisation's branding (for reports, the PCN and other pages inside the app), or null. */
export const currentBranding = () => current;

/**
 * @param {BrandingView | null | undefined} b
 */
export function applyBranding(b) {
  current = b ?? null;
  const root = document.documentElement;
  let style = /** @type {HTMLStyleElement | null} */ (document.getElementById(STYLE_ID));
  if (!b) {
    style?.remove();
    delete root.dataset.org;
    delete root.dataset.orgSidebar;
    delete root.dataset.orgTheme;
    setFavicon(svgDataUrl(platformIconSvg()));
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (b.theme) {
    const css = themeCss(b.theme);
    const sheet = /** @type {HTMLStyleElement} */ (style);
    const swap = () => {
      sheet.textContent = css;
      root.dataset.orgTheme = /** @type {import("./data/logoTheme").ThemeSpec} */ (b.theme).variation;
      if (b.theme?.variation === "subtle") delete root.dataset.orgSidebar;
      else root.dataset.orgSidebar = "1";
    };
    crossfade(sheet.textContent ?? "", css, swap);
    root.dataset.org = b.code;
    setFavicon(b.icon ?? svgDataUrl(monogramSvg(b.name, b.accent)));
    return;
  }
  delete root.dataset.orgTheme;
  // The values come from cleaned hex colours (#rrggbb), so they are safe to write into a style sheet.
  const solid = solidShade(b.accent);
  // Its own sidebar, if it set one: safe shades worked out from its colours.
  const sb = sidebarTheme(b.sidebar, b.highlight, b.accent);
  style.textContent = [
    `:root { --accent-solid: ${solid}; --accent-light: ${b.shades.light}; --accent-dark: ${b.shades.dark}; }`,
    `:root[data-theme="futuristic"] { --accent-dark: ${b.shades.futuristic}; }`,
    b.tint ? `:root { --org-tint: ${b.tint}; }` : "",
    sb ? `:root { --org-sb-top: ${sb.top}; --org-sb: ${sb.base}; --org-sb-end: ${sb.end}; --org-sb-hi: ${sb.hi}; --org-sb-ink: ${sb.ink}; }` : "",
  ].join("\n");
  root.dataset.org = b.code;
  if (sb) root.dataset.orgSidebar = "1";
  else delete root.dataset.orgSidebar;
  setFavicon(b.icon ?? svgDataUrl(monogramSvg(b.name, b.accent)));
}

/**
 * Applies a new style sheet; when one theme replaces another on screen, through a short crossfade (200 ms, styles.css
 * ::view-transition), unless reduced motion is asked for or the browser can't.
 * @param {string} before
 * @param {string} after
 * @param {() => void} swap
 */
function crossfade(before, after, swap) {
  const doc = /** @type {Document & { startViewTransition?: (cb: () => void) => unknown }} */ (document);
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
  if (before && before !== after && doc.startViewTransition && !still && document.visibilityState === "visible") doc.startViewTransition(swap);
  else swap();
}

/**
 * The tab's icon. The static /favicon.svg is the platform's; an organisation's replaces it while it is open.
 * @param {string} href
 */
function setFavicon(href) {
  for (const rel of ["icon", "shortcut icon"]) {
    document.querySelectorAll(`link[rel="${rel}"]`).forEach((l) => l.remove());
  }
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = href;
  document.head.appendChild(link);
}

/**
 * The tab title: "Dashboard · Omnicontact · PMS" inside an organisation, "Project Management System" outside.
 * @param {string | null | undefined} orgName
 * @param {string | null | undefined} [page]
 */
export function setTitle(orgName, page) {
  document.title = orgName ? tabTitle(page, orgName) : page ? `${page} · ${BRAND.productName}` : BRAND.productName;
}
