// Project documents written in PMS (docs/project-documents.md): the organisation's own templates as data. Each kit
// is a list of sections; one editor (DocumentEditor.jsx) and one printed layout (DocumentPrint) serve them all, and a
// submitted version becomes the lifecycle stage's deliverable (signed off and locked like an uploaded file).
//   BRS  Business Requirements Specification      → BRS Draft / BRS Sign Off
//   BSS  Business Solution Specification          → BSS Draft / BSS Sign Off
//   Release notes (each one a release; the changelog is built from them) → Post Deployment Testing / Close Project
// The Change Request form is the Deployment stage's record (CHANGE_REQUEST_FIELDS), and the UAT script is printed
// from the project's UAT test cases. The Concept Note is the existing PCN (src/data/pcn.js).
// Shared by the Worker (which stores only what cleanDoc returns) and the screens.

/** @typedef {"text" | "textarea" | "date" | "select" | "number"} FieldType */
/** @typedef {{ key: string; label: string; type?: FieldType; options?: string[]; width?: string }} Column */
/**
 * @typedef {{ kind: "fields"; key: string; title: string; fields: (Column & { prefill?: string; default?: string })[]; required?: string[] }
 *   | { kind: "text"; key: string; title: string; hint?: string; prefill?: string; default?: string; required?: boolean }
 *   | { kind: "list"; key: string; title: string; hint?: string; default?: string[] }
 *   | { kind: "table"; key: string; title: string; hint?: string; columns: Column[]; default?: Record<string, string>[]; idPrefix?: string; idPad?: number; required?: boolean; prefill?: string }
 *   | { kind: "modules"; key: string; title: string; hint?: string; prefix: string; idPad: number; itemColumns: Column[]; featureFields?: Column[]; default?: DocModule[]; required?: boolean }
 *   | { kind: "auto"; key: string; title: string; source: "history" | "approvals" | "summary" }
 * } Section
 */
/** @typedef {{ title: string; items: Record<string, string>[]; features?: Record<string, string>[] }} DocModule */
/** @typedef {{ kind: string; name: string; short: string; deliverable: string | null; versioned: "document" | "release"; sections: Section[] }} Kit */
/** @typedef {Record<string, unknown>} DocData */

const PRIORITY = ["M", "S", "C", "W"];
export const PRIORITY_LEGEND = "M – Must have, S – Should have, C – Could have, W – Won't have this time";

// ---------- BRS (the Business Requirements Specification template) ----------
/** @type {Kit} */
const BRS = {
  kind: "brs",
  name: "Business Requirements Specification",
  short: "BRS",
  deliverable: "brs",
  versioned: "document",
  sections: [
    {
      kind: "fields",
      key: "control",
      title: "Document control",
      fields: [
        { key: "title", label: "Document title", prefill: "project" },
        { key: "fileReference", label: "File reference" },
        { key: "modifiedOn", label: "Modified on", type: "date", prefill: "today" },
        { key: "confidentiality", label: "Confidentiality", type: "select", options: ["STRICTLY CONFIDENTIAL", "CONFIDENTIAL", "INTERNAL", "PUBLIC"], default: "STRICTLY CONFIDENTIAL" },
      ],
      required: ["title"],
    },
    { kind: "text", key: "summary", title: "Executive summary", hint: "What the project is, why, and what it must achieve, in a paragraph or two.", prefill: "pcn.concept" },
    {
      kind: "table",
      key: "contributors",
      title: "Document contributors",
      columns: [{ key: "name", label: "Name" }, { key: "designation", label: "Designation" }, { key: "role", label: "Role" }, { key: "date", label: "Date", type: "date" }],
      prefill: "me",
    },
    { kind: "auto", key: "approvals", title: "Approvals", source: "approvals" },
    { kind: "auto", key: "history", title: "Document history", source: "history" },
    { kind: "text", key: "introduction", title: "1. Introduction", prefill: "pcn.background", required: true },
    { kind: "text", key: "objectives", title: "Objectives", prefill: "pcn.objectives" },
    { kind: "text", key: "projections", title: "Business projections", hint: "Volumes, revenue, savings or growth the business expects." },
    {
      kind: "modules",
      key: "functional",
      title: "2. Functional requirements: general requirements",
      hint: PRIORITY_LEGEND,
      prefix: "FRN-",
      idPad: 2,
      itemColumns: [{ key: "description", label: "Requirement description", type: "textarea" }, { key: "priority", label: "Priority", type: "select", options: PRIORITY, width: "90px" }],
      default: [{ title: "", items: [{ description: "", priority: "M" }] }],
      required: true,
    },
    {
      kind: "table",
      key: "integration",
      title: "3. Non-functional requirements: integration requirements",
      hint: PRIORITY_LEGEND,
      idPrefix: "IRN-",
      idPad: 3,
      columns: [{ key: "useCase", label: "Use case" }, { key: "functionality", label: "Desired functionality", type: "textarea" }, { key: "priority", label: "Priority", type: "select", options: PRIORITY, width: "90px" }],
      default: [{ useCase: "", functionality: "", priority: "M" }],
    },
    { kind: "text", key: "uat", title: "Testing requirements: User Acceptance Testing" },
    { kind: "text", key: "quality", title: "Testing requirements: Quality Assessments" },
    { kind: "text", key: "regression", title: "Testing requirements: Regression Testing" },
    { kind: "text", key: "processFlow", title: "4. Process flow", hint: "Describe the flow step by step, or attach the diagram to the project's documents and name it here." },
  ],
};

