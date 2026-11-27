// The public address of the Project Management System. Deployed twice from this one file:
//   - as "pms" (pms.<account>.workers.dev), the address people use: every request goes, unchanged, to the app
//     Worker "omni-tracker", which keeps the database, the AI and the MFA_KEY secret (that secret can't be read
//     back, so the app itself can't move to a Worker with a new name);
//   - as "pulse" (pulse.<account>.workers.dev), the old address, which moves people to the new one: pages and
//     files opened in a browser get a permanent redirect, keeping the path, view-only links and project pages.
//     /api/ calls are passed straight on instead, because other systems (GitHub, automation webhooks, API tokens)
//     may still call the old address and often don't follow a redirect for a POST.
const OLD = "pulse.";
const NEW = "pms.";

export default {
  /**
   * @param {Request} req
   * @param {{ APP: { fetch(r: Request): Promise<Response> } }} env
   */
  fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname.startsWith(OLD) && (req.method === "GET" || req.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      url.hostname = NEW + url.hostname.slice(OLD.length);
      return Response.redirect(url.toString(), 301);
    }
    return env.APP.fetch(req);
  },
};
