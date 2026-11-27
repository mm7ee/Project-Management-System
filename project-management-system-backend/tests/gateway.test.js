// The gateway (gateway/index.js), deployed as "pms" (the address people use) and as "pulse" (the old address).
import { describe, expect, it } from "vitest";
import gateway from "../gateway/index.js";

const HOST = "utsa--wanza--ortfolio.workers.dev";
/** A stand-in app Worker that says what it received. */
const env = { APP: { fetch: async (/** @type {Request} */ r) => new Response(`app: ${r.method} ${new URL(r.url).pathname}`) } };

describe("the gateway", () => {
  it("passes everything on at the new address", async () => {
    for (const [method, path] of [["GET", "/"], ["GET", "/view/abc"], ["POST", "/api/login"], ["GET", "/api/me/workspaces"]]) {
      const res = await gateway.fetch(new Request(`https://pms.${HOST}${path}`, { method }), env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`app: ${method} ${path}`);
    }
  });

  it("moves pages opened at the old address to the new one, keeping the path and query", async () => {
    const res = await gateway.fetch(new Request(`https://pulse.${HOST}/executive/0123?x=1`), env);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`https://pms.${HOST}/executive/0123?x=1`);
    expect((await gateway.fetch(new Request(`https://pulse.${HOST}/`, { method: "HEAD" }), env)).status).toBe(301);
  });

  it("still passes API calls on at the old address, so other systems calling it keep working", async () => {
    for (const [method, path] of [["POST", "/api/integrations/github/webhook"], ["POST", "/api/hooks/automation/abc"], ["GET", "/api/items"]]) {
      const res = await gateway.fetch(new Request(`https://pulse.${HOST}${path}`, { method }), env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`app: ${method} ${path}`);
    }
  });
});
