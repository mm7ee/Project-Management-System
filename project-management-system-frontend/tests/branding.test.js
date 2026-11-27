// Organisation branding: the contrast check, the safe shades and the monogram fallback (src/data/branding.js).
import { describe, expect, it } from "vitest";
import { AA, SURFACES, THEMES, accentShades, cleanHex, contrast, initials, monogramSvg, passes, safeShade, solidShade, textOn } from "../src/data/branding";

describe("contrast", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 is the classic lightest grey that passes AA on white; #777777 just fails.
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(contrast("#2c3280", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#2c3280"), 10);
  });
  it("picks white or dark text, whichever reads better", () => {
    expect(textOn("#2c3280")).toBe("#ffffff");
    expect(textOn("#ffd400")).not.toBe("#ffffff");
  });
  it("cleans colours", () => {
    expect(cleanHex("#ABC")).toBe("#aabbcc");
    expect(cleanHex(" #2C3280 ")).toBe("#2c3280");
    expect(cleanHex("red")).toBeNull();
    expect(cleanHex("#12345")).toBeNull();
    expect(cleanHex("url(javascript:1)")).toBeNull();
  });
});

describe("safe accent shades", () => {
  it("keeps a colour that already passes", () => {
    expect(passes("#2c3280", "light")).toBe(true);
    expect(safeShade("#2c3280", "light")).toBe("#2c3280");
  });
  it("lightens a dark accent for the dark themes, and the result passes", () => {
    const { shades, adjusted } = accentShades("#2c3280");
    expect(adjusted).toEqual(["dark", "futuristic"]);
    for (const t of THEMES) expect(passes(shades[t], t)).toBe(true);
    expect(contrast(shades.dark, "#13163a")).toBeGreaterThanOrEqual(AA);
  });
  it("darkens a pale accent for the light theme", () => {
    const { shades } = accentShades("#ffd400");
    expect(shades.light).not.toBe("#ffd400");
    expect(passes(shades.light, "light")).toBe(true);
    expect(passes("#ffd400", "dark")).toBe(true);
  });
  it("makes every accent safe on every theme's surfaces, with readable button text", () => {
    // A sweep of hues and lightnesses, including the extremes.
    const samples = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#777777", "#ed0000", "#0e7c66", "#b4beff", "#101553", "#f0f0f0", "#123456", "#fedcba"];
    for (let h = 0; h < 360; h += 30) samples.push(`#${[0, 1, 2].map((i) => Math.round(127 + 120 * Math.cos(((h + i * 120) * Math.PI) / 180)).toString(16).padStart(2, "0")).join("")}`);
    for (const c of samples) {
      const { shades } = accentShades(c);
      for (const t of THEMES) {
        for (const s of SURFACES[t]) expect(contrast(shades[t], s), `${c} on ${t} ${s}`).toBeGreaterThanOrEqual(AA);
        expect(contrast(shades[t], textOn(shades[t])), `${c} button text on ${t}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });
  it("finds a shade that always carries white text, for buttons and the active page", () => {
    expect(solidShade("#2c3280")).toBe("#2c3280");
    for (const c of ["#ffd400", "#ffffff", "#8fdcfb", "#0e7c66", "#ed0000", "#777777", "nonsense"]) expect(contrast(solidShade(c), "#ffffff"), c).toBeGreaterThanOrEqual(AA);
  });
  it("falls back to the platform accent for nonsense", () => {
    expect(accentShades("not a colour").shades.light).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("the monogram fallback", () => {
  it("takes the initials of the first two words", () => {
    expect(initials("Omnicontact")).toBe("O");
    expect(initials("Demo Co")).toBe("DC");
    expect(initials("Wideline Logistics International")).toBe("WL");
    expect(initials("  acme   corp ")).toBe("AC");
    expect(initials("Zuva-Insurance")).toBe("ZI");
  });
  it("handles accents, digits, symbols and emoji", () => {
    expect(initials("Élan Vital")).toBe("ÉV");
    expect(initials("3M Africa")).toBe("3A");
    expect(initials("🚀 Rocket Labs")).toBe("RL");
    expect(initials("!!!")).toBe("?");
    expect(initials("")).toBe("?");
  });
  it("draws an SVG with escaped text in the accent, with readable text", () => {
    const svg = monogramSvg("<script> & Co", "#2c3280");
    expect(svg).toContain('fill="#2c3280"');
    expect(svg).toContain(">SC<");
    expect(svg).not.toContain("<script>");
    expect(monogramSvg("Demo Co", "#ffd400")).toContain('fill="#0b0c22"');
    expect(monogramSvg("Demo Co", "javascript:alert(1)")).toMatch(/fill="#[0-9a-f]{6}"/);
  });
});