// ---------- BSS (the Business Solution Specification template) ----------
const req = (/** @type {string} */ id, /** @type {string} */ requirement, /** @type {string} */ description, priority = "M") => ({ id, requirement, description, priority });
const REQ_COLUMNS = /** @type {Column[]} */ ([{ key: "id", label: "Req No", width: "110px" }, { key: "requirement", label: "Requirement" }, { key: "description", label: "Description", type: "textarea" }, { key: "priority", label: "Priority", type: "select", options: PRIORITY, width: "90px" }]);
const FEATURE_FIELDS = /** @type {Column[]} */ ([
  { key: "name", label: "Sub-feature" },
  { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] },
  { key: "process", label: "Business process", type: "textarea" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "benefits", label: "Benefits", type: "textarea" },
  { key: "preconditions", label: "Pre-conditions", type: "textarea" },
  { key: "actors", label: "Actors" },
  { key: "triggers", label: "Triggers" },
]);
/** @type {Kit} */
const BSS = {
  kind: "bss",
  name: "Business Solution Specification",
  short: "BSS",
  deliverable: "bss",
  versioned: "document",
  sections: [
    { kind: "fields", key: "cover", title: "Cover", fields: [{ key: "system", label: "Project / system name", prefill: "project" }, { key: "client", label: "Client / industry" }, { key: "date", label: "Date", type: "date", prefill: "today" }], required: ["system"] },
    {
      kind: "table",
      key: "contributors",
      title: "Contributors",
      columns: [{ key: "name", label: "Name" }, { key: "company", label: "Company" }, { key: "designation", label: "Designation" }, { key: "date", label: "Date", type: "date" }],
      prefill: "me",
    },
    { kind: "auto", key: "approvals", title: "Approvals", source: "approvals" },
    { kind: "text", key: "scope", title: "1.1 Scope", prefill: "bss.scope", required: true, hint: "What the solution is, who it is for and what it is designed to do." },
    { kind: "auto", key: "summary", title: "High-level requirements", source: "summary" },
    {
      kind: "table",
      key: "architecture",
      title: "1.2 System architecture",
      columns: [{ key: "layer", label: "Layer", width: "180px" }, { key: "description", label: "Description", type: "textarea" }],
      default: [
        { layer: "Client Layer", description: "Web-based interfaces for the different user roles" },
        { layer: "API Gateway Layer", description: "Security: authentication, rate limiting, CORS" },
        { layer: "Application Layer", description: "Core business logic with RESTful API endpoints" },
        { layer: "Data Layer", description: "Database for data persistence and relationships" },
      ],
    },
    {
      kind: "table",
      key: "stack",
      title: "1.3 Solution stack",
      columns: [{ key: "component", label: "Component" }, { key: "technology", label: "Technology" }],
      default: ["Frontend Framework", "State Management", "UI Framework", "Backend Runtime", "Backend Framework", "Database", "ORM", "Authentication", "Real-time Communication", "Payment Gateway", "Email Service", "Version Control", "Containerization", "API Documentation"].map((component) => ({
        component,
        technology: component === "Version Control" ? "Git" : component === "Containerization" ? "Docker, Docker Compose" : component === "API Documentation" ? "Swagger/OpenAPI" : "",
      })),
    },
    {
      kind: "list",
      key: "deliverables",
      title: "1.4 Deliverables",
      default: ["Frontend Application", "Backend API Server", "Database Schema with migrations", "API Documentation (Swagger/OpenAPI)", "Administrative Portal", "Integration Services", "Docker Configuration (containerised deployment)", "User Documentation (training and operational guides)"],
    },
    {
      kind: "modules",
      key: "functional",
      title: "2. Functional requirements",
      hint: PRIORITY_LEGEND,
      prefix: "FRN-",
      idPad: 3,
      itemColumns: [{ key: "need", label: "Optional / required", type: "select", options: ["Required", "Should Have", "Optional"], width: "150px" }, { key: "description", label: "Description", type: "textarea" }, { key: "priority", label: "Priority", type: "select", options: PRIORITY, width: "90px" }],
      featureFields: FEATURE_FIELDS,
      default: [
        {
          title: "Authentication & User Management",
          items: [
            "System should support email and password-based login for all user roles",
            "System should support account registration for applicable roles",
            "System should provide role-based access control",
            "System should support email verification flows",
            "System should support password reset with secure token",
            "System should maintain session state using JWT tokens",
          ].map((description) => ({ need: "Required", description, priority: "M" })),
          features: [
            { name: "User Registration & Authentication", priority: "High", process: "", description: "Secure authentication with role-based access control", benefits: "", preconditions: "", actors: "", triggers: "Login attempt, Token refresh, Logout, Registration" },
            { name: "Role-Based Access Control", priority: "High", process: "", description: "RBAC enforcement across all protected platform routes", benefits: "Ensures data segregation, privacy, and operational integrity", preconditions: "", actors: "All users", triggers: "" },
          ],
        },
      ],
      required: true,
    },
    {
      kind: "table",
      key: "performance",
      title: "3.1 Performance requirements",
      columns: REQ_COLUMNS,
      default: [
        req("NFRN-001", "Response Time", "API response time should be < 2 seconds for 95% of requests"),
        req("NFRN-002", "Concurrent Users", "System should support [X]+ concurrent users across the platform"),
        req("NFRN-003", "Scalability", "System should scale horizontally with Docker containers"),
        req("NFRN-004", "Database Performance", "Queries should be optimised with proper indexing and pagination"),
      ],
    },
    {
      kind: "table",
      key: "availability",
      title: "3.2 Availability requirements",
      columns: REQ_COLUMNS,
      default: [
        req("NFRN-005", "Uptime", "System should have [X]% uptime SLA"),
        req("NFRN-006", "Failover", "Database should have automated backup and recovery"),
        req("NFRN-007", "Monitoring", "Health check endpoints should be available for monitoring tools"),
      ],
    },
    {
      kind: "table",
      key: "usability",
      title: "3.3 Usability requirements",
      columns: REQ_COLUMNS,
      default: [
        req("NFRN-008", "Responsive Design", "UI should work on desktop, tablet, and mobile devices"),
        req("NFRN-009", "Accessibility", "UI should follow WCAG guidelines", "S"),
        req("NFRN-010", "Error Handling", "System shall handle network failures gracefully and show actionable error messages"),
      ],
    },
    {
      kind: "table",
      key: "authSecurity",
      title: "4.1 Authentication & authorisation",
      columns: REQ_COLUMNS,
      default: [
        req("SECN-001", "JWT Authentication", "All API requests must be authenticated with JWT tokens"),
        req("SECN-002", "Role-Based Access", "Access control based on defined user roles"),
        req("SECN-003", "Password Policy", "Passwords must be hashed using bcrypt with minimum 10 rounds"),
        req("SECN-004", "Session Management", "JWT tokens should expire after a configured period"),
      ],
    },
    {
      kind: "table",
      key: "dataSecurity",
      title: "4.2 Data security",
      columns: REQ_COLUMNS,
      default: [
        req("SECN-005", "HTTPS", "All communications must be over HTTPS"),
        req("SECN-006", "Data Encryption", "Sensitive data should be encrypted at rest"),
        req("SECN-007", "SQL Injection Prevention", "Use parameterised queries via ORM"),
        req("SECN-008", "XSS Prevention", "Input sanitisation and output encoding enforced throughout"),
      ],
    },
    {
      kind: "table",
      key: "headers",
      title: "4.3 Security headers",
      columns: [{ key: "header", label: "Header" }, { key: "purpose", label: "Purpose" }, { key: "configuration", label: "Configuration" }],
      default: [
        { header: "X-Frame-Options", purpose: "Prevent clickjacking", configuration: "SAMEORIGIN" },
        { header: "X-XSS-Protection", purpose: "Prevent XSS attacks", configuration: "1; mode=block" },
        { header: "X-Content-Type-Options", purpose: "Block MIME sniffing", configuration: "nosniff" },
        { header: "Strict-Transport-Security", purpose: "Force HTTPS", configuration: "max-age=31536000" },
        { header: "Content-Security-Policy", purpose: "Prevent injection attacks", configuration: "Configured directives" },
      ],
    },
    {
      kind: "table",
      key: "rateLimiting",
      title: "4.4 Rate limiting",
      columns: REQ_COLUMNS,
      default: [
        req("SECN-009", "API Rate Limiting", "Limit requests per IP to prevent abuse"),
        req("SECN-010", "Password Reset Limit", "Max [X] password reset attempts per [Y] minutes"),
        req("SECN-011", "Login Attempt Limit", "Lock account after [X] failed login attempts"),
      ],
    },
    {
      kind: "table",
      key: "audit",
      title: "4.5 Audit & monitoring",
      columns: REQ_COLUMNS,
      default: [
        req("SECN-012", "Audit Trail", "Log all user actions with timestamps for key operations"),
        req("SECN-013", "Access Logging", "Log all API access attempts"),
        req("SECN-014", "Error Logging", "Log all errors with stack traces (details hidden from users in production)"),
      ],
    },
    {
      kind: "table",
      key: "dashboards",
      title: "5.1 Dashboard reports",
      columns: REQ_COLUMNS,
      default: [
        req("RRN-001", "Admin Dashboard", "Summary view with key platform metrics"),
        req("RRN-002", "Financial Dashboard", "Revenue, outstanding payments, wallet balances, payment trends"),
        req("RRN-003", "[Module] Dashboard", "[Description of module-specific dashboard]"),
        req("RRN-004", "Support Dashboard", "Ticket volume, status counts, average response/resolution times"),
      ],
    },
    {
      kind: "table",
      key: "formats",
      title: "5.2 Report formats",
      columns: REQ_COLUMNS,
      default: [
        req("RRN-005", "PDF Reports", "Generate downloadable PDF reports for key entities"),
        req("RRN-006", "Excel/CSV Export", "Export data to Excel/CSV format where applicable"),
        req("RRN-007", "Print Support", "Reports should be print-friendly"),
      ],
    },
    {
      kind: "table",
      key: "reportTypes",
      title: "5.3 Report types",
      columns: [{ key: "category", label: "Report category" }, { key: "reports", label: "Reports included", type: "textarea" }],
      default: [{ category: "", reports: "" }, { category: "Admin Reports", reports: "User activity logs, Audit trail, Moderation actions, System settings change log" }],
    },
    {
      kind: "table",
      key: "retention",
      title: "5.4 Data retention",
      columns: REQ_COLUMNS,
      default: [req("RRN-008", "Active Data", "[Module] and transaction data accessible directly for current period"), req("RRN-009", "Archived Data", "Historical data archived and accessible on demand for [X] years")],
    },
    {
      kind: "list",
      key: "uat",
      title: "6.1 User Acceptance Testing (UAT): key areas",
      hint: "Acceptance criteria are based on both functional and non-functional requirements.",
      default: [
        "User authentication and authorisation flows across all defined roles",
        "End-to-end [core feature] flows for all relevant product/service types",
        "Payment processing and [gateway] confirmation",
        "Support ticket creation, messaging, and resolution",
        "Notification delivery (in-app and real-time events)",
        "Cross-browser compatibility (Chrome, Firefox, Edge, Safari)",
      ],
    },
    {
      kind: "table",
      key: "quality",
      title: "6.2 Quality assessments",
      columns: [{ key: "type", label: "Test type", width: "200px" }, { key: "description", label: "Description", type: "textarea" }],
      default: [
        { type: "Functional Testing", description: "Verify all features work as specified in this document" },
        { type: "Integration Testing", description: "Test API integrations ([list relevant integrations])" },
        { type: "Performance Testing", description: "Load testing with simulated concurrent users" },
        { type: "Security Testing", description: "Penetration testing and vulnerability assessment" },
        { type: "Usability Testing", description: "User experience validation across roles" },
        { type: "Regression Testing", description: "Automated test suites for critical user journeys on every release" },
      ],
    },
    {
      kind: "table",
      key: "documentation",
      title: "7. Documentation requirements",
      columns: [{ key: "group", label: "Group", width: "150px" }, { key: "document", label: "Document" }, { key: "description", label: "Description", type: "textarea" }],
      default: [
        ["Technical", "API Documentation", "Swagger/OpenAPI specification for all endpoints"],
        ["Technical", "Database Schema", "ERD diagrams and table definitions"],
        ["Technical", "Architecture Document", "High-level and low-level design documents"],
        ["Technical", "Deployment Guide", "Docker deployment and configuration guide"],
        ["Technical", "Frontend Route Map", "Authoritative list of frontend routes per role"],
        ["User", "User Manual", "Role-specific user guides"],
        ["User", "Training Materials", "Training documentation and walkthrough videos"],
        ["User", "FAQ Document", "Common questions and troubleshooting per role"],
        ["Operational", "Runbook", "Operational procedures for support team"],
        ["Operational", "Backup & Recovery", "Data backup and disaster recovery procedures"],
        ["Operational", "Monitoring Guide", "System monitoring and alerting configuration"],
      ].map(([group, document, description]) => ({ group, document, description })),
    },
    { kind: "text", key: "docker", title: "8.1 Deployment: Docker configuration", default: "The system is containerised using Docker Compose with separate service containers for the application and the database." },
    {
      kind: "table",
      key: "environment",
      title: "8.2 Environment configuration",
      columns: [{ key: "variable", label: "Variable", width: "220px" }, { key: "description", label: "Description" }],
      default: [
        ["PORT", "Application port"],
        ["NODE_ENV", "Environment (development/production)"],
        ["DB_HOST", "Database host"],
        ["DB_USER", "Database username"],
        ["DB_PASSWORD", "Database password"],
        ["DB_NAME", "Database name"],
        ["JWT_SECRET", "JWT signing secret"],
        ["JWT_EXPIRES_IN", "Token expiration time"],
        ["EMAIL_HOST", "SMTP server host"],
        ["EMAIL_USER", "SMTP username"],
        ["EMAIL_PASS", "SMTP password"],
      ].map(([variable, description]) => ({ variable, description })),
    },
    {
      kind: "table",
      key: "roles",
      title: "Appendix A: User roles & permissions matrix",
      columns: [{ key: "module", label: "Module" }, { key: "role1", label: "Role 1" }, { key: "role2", label: "Role 2" }, { key: "role3", label: "Role 3" }, { key: "admin", label: "Admin" }],
      default: ["Authentication", "Listings (Browse)", "Listings (Manage)", "Bookings / Orders", "Payments", "Support Tickets", "Notifications", "Finance / Wallet", "System Settings", "Audit Logs"].map((module) => ({ module, role1: "Own", role2: "Own/Business", role3: "Limited", admin: "Full" })),
    },
    {
      kind: "table",
      key: "statuses",
      title: "Appendix B: Status models",
      columns: [{ key: "status", label: "Status", width: "180px" }, { key: "description", label: "Description" }],
      default: [
        ["pending", "Created, awaiting payment or confirmation"],
        ["pending_payment", "Awaiting payment completion"],
        ["confirmed", "Confirmed"],
        ["in_progress", "Service underway"],
        ["completed", "Service fully delivered"],
        ["cancelled", "Cancelled"],
      ].map(([status, description]) => ({ status, description })),
    },
    {
      kind: "table",
      key: "endpoints",
      title: "Appendix C: API endpoint summary",
      columns: [{ key: "category", label: "Category", width: "180px" }, { key: "endpoints", label: "Endpoints", type: "textarea" }],
      default: [
        ["Authentication", "/auth/login, /auth/register, /auth/forgot-password, /auth/reset-password, /auth/verify-email"],
        ["Users", "/users, /users/me, /users/:id"],
        ["[Core Resource]", "/[resource], /[resource]/:id"],
        ["Payments", "/payments, /payments/poll"],
        ["Support", "/tickets, /tickets/:id/messages"],
        ["Admin", "/admin/users, /admin/[resources], /admin/audit-logs, /admin/settings"],
        ["Other", "/notifications, /[other-resources]"],
      ].map(([category, endpoints]) => ({ category, endpoints })),
    },
    { kind: "auto", key: "history", title: "Document control", source: "history" },
  ],
};

