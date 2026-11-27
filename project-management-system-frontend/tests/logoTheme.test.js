// Logo-driven themes (src/data/logoTheme.js): 12 fixture logos, drawn here pixel by pixel, each turned into a
// theme in all three variations, light and dark, normal and high contrast. Every text pair must pass (body text
// 7:1, the rest 4.5:1, focus and accents 3:1), chart colours must stay apart under colour-blindness (or carry a
// pattern), and the style sheet may hold nothing but known variables with safe values.
import { describe, expect, it } from "vitest";
import {
  CHART_MIN_DISTANCE,
  THEME_VARIABLES,
  VARIATIONS,
  analyseLogo,
  chartPalette,
  cleanThemeSpec,
  contrastChecks,
  cvdReport,
  darkLogoTreatment,
  hexLch,
  hueDiff,
  specFromAnalysis,
  specFromColour,
  themeCss,
  themeTokens,
} from "../src/data/logoTheme.js";

const W = 96;
const H = 48;
/** @typedef {[number, number, number, number]} RGBA */
/**
 * A logo canvas: `paint(x, y)` returns the pixel's colour or null (transparent). Shapes get a 1-pixel anti-aliased
 * rim, as real logos have.
 * @param {(x: number, y: number) => RGBA | null} paint
 * @param {number} [w]
 * @param {number} [h]
 */
