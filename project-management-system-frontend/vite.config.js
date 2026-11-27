import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { BRAND } from "./src/data/brand.js";
import { platformIconSvg, svgDataUrl } from "./src/data/branding.js";

// index.html is static, so its title, app name and favicon (the letters PMS, as an SVG) come from the brand config
// at build time (%BRAND_NAME%, %BRAND_SHORT%, %BRAND_ICON%): renaming the product stays a change to
// src/data/brand.js alone.
const brandHtml = {
  name: "brand-html",
  // "pre": before Vite reads the page's links, which %BRAND_ICON% isn't yet.
  transformIndexHtml: {
    order: /** @type {const} */ ("pre"),
    handler: (/** @type {string} */ html) =>
      html.replaceAll("%BRAND_NAME%", BRAND.productName).replaceAll("%BRAND_SHORT%", BRAND.shortName).replaceAll("%BRAND_ICON%", svgDataUrl(platformIconSvg())),
  },
};

// /api is served by the backend (the Worker). Run it alongside this dev server: `npm run dev` in
// project-management-system-backend, or `npm run dev` at the repository root for both at once.
// PULSE_API points the proxy elsewhere, e.g. another port.
const API = process.env.PULSE_API ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), brandHtml],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: API,
        configure: (proxy) => {
          // The frontend runs on its own too: with the backend off, API calls get a clear answer, not a hang.
          proxy.on("error", (_err, _req, res) => {
            if (!("writeHead" in res) || res.headersSent) return;
            res.writeHead(503, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: `The backend isn't running at ${API}. Start it with npm run dev in project-management-system-backend.` }));
          });
        },
      },
    },
  },
});