// ---------- Release notes (each submitted version is one release; the changelog lists them) ----------
/** @type {Kit} */
const RELEASE_NOTES = {
  kind: "release_notes",
  name: "Release Notes",
  short: "Release notes",
  deliverable: "release_notes",
  versioned: "release",
  sections: [
    {
      kind: "fields",
      key: "release",
      title: "Release",
      fields: [
        { key: "product", label: "Product", prefill: "project" },
        { key: "version", label: "Version (e.g. 1.2.0)" },
        { key: "releaseDate", label: "Release date", type: "date", prefill: "today" },
        { key: "releaseType", label: "Release type", type: "select", options: ["Major", "Minor", "Patch", "Hotfix"], default: "Minor" },
        { key: "preparedBy", label: "Prepared by", prefill: "me" },
      ],
      required: ["product", "version", "releaseDate"],
    },
    { kind: "text", key: "overview", title: "Overview", hint: "Two or three sentences: the headline feature and the most important fixes.", required: true },
    { kind: "table", key: "features", title: "New features", hint: "One entry per feature: what it does, who it helps, where to find it.", columns: [{ key: "name", label: "Feature", width: "220px" }, { key: "description", label: "Description", type: "textarea" }], prefill: "items.features" },
    { kind: "list", key: "improvements", title: "Improvements" },
    { kind: "table", key: "fixes", title: "Bug fixes", columns: [{ key: "ticket", label: "Ticket / ID", width: "120px" }, { key: "description", label: "Description of fix", type: "textarea" }, { key: "area", label: "Area affected", width: "160px" }], prefill: "items.bugs" },
    { kind: "list", key: "security", title: "Security fixes" },
    { kind: "table", key: "knownIssues", title: "Known issues", columns: [{ key: "id", label: "ID", width: "100px" }, { key: "issue", label: "Issue", type: "textarea" }, { key: "workaround", label: "Workaround" }] },
    { kind: "list", key: "deprecated", title: "Deprecated or removed" },
    { kind: "list", key: "actions", title: "Action required / upgrade instructions", default: ["None"] },
    { kind: "list", key: "compatibility", title: "Compatibility" },
    { kind: "text", key: "support", title: "Support", default: "For questions or to report a problem, contact the service desk." },
  ],
};