function draw(paint, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      if (c) data.set(c, (y * w + x) * 4);
    }
  }
  return { data, w, h };
}
const rgb = (/** @type {string} */ hex, a = 255) => /** @type {RGBA} */ ([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(a));
const inCircle = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
/** Letter-like bars across the width: a wordmark. */
const bars = (/** @type {number} */ x, /** @type {number} */ y) => y > 14 && y < 34 && x % 9 < 6;

const FIXTURES = {
  "dark navy wordmark (Omnicontact-like)": draw((x, y) => (bars(x, y) || inCircle(x, y, 12, 24, 10) ? rgb("#1c2a4a") : null)),
  "orange and green square mark": draw((x, y) => (inCircle(x, y, 20, 24, 16) ? rgb("#f26b1d") : x > 40 && x < 60 && y > 8 && y < 40 ? rgb("#2e9e5b") : null), 64, 48),
  "black wordmark": draw((x, y) => (bars(x, y) ? rgb("#111111") : null)),
  "white wordmark for dark backgrounds": draw((x, y) => (bars(x, y) ? rgb("#ffffff") : null)),
  "four-colour stripes": draw((x, y) => (y > 10 && y < 38 ? rgb(["#4285f4", "#ea4335", "#fbbc05", "#34a853"][Math.floor(x / 24)]) : null)),
  "neon pink single colour": draw((x, y) => (bars(x, y) ? rgb("#ff2d95") : null)),
  "pale yellow": draw((x, y) => (inCircle(x, y, 48, 24, 20) ? rgb("#f7e58b") : null)),
  "teal mark on a white background": draw((x, y) => (inCircle(x, y, 48, 24, 16) ? rgb("#0f8b8d") : rgb("#ffffff"))),
  "white letter on a red tile": draw((x, y) => (x > 40 && x < 56 && y > 12 && y < 36 ? rgb("#ffffff") : rgb("#d0021b")), 96, 48),
  "warm grey wordmark": draw((x, y) => (bars(x, y) ? rgb("#6b625a") : null)),
  "teal, magenta and yellow": draw((x, y) => (inCircle(x, y, 16, 24, 12) ? rgb("#00a6a6") : inCircle(x, y, 48, 24, 12) ? rgb("#c2185b") : inCircle(x, y, 80, 24, 12) ? rgb("#ffc107") : null)),
  "empty (fully transparent)": draw(() => null, 8, 8),
};

/** A soft edge: halves the alpha of pixels next to a transparent one, as anti-aliasing does. */
for (const f of Object.values(FIXTURES)) {
  const copy = f.data.slice();
  for (let y = 1; y < f.h - 1; y++) {
    for (let x = 1; x < f.w - 1; x++) {
      const i = (y * f.w + x) * 4;
      if (copy[i + 3] && [-4, 4, -f.w * 4, f.w * 4].some((d) => copy[i + d + 3] === 0)) f.data[i + 3] = 140;
    }
  }
}

const specs = Object.fromEntries(Object.entries(FIXTURES).map(([name, f]) => [name, specFromAnalysis(analyseLogo(f.data, f.w, f.h)).spec]));

describe("reading a logo", () => {
  it("classifies each kind of logo", () => {
    const kind = (/** @type {keyof typeof FIXTURES} */ n) => analyseLogo(FIXTURES[n].data, FIXTURES[n].w, FIXTURES[n].h);
    expect(kind("dark navy wordmark (Omnicontact-like)")).toMatchObject({ kind: "single-colour", tone: "dark-on-transparent", shape: "wide wordmark" });
    expect(kind("orange and green square mark").kind).toBe("duotone");
    expect(kind("black wordmark").kind).toBe("monochrome");
    expect(kind("white wordmark for dark backgrounds")).toMatchObject({ kind: "monochrome", tone: "light-on-transparent" });
    expect(kind("four-colour stripes").kind).toBe("multicolour");
    expect(kind("teal, magenta and yellow").kind).toBe("multicolour");
    expect(kind("empty (fully transparent)").kind).toBe("monochrome");
  });

  it("takes the brand colour from the logo, ignoring a white background but keeping a coloured one", () => {
    expect(hueDiff(specs["teal mark on a white background"].primary[2], hexLch("#0f8b8d")[2])).toBeLessThan(8);
    expect(hueDiff(specs["white letter on a red tile"].primary[2], hexLch("#d0021b")[2])).toBeLessThan(8);
    expect(hueDiff(specs["neon pink single colour"].primary[2], hexLch("#ff2d95")[2])).toBeLessThan(8);
  });

  it("strengthens a muted brand colour (same hue) and derives a neighbouring second colour", () => {
    const s = specs["dark navy wordmark (Omnicontact-like)"];
    expect(s.primary[1]).toBeGreaterThanOrEqual(0.12);
    expect(hueDiff(s.primary[2], hexLch("#1c2a4a")[2])).toBeLessThan(8);
    expect(hueDiff(s.secondary[2], s.primary[2])).toBeCloseTo(35, 0);
  });

  it("uses the logo's own second colour when it has one", () => {
    const s = specs["orange and green square mark"];
    expect(hueDiff(s.primary[2], hexLch("#f26b1d")[2])).toBeLessThan(10);
    expect(hueDiff(s.secondary[2], hexLch("#2e9e5b")[2])).toBeLessThan(10);
  });

  it("a monochrome logo gets a neutral theme and the admin is asked for a colour", () => {
    expect(specs["black wordmark"].askAdmin).toBe(true);
    expect(specs["warm grey wordmark"].askAdmin).toBe(true);
    expect(specs["orange and green square mark"].askAdmin).toBe(false);
  });
});

describe("every theme passes WCAG contrast", () => {
  for (const [name, spec] of Object.entries(specs)) {
    it(name, () => {
      /** @type {string[]} */ const failures = [];
      for (const variation of VARIATIONS) {
        for (const vibrancy of [0.5, 1, 1.5]) {
          for (const mode of /** @type {const} */ (["light", "dark"])) {
            for (const highContrast of [false, true]) {
              const s = { ...spec, variation, vibrancy };
              for (const c of contrastChecks(themeTokens(s, mode, { highContrast }).tokens, { highContrast })) {
                if (!c.ok) failures.push(`${variation} ×${vibrancy} ${mode}${highContrast ? " (more contrast)" : ""}: ${c.name} ${c.fg} on ${c.bg} = ${c.ratio.toFixed(2)} < ${c.min}`);
              }
            }
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe("chart colours", () => {
  it("stay apart with normal vision and under protanopia, deuteranopia and tritanopia, or carry a pattern", () => {
    for (const spec of Object.values(specs)) {
      for (const mode of /** @type {const} */ (["light", "dark"])) {
        const { palette, patterns } = chartPalette(spec, mode);
        expect(palette).toHaveLength(8);
        expect(new Set(palette).size).toBe(8);
        for (const v of Object.values(cvdReport(palette))) {
          if (v.min < CHART_MIN_DISTANCE) expect(patterns).toEqual(expect.arrayContaining(v.pair));
        }
      }
    }
  });

  it("most brands need no patterns at all", () => {
    const needing = Object.values(specs).filter((s) => chartPalette(s, "light").patterns.length).length;
    expect(needing).toBeLessThanOrEqual(2);
  });
});

describe("the stored spec and the style sheet", () => {
  const good = specs["orange and green square mark"];

  it("only a valid spec is kept: unknown keys dropped, numbers clamped, anything else refused", () => {
    expect(cleanThemeSpec({ ...good, css: "body{display:none}", extra: 1 })).toEqual(good);
    expect(cleanThemeSpec(JSON.stringify(good))).toEqual(good);
    expect(cleanThemeSpec({ ...good, vibrancy: 9 })?.vibrancy).toBe(1.5);
    expect(cleanThemeSpec({ ...good, primary: [2, 1, 400] })?.primary).toEqual([1, 0.37, 40]);
    for (const bad of [null, "nope", [], { ...good, v: 2 }, { ...good, variation: "loud" }, { ...good, primary: "red" }, { ...good, primary: [0.5, 0.1] }, { ...good, font: "Comic Sans; } body { x" }, { ...good, primary: [0.5, NaN, 1] }]) {
      expect(cleanThemeSpec(bad)).toBeNull();
    }
  });

  it("sets only known variables, with hex colours, pixel sizes and a font from the list", () => {
    for (const spec of [good, { ...good, radius: /** @type {const} */ ("round"), font: /** @type {const} */ ("serif") }]) {
      const css = themeCss(spec);
      const names = [...css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)];
      expect(names.length).toBeGreaterThan(30);
      for (const [, name, value] of names) {
        expect(THEME_VARIABLES).toContain(name);
        if (name === "org-font") expect(value).toMatch(/^[\w\s",-]+$/);
        else if (name.startsWith("r-")) expect(value).toMatch(/^\d+px$/);
        else expect(value).toMatch(/^(#[0-9a-f]{6}|transparent)$/);
      }
      expect(css).not.toMatch(/url\(|expression|@import|<|\\/);
      // Status colours never change.
      expect(css).not.toMatch(/--(success|warning|danger|info|green|amber|red|st-)/);
    }
  });

  it("a brand colour someone picks makes a valid spec too", () => {
    const s = specFromColour("#2c3280");
    expect(cleanThemeSpec(s)).toEqual(s);
    expect(contrastChecks(themeTokens(s, "light").tokens).every((c) => c.ok)).toBe(true);
  });

  it("a dark one-colour logo is recoloured for dark surfaces; a multicolour one sits on a plate", () => {
    expect(darkLogoTreatment(specs["dark navy wordmark (Omnicontact-like)"])).toBe("recolour");
    expect(darkLogoTreatment(specs["black wordmark"])).toBe("recolour");
    expect(darkLogoTreatment(specs["orange and green square mark"])).toBe("plate");
    expect(darkLogoTreatment(null)).toBe("plate");
  });
});
