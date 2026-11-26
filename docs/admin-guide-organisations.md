# Running organisations and workspaces in Pulse

For Pulse's Platform Administrators and each organisation's administrators.

Pulse holds several **organisations**. Each has its own **workspaces** (for example Projects, HR, Finance) and its
own people. Nobody ever sees anything of another organisation, and people see only the workspace they have open.

| Who | Where | What they do |
| --- | --- | --- |
| Platform Administrator | `/platform` | Create, rename, suspend and archive organisations; give each its first administrator. They can't open an organisation's data. |
| Organisation Administrator | Settings → **Organisation** (Profile, Workspaces, Members & roles, Roles & permissions, Audit log) | Their organisation's profile, workspaces and people, each person's role in each workspace, and the organisation-wide settings: two-step rules, sign-in security, email & Teams. |
| Workspace administrator (the Administrator role in a workspace) | Settings → **This workspace** | That workspace: workflows, fields, automations, users, its audit log; boards, integrations, the service desk. |
| Viewer (the read-only role) | — | Sees what the workspace shows. Can't change anything except their own account, notifications and chat, and can't be assigned work. |

## The first Platform Administrator

Someone with the database's connection string makes the first one:

```
cd frontend
node scripts/platform-admin.mjs create main <username> "<Full name>"
```

It prints a temporary password, shown once. Give it to them through a safe channel. `list` shows who exists.

The Platform Administrator then:
1. Opens `https://<pulse address>/platform` and signs in with the username and the temporary password.
2. Scans the QR code with an authenticator app (Microsoft or Google Authenticator, 1Password …) and enters its
   6-digit code. Platform sign-in always needs the app.
3. Chooses their own password (12+ characters, with letters, numbers and symbols, not their name).

## Adding an organisation (Platform Administrator)

1. `/platform` → **New organisation**.
2. Give its **name**, and a **code**: lower-case letters, numbers and dashes, such as `acme` or `acme-zw`. People
   type the code when they sign in, so keep it short. It can't be changed later.
3. Give its first administrator's **username**, **full name** and, if you like, **email**.
4. **Make the organisation.**
   - Pulse copies its standard statuses, workflows, security levels, notification schemes, holidays and service
     desk request types into it.
   - It gets one workspace, **Projects**.
   - Its first administrator is made an Organisation Administrator.
5. Copy the **sign-in link**, **username** and **temporary password** to the administrator through a safe channel.
   The password is shown only once.

The administrator opens the link (or the main page, typing the code), signs in, and chooses their own password.

**Other actions on `/platform`:**
- **Rename:** the code stays the same.
- **Suspend:** nobody in it can sign in, and its view-only links, portal links and API tokens stop working, until
  you **Reactivate** it.
- **Archive:** the same as suspending, for an organisation that has left. Nothing is deleted.
- **Delete…** (archived organisations only):
  - Type its code to confirm.
  - 30 days later everything it holds is deleted for good: workspaces, people, projects, work items and history.
  - Until then, **Keep it** calls it off, and so does reactivating it.
- **Add admin:** a new Organisation Administrator, for an organisation that has lost all of its own.

## The organisation profile (Organisation Administrator)

Settings → Organisation → **Profile**:
- **Logo:** PNG, JPEG or WebP, up to 100 KB. It replaces the Pulse logo in the sidebar.
- **Brand colour:** a line under the logo.
- **Time zone:** schedules, digests and SLA clocks use it.
- **Working days and hours.**
- **Contact email.**

The logo and colour appear only after people sign in. The sign-in page stays plain, so it never shows which
organisations use Pulse.

## Adding a workspace (Organisation Administrator)

1. Settings → **Organisation** → **Workspaces** → **Add workspace**.
2. Fill in:
   - its **name** (Marketing)
   - a **key** (2 to 10 capital letters or digits, such as MKT)
   - optionally an **icon**, **colour** and **description**
3. **Visibility:**
   - **Members only:** the default.
   - **Whole organisation:** anyone in the organisation can open it from the workspace switcher, as a **Viewer**
     (read-only). You can change their role later.
