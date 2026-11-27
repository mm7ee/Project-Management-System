# Running organisations and workspaces in PMS

For PMS's Platform Administrators and each organisation's administrators.

PMS holds several **organisations**. Each has its own **workspaces** (for example Projects, HR, Finance) and its
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
cd project-management-system-backend
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
   - PMS copies its standard statuses, workflows, security levels, notification schemes, holidays and service
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
- **Time zone:** schedules, digests and SLA clocks use it.
- **Working days and hours.**
- **Contact email.**

## Branding (Organisation Administrator, or a Platform Administrator)

Settings → Organisation → **Branding** makes PMS look like your organisation's own system. A Platform Administrator
can do the same from `/platform`: **Branding** on the organisation's row.

**What you can set:**
- **Display name:** "Sign in to {name}", tab titles, emails.
- **Logo for light backgrounds**, and **logo for dark backgrounds** (usually a white version). The sidebar is always
  dark, so it uses the dark one.
- **Square icon:** the browser tab and small places.
- **Accent colour:** main buttons, links, the active page, focus rings.
- **Sign-in background tint** (optional).
- **Sidebar colour and sidebar highlight** (optional): your own sidebar, and the colour of the page you're on in it.
  Without them the sidebar is neutral graphite with your accent. Both are adjusted if needed, so text stays
  readable.

**How it behaves:**
- **The contrast check:** if the accent is too light or too dark for a theme, a safe shade of it is used there. The
  page shows which.
- **Without a logo:** your initials in a rounded square of the accent stand in.
- **Images:** PNG, WebP or JPEG up to 512 KB, resized for you. SVG isn't accepted.
- **The live preview** shows the platform page, your sign-in page and the app, in each theme.

**Where it shows:**
- **Your sign-in page:** `…/#/o/{code}`, or after someone types your code.
- **Inside the app:** the sidebar, the tab, buttons and links.
- **Beyond it:** emails, Teams posts, PDF and Excel exports, the executive page and the service desk portal, each with
  "Powered by Project Management System" in small print.
- **Not on the platform's own page:** it stays neutral and never lists organisations.
- **Never the status colours:** on track, at risk and overdue look the same in every organisation.

### The theme, generated from your logo

Below Branding, **Theme** turns your logo into a complete colour theme: sidebar, header, buttons, links and chart
colours, in light and dark.

- **Generate from the logo:** shows the colours it found and the roles it chose. If your logo is one muted colour,
  the theme uses a stronger version of the same hue; if it has no colour at all, the theme is neutral and you pick a
  brand colour (click the primary swatch).
- **Choose a variation:** Subtle (brand on buttons and links, a neutral sidebar), **Balanced** (recommended: a branded
  sidebar and header band) or Immersive (gradients and a soft glow).
