// Emails carry the organisation's branding (src/notify.js brandEmail): its logo or monogram, its name and its
// accent, with "Powered by" in small print; without an organisation, the neutral PMS header. Nothing of any other
// organisation, and no product branding beyond the credit.
import { describe, expect, it } from "vitest";
import { brandEmail, emailFor, securityEmail } from "../src/notify.js";
import { accentShades, solidShade } from "../../project-management-system-frontend/src/data/branding.js";
import { BRAND } from "../../project-management-system-frontend/src/data/brand.js";

const env = /** @type {any} */ ({ PUBLIC_URL: "https://pms.example" });
/** @param {Partial<import("../../project-management-system-frontend/src/data/branding.js").BrandingView>} o */
const view = (o) => ({ name: "Alpha Co", code: "alpha", accent: "#0e7c66", shades: accentShades("#0e7c66").shades, tint: null, logo: null, logoDark: null, icon: null, ...o });

describe("branded emails", () => {
  const mail = emailFor(env, "Item DEV-12 was assigned to you", "Fix the login page", undefined, "#/item/DEV-12");

  it("uses the organisation's logo, name and accent, and its name in the subject", () => {
    const b = brandEmail(env, view({ logo: "/api/public/org/alpha/logo?v=3" }), mail.subject, mail.html);
    expect(b.subject).toBe("Alpha Co: Item DEV-12 was assigned to you");
    expect(b.html).toContain('src="https://pms.example/api/public/org/alpha/logo?v=3"');
    expect(b.html).toContain('alt="Alpha Co"');
    expect(b.html).toContain(`background:${solidShade("#0e7c66")}`);
    expect(b.html).toContain(BRAND.poweredBy);
    expect(b.html).not.toMatch(/<!--pms:|#pmsacc|#pmsink/);
  });

  it("shows the monogram when the organisation has no logo", () => {
    const b = brandEmail(env, view({ name: "Demo Co" }), mail.subject, mail.html);
    expect(b.html).toContain(">DC</span>");
    expect(b.html).toContain("Demo Co");
  });

  it("is neutral without an organisation, and never names another one", () => {
    const b = brandEmail(env, null, mail.subject, mail.html);
    expect(b.subject).toBe(mail.subject);
    expect(b.html).toContain(`>${BRAND.shortName}</p>`);
    expect(b.html).not.toMatch(/Omni|Pulse|PULSE|#ed0000|#2c3280|#101553/);
    const alpha = brandEmail(env, view({}), mail.subject, mail.html).html;
    expect(alpha).not.toMatch(/Omni|Bravo/);
  });

  it("escapes the organisation's name and leaves user text alone", () => {
    const sec = securityEmail("Reset your password", ["Hi <b>you</b>"], { label: "Choose a new password", url: "https://pms.example/#/reset" });
    const b = brandEmail(env, view({ name: 'Evil "Co" <script>' }), sec.subject, sec.html);
    expect(b.html).not.toContain("<script>");
    expect(b.html).toContain("Hi &lt;b&gt;you&lt;/b&gt;");
    expect(b.subject).toBe('Evil "Co" <script>: Reset your password'); // a subject is plain text
  });
});
