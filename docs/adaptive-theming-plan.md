# Logo-driven adaptive theming: algorithm and plan (step 1, for approval)

Status: **approved and built** (2026-11-27; see UPGRADE-LOG). The step-1 gallery:

- Preview: `docs/design/adaptive-theme-preview.html` (open in a browser; everything is computed live in the page)
- Logos in the preview: Omnicontact's real logo, plus two invented logos chosen to be as different as possible:
  **Kestrel & Fern** (a two-colour square mark: orange circle, green leaf) and **Monolith Partners** (a black-only wordmark).

All colour work happens in **OKLab / OKLCH** (L = lightness 0–1, C = chroma, h = hue in degrees). Contrast is
checked with the WCAG 2.x formula on the final sRGB hex values.

---

## 1. Extraction: what colours are in the logo

Input: the organisation's own uploaded logo (PNG, JPEG, WebP or SVG rasterised), nothing else.

1. **Downscale** to at most 96 px on the long side (fast, and removes noise).
2. **Background**: if the four corners agree (ΔE < 0.03) and are opaque, that colour is the background and is skipped.
3. **Skip pixels** that are:
   - transparent (alpha < 128), or anti-aliased edges (alpha < 230);
   - near-white or near-black *and* nearly grey (L > 0.95 or L < 0.12, with C < 0.03).
4. **Weight** each kept pixel by `1 + 4 · min(1, C / 0.15)`: area counts, saturated colour counts up to 5× more,
   so a small coloured accent is not drowned by a large grey wordmark.
5. **k-means in OKLab**, k ≤ 5, seeded by farthest weighted point, 12 iterations. Clusters closer than ΔE 0.06 merge.
6. **Classify**:
   - *kind*: monochrome (no cluster with C ≥ 0.035), single-colour, duotone, multicolour (count of hues ≥ 30° apart);
   - *tone*: light-on-transparent (ink L > 0.75), dark-on-transparent (L < 0.45), or mid-tone;
   - *shape*: wide wordmark (aspect > 2.2), square mark (< 1.4), or other.

## 2. Roles

| Role | Rule |
|---|---|
| **Primary** | The cluster with the best score `weight · C^0.6 · (1 − 0.8·|L − 0.6|)`: big, colourful, mid-light. |
| Muted primary | If its chroma is below 0.10, the **hue is kept and chroma raised to 0.12** for the theme (the logo itself is never recoloured). |
| **Secondary** | The next cluster whose hue is ≥ 30° from the primary. If none, derived **analogous**: hue +35°, L 0.62, C ≤ 0.14. |
| **Neutral tint** | L 0.5, C 0.012, at the primary's hue: greys that lean slightly towards the brand. |
| **Monochrome fallback** | No chromatic colour: primary = the ink's tint (L clamped 0.30–0.55, C 0.03), accent = L 0.60 C 0.12 at the ink's hue (250° if pure grey). The admin is told and asked to pick an accent. |
| **Status colours** | Success, warning, danger are **locked**; never taken from the logo. |

## 3. Generation

**Scales.** Each role gets 50–950 steps at fixed lightness (50 = L 0.975 … 950 = L 0.22). Chroma follows
`C · max(0.25, 1 − ((L − 0.58) / 0.48)²)` so very light and very dark steps are calmer. Out-of-gamut colours are
brought into sRGB by **reducing chroma only** (binary search), never by shifting hue.

**Tokens** (per variation × mode): page, card, text, muted text, border, button + on-button, link, focus ring,
secondary, sidebar (top / base / end), sidebar text, active nav, header, header gradient, glow, 8 chart colours.

**Dark mode** is re-tuned, not inverted: brand colour becomes L clamp(Lp + 0.2, 0.70, 0.80), C × 0.85; surfaces
are near-black at the brand hue.

**Three variations**

| | Sidebar chroma | Header | Feel |
|---|---|---|---|
| Subtle | 0.012–0.015 (near-neutral graphite) | plain | Brand only on buttons, links, focus |
| **Balanced** (default) | min(Cp × 0.55, 0.085) | tinted | Branded sidebar, calm content |
| Immersive | min(Cp, 0.13) | brand gradient + glow | Strong brand presence |

**The contrast fixer.** Every pair is checked; if one fails, the foreground's OKLCH lightness is stepped by 0.01
(hue and chroma kept) until it passes, and the change is logged (shown under "Contrast and fixes" in the preview).

