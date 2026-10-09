import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // /api is served by the Worker: run `npm run dev:api` alongside `npm run dev`.
  server: { port: 5173, host: true, proxy: { "/api": "http://127.0.0.1:8787" } },
});