/** The kits, by kind. @type {Record<string, Kit>} */
export const KITS = { brs: BRS, bss: BSS, release_notes: RELEASE_NOTES };
export const KIT_KINDS = /** @type {const} */ (["brs", "bss", "release_notes"]);
/** The kit that writes a lifecycle deliverable, or null. @param {string} key */
export const kitFor = (key) => Object.values(KITS).find((k) => k.deliverable === key) ?? null;

// ---------- the Change Request form (the Deployment stage's record) ----------
/** Fields of the organisation's Change Request form; plan, rollbackPlan, scheduledAt and approver are the ones the Deployment gate checks. @type {{ group: string; fields: (Column & { required?: boolean; default?: string })[] }[]} */
export const CHANGE_REQUEST_FIELDS = [
  {
    group: "Request",
    fields: [
      { key: "requestedBy", label: "Requested by" },
      { key: "requestDate", label: "Date", type: "date" },
      { key: "rfsNo", label: "RFS No" },
      { key: "department", label: "Department" },
      { key: "assignee", label: "Change assignee" },
      { key: "changeType", label: "Change type", type: "select", options: ["Configuration", "Code release", "Infrastructure", "Data", "Other"] },
      { key: "changeCategory", label: "Change category", type: "select", options: ["Business Request", "Incident Fix", "Maintenance", "Enhancement"] },
      { key: "emergency", label: "Is this an emergency?", type: "select", options: ["No", "Yes"], default: "No" },
      { key: "priority", label: "Priority", type: "select", options: ["0 (Critical)", "1 (High)", "2 (Medium)", "3 (Low)"], default: "2 (Medium)" },
    ],
  },
  {
    group: "The change",
    fields: [
      { key: "plan", label: "Description of proposed change (the deployment plan)", type: "textarea", required: true },
      { key: "justification", label: "Business justification / reason for change", type: "textarea" },
      { key: "affectedAreas", label: "Which IS / IT / business areas will be affected?", type: "textarea" },
      { key: "rollbackPlan", label: "Rollback plan", type: "textarea", required: true },
    ],
  },
  {
    group: "Technical details",
    fields: [
      { key: "components", label: "Component(s) name" },
      { key: "platform", label: "Platform" },
      { key: "dependencies", label: "Dependencies", default: "None" },
      { key: "numberOfChanges", label: "Number of changes", default: "1" },
      { key: "scheduledAt", label: "Implementation date and time", type: "text", required: true },
      { key: "implementor", label: "Change implementor" },
      { key: "timeRequired", label: "Time required" },
      { key: "risk", label: "Risk", type: "select", options: ["Low", "Medium", "High"], default: "Low" },
      { key: "impact", label: "Impact", type: "select", options: ["S1", "I2", "I3", "I4"] },
      { key: "documentation", label: "Documentation / procedures required", type: "textarea" },
      { key: "implications", label: "Business implications", type: "textarea" },
    ],
  },
  {
    group: "Approvals",
    fields: [
      { key: "approverTeamLeader", label: "Contact Centre Team Leader (name / alternate)" },
      { key: "approverOpsManager", label: "Back Office Operations Manager (name / alternate)" },
      { key: "approverCcxo", label: "Chief Customer Experience Officer (name / alternate)" },
      { key: "approver", label: "Approved by (recorded)", required: true },
    ],
  },
  {
    group: "Change closure",
    fields: [
      { key: "successful", label: "Was the change successful?", type: "select", options: ["", "Yes", "No"] },
      { key: "incidentNo", label: "If no: incident number" },
      { key: "closureNotes", label: "Problem(s) encountered", type: "textarea" },
      { key: "dateClosed", label: "Date closed", type: "date" },
    ],
  },
];

