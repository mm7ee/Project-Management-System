import { useEffect, useState } from "react";
import { SYSTEMS, type System } from "./systems";

// Until there is a backend, changes made in the UI live in this browser's localStorage.
// Only the changes are stored (systems added + edits to built-in ones), so edits to the
// seed list in systems.ts still show up for everyone.
const KEY = "omnitrack:v1";

interface Saved {
  added: System[];
  edits: Record<string, Partial<System>>;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { added: [], edits: {}, ...JSON.parse(raw) };
  } catch {
    // Storage blocked or corrupt: fall back to the seed list.
  }
  return { added: [], edits: {} };
}

export function useSystems() {
  const [saved, setSaved] = useState<Saved>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      // Not persisted this session; the UI still works in memory.
    }
  }, [saved]);

  const systems: System[] = [...SYSTEMS.map((s) => ({ ...s, ...saved.edits[s.id] })), ...saved.added];

  const add = (s: System) => setSaved((v) => ({ ...v, added: [...v.added, s] }));

  const update = (id: string, patch: Partial<System>) =>
    setSaved((v) =>
      v.added.some((s) => s.id === id)
        ? { ...v, added: v.added.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
        : { ...v, edits: { ...v.edits, [id]: { ...v.edits[id], ...patch } } },
    );

  return { systems, add, update };
}
