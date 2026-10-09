import { useState } from "react";

// Who is using this browser. There is no real login yet, so this is self-declared
// and stored per browser; it labels the sidebar and the updates this person posts.
const KEY = "omnitrack:profile";

export interface Profile {
  name: string;
  title: string;
}

function load(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p?.name ? p : null;
  } catch {
    return null;
  }
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(load);

  const save = (p: Profile) => {
    setProfile(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      // Kept for this visit only.
    }
  };

  return { profile, save };
}
