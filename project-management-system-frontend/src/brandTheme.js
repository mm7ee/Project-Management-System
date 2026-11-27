// Puts an organisation's branding on the page, or takes it off: the accent tokens, the favicon and the tab title.
// One organisation at a time. Before an organisation is chosen (the platform page) and on the platform's own pages,
// nothing is set, so the page is neutral (styles.css defaults and the PMS favicon).
//
// An organisation sets only three CSS variables (styles.css explains them): --accent-solid for backgrounds with
// white text, --accent-light and --accent-dark for text, links and focus on light and dark surfaces. All three
// are worked out from its accent by src/data/branding.js and already pass WCAG AA. Status colours never change.
import { BRAND, tabTitle } from "./data/brand";
import { monogramSvg, platformIconSvg, sidebarTheme, solidShade, svgDataUrl } from "./data/branding";

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
    setFavicon(svgDataUrl(platformIconSvg()));
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
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
