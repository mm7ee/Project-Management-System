import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Profile } from "../data/profile";

interface Props {
  profile: Profile | null;
  onSave: (p: Profile) => void;
  onClose: () => void;
}

export default function ProfileModal({ profile, onSave, onClose }: Props) {
  const [name, setName] = useState(profile?.name ?? "");
  const [title, setTitle] = useState(profile?.title ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label="Your profile"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name: name.trim(), title: title.trim() });
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Your profile</h2>
        <p className="modal-note">Shown in the sidebar, and your initials go on the updates you post.</p>

        <label className="field">
          <span>Name</span>
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mutsa Mwanza" />
        </label>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sys Admin" />
        </label>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
