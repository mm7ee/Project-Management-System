// Ask AI, phase (c) (docs/assistant-plan.md): the task skills. The built-in ones are in src/data/skills.js; an
// organisation's own are in ai_skills (migration 0030), per workspace, added by its administrators.
//   GET    /api/assistant/skills?projectId&section&itemKey&document&page   the skills for where the person is
//   GET    /api/assistant/skills/custom                                    the workspace's own (organisation admins)
//   POST   /api/assistant/skills/custom                                    { name, context, prompt, tools }
//   PATCH  /api/assistant/skills/custom/:id                                { name?, context?, prompt?, tools?, enabled? }
//   DELETE /api/assistant/skills/custom/:id
// The browser sends only a skill's id with a question (POST /api/assistant { skill }); the prompt and the tools it
// may use are worked out here, so a skill can never be given tools the person couldn't use.
/** @typedef {import("./workitems").ItemContext} ItemContext */
/** @typedef {import("../../project-management-system-frontend/src/data/skills").Skill} Skill */
/** @typedef {import("../../project-management-system-frontend/src/data/skills").SkillContext} SkillContext */
import { HttpError, body, json } from "./http";
import { newToken } from "./auth";
import { BUILT_IN_SKILLS, CONTEXT_LABELS, MAX_CUSTOM_SKILLS, SKILL_CONTEXTS, contextsAt, fillPrompt } from "../../project-management-system-frontend/src/data/skills";
import { TOOLS, pageContext } from "./assistant";
import { toSummary } from "./workitems";

const CUSTOM = "custom:";
/** @param {{ id: string; name: string; context: string; prompt: string; tools: string }} r @returns {Skill} */
const fromRow = (r) => ({
  id: `${CUSTOM}${r.id}`,
  context: /** @type {SkillContext} */ (r.context),
  label: r.name,
  prompt: r.prompt,
  tools: JSON.parse(r.tools),
  custom: true,
  instructions: `This is your organisation's own skill "${r.name}". Follow its request within the rules above.`,
});

/**
 * A skill by its id: a built-in one, or the workspace's own ("custom:<id>", only while it's switched on).
 * @param {ItemContext} c
 * @param {string} id
 * @returns {Promise<Skill | null>}
 */
export async function resolveSkill(c, id) {
  if (id.startsWith(CUSTOM)) {
    const r = /** @type {any} */ (await c.db.prepare("SELECT id, name, context, prompt, tools FROM ai_skills WHERE id = ? AND enabled = 1").bind(id.slice(CUSTOM.length)).first());
    return r ? fromRow(r) : null;
  }
  return BUILT_IN_SKILLS.find((s) => s.id === id) ?? null;
}

/**
 * A skill's question, with the names of what's open.
 * @param {Skill} skill
 * @param {{ project: { name: string } | null; item: any; doc: { name: string } | null }} page
 */
export function skillQuestion(skill, page) {
  return fillPrompt(skill.prompt, { project: page.project?.name, document: page.doc?.name, item: page.item ? `${toSummary(page.item).key} "${page.item.summary}"` : undefined });
}

/** Whether a person may use a skill: its main tool (the first it lists) is one they're offered. @param {ItemContext} c @param {Skill} s */
const usable = (c, s) => !s.tools?.length || !!TOOLS.find((t) => t.name === s.tools?.[0])?.available(c);