// ---------- data ----------
const MAX_CELL = 4000;
const MAX_ROWS = 300;
const s = (/** @type {unknown} */ v, max = MAX_CELL) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
/** @param {Column[]} cols @param {unknown} row */
const cleanRow = (cols, row) => Object.fromEntries(cols.map((c) => [c.key, s(/** @type {any} */ (row)?.[c.key])]));

/**
 * The only shape a document of a kit may have: known sections, strings only, bounded sizes.
 * @param {Kit} kit
 * @param {unknown} raw
 * @returns {DocData}
 */
export function cleanDoc(kit, raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  /** @type {DocData} */ const out = {};
  for (const sec of kit.sections) {
    const v = o[sec.key];
    if (sec.kind === "fields") out[sec.key] = Object.fromEntries(sec.fields.map((f) => [f.key, s(v?.[f.key], 500)]));
    else if (sec.kind === "text") out[sec.key] = s(v, 20000);
    else if (sec.kind === "list") out[sec.key] = (Array.isArray(v) ? v : []).slice(0, MAX_ROWS).map((x) => s(x, 1000));
    else if (sec.kind === "table") out[sec.key] = (Array.isArray(v) ? v : []).slice(0, MAX_ROWS).map((r) => cleanRow(sec.columns, r));
    else if (sec.kind === "modules") {
      out[sec.key] = (Array.isArray(v) ? v : []).slice(0, 60).map((m) => ({
        title: s(m?.title, 200),
        items: (Array.isArray(m?.items) ? m.items : []).slice(0, MAX_ROWS).map((/** @type {unknown} */ r) => cleanRow(sec.itemColumns, r)),
        ...(sec.featureFields ? { features: (Array.isArray(m?.features) ? m.features : []).slice(0, 40).map((/** @type {unknown} */ r) => cleanRow(/** @type {Column[]} */ (sec.featureFields), r)) } : {}),
      }));
    }
  }
  return out;
}

