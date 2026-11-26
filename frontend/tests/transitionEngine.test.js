// The transition engine (src/data/workflows.js), shared by the Worker (which enforces it) and the screens (which
// grey out moves): which moves leave a status, who may make one, what it needs first. And the built-in workspace
// templates, which must each describe a workflow the engine accepts.
import { describe, expect, it } from "vitest";
import { checkTransition, describeRule, needsInput, transitionsFrom } from "../src/data/workflows.js";
import { BUILT_IN_TEMPLATES } from "../src/data/workspaceTemplates.js";
import { checkBlueprint } from "../worker/blueprints.js";

/** @param {Partial<import("../src/data/workflows.js").Transition>} t */
const move = (t) => /** @type {import("../src/data/workflows.js").Transition} */ ({ id: "t", name: "Approve", from: "A", to: "B", rules: [], ...t });
const item = { status: "A", assignee: "ann", reporter: "rob", description: "", dueDate: null, labels: [], openSubtasks: 0 };
const ann = { id: "ann", role: /** @type {const} */ ("developer") };

describe("the transition engine", () => {
  const wf = /** @type {import("../src/data/workflows.js").Workflow} */ ({
    id: "w",
    name: "W",
    description: "",
    isDefault: false,
    statuses: [
      { id: "A", initial: true },
      { id: "B", initial: false },
      { id: "C", initial: false },
    ],
    transitions: [move({ id: "ab", from: "A", to: "B" }), move({ id: "anyC", from: null, to: "C" }), move({ id: "anyA", from: null, to: "A" }), move({ id: "ac", from: "A", to: "C", name: "Skip" })],
  });

  it("lists the moves out of a status: its own first, then 'from any', never to itself, and a specific move wins", () => {
    expect(transitionsFrom(wf, "A").map((t) => t.id)).toEqual(["ab", "ac"]);
    expect(transitionsFrom(wf, "B").map((t) => t.id)).toEqual(["anyC", "anyA"]);
  });

  it("conditions: a role (administrators always may), the assignee, the reporter", () => {
    const managersOnly = move({ rules: [{ kind: "condition", rule: "role", value: "manager" }] });
    expect(checkTransition(managersOnly, item, ann).allowed).toBe(false);
    expect(checkTransition(managersOnly, item, ann).reason).toMatch(/Only Managers can approve/);
    expect(checkTransition(managersOnly, item, { id: "x", role: "manager" }).allowed).toBe(true);
    expect(checkTransition(managersOnly, item, { id: "x", role: "admin" }).allowed).toBe(true);
    const assigneeOnly = move({ rules: [{ kind: "condition", rule: "assignee_only" }] });
    expect(checkTransition(assigneeOnly, item, ann).allowed).toBe(true);
    expect(checkTransition(assigneeOnly, item, { id: "rob", role: "developer" }).allowed).toBe(false);
    const reporterOnly = move({ rules: [{ kind: "condition", rule: "reporter_only" }] });
    expect(checkTransition(reporterOnly, item, { id: "rob", role: "viewer" }).allowed).toBe(true);
  });

  it("validators ask for what's missing; what the person sends with the move counts", () => {
    const strict = move({
      rules: [
        { kind: "validator", rule: "comment_required" },
        { kind: "validator", rule: "field_filled", value: "dueDate" },
        { kind: "validator", rule: "assignee_set" },
      ],
    });
    const bare = checkTransition(strict, { ...item, assignee: null }, ann);
    expect(bare.allowed).toBe(true);
    expect(bare.needs).toEqual({ comment: true, assignee: true, fields: ["dueDate"] });
    expect(needsInput(bare)).toBe(true);
    const given = checkTransition(strict, { ...item, assignee: null }, ann, { comment: "Looks good", fields: { dueDate: "2026-12-01", assignee: "ann" } });
    expect(needsInput(given)).toBe(false);
  });

  it("an assigning post-function satisfies 'someone must be assigned'", () => {
    const t = move({ rules: [{ kind: "validator", rule: "assignee_set" }, { kind: "post_function", rule: "assign_reporter" }] });
    expect(checkTransition(t, { ...item, assignee: null }, ann).needs.assignee).toBe(false);
  });

  it("all sub-tasks must be done", () => {
    const t = move({ rules: [{ kind: "validator", rule: "subtasks_done" }] });
    expect(checkTransition(t, { ...item, openSubtasks: 2 }, ann)).toMatchObject({ allowed: false, reason: "Finish its 2 open sub-tasks first" });
    expect(checkTransition(t, item, ann).allowed).toBe(true);
  });

  it("describes rules in plain words, including clearing a field", () => {
    expect(describeRule({ kind: "post_function", rule: "clear_field", value: "dueDate" })).toBe("Clear due date");
    expect(describeRule({ kind: "post_function", rule: "set_resolution", value: "WONT_DO" })).toBe("Resolution: Won't do");
  });
});

describe("the built-in workspace templates", () => {
  for (const t of BUILT_IN_TEMPLATES) {
    it(`${t.name}: a workflow the engine accepts, every status reachable from the start`, () => {
      expect(() => checkBlueprint(t.blueprint)).not.toThrow();
      const wf = /** @type {import("../src/data/workspaceTemplates.js").BlueprintWorkflow} */ (t.blueprint.workflows.find((w) => w.key === t.blueprint.workspaceWorkflow));
      const start = /** @type {{ status: string }} */ (wf.statuses.find((s) => s.initial)).status;
      const seen = new Set([start]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const m of wf.transitions) {
          if ((m.from === null || seen.has(m.from)) && !seen.has(m.to)) {
            seen.add(m.to);
            grew = true;
          }
        }
      }
      expect([...seen].sort()).toEqual(wf.statuses.map((s) => s.status).sort());
      // It can finish: some status is in the Done category.
      expect(t.blueprint.statuses.some((s) => s.category === "DONE" && seen.has(s.key))).toBe(true);
    });
  }
  it("the brief's statuses and types, in order", () => {
    const by = Object.fromEntries(BUILT_IN_TEMPLATES.map((t) => [t.id, t.blueprint]));
    const names = (/** @type {string} */ id) => by[id].workflows[0].statuses.map((s) => by[id].statuses.find((x) => x.key === s.status)?.name);
    expect(names("software")).toEqual(["Backlog", "Selected for Development", "In Progress", "Code Review", "QA/Testing", "Ready for Release", "Done"]);
    expect(names("marketing")).toEqual(["Idea", "Brief", "In Production", "Internal Review", "Client/Manager Approval", "Scheduled", "Published", "Reporting"]);
    expect(names("hr")).toEqual(["Request Received", "Under Review", "Awaiting Approval", "Approved", "Rejected", "Completed"]);
    expect(names("projects")).toEqual(["To Do", "In Progress", "Blocked", "In Review", "Done"]);
    expect(by.marketing.itemTypes.filter((t) => t.active !== false).map((t) => t.name)).toEqual(["Sub-task", "Campaign", "Content Piece", "Social Post", "Event"]);
    expect(by.hr.itemTypes.filter((t) => t.active !== false && t.base !== "SUBTASK").map((t) => t.name)).toEqual(["Recruitment", "Onboarding", "Leave Request", "Policy Task"]);
  });
});
