// The timeline's critical path: the chain of dependencies ("this blocks that") that decides when the project's
// linked work finishes. For every item something blocks, walk back through the blocker that finishes latest (the one
// actually holding it up); of those chains, the critical one ends last (the longer one when two end together). With
// no dependencies there is no critical path, and the timeline says so rather than guess.
/**
 * @param {{ key: string; start: string | null; end: string | null }[]} bars
 * @param {{ from: string; to: string }[]} links  from blocks to
 * @returns {{ keys: string[]; finish: string } | null}
 */
export function criticalPath(bars, links) {
  const endOf = new Map(bars.map((b) => [b.key, b.end ?? b.start]));
  const usable = links.filter((l) => l.from !== l.to && endOf.get(l.from) && endOf.get(l.to));
  if (!usable.length) return null;
  /** @type {Map<string, string[]>} */ const blockers = new Map();
  for (const l of usable) blockers.set(l.to, [...(blockers.get(l.to) ?? []), l.from]);
  const latest = (/** @type {string[]} */ keys) => keys.reduce((a, k) => (/** @type {string} */ (endOf.get(k)) > /** @type {string} */ (endOf.get(a)) ? k : a));
  /** @type {string[] | null} */ let best = null;
  for (const target of blockers.keys()) {
    const path = [target];
    const seen = new Set(path);
    let at = target;
    for (;;) {
      const before = (blockers.get(at) ?? []).filter((k) => !seen.has(k));
      if (!before.length) break;
      at = latest(before);
      path.unshift(at);
      seen.add(at);
    }
    const end = /** @type {string} */ (endOf.get(target));
    const bestEnd = best ? /** @type {string} */ (endOf.get(best[best.length - 1])) : "";
    if (!best || end > bestEnd || (end === bestEnd && path.length > best.length)) best = path;
  }
  return best && best.length > 1 ? { keys: best, finish: /** @type {string} */ (endOf.get(best[best.length - 1])) } : null;
}
