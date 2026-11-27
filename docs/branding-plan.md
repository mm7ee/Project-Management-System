# Plan: rename to Project Management System, and branding per organisation

Status: **approved and built** (2026-11-27). The plan-stage mock-ups are replaced by screenshots of the real thing:
[docs/screenshots/branding/index.html](screenshots/branding/index.html).

## What is already in place

- **Multi-tenancy is live:**
  - organisations → workspaces → sign-in
  - the organisation is chosen by code, or by `#/o/<code>`
  - after sign-in, people in several workspaces choose one
- **Phase 1 of the admin module** gave each organisation a `logo` (PNG/JPEG/WebP data, ≤ 200 KB) and a `colour`.
  - They are shown only after sign-in, from `/api/org/logo`.
  - DECISIONS.md (admin module, phase 1) recorded: *"The sign-in page stays plain, so it never reveals which
    organisations exist."*
- **The Omni Contact logo is hard-coded in 7 places:**
  - `public/omni-logo.png` and `public/omni-logo-white.png`
  - used by the sidebar, the sign-in page, the executive page, the BI dashboard, the report cover, the PCN form and
    one CSS rule
- **The colour system is Omni Contact's.** `styles.css` is built on Omni's indigo `#2c3280`, Penn blue `#011f5b`,
  royal blue `#0039a6` and signature red `#ed0000`. So "neutral platform" means a new base palette, not only a new
  logo.
- **Not in R2:** no R2 bucket is bound. Logos will stay in Postgres (below).

Corrections to the brief:
- The code is **JavaScript with JSDoc types** (checked by `tsc --checkJs`), not TypeScript, so the config is
  `src/data/brand.js`.
- The folders are now `project-management-system-frontend/` and `-backend/`.

## Decisions I need from you

1. **Showing the organisation before sign-in reverses a recorded decision.** State B needs a public
   `GET /api/public/org/:code/branding`. Any public lookup by code tells a visitor whether a code exists, which is
   exactly what the current design avoids. **Proposal:** accept it, with these limits:
   - Codes are never listed.
   - Unknown, suspended and archived codes all get the same 404 and the same message.
   - The reply carries only the name, the logo and icon addresses, the accent and the tint.
   - Lookups are limited per address (30 a minute, then 429), through Cloudflare's rate-limit binding. (As built:
     30 codes that lead nowhere in 10 minutes, counted in the database, because the binding wasn't strict enough live.)
   - A failed lookup costs the same time as a successful one.
   - DECISIONS.md records the change and why.
2. **Choosing a workspace before sign-in:** the brief puts the workspace choice (Projects, HR…) on the sign-in
   page. That would publish an organisation's list of workspaces to anyone with the code. It contradicts the brief's
   own "only the name, logo and colour", and your earlier rule about not revealing workspaces before sign-in.
   **Proposal:** keep choosing after sign-in, as now, for people in more than one workspace. State B shows the
   organisation, then the sign-in form.
3. **"Ask Pulse"** → **"Ask AI"**. It reads naturally under any organisation's brand and doesn't change if the
   product is renamed again. The AI is told it is "the assistant in {organisation}'s project management system".
4. **Accent colours that fail contrast:** adjust them automatically, and tell the administrator. Pulse keeps the
   administrator's colour as chosen and works out one safe shade for each theme. The settings page shows the shades
   it will use, with a note. Refusing would make admins guess at colours.
5. **SVG logos:** refuse them. PNG, WebP or JPEG only, so no SVG sanitiser to get wrong.
6. **Omnicontact's look after the change:** it gets its logo and its indigo `#2c3280` as the accent. The signature
   red is no longer used: one accent per organisation, and red stays the "danger" colour. Say if Omnicontact should
   keep red for its main buttons instead (a second, optional "action colour").

## Part 1: rename, in one place

**`src/data/brand.js`** is the one place the name lives:

```js
export const BRAND = {
  productName: "Project Management System",
  shortName: "PMS",
  tagline: "Plan, track and deliver your organisation's work in one place.",
  supportEmail: "support@…",            // you tell me the address
  assistantName: "Ask AI",
  poweredBy: "Powered by Project Management System",
};
```

