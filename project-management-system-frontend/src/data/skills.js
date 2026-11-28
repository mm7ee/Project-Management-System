// Ask AI, phase (c) (docs/assistant-plan.md): task skills, the one-click starters in the panel. Each belongs to a
// context (where the person is) and is a prompt the Worker fills in with the names of what's open, plus, for some,
// extra instructions and the tools it may use. Organisation administrators add their own (ai_skills, the same shape).
// Shared by the Worker (src/skills.js, which builds the prompts: the browser only sends the skill's id) and the tests.
import { EXTRACTIONS, EXTRACTION_KINDS } from "./extraction.js";

/** Where a skill shows. */
export const SKILL_CONTEXTS = /** @type {const} */ (["project", "document", "item", "request", "portfolio", "service_desk"]);
/** @type {Record<SkillContext, string>} */
export const CONTEXT_LABELS = {
  project: "On a project",
  document: "On a project's documents",
  item: "On a work item",
  request: "On a service desk request",
  portfolio: "Across projects",
  service_desk: "On the service desk",
};
/** Custom skills a workspace may have. */
export const MAX_CUSTOM_SKILLS = 40;
const DRAFT_ONLY = "This is a draft for the person to review: don't create or change anything.";

/** @type {Skill[]} */
export const BUILT_IN_SKILLS = [
  // On a project.
  { id: "status", context: "project", label: "Summarise status", prompt: "Summarise where {project} stands now: its health and why, the stage and its clock, progress, the forecast finish, and what needs attention. At most six bullets." },
  { id: "blocking", context: "project", label: "What's blocking this project?", prompt: "What's blocking {project}? List the open blockers, overdue work, sign-offs waiting and anything else holding it up, most serious first, and who can unblock each." },
  { id: "weekly_update", context: "project", label: "Draft the weekly update", prompt: "Draft this week's update for {project}: what was done in the last 7 days, what's next, risks and blockers, and any decision needed. Under 200 words, ready to send to stakeholders.", instructions: DRAFT_ONLY },
  { id: "steering_brief", context: "project", label: "Prepare the steering committee brief", prompt: "Prepare a steering committee brief for {project}: status (red, amber or green) and why, progress against plan, the forecast finish, the top risks and issues, and the decisions needed. Use short headings.", instructions: DRAFT_ONLY },
  { id: "gate_check", context: "project", label: "Check readiness for the next stage gate", prompt: "Is {project} ready to move past its current lifecycle stage? Go through each gate criterion: met or not, what's missing and what to do about it, and whose sign-off is still needed.", tools: ["get_lifecycle_status", "list_signoffs_pending", "get_project_overview", "list_documents", "get_test_results"] },
  { id: "forecast", context: "project", label: "Forecast the finish date and explain the risk", prompt: "Forecast {project}'s finish date and explain it: how it's worked out, how likely it is, the gap to the due date, and the risks that could move it." },
  // On a project's documents.
  { id: "doc_summary", context: "document", label: "Summarise", prompt: "Summarise {document}: its purpose, the main points and anything still open. Cite the sections." },
  ...EXTRACTION_KINDS.map(
    (k) =>
      /** @type {Skill} */ ({
        id: `extract_${k}`,
        context: "document",
        label: `Extract ${EXTRACTIONS[k].label.toLowerCase()}`,
        prompt: `Extract the ${EXTRACTIONS[k].label.toLowerCase()} from {document} as a table.`,
        instructions: `Call extract_from_document with kind "${k}" (find the document with list_documents if you don't have its id). The table is shown under your answer: don't repeat it. Say how many rows there are and anything notable, such as missing owners or dates.`,
        tools: ["extract_from_document", "list_documents", "find_projects"],
      }),
  ),
  { id: "compare_versions", context: "document", label: "Compare the last two versions", prompt: "Compare the last two versions of {document}: what was added, removed or changed. Cite the sections.", instructions: "Use list_documents to find both versions, then get_document for each.", tools: ["get_document", "list_documents", "search_documents", "find_projects"] },
  { id: "traceability", context: "document", label: "Check the BSS covers every BRS requirement", prompt: "Check that {project}'s latest BSS covers every requirement in its latest BRS, and list the gaps.", instructions: "Use list_documents to find the latest BRS and BSS, then check_traceability. The table is shown under your answer: summarise it (how many covered, probably covered, gaps) and list the gaps.", tools: ["check_traceability", "list_documents", "find_projects"] },
  // On a work item.
  { id: "breakdown", context: "item", label: "Break this into stories with acceptance criteria", prompt: "Break {item} into user stories, each with acceptance criteria written as Given / When / Then.", instructions: DRAFT_ONLY, tools: ["get_work_item", "search_items", "get_project_overview"] },
  { id: "test_cases", context: "item", label: "Write test cases", prompt: "Write test cases for {item}: for each, the scenario, the steps and the expected result.", instructions: DRAFT_ONLY, tools: ["get_work_item", "search_items", "get_test_results"] },
  { id: "duplicates", context: "item", label: "Find duplicates", prompt: "Find work items that may duplicate {item}: search its project for its key words and say which look like the same thing, and why.", tools: ["get_work_item", "search_items"] },
  { id: "suggest_assignee", context: "item", label: "Suggest an assignee", prompt: "Who should take {item}? Base it on workload and on who has worked on similar items, and give the reasons.", tools: ["get_work_item", "get_workload", "search_items"] },
  // On a service desk request (a work item raised through the service desk).
  { id: "draft_reply", context: "request", label: "Draft a reply", prompt: "Draft a reply to the customer on {item}: polite and plain, saying what happens next.", instructions: DRAFT_ONLY, tools: ["get_work_item", "search_items"] },
  { id: "categorise", context: "request", label: "Categorise and prioritise", prompt: "Categorise and prioritise {item}: the request type and priority it should have, and why, compared with similar requests.", tools: ["get_work_item", "search_items", "get_report"] },
  { id: "similar_resolved", context: "request", label: "Find similar resolved requests", prompt: "Find resolved requests similar to {item}, and say how they were resolved.", tools: ["get_work_item", "search_items"] },
  // Across projects.
  { id: "stuck_signoff", context: "portfolio", label: "Which projects are stuck in sign-off for more than 10 days?", prompt: "Which projects have been waiting for a sign-off for more than 10 days? Who is each one waiting on, and since when?", tools: ["list_signoffs_pending", "find_projects"] },
  { id: "stage_times", context: "portfolio", label: "Compare delivery times by stage", prompt: "Compare how long projects spend in each lifecycle stage against the targets. Which stages are the bottlenecks?", tools: ["get_lifecycle_report", "find_projects"] },
  { id: "off_track", context: "portfolio", label: "Which projects are off track, and why?", prompt: "Which projects are off track, and why? Most serious first.", tools: ["get_report", "find_projects", "get_project_overview"] },
  // On the service desk.
  { id: "sla_risk", context: "service_desk", label: "Which requests are close to breaching?", prompt: "Which service desk requests have breached their SLA or are close to it? Who has each one?", tools: ["get_report", "search_items"] },
];

