import { BRAND } from "./brand";
/** @import { User } from './roles' */
export {}; // the type imports above belong to the file, not to the first declaration
/**
 * @param {User} p
 * @param {string} about
 * @returns {{ kind: ContactKind; label: string; href: string }[]}
 */
export function contactLinks(p, about) {
  const subject = `${BRAND.shortName}: ${about}`;
  /** @type {{ kind: ContactKind; label: string; href: string }[]} */ const links = [];
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
/** @typedef {"email" | "teams" | "whatsapp" | "call"} ContactKind */
