// Project leads. PLACEHOLDERS: the emails use the reserved example.com domain and nobody
// has a phone number yet. Replace them with real details; phone numbers (international
// format, e.g. "+263 77 123 4567") switch on the WhatsApp and Call buttons.

export interface Person {
  id: string;
  name: string;
  title: string;
  email?: string;
  phone?: string;
}

export const PEOPLE: Person[] = [
  { id: "donald", name: "Donald", title: "Project Lead", email: "donald@example.com" },
  { id: "anesu", name: "Anesu", title: "Project Lead", email: "anesu@example.com" },
  { id: "kundai", name: "Kundai", title: "Project Lead", email: "kundai@example.com" },
  { id: "tino", name: "Tino", title: "Project Lead", email: "tino@example.com" },
  { id: "paul", name: "Paul", title: "Project Lead", email: "paul@example.com" },
  { id: "mutsa", name: "Mutsa", title: "Sys Admin", email: "mutsa@example.com" },
  { id: "mcdonald", name: "McDonald", title: "Project Lead", email: "mcdonald@example.com" },
  { id: "ruva", name: "Ruva", title: "Project Lead", email: "ruva@example.com" },
];

export const personById = (id?: string) => PEOPLE.find((p) => p.id === id);

export type ContactKind = "email" | "teams" | "whatsapp" | "call";

/** The ways to reach someone, limited to what their details allow. */
export function contactLinks(p: Person, about: string): { kind: ContactKind; label: string; href: string }[] {
  const subject = `OmniTrack: ${about}`;
  const links: { kind: ContactKind; label: string; href: string }[] = [];
  if (p.email) {
    links.push({ kind: "email", label: "Email", href: `mailto:${p.email}?subject=${encodeURIComponent(subject)}` });
    links.push({
      kind: "teams",
      label: "Teams",
      href: `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(p.email)}&message=${encodeURIComponent(`Hi ${p.name}, about ${about}: `)}`,
    });
  }
  if (p.phone) {
    const digits = p.phone.replace(/[^\d]/g, "");
    links.push({ kind: "whatsapp", label: "WhatsApp", href: `https://wa.me/${digits}?text=${encodeURIComponent(`Hi ${p.name}, about ${about}: `)}` });
    links.push({ kind: "call", label: "Call", href: `tel:+${digits}` });
  }
  return links;
}