/**
 * @typedef {Object} PrefillContext
 * @property {string} project
 * @property {string} today      YYYY-MM-DD
 * @property {{ name: string; title?: string }} me
 * @property {{ background?: string; concept?: string; objectives?: string } | null} pcn
 * @property {{ key: string; summary: string; type: string; component?: string | null }[]} doneItems  resolved work items (release notes)
 * @property {DocData | null} previous   the last version, if any: a new draft starts from it
 */
/**
 * A new draft: the previous version if there is one, else the kit's defaults with what PMS already knows (the
 * project's name, today, the Concept Note, resolved work items).
 * @param {Kit} kit
 * @param {PrefillContext} ctx
 * @returns {DocData}
 */
export function newDoc(kit, ctx) {
  if (ctx.previous && kit.versioned === "document") return cleanDoc(kit, ctx.previous);
  /** @param {string | undefined} p */
  const fill = (p) =>
    p === "project" ? ctx.project : p === "today" ? ctx.today : p === "me" ? ctx.me.name : p === "pcn.background" ? (ctx.pcn?.background ?? "") : p === "pcn.concept" ? (ctx.pcn?.concept ?? "") : p === "pcn.objectives" ? (ctx.pcn?.objectives ?? "") : p === "bss.scope" ? `This Business Solution Specification (BSS) outlines the functional and non-functional requirements for the development of ${ctx.project}.` : "";
  /** @type {DocData} */ const d = {};
  for (const sec of kit.sections) {
    if (sec.kind === "fields") d[sec.key] = Object.fromEntries(sec.fields.map((f) => [f.key, fill(f.prefill) || f.default || ""]));
    else if (sec.kind === "text") d[sec.key] = fill(sec.prefill) || sec.default || "";
    else if (sec.kind === "list") d[sec.key] = [...(sec.default ?? [])];
    else if (sec.kind === "table") {
      if (sec.prefill === "me") d[sec.key] = [{ ...cleanRow(sec.columns, {}), name: ctx.me.name, designation: ctx.me.title ?? "", role: "Author", date: ctx.today }];
      else if (sec.prefill === "items.bugs") d[sec.key] = ctx.doneItems.filter((i) => i.type === "BUG").map((i) => ({ ticket: i.key, description: i.summary, area: i.component ?? "" }));
      else if (sec.prefill === "items.features") d[sec.key] = ctx.doneItems.filter((i) => i.type === "STORY" || i.type === "EPIC").map((i) => ({ name: i.summary, description: "" }));
      else d[sec.key] = (sec.default ?? []).map((r) => cleanRow(sec.columns, r));
    } else if (sec.kind === "modules") d[sec.key] = structuredClone(sec.default ?? []);
  }
  return cleanDoc(kit, d);
}