4. **Start from:**
   - **A blank workspace**, or
   - **a copy of another workspace's set-up:** its workflow, custom fields, automation rules and workload limits.
     No projects or work items are copied, and the copied automation rules start switched off, so check them before
     turning them on.
5. **Add workspace.** You're its first member, as its Administrator.

**Edit** changes the name, key, icon, colour, description or visibility, and keeps everything in the workspace.
**Archive** closes it to everyone (nothing is deleted), and **Reactivate** opens it again. You can't archive the last
active workspace, or the one you have open.

## Adding people and giving them roles (Organisation Administrator)

Settings → **Organisation** → **Members & roles**. There are three ways to add people.

**Invite by email** (best):
1. Give their **email** and **full name**. The username comes from the email unless you give one.
2. Under **Workspaces and roles**, choose their role in each workspace they should be in, or "Not in it". They need
   at least one workspace.
   - **Administrator:** everything in that workspace.
   - **Manager, Team Leader, Projects Assistant, Developer, Standard user:** what Roles & permissions gives each.
   - **Viewer (read-only):** sees the workspace and changes nothing.
3. Tick **Organisation Administrator** only for people who should manage workspaces, people and organisation
   settings.
4. **Send invitation.**
   - They get an email with their username, the organisation code and a link to choose their password. The link
     works once, within 72 hours.
   - If email isn't set up (Settings → Email & Teams), Pulse shows the link once instead: send it to them through a
     safe channel.

**Import CSV:** for many people at once.
- **The columns:**
  - The first row names them: `email, name, workspace, role`, and optionally `username, title, orgadmin`.
  - **workspace** is the key or name. Put several separated by `;`, or one row per workspace for the same email.
  - **role** is the name you see in Pulse, such as Developer or Viewer.
- **Check the file** lists who would be invited. If any row has a problem, every problem is listed and nobody is
  invited.
- **Invite** sends the invitations.

**Add with a temporary password:** as before, for someone without email. Pass the password on safely; they choose
their own at the first sign-in.

**Afterwards, in the table:**
- **Change a role** in any workspace from its column.
- **"Not in it"** takes them out of that workspace, and closes their sessions there at once.
- **Organisation Administrator:** tick or untick it. There must always be at least one active one.
- **Deactivate:**
  - It signs them out and stops them signing in. Their workspaces, assignments and history stay.
  - **Reactivate** lets them back in with their old password.
  - Use this when someone leaves for a while, or until their work is handed over.
- **Remove:**
  - It takes them out of the organisation for good (type their username to confirm).
  - Their account goes; what they did stays, shown as a former user.

## The audit log

Settings → Organisation → **Audit log** lists every change to the organisation's profile, workspaces, people, roles
and permissions. Each entry shows:
- who made it, when, and from which address
- the values before and after

Filter by workspace. Nobody can edit or delete an entry. Workspace administrators see their own workspace's entries
under This workspace → Audit log.

## Signing in, for everyone

1. The sign-in page asks for the **organisation code**, or takes it from a link like `…/#/o/acme`. This device
   remembers it; **Change** sets another.
2. Username and password, then the second step if they have two-step verification.
3. Someone in several workspaces chooses which to open. They can switch later from the top bar, without signing in
   again.

A wrong code, an unknown username and a wrong password all get the same message. That's on purpose, so nobody can
find out which organisations or accounts exist.

## Inside each workspace

- **Executive page:** Settings → View-only links → **Executive page links**. Make a link for leadership. It shows
  that workspace's totals only (no names of projects or people), until it expires or you turn it off. Each
  workspace makes its own.
- **GitHub:** Settings → Integrations → GitHub connects this workspace's repositories, with a secret of its own.
  Pulse refuses a secret another workspace already uses, because the secret tells Pulse which workspace a delivery
  is for.
- **Digests and the Monday Briefing** go out per workspace, to its members, titled with its name. Someone in two
  workspaces gets one of each.
