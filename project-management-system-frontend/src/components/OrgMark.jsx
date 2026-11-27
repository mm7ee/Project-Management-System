import "./landing.css";
import { initials, solidShade } from "../data/branding";
import { darkLogoTreatment } from "../data/logoTheme";

/** @typedef {import("../data/branding").BrandingView} BrandingView */

/**
 * An organisation's logo, in a fixed box (object-fit: contain, so very wide and very tall logos both fit), or its
 * monogram when it has none: its initials in a rounded square of its accent, so no organisation ever looks broken.
 *  - surface: what it sits on. "dark" uses the logo for dark backgrounds, then the ordinary logo on a light plate.
 *  - icon: the square icon (collapsed sidebar, small places), else the monogram.
 * @param {{ branding: BrandingView; surface?: "light" | "dark"; size?: "sm" | "md" | "lg"; icon?: boolean; className?: string }} props
 */
export default function OrgMark({ branding: b, surface = "light", size = "md", icon = false, className = "" }) {
  const src = icon ? b.icon : surface === "dark" ? (b.logoDark ?? b.logo) : (b.logo ?? b.logoDark);
  // A logo made for light backgrounds, shown on a dark one: a dark one-colour logo (its theme says so) is shown in
  // white; anything else sits on a light plate so it stays readable.
  const onDark = !icon && surface === "dark" && !b.logoDark && !!b.logo;
  const recolour = onDark && darkLogoTreatment(b.theme) === "recolour";
  const plate = onDark && !recolour;
  const lightOnLight = !icon && surface === "light" && !b.logo && !!b.logoDark;
  if (src) {
    return (
      <span className={`org-mark ${icon ? "org-icon" : "org-logo"} ${size} ${plate ? "on-light-plate" : ""} ${lightOnLight ? "on-dark-plate" : ""} ${recolour ? "recoloured" : ""} ${className}`}>
        <img src={src} alt={b.name} />
      </span>
    );
  }
  return (
    <span className={`org-mark org-monogram ${size} ${className}`} style={{ background: solidShade(b.accent) }} role="img" aria-label={b.name}>
      {initials(b.name)}
    </span>
  );
}

/** Which surface the page is on, from the theme (the sidebar is always dark). */
export function pageSurface() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || t === "futuristic" ? "dark" : "light";
}
