import { useEffect, useState } from "react";
import { SYSTEMS, type System } from "./systems";

// Until there is a backend, changes made in the UI live in this browser's localStorage.
// Only the changes are stored (systems added, edits to built-in ones, built-in ones removed),
// so edits to the seed list in systems.ts still show up for everyone.
const KEY = "omnitrack:v1";

interface Saved {
  added: System[];
  edits: Record<string, Partial<System>>;
  removed: string[]; // ids of built-in systems deleted in this browser
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { added: [], edits: {}, removed: [], ...JSON.parse(raw) };
  } catch {
    // Storage blocked or corrupt: fall back to the seed list.
  }
  return { added: [], edits: {}, removed: [] };
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

  const systems: System[] = [
    ...SYSTEMS.filter((s) => !saved.removed.includes(s.id)).map((s) => ({ ...s, ...saved.edits[s.id] })),
    ...saved.added,
  ];

  const add = (s: System) => setSaved((v) => ({ ...v, added: [...v.added, s] }));

  const update = (id: string, patch: Partial<System>) =>
    setSaved((v) =>
      v.added.some((s) => s.id === id)
        ? { ...v, added: v.added.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
        : { ...v, edits: { ...v.edits, [id]: { ...v.edits[id], ...patch } } },
    );

  const remove = (id: string) =>
    setSaved((v) =>
      v.added.some((s) => s.id === id)
        ? { ...v, added: v.added.filter((s) => s.id !== id) }
        : { ...v, removed: [...v.removed, id] },
    );

  return { systems, add, update, remove };
}