/**
 * A skill's prompt with the names of what's open. A missing name becomes a plain description, so a skill still reads
 * well without one.
 * @param {string} prompt
 * @param {{ project?: string; document?: string; item?: string }} names
 */
export function fillPrompt(prompt, names) {
  return prompt
    .replace(/\{project\}/g, names.project ? `"${names.project}"` : "this project")
    .replace(/\{document\}/g, names.document ? `"${names.document}"` : `the most relevant document of ${names.project ? `"${names.project}"` : "this project"}`)
    .replace(/\{item\}/g, names.item ?? "this work item");
}

/**
 * The contexts that apply where the person is.
 * @param {{ project: boolean; section?: string; item: boolean; request: boolean; page?: string }} at
 * @returns {SkillContext[]}
 */
export function contextsAt(at) {
  if (at.item) return at.request ? ["request", "item"] : ["item"];
  if (at.project) return at.section === "docs" ? ["document", "project"] : ["project"];
  if (at.page === "service-desk") return ["service_desk", "portfolio"];
  return ["portfolio"];
}

/**
 * @typedef {typeof SKILL_CONTEXTS[number]} SkillContext
 * @typedef {Object} Skill
 * @property {string} id
 * @property {SkillContext} context
 * @property {string} label  what the button says
 * @property {string} prompt  the question, with {project}, {document} and {item} filled in
 * @property {string} [instructions]  added to the assistant's rules for this request
 * @property {string[]} [tools]  the tools it may use, its main one first (all the person may use, when not set); it shows
 *   only to people offered its main tool
 * @property {boolean} [custom]  added by the organisation
 */