- **Used everywhere the product is named:** the screens and the Worker (emails, digests, the Monday Briefing,
  notifications, Teams posts, Ask AI's instructions, the app manifest, passkeys, exports). `index.html` and
  `sw.js` are static files, so the build fills in their title.
- **The docs:** README, `running-pulse.html` (renamed `running-pms.html`), the admin guide and the API reference say
  "Project Management System (PMS)". UPGRADE-LOG and DECISIONS keep their history, with a dated note.
- **The strings:** I found **133 user-visible lines** naming Pulse or Omni Contact. The full list, each with
  before → after, comes with the work as `docs/rename-list.md`. The main groups:

  | Where | Examples now | After |
  | --- | --- | --- |
  | Names and titles | `<title>Pulse`, manifest "Pulse", "Pulse · Platform", splash and sidebar mark | Project Management System / PMS |
  | Sign-in | "Sign in to Pulse", "The live heartbeat of Omni Contact's projects", "© Omni Contact", "Pulse AI" | State A and B text below |
  | Ask | "Ask Pulse" (button, panel, prompts, errors) | Ask AI |
  | Emails and Teams | "Sent by Pulse…", "Open Pulse:", password-reset emails, "Test message from Pulse" | the organisation's name and logo, "Powered by PMS" |
  | Help text | "Pulse seals it", "How long Pulse keeps…", "Install Pulse", "Pulse has been updated" | PMS / "this system" |
  | Dashboards and reports | "Pulse overview", the report cover "Pulse · {org}", the executive page "Pulse is where…" | "{workspace} overview", the organisation's cover |
  | Organisation-specific | the PCN form's "OmniContact BPO" header and logo, "Omni Contact Security Essentials" | the signed-in organisation's name and logo |
  | Examples | `Pulse <pulse@omnicontact.biz>` | `PMS <pms@your-company.com>` |

  "Omnicontact" as the **organisation** stays: its code `omnicontact`, its name, its data.

**Internal names left alone**, for you to decide later. Changing these breaks sessions, integrations or deployment,
or needs a Cloudflare move:

| Identifier | What it is | Risk if renamed |
| --- | --- | --- |
| `omni-tracker` | the app Worker | MFA_KEY can't be moved (the brief says keep) |
| `pulse` | the gateway Worker, and so the address `pulse.utsa--wanza--ortfolio.workers.dev` | **visible to users.** A new address breaks passkeys (bound to the host name), installed apps, links in old emails and Postman |
| `omni_session`, `pulse_platform` | sign-in cookies | everyone is signed out once |
| `pulse_` | API token prefix | existing tokens stop working |
| `X-Pulse-Signature`, `Pulse-Webhooks/1` | webhook signature header and user agent | breaks every receiving system |
| `pulse_app` | the database role for row-level security | migration work, no benefit |
| `pulse-db` / `omni-tracker` | the Hyperdrive config / the old D1 database | none visible |
| `pulse-template`, `pulse-template-ws` | the template organisation's ids | none visible |
| `pulse.*` | localStorage keys | settings reset per browser |
| `pulse-frontend`, `pulse-backend`, `PulseMark`, `.pulse-*` CSS | package and code names | none visible (`PulseMark` is replaced anyway) |

## Part 2: the three states

See the mock-ups. In short:

- **State A, the platform page** (`/`, no organisation chosen):
  - **Wordmark:** "**PMS**" in a heavy weight over "Project Management System", in platform ink, with no image
    logo.
  - **Text:** one line of value, then the "Organisation code" field and **Continue**. Underneath, "Find your
    organisation" opens a short help note ("Use the sign-in link your administrator sent you, or ask them for your
    code"). Nothing is listed or looked up by email, which would be another way to probe.
  - **Background:** a soft gradient with a faint CSS dot grid, and no images.
  - **Neutral platform tokens** (`--brand-*`): graphite ink `#1f2933`, steel blue `#3e5c76`, mist `#eef2f6`.
  - **Tab:** title "Project Management System"; the favicon is an inline SVG of the letters "PMS". The installable
    app icons (PNG) become the same monogram, made at build time.
  - **Existing visitors:** someone who has used an organisation on this device goes straight to State B, as now.
    "Not your organisation?" brings them back to A.
- **State B, the organisation's sign-in** (`#/o/omnicontact`, or after Continue):
  - **The look:** the logo (or monogram), "Sign in to Omnicontact", and the accent on the button and focus rings.
  - **The form:** username and password (then two-step, unchanged). Below it, "Not your organisation?", and in the
    footer, small: "Powered by Project Management System".
  - **Tab:** "Omnicontact · PMS"; the favicon is the organisation's icon, or its monogram.
  - **Unknown codes:** an unknown, suspended or archived code stays on State A with one message: "We couldn't find
    that organisation. Check the code with your administrator." The sign-in reply is unchanged: one generic message.
  - **Other screens** that come before sign-in follow it: password reset and the two-step and passkey steps.
- **State C, signed in:**
  - **Sidebar, top-left:** the logo (light or dark to suit the theme) in a fixed box with `object-fit: contain`,
    then the workspace pill and its switcher. Collapsed, it shows the square icon.
  - **The accent** sets only `--accent`, `--accent-ink`, `--accent-soft`, `--on-accent`, `--link` and `--focus`, and
    the active navigation. Status colours (`--success`, `--warning`, `--danger`, `--info`) and the chart palette
    never change.
  - **"Powered by PMS"** appears in the About panel (Settings) and in small print in the footer.
- **Outside the app:**
  - **Emails and digests:** the organisation's logo from its public address, its name and its accent on the button,
    with "Powered by Project Management System" in the footer.
  - **PDF and report covers, Excel exports:** the organisation's logo and name.
  - **The executive page, view-only links and the customer portal:** the organisation's branding.
  - **Teams posts:** the organisation's name.

## Part 3: branding settings and storage

- **Settings → Organisation → Branding** (Organisation Administrators; Platform Administrators from `/platform`):
  - display name
  - logo for light backgrounds, logo for dark backgrounds
  - square icon
  - accent colour
  - optional sign-in background tint
  - **a live preview** of A, B and C, with a theme switch
- **The monogram fallback:** up to two initials of the display name ("Omnicontact" → "O", "Demo Co" → "DC") in a
  rounded square of the accent, with text colour picked for contrast. The same code draws it in the app, the
  favicon and emails.
- **Contrast (WCAG AA):**
  - **What's checked:** for each theme (light, dark, futuristic), the accent as text and links against the page and
    card (4.5:1), white or ink text on accent buttons (4.5:1), and the focus ring against the page (3:1).
  - **If it fails:** the shade is moved in lightness (same hue) until it passes, and saved as that theme's shade.
  - **Where:** in `src/data/brandColour.js`, shared by the screen and the Worker, so the server checks the same
    rules.
- **Uploads:**
  - **Types:** PNG, WebP or JPEG; the file type is read from the bytes. SVG and anything else is refused.
  - **Size and resizing:** files up to 512 KB are accepted. In the browser they are resized on a canvas: logos to
    at most 480×160, the icon to 256×256 (square, contained). They are re-encoded as WebP (PNG if that's smaller).
    Re-encoding also strips metadata and anything hidden in the file.
  - **The server re-checks:** the type from the bytes, the size (≤ 200 KB after resizing) and the dimensions.
- **Storage:** a new table `organization_branding` holds one row per organisation:
  - its fields: `display_name`, `logo_light`, `logo_dark`, `icon` (as `bytea`), `accent`, `accent_shades` (json),
    `signin_tint`, `version`
  - under row-level security: the organisation reads and updates its own row
  - the existing `organizations.logo` and `colour` move into it, and those two columns are dropped in a later
    release, once the new code is live
- **Serving:**
  - `GET /api/public/org/:code/branding` → `{ name, accent, shades, logo, logoDark, icon, tint }`. These are
    addresses like `/api/public/org/omnicontact/logo?v=7`.
  - The images are served with `Cache-Control: public, max-age=31536000, immutable`, `nosniff` and their real
    content type. `?v=` changes with each upload.
  - The private `/api/org/logo` is retired.
- **Who may change it:** that organisation's Organisation Administrator, or a Platform Administrator. Every change
  goes into the audit log ("logo replaced", "accent changed from → to").

## Part 4: migration

- **Migration `0021_branding.sql`** (with its reverse):
  - creates `organization_branding` and its policies
  - copies every organisation's existing logo and colour into it
  - sets Omnicontact's display name, accent `#2c3280`, and its two logos, embedded as data (the files are about
    3.9 KB each)
  - adds the rate-limit binding to `wrangler.jsonc`
- **Then the code:**
  - deletes `public/omni-logo*.png` and `src/brand.js` (`COMPANY_URL`)
  - removes the CSS rule that swaps in the white logo, and every hard-coded `<img>`
  - replaces the heartbeat icons in `public/` with the PMS monogram
- **A test** fails if any file outside the migration mentions `omni-logo`, `omnicontact.biz` or "Omni Contact".

## Part 5: quality

- **Vitest:**
  - **Contrast:** the ratio maths against known pairs, every theme, and that adjusted shades always pass.
  - **The monogram:** initials (one word, two words, accents, emoji, empty), and the colour of its text.
  - **The public endpoint:** a known code gives only the allowed fields. Unknown, suspended and archived codes give
    the same 404, and nothing else leaks. The rate limit gives 429.
  - **Uploads:** SVG, HTML renamed `.png`, oversized and wrong-dimension files are refused. Only that organisation's
    admin, or a Platform Administrator, may save.
  - **No leaks between organisations:** State A's page and the platform shell carry no organisation branding.
    Organisation B's branding, emails and exports never carry Omnicontact's name or logo.
- **Screenshots:** States A, B and C, for Omnicontact and for Demo Co (no logo):
  - themes: light, dark and futuristic
  - widths: 1440, 1024, 768 and 390
  - logos: a very wide one and a very tall one, to check the fit
- **Development:** against the Neon dev branch (`npm run dev:api`). I need a browser for the screenshots: the
  built-in browser or Claude in Chrome, if you switch one on, or I'll script it with Playwright locally.
- **Checks:** `npm run build` type-checks cleanly and `npm test` passes, in both folders.
- **Docs:** API reference, Postman, UPGRADE-LOG, and DECISIONS (the branding rules: the platform is neutral; the
  organisation brands its own space; status colours never change with the brand).

## Order of work (each step ends with tests passing)

1. **Brand config and rename:** `brand.js`, the 133 strings, the docs, Ask AI.
2. **State A:** platform tokens, the wordmark, the page, the PMS favicon and app icons.
3. **Branding storage and settings:** the migration, the API, uploads, contrast, the monogram, the settings page
   with its preview.
4. **States B and C:** the public endpoint and rate limit, the sign-in page, the sidebar, the accent tokens, the
   Omni logo removed.
5. **Outside the app:** emails, digests, Teams, PDF and Excel exports, the executive page, view-only links, the
   portal, the PCN.
6. **Screenshots, docs, release:** a dry run of 0021 on a copy of production, then backup, migrate and push.