/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function skillsApi(c, path, method) {
  if (path === "/api/assistant/skills" && method === "GET") {
    const q = new URL(c.req.url).searchParams;
    const get = (/** @type {string} */ k, /** @type {number} */ n) => q.get(k)?.trim().slice(0, n) || undefined;
    const at = { projectId: get("projectId", 64), section: get("section", 20), itemKey: get("itemKey", 20)?.toUpperCase(), document: get("document", 40), page: get("page", 30) };
    const page = await pageContext(c, at);
    const contexts = contextsAt({ project: !!page.project, section: at.section, item: !!page.item, request: page.request, page: at.page });
    const custom = /** @type {any[]} */ ((await c.db.prepare("SELECT id, name, context, prompt, tools FROM ai_skills WHERE enabled = 1 ORDER BY name").all()).results).map(fromRow);
    const skills = contexts.flatMap((ctx) => [...BUILT_IN_SKILLS, ...custom].filter((s) => s.context === ctx && usable(c, s)));
    return json({ contexts, skills: skills.map((s) => ({ id: s.id, label: s.label, context: s.context, custom: !!s.custom, prompt: skillQuestion(s, page) })) });
  }
  const m = path.match(/^\/api\/assistant\/skills\/custom(?:\/([a-f0-9]{16}))?$/);
  if (!m) return null;
  if (!c.orgAdmin) throw new HttpError(403, "Only your organisation's administrators can change Ask AI skills", "org_admin_only");
  if (!m[1] && method === "GET") {
    const rows = /** @type {any[]} */ ((await c.db.prepare("SELECT id, name, context, prompt, tools, enabled, updated_at FROM ai_skills ORDER BY context, name").all()).results);
    return json({
      skills: rows.map((r) => ({ id: r.id, name: r.name, context: r.context, prompt: r.prompt, tools: JSON.parse(r.tools), enabled: !!r.enabled, updatedAt: r.updated_at })),
      contexts: CONTEXT_LABELS,
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description.split(/(?<=\.)\s/)[0] })),
    });
  }
  const b = method === "POST" || method === "PATCH" ? /** @type {Record<string, unknown>} */ (await body(c.req)) : {};
  /** @param {boolean} partial */
  const clean = (partial) => {
    /** @type {Record<string, unknown>} */ const out = {};
    if (!partial || b.name !== undefined) {
      const name = String(b.name ?? "").trim();
      if (!name || name.length > 80) throw new HttpError(400, "Give the skill a name, up to 80 characters");
      out.name = name;
    }
    if (!partial || b.context !== undefined) {
      if (!SKILL_CONTEXTS.includes(/** @type {any} */ (b.context))) throw new HttpError(400, "Choose where the skill shows");
      out.context = b.context;
    }
    if (!partial || b.prompt !== undefined) {
      const prompt = String(b.prompt ?? "").trim();
      if (!prompt || prompt.length > 2000) throw new HttpError(400, "Write what the skill asks, up to 2,000 characters");
      out.prompt = prompt;
    }
    if (!partial || b.tools !== undefined) {
      const tools = Array.isArray(b.tools) ? [...new Set(b.tools.map(String))] : [];
      const unknown = tools.filter((t) => !TOOLS.some((x) => x.name === t));
      if (unknown.length) throw new HttpError(400, `Unknown tools: ${unknown.join(", ")}`);
      if (tools.length > 20) throw new HttpError(400, "At most 20 tools");
      out.tools = JSON.stringify(tools);
    }
    if (partial && b.enabled !== undefined) out.enabled = b.enabled ? 1 : 0;
    return out;
  };
  if (!m[1] && method === "POST") {
    const v = clean(false);
    const n = /** @type {{ n: number } | null} */ (await c.db.prepare("SELECT COUNT(*) AS n FROM ai_skills").first());
    if (Number(n?.n ?? 0) >= MAX_CUSTOM_SKILLS) throw new HttpError(409, `A workspace can have up to ${MAX_CUSTOM_SKILLS} skills of its own`);
    const id = newToken().slice(0, 16);
    await c.db
      .prepare("INSERT INTO ai_skills (id, name, context, prompt, tools, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, v.name, v.context, v.prompt, v.tools, c.me.id, c.now, c.me.id, c.now)
      .run();
    await c.audit("ai_skill_added", null, { skill: v.name, context: v.context });
    return json({ id }, 201);
  }
  if (!m[1]) throw new HttpError(405, "Method not allowed");
  const row = /** @type {{ id: string; name: string } | null} */ (await c.db.prepare("SELECT id, name FROM ai_skills WHERE id = ?").bind(m[1]).first());
  if (!row) throw new HttpError(404, "Not found");
  if (method === "PATCH") {
    const v = clean(true);
    const keys = Object.keys(v);
    if (!keys.length) return json({ ok: true });
    await c.db
      .prepare(`UPDATE ai_skills SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => v[k]), c.me.id, c.now, row.id)
      .run();
    await c.audit("ai_skill_changed", null, { skill: String(v.name ?? row.name), changed: keys });
    return json({ ok: true });
  }
  if (method === "DELETE") {
    await c.db.prepare("DELETE FROM ai_skills WHERE id = ?").bind(row.id).run();
    await c.audit("ai_skill_removed", null, { skill: row.name });
    return json({ ok: true });
  }
  throw new HttpError(405, "Method not allowed");
}
