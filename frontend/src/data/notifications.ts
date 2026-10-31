// Notifications and digests, shared by the Worker (which writes them) and the bell in the app.

export type NotificationKind = "assigned" | "update_requested" | "signature" | "daily_digest" | "monday_briefing";

export interface DigestItem {
  text: string;
  link?: string; // "#/projects/<id>" or "view:<page>"
}

export interface DigestSection {
  title: string;
  items: DigestItem[];
}

/** A daily digest or Monday Briefing. The sections come straight from the data; only `summary` may be AI-written. */
export interface Digest {
  title: string;
  period: string; // "2026-11-02" or "2026-W45"
  writtenAt?: string;
  summary: string;
  aiWritten: boolean;
  sections: DigestSection[];
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  digest?: Digest;
  createdAt: string;
  readAt?: string;
}

export interface NotificationFeed {
  items: AppNotification[];
  unread: number;
}

/** Administrators: how alerts and digests leave Pulse. Secrets are never sent back, only whether they're set. */
export interface DeliveryStatus {
  email: { configured: boolean; from: string };
  teams: { configured: boolean };
  briefingEmails: string[];
  lastError?: { channel: string; message: string; at: string };
  demoProjects: number; // demo records still in the database
}
