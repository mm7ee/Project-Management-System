// The product's own name and wording, in one place. Everything that names the product (screens, page titles,
// emails, digests, the Monday Briefing, notifications, Teams posts, exports, the assistant, the app manifest)
// reads it from here, in the browser and in the Worker. Renaming the product is a change to this file.
//
// This is the PLATFORM's identity, and it stays neutral. An organisation's own name, logo and colour are its
// branding (src/data/branding.js), shown once someone has chosen that organisation.

export const BRAND = Object.freeze({
  /** The full name: page titles, the platform page, "Powered by …". */
  productName: "Project Management System",
  /** The short form: tab titles after the organisation's name, labels with little room. */
  shortName: "PMS",
  /** One line of value, on the platform page. */
  tagline: "Plan, track and deliver your organisation's work in one place.",
  /** Where people can ask for help with the platform itself. Empty until one is set: then it isn't shown. */
  supportEmail: "",
  /** The AI assistant's name. Neutral, so it reads well under any organisation's brand. */
  assistantName: "Ask AI",
  /** The quiet credit on organisation-branded pages, emails and exports. */
  poweredBy: "Powered by Project Management System",
});

/**
 * "Omnicontact · PMS": a tab title inside an organisation's space.
 * @param {...(string | null | undefined)} parts
 */
export function tabTitle(...parts) {
  return [...parts.filter(Boolean), BRAND.shortName].join(" · ");
}
