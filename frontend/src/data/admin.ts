// Phase 5 administration, shared by the Worker and the UI: notification schemes, security levels,
// custom fields, GitHub development links, personal API tokens and outbound webhooks.

import type { Role } from "./roles";

// ---------- notification schemes ----------

export type NotificationEvent = "item_created" | "item_assigned" | "item_updated" | "item_transitioned" | "item_commented";

export const NOTIFICATION_EVENTS: { key: NotificationEvent; label: string; help: string }[] = [
  { key: "item_created", label: "A work item is created", help: "Someone creates a work item." },
  { key: "item_assigned", label: "A work item is assigned", help: "Someone becomes the assignee." },
  { key: "item_updated", label: "A work item is changed", help: "Its fields, links or attachments change." },
  { key: "item_transitioned", label: "A work item moves status", help: "It moves to another status." },
  { key: "item_commented", label: "A comment is added", help: "Someone comments on it." },
];

export interface NotificationScheme {
  event: NotificationEvent;
  assignee: boolean;
  reporter: boolean;
  watchers: boolean;
  lead: boolean; // the project's lead
  mentioned: boolean; // people @mentioned in the comment or description
  role?: Role; // everyone with this role
  bell: boolean;
  email: boolean;
  teams: boolean;
}

export const RECIPIENTS: { key: "assignee" | "reporter" | "watchers" | "lead" | "mentioned"; label: string }[] = [
  { key: "assignee", label: "Assignee" },
  { key: "reporter", label: "Reporter" },
  { key: "watchers", label: "Watchers" },
  { key: "lead", label: "Project lead" },
  { key: "mentioned", label: "@mentioned people" },
];

// ---------- security levels ----------

export interface SecurityLevel {
  id: string;
  name: string;
  description: string;
  roles: Role[];
  people: string[]; // user ids
  items: number; // work items at this level
}

// ---------- custom fields ----------

export type CustomFieldKind = "text" | "number" | "date" | "select" | "multiselect" | "user";

export const CUSTOM_FIELD_KINDS: Record<CustomFieldKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Single select",
  multiselect: "Multi select",
  user: "Person",
};

export interface CustomFieldOption {
  id: string;
  label: string;
}

export interface CustomField {
  id: string;
  workspace: string;
  name: string;
  kind: CustomFieldKind;
  description: string;
  required: boolean;
  onCreate: boolean;
  onEdit: boolean;
  onView: boolean;
  onBoard: boolean;
  options: CustomFieldOption[];
}

/** A value as the API sends and takes it: text, a number, a date, a user id, or option ids. */
export type CustomValue = string | number | string[] | null;

export interface CustomFieldValue {
  fieldId: string;
  name: string;
  kind: CustomFieldKind;
  value: CustomValue;
  display: string; // the value as words, for lists, cards and CSV
}

export const MAX_CUSTOM_FIELDS = 30;
export const MAX_FIELD_OPTIONS = 50;

// ---------- GitHub ----------

export type DevLinkKind = "commit" | "branch" | "pull_request";

export interface DevLink {
  id: string;
  kind: DevLinkKind;
  repo: string;
  ref: string;
  title: string;
  url: string;
  author: string;
  state?: "open" | "merged" | "closed";
  at: string;
}

// ---------- personal API tokens ----------

export type TokenScope = "read" | "write";

export interface ApiToken {
  id: string;
  userId: string;
  userName?: string; // in the administrators' list
  name: string;
  prefix: string;
  scope: TokenScope;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export const TOKEN_PREFIX = "pulse_";
export const TOKEN_DAYS = [7, 30, 90, 180, 365];
export const MAX_TOKENS_PER_PERSON = 10;
/** Requests per token per minute. */
export const API_RATE_LIMIT = 120;

// ---------- outbound webhooks ----------

export type WebhookEvent = "created" | "updated" | "transitioned" | "commented";

export const WEBHOOK_EVENTS: { key: WebhookEvent; label: string; header: string }[] = [
  { key: "created", label: "Work item created", header: "work_item.created" },
  { key: "updated", label: "Work item updated", header: "work_item.updated" },
  { key: "transitioned", label: "Work item moved status", header: "work_item.transitioned" },
  { key: "commented", label: "Comment added", header: "work_item.commented" },
];

export interface Webhook {
  id: string;
  name: string;
  url: string;
  systemId?: string; // one project, or every project
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: string;
  lastDelivery?: { status: "pending" | "delivered" | "failed"; at: string; code?: number; error?: string };
}

export interface WebhookDelivery {
  id: number;
  event: string;
  itemKey?: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  nextAttemptAt?: string;
  lastStatus?: number;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
}

/** How long to wait before each retry (attempts 2 to 6), in minutes. */
export const WEBHOOK_BACKOFF_MINUTES = [0.25, 60, 120, 240, 480];
export const WEBHOOK_MAX_ATTEMPTS = 6;