| Pair | Target |
|---|---|
| Body text on page / card | 7:1 (AAA) |
| Muted text, links, button text, sidebar text | 4.5:1 (AA) |
| Focus ring, active-nav marker, borders that carry meaning | 3:1 |

**Chart palette.** Hues: primary, secondary, then golden-angle steps (at least 22° apart); alternating lightness
pattern; C 0.14. It is then simulated under protanopia, deuteranopia and tritanopia (Machado matrices). While any
pair is closer than ΔE 0.06 under any vision, a greedy step moves one colour of the closest pair to the lightness
that best raises the minimum. Pairs that still clash get **patterns** (hatching) as a second cue.

## 4. Results (see the preview page)

| Logo | Classified | Roles | Contrast | Charts under colour-blindness |
|---|---|---|---|---|
| Omnicontact | single-colour, dark on transparent, wordmark | Primary navy h 255 (chroma raised 0.046 → 0.12); secondary violet h 290 (analogous) | all 6 pass | distinct in all 4 visions, no patterns needed |
| Kestrel & Fern | duotone, mid-tone, square mark | Orange h 45, green h 152 (both from the logo) | all 6 pass | distinct in all 4 |
| Monolith Partners | monochrome wordmark | Ink grey-blue + steel-blue accent; admin is asked to choose | all 6 pass | distinct in all 4 |

Changes after the first run: Omnicontact's first result was dull (greyish navy, mustard complementary secondary).
The muted-chroma rule and the analogous secondary fixed that, and the new chart step removed the need for patterns.

## 5. Adaptive behaviour (planned)

- Follows `prefers-color-scheme`; user override stays in personal preferences.
- **Logo in dark mode**: use the uploaded dark logo if any; else, for a dark-on-transparent mono logo, a recoloured
  light version; else a soft light backplate (the current approach).
- `prefers-contrast: more` → text targets 7:1 everywhere, borders 4.5:1. `forced-colors` → system colours, no
  gradients. `prefers-reduced-motion` → no crossfade.
- Print and email: a light, ink-saving token set (no gradients, no dark surfaces).
- Theme switches crossfade over 200 ms; tokens are set before first paint (no flash).
- Deferred unless you want them: per-workspace hue shift, evening palette, density by screen.

## 6. Storage and safety

- **ThemeSpec**: a small JSON object (roles as OKLCH numbers, variation, vibrancy, radius, density, font choice from
  a fixed list). Validated on the server against a strict schema; the server turns it into tokens. **No raw CSS is
  ever stored or injected**; only known CSS variable names with hex values.
- **`org_themes` table**: id, organisation, version, status (`draft` / `published` / `archived`), spec, created by,
  published by, timestamps. Row-level security by organisation, like every other table.
- Draft → "preview as me" → publish; history list with one-click rollback (rollback publishes a copy of an old version).
- Only that organisation's admins, or Platform Administrators, may publish. Other organisations' themes return 404.
- Logo analysis runs in the admin's browser on the organisation's own logo; the server re-validates the result.
- New organisations get Balanced automatically. Changing the logo creates a new **draft** (never auto-publishes)
  and notifies admins.

## 7. Admin experience

Branding → **Theme** (a new page; Settings → Appearance stays the personal light/dark preference):
"We generated a theme from your logo" → swatches and roles → the three variations → live preview (dashboard,
board, report, sign-in, email, PDF; light and dark; desktop and mobile) → fine-tune (swap colours, vibrancy
slider, radius, density, font from a short list) → save draft / preview as me / publish → history.

## 8. Phases

1. Engine as a module in `src/` + unit tests (12 fixture logos, AA in both modes, colour-vision distinctness).
2. Migration `0024_org_themes`, API (get / save draft / publish / rollback / history), tenant-isolation tests.
3. Theme page for admins; token application in the app replacing today's accent/sidebar logic (kept as fallback).
4. Adaptive modes (contrast, forced colours, print, email), dark-mode logo handling, crossfade.
5. Visual snapshots, sample gallery, screenshots/GIF, docs (API, UPGRADE-LOG, DECISIONS).

## 9. Things to know

- The stack is JavaScript with JSDoc, not TypeScript; the engine will follow that.
- Commit `fb60770` (Omnicontact's sidebar colours) is **not live yet**. This work would supersede its colour logic
  but keep its columns as manual overrides, so it is still safe to release first.
- Font choice adds a web-font download; I'd limit it to 3–4 fonts and load only the chosen one.
- This is a large feature (about five phases); each phase is releasable on its own.