- **Fine-tune:** swap primary and secondary, vibrancy, corners, font (fonts already on everyone's devices).
- **Check it:** the panel confirms every colour pair is readable, and that chart colours stay distinct for
  colour-blind people. The preview shows the dashboard, a board, a report, the sign-in page, an email and a PDF, in
  light and dark, on desktop and mobile.
- **Save draft, Preview as me, Publish.** Nobody else sees anything until you publish. Everyone sees it on their next
  page load.
- **History:** every version is kept; **Restore** publishes an old one again. **Turn the theme off** goes back to the
  accent colour.
- **When the logo changes,** a new theme is generated. If you've never published one, it's applied straight away;
  otherwise it waits as a draft and the other administrators are notified.

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
   - If email isn't set up (Settings → Email & Teams), PMS shows the link once instead: send it to them through a
     safe channel.

**Import CSV:** for many people at once.
- **The columns:**
  - The first row names them: `email, name, workspace, role`, and optionally `username, title, orgadmin`.
  - **workspace** is the key or name. Put several separated by `;`, or one row per workspace for the same email.
  - **role** is the name you see in PMS, such as Developer or Viewer.
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

1. The platform page asks for the **organisation code**, or a link like `…/#/o/acme` opens the organisation's own
   sign-in page directly. This device remembers it; **Not your organisation?** goes back.
2. The organisation's page (its logo and name): username and password, then the second step if they have two-step
   verification.
3. Someone in several workspaces chooses which to open. They can switch later from the top bar, without signing in
   again.

**What a visitor can learn:**
- **Unknown codes:** an unknown, suspended or archived code gets one message: "We couldn't find that organisation".
- **Repeated guessing:** after 30 such codes in 10 minutes, that address is refused for a while.
- **Sign-in:** an unknown username and a wrong password get the same message, so nobody can find out which accounts
  exist.

## Templates for new workspaces (Organisation Administrator)

Settings → Organisation → **Templates** lists:
- **The built-in templates:**
  - **Software Development:** Backlog → … → Done, with code review and QA.
  - **Marketing:** Idea → … → Reporting. Campaigns, content pieces, social posts, events.
  - **HR:** requests reviewed, approved or rejected.
  - **Projects (general):** To Do, In Progress, Blocked, In Review, Done.
- **Your organisation's own templates.**

To make one of your own, set a workspace up the way you like, then **Save a workspace as a template**. The template
keeps its workflow, item types and fields, but not its projects, work, people or automation rules.

When you add a workspace, **Start from** offers a blank workspace, any template, or a copy of another workspace. The
new workspace gets its own copy of everything, to change freely.

## Item types and workflows (workspace administrators)

**Item types:** Settings → This workspace → **Item types**.
- Add the kinds of work this workspace tracks, such as Campaign or Leave Request.
- Each one **behaves like** a built-in kind:
  - an **epic** groups other items
  - a **sub-task** sits under another item
  - **story, task and bug** are pieces of work
- **Rename** a type, or switch it **off** so it isn't offered for new items. Items of that type keep it.
- A type of your own can be deleted once no item uses it.

**Create or change a workflow:** Settings → This workspace → **Workflows**.
1. Pick the workflow, or **New workflow** to copy one. The organisation's templates are listed separately: copy one to
   make it this workspace's own.
2. **Statuses:** add from the list, reorder, choose where items start.
3. **Moves:**
   - On the **Diagram**, drag from the right edge of one status to another to add a move. Select an arrow and press
     Delete to remove it.
   - The table below lists the same moves. There you name each move and add **rules**:
     - **Who may:** a role, the assignee or the reporter
     - **Needs first:** a comment, an assignee, a field, all sub-tasks done
     - **Then:** assign, set the resolution, clear a field, notify
4. **Save draft** as you go. Nothing changes for anyone until you **Publish** (with a note of what changed). If you took
   out a status that has work items in it, PMS asks where they go.
5. **Versions** lists everything published. **Restore** publishes an old version again, so nothing is lost.

**Who uses which workflow:** at the top of the page.
- The workspace uses one workflow.
- A project, or an **item type**, can use another of the workspace's workflows. For example, Bugs could follow a
  triage workflow.
- An item follows its type's workflow first, then its project's, then the workspace's.

**Custom fields:** Settings → This workspace → **Fields**.
- **Kinds:** text, long text, number, money (with a currency), date, single or multi select, person, checkbox and link.
- A field can be just **for some item types**, and can have a **default value**, which fills in new items left empty.

## SLAs and approvals (workspace administrators)

**SLAs:** Settings → This workspace → **SLAs**.
- Set how soon work items should get a first response and be resolved, in **working hours**: your organisation's
  working days and hours, in its time zone, without public holidays.
- An SLA can be for some item types and priorities only, for example "Urgent bugs: first response in 2 hours,
  resolved in 2 days".
- On a work item, its SLA shows how much time is used and when it's due.
- When a target is at risk, its assignee is told; when it's breached, the assignee and the workspace's administrators
  are. Automations can react too.

**Approvals:** in Workflows, add the rule **Approval is needed** to a move. Choose who approves:
- anyone with a role
- a named person
- a number of people from a list, for example two of three

When someone makes that move:
- the item waits instead, with **Waiting for approval** on its page
- the approvers are told
- each approver can **Approve**, or **Reject** with a reason (required)
- once enough approve, the move is made; a rejection ends it, and the reason is added as a comment
- whoever asked can cancel it

## Automations (workspace administrators)

Settings → This workspace → **Automations**. A rule reads **When** … **If** … **Then** ….

**Start from a preset:** **From a preset** offers ready-made rules:
- a critical bug goes to the next developer
- all sub-tasks done moves the story to Code Review
- content in review goes to the Marketing Lead, due in 2 working days
- a weekly social media plan every Monday at 08:00
- reminders before and after due dates

A preset is added **switched off**. PMS lists anything it couldn't match in your workspace (a status or field it
doesn't have). Fix those, then switch the rule on.

**Make your own:** **New rule**, then:
1. **When:**
   - something happens to a work item: created, moved to a status, assigned, a field changed, commented, all sub-tasks
     done
   - a sprint starts or ends
   - its due date is near, or has passed
   - on a schedule: every day, working day, week or month at a time, in your organisation's time zone
   - another system calls the rule's webhook
   - someone presses the rule's **button** on an item
2. **If:** add conditions with the dropdowns, such as Item type is Bug, Priority is Highest, Assignee is empty, or Due
   date is within 2 days.
   - **All of these** means AND; **Any of these** means OR. Groups can nest.
   - People who know PQL can add a PQL condition too.
3. **Then:** up to 10 actions:
   - **Move and change:** move it, assign it (to a person, a role, in turn between a team, or to whoever has the
     fewest open items), set or clear a field, add a label.
   - **Write and tell:** comment, notify, email, send WhatsApp or SMS, escalate to the managers.
   - **Make and connect:** create a sub-task or a work item (here or in another workspace you're in), link it, call
     another system's webhook.
   - **Smart values** such as `{{item.key}}`, `{{item.title}}` and `{{item.assignee.name}}` fill in the details.
4. **Owner:** they're told if the rule keeps failing.
5. **Test:** pick a work item. PMS shows which conditions hold and what each action would do, without changing
   anything.
6. **Save**, then switch it on.

Each rule's **Run log** shows every run: what set it off, each condition's result, and what each action did. A step
that fails is tried again a few times before the owner is told.

**WhatsApp and SMS** need a provider (Twilio, Africa's Talking, the WhatsApp Business API …). Until one is connected,
the run log shows what would have been sent.

**Organisation Administrators** can make a rule for **every workspace** (or some). Each workspace gets a copy that
only Organisation Administrators change, and new workspaces get organisation-wide rules too.

## Inside each workspace

- **Executive page:** Settings → View-only links → **Executive page links**. Make a link for leadership. It shows
  that workspace's totals only (no names of projects or people), until it expires or you turn it off. Each
  workspace makes its own.
- **GitHub:** Settings → Integrations → GitHub connects this workspace's repositories, with a secret of its own.
  PMS refuses a secret another workspace already uses, because the secret tells PMS which workspace a delivery
  is for.
- **Digests and the Monday Briefing** go out per workspace, to its members, titled with its name. Someone in two
  workspaces gets one of each.
