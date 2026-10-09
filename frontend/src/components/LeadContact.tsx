import { Mail, MessageCircle, MessagesSquare, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { contactLinks, type ContactKind, type Person } from "../data/people";

const ICONS: Record<ContactKind, LucideIcon> = {
  email: Mail,
  teams: MessagesSquare,
  whatsapp: MessageCircle,
  call: Phone,
};

/** Row of contact buttons for a lead: Email / Teams, plus WhatsApp / Call once they have a phone number. */
export default function LeadContact({ person, about }: { person: Person; about: string }) {
  const links = contactLinks(person, about);
  if (!links.length) return <p className="lead-none">No contact details yet.</p>;
  return (
    <div className="contact-row">
      {links.map(({ kind, label, href }) => {
        const Icon = ICONS[kind];
        return (
          <a
            key={kind}
            className="contact-btn"
            href={href}
            target={kind === "email" || kind === "call" ? undefined : "_blank"}
            rel="noreferrer"
          >
            <Icon size={15} /> {label}
          </a>
        );
      })}
    </div>
  );
}
