// The platform is neutral: no organisation's branding is built into the product (docs/branding-plan.md, part 4).
// Omnicontact's logos live only in its own branding row (migration 0021); nothing else in the code refers to them,
// and the platform's page, icons and manifest carry no organisation at all.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const FRONT = fileURLToPath(new URL("../", import.meta.url));
const BACK = fileURLToPath(new URL("../../project-management-system-backend/", import.meta.url));

/** Every file under a folder, except dependencies, builds and the one migration that moves the logos. */
function files(/** @type {string} */ dir) {
  /** @type {string[]} */ const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".wrangler", ".vite", "backups"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (!/0021_branding(\.down)?\.sql$/.test(name) && /\.(js|jsx|mjs|css|html|json|jsonc|sql|svg)$/.test(name)) out.push(p);
  }
  return out;
}
const product = [...files(join(FRONT, "src")), ...files(join(FRONT, "public")), join(FRONT, "index.html"), ...files(join(BACK, "src")), ...files(join(BACK, "database")), join(BACK, "wrangler.jsonc")];

describe("no organisation's branding in the product", () => {
  it("nothing outside Omnicontact's branding row refers to its logo or website", () => {
    const hits = product.filter((f) => /omni-logo|omnicontact\.biz/i.test(readFileSync(f, "utf8"))).map((f) => relative(join(FRONT, ".."), f));
    expect(hits).toEqual([]);
    expect(existsSync(join(FRONT, "public", "omni-logo.png"))).toBe(false);
    expect(existsSync(join(FRONT, "public", "omni-logo-white.png"))).toBe(false);
  });

  it("the product never names Omni Contact as itself", () => {
    const hits = product
      .filter((f) => !f.endsWith(".sql"))
      .filter((f) => /Omni ?Contact|OMNI CONTACT/.test(readFileSync(f, "utf8")))
      .map((f) => relative(join(FRONT, ".."), f));
    expect(hits).toEqual([]);
  });

  it("the platform page (State A) carries no organisation: the page, its title and icon, and the sign-in screen", () => {
    const html = readFileSync(join(FRONT, "index.html"), "utf8");
    expect(html).toContain("%BRAND_NAME%");
    // (Its redirect names the "omni-tracker" Worker and the "pulse." address: internal names, kept for now.)
    expect(html).not.toMatch(/Omni|omnicontact|\bPulse\b/);
    const login = readFileSync(join(FRONT, "src", "components", "Login.jsx"), "utf8");
    // The only organisation it ever shows is the one the public branding lookup returned for a typed code.
    expect(login).not.toMatch(/Omni|omnicontact|<img/);
    expect(login).toContain("/public/org/");
    // The platform page itself: no image, no organisation, no data of any kind, no claims about customers.
    const landing = readFileSync(join(FRONT, "src", "components", "LandingPage.jsx"), "utf8");
    expect(landing).not.toMatch(/Omni|omnicontact|<img|api\(|fetch\(|trusted by|customers/i);
    expect(landing).toContain("BRAND.productName");
  });

  it("status colours are fixed: an organisation's branding sets only the accent variables", () => {
    const theme = readFileSync(join(FRONT, "src", "brandTheme.js"), "utf8");
    const set = [...theme.matchAll(/--([a-z-]+):/g)].map((m) => m[1]);
    expect([...new Set(set)].sort()).toEqual(["accent-dark", "accent-light", "accent-solid", "org-sb", "org-sb-end", "org-sb-hi", "org-sb-ink", "org-sb-top", "org-tint"]);
  });
});