/**
 * What a document still needs before it can be submitted (its required parts), in words.
 * @param {Kit} kit
 * @param {DocData} doc
 * @returns {string[]}
 */
export function docMissing(kit, doc) {
  /** @type {string[]} */ const out = [];
  for (const sec of kit.sections) {
    const v = /** @type {any} */ (doc[sec.key]);
    if (sec.kind === "fields") for (const k of sec.required ?? []) if (!String(v?.[k] ?? "").trim()) out.push(`${sec.title}: ${sec.fields.find((f) => f.key === k)?.label ?? k}`);
    if (sec.kind === "text" && sec.required && !String(v ?? "").trim()) out.push(sec.title);
    if (sec.kind === "modules" && sec.required && !(v ?? []).some((/** @type {DocModule} */ m) => m.title.trim() && m.items.some((i) => Object.values(i).some((x) => x.trim() && !PRIORITY.includes(x) && x !== "Required")))) out.push(`${sec.title}: at least one requirement`);
  }
  return out;
}

/** Ids as the templates number them: FRN-01, IRN-001, FRN-01-02. @param {string} prefix @param {number} i @param {number} pad */
export const docId = (prefix, i, pad) => `${prefix}${String(i + 1).padStart(pad, "0")}`;

/**
 * The changelog, from the project's submitted release notes (newest first), in the Changelog template's headings.
 * @param {{ version: number; data: DocData; submittedAt: string | null }[]} releases
 */
export function changelog(releases) {
  return releases
    .filter((r) => r.submittedAt)
    .sort((a, b) => b.version - a.version)
    .map((r) => {
      const d = /** @type {any} */ (r.data);
      const rel = d.release ?? {};
      const listOf = (/** @type {string[] | undefined} */ x) => (x ?? []).map((t) => t.trim()).filter(Boolean);
      return {
        version: rel.version || `Release ${r.version}`,
        date: rel.releaseDate || (r.submittedAt ?? "").slice(0, 10),
        summary: String(d.overview ?? "").split(/(?<=\.)\s/)[0] ?? "",
        added: (d.features ?? []).map((/** @type {any} */ f) => [f.name, f.description].filter((x) => x?.trim()).join(": ")).filter(Boolean),
        changed: listOf(d.improvements),
        deprecated: listOf(d.deprecated),
        fixed: (d.fixes ?? []).map((/** @type {any} */ f) => `${f.description}${f.ticket ? ` (${f.ticket})` : ""}`).filter((/** @type {string} */ x) => x.trim()),
        security: listOf(d.security),
      };
    });
}
