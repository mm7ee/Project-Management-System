import type { User } from "./roles";

// How to reach a user. Emails are placeholders (example.com) until the admin fills in real
// ones; adding a phone number (international format, e.g. "+263 77 123 4567") switches on
// the WhatsApp and Call buttons.

export type ContactKind = "email" | "teams" | "whatsapp" | "call";

export function contactLinks(p: User, about: string): { kind: ContactKind; label: string; href: string }[] {
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
