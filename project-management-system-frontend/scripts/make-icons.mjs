// Draws the platform's neutral app icons, the letters "PMS" in white on graphite, as PNG files in public/: the
// favicon, the Apple touch icon and the installable app's icons (one "maskable", with no rounded corners). Browsers
// and phones need PNG here; the tab itself uses an SVG built from the same letters (src/data/branding.js).
// No image libraries: the letters are rounded strokes, filled with 4×4 supersampling, and written with zlib.
// Run after changing the colours or the letters:  node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x1f, 0x29, 0x33];
const FG = [0xff, 0xff, 0xff];
const STROKE = 0.03; // half the letters' stroke width, as a share of the icon

/** @typedef {[number, number]} Pt */
/** Points along an arc (screen coordinates, y down). @returns {Pt[]} */
function arc(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r, /** @type {number} */ from, /** @type {number} */ to, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return /** @type {Pt} */ ([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  });
}
/** The letters as polylines, in a 1×1 box. @returns {Pt[][]} */
function letters() {
  const top = 0.35;
  const bottom = 0.65;
  const mid = 0.5;
  const p = 0.17;
  const m = 0.405;
  const s = 0.665;
  return [
    // P: the stem, and the bowl.
    [[p, bottom], [p, top]],
    [[p, top], [p + 0.075, top], ...arc(p + 0.075, (top + mid) / 2, (mid - top) / 2, -90, 90), [p, mid]],
    // M
    [[m, bottom], [m, top], [m + 0.1, mid + 0.02], [m + 0.2, top], [m + 0.2, bottom]],
    // S: the upper bowl anticlockwise, then the lower one clockwise.
    [...arc(s + 0.085, top + 0.075, 0.075, -15, -270), ...arc(s + 0.085, bottom - 0.075, 0.075, -90, 165)],
  ];
}
/** Distance from a point to a segment. */
function segDist(/** @type {Pt} */ q, /** @type {Pt} */ a, /** @type {Pt} */ b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
}
/** Inside a rounded square of radius r (as a share), or the full square when r is 0. */
function inSquare(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r) {
  if (!r) return true;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}
/** RGBA pixels of the icon. */
function draw(/** @type {number} */ size, /** @type {number} */ corner, /** @type {number} */ scale) {
  const strokes = letters().map((line) => line.map(([x, y]) => /** @type {Pt} */ ([0.5 + (x - 0.5) * scale, 0.5 + (y - 0.5) * scale])));
  const px = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const q = /** @type {Pt} */ ([(x + (sx + 0.5) / N) / size, (y + (sy + 0.5) / N) / size]);
          if (!inSquare(q[0], q[1], corner)) continue;
          bg++;
          if (strokes.some((line) => line.some((a, i) => i > 0 && segDist(q, line[i - 1], a) <= STROKE * scale))) fg++;
        }
      }
      const i = (y * size + x) * 4;
      const f = fg / (N * N);
      const cov = bg / (N * N);
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(cov ? (BG[c] * (bg - fg) + FG[c] * fg) / bg : 0);
      px[i + 3] = Math.round(255 * Math.max(cov, f));
    }
  }
  return px;
}
/** A PNG file from RGBA pixels. */
function png(/** @type {number} */ size, /** @type {Buffer} */ rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (/** @type {Buffer} */ b) => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const out = new URL("../public/", import.meta.url);
/** [file, size, rounded corner, letter scale]: the maskable icon fills its square and keeps the letters inside the safe zone. */
const ICONS = /** @type {const} */ ([
  ["favicon.png", 64, 0.22, 1.25],
  ["apple-touch-icon.png", 180, 0, 1.15],
  ["icon-192.png", 192, 0.22, 1.2],
  ["icon-512.png", 512, 0.22, 1.2],
  ["icon-maskable-512.png", 512, 0, 0.95],
]);
for (const [file, size, corner, scale] of ICONS) {
  writeFileSync(new URL(file, out), png(size, draw(size, corner, scale)));
  console.log(`public/${file} (${size}×${size})`);
}
