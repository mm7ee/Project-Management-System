// What the project page remembers for each person (saved in their preferences, PUT /api/me/prefs): the views they've
// saved on a project's Work tab, the filters they last chose there, and the tab they last had open. Cleaned here,
// shared by the Worker and the screens, so nothing else ever reaches the database: known keys, short strings, and a
// cap on how many of each.
export const WORK_STATES = /** @type {const} */ (["open", "done", "all"]);
export const WORK_SORTS = /** @type {const} */ (["key", "priority", "status", "due", "updated", "created", "type", "summary"]);
export const PROJECT_SECTIONS = /** @type {const} */ (["overview", "lifecycle", "items", "board", "backlog", "timeline", "risks", "testing", "docs", "team", "activity", "chat"]);
export const PAGE_PREF_LIMITS = /** @type {const} */ ({ views: 40, filters: 40, tabs: 80, name: 60 });
/** @type {WorkFilters} */ export const DEFAULT_WORK_FILTERS = { state: "open", type: "", status: "", priority: "", assignee: "", label: "", q: "", sort: "key", dir: "desc" };
const SYSTEM_ID = /^[a-z0-9-]{1,64}$/;
const VIEW_ID = /^[a-z0-9]{6,24}$/;
/** A short string, or "" for anything else. @param {unknown} v @param {number} max */
const short = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/**
 * @param {unknown} raw
 * @returns {WorkFilters}
 */
export function cleanWorkFilters(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const pick = /** @template {string} T @param {unknown} v @param {readonly T[]} list @param {T} fallback @returns {T} */ (v, list, fallback) => (list.includes(/** @type {T} */ (v)) ? /** @type {T} */ (v) : fallback);
  return {
    state: pick(r.state, WORK_STATES, "open"),
    type: /^[A-Z_]{0,20}$/.test(short(r.type, 20)) ? short(r.type, 20) : "",
    status: /^[A-Za-z0-9_-]{0,40}$/.test(short(r.status, 40)) ? short(r.status, 40) : "",
    priority: /^[A-Z]{0,10}$/.test(short(r.priority, 10)) ? short(r.priority, 10) : "",
    assignee: /^[A-Za-z0-9_-]{0,64}$/.test(short(r.assignee, 64)) ? short(r.assignee, 64) : "",
    label: short(r.label, 40),
    q: short(r.q, 100),
    sort: pick(r.sort, WORK_SORTS, "key"),
    dir: r.dir === "asc" ? "asc" : "desc",
  };
}
/** Filters that differ from the defaults (what a saved view or the remembered state needs). @param {WorkFilters} f */
export const isDefaultFilters = (f) => /** @type {(keyof WorkFilters)[]} */ (Object.keys(DEFAULT_WORK_FILTERS)).every((k) => f[k] === DEFAULT_WORK_FILTERS[k]);
/**
 * The project-page part of someone's preferences.
 * @param {unknown} raw
 * @returns {PagePrefs}
 */
export function cleanPagePrefs(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  /** @type {WorkView[]} */ const views = [];
  for (const v of Array.isArray(r.workViews) ? r.workViews : []) {
    const x = /** @type {Record<string, unknown>} */ (v && typeof v === "object" ? v : {});
    const id = short(x.id, 24);
    const systemId = short(x.systemId, 64);
    const name = short(x.name, PAGE_PREF_LIMITS.name);
    if (!VIEW_ID.test(id) || !SYSTEM_ID.test(systemId) || !name || views.some((w) => w.id === id)) continue;
    views.push({ id, systemId, name, filters: cleanWorkFilters(x.filters) });
    if (views.length >= PAGE_PREF_LIMITS.views) break;
  }
  /** @type {Record<string, WorkFilters>} */ const workFilters = {};
  for (const [k, v] of Object.entries(r.workFilters && typeof r.workFilters === "object" ? r.workFilters : {}).slice(0, PAGE_PREF_LIMITS.filters)) {
    if (SYSTEM_ID.test(k)) workFilters[k] = cleanWorkFilters(v);
  }
  /** @type {Record<string, string>} */ const lastTabs = {};
  for (const [k, v] of Object.entries(r.lastTabs && typeof r.lastTabs === "object" ? r.lastTabs : {}).slice(0, PAGE_PREF_LIMITS.tabs)) {
    if (SYSTEM_ID.test(k) && PROJECT_SECTIONS.includes(/** @type {any} */ (v))) lastTabs[k] = /** @type {string} */ (v);
  }
  return { workViews: views, workFilters, lastTabs };
}
/**
 * Keeps the newest entries of a map when it grows past its cap (insertion order: oldest first).
 * @template T
 * @param {Record<string, T>} map
 * @param {string} key
 * @param {T} value
 * @param {number} cap
 * @returns {Record<string, T>}
 */
export function remember(map, key, value, cap) {
  const { [key]: _old, ...rest } = map;
  const entries = [...Object.entries(rest), [key, value]];
  return Object.fromEntries(entries.slice(-cap));
}
/**
 * @typedef {Object} WorkFilters
 * @property {"open" | "done" | "all"} state
 * @property {string} type
 * @property {string} status
 * @property {string} priority
 * @property {string} assignee
 * @property {string} label
 * @property {string} q
 * @property {typeof WORK_SORTS[number]} sort
 * @property {"asc" | "desc"} dir
 */
/**
 * @typedef {Object} WorkView
 * @property {string} id
 * @property {string} systemId
 * @property {string} name
 * @property {WorkFilters} filters
 */
/**
 * @typedef {Object} PagePrefs
 * @property {WorkView[]} workViews
 * @property {Record<string, WorkFilters>} workFilters
 * @property {Record<string, string>} lastTabs
 */
