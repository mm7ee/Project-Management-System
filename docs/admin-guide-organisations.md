# Running organisations and workspaces in Pulse

For Pulse's Platform Administrators and each organisation's administrators.

Pulse holds several **organisations**. Each has its own **workspaces** (for example Projects, HR, Finance) and its
own people. Nobody ever sees anything of another organisation, and people see only the workspace they have open.

| Who | Where | What they do |
| --- | --- | --- |
| Platform Administrator | `/platform` | Create, rename, suspend and archive organisations; give each its first administrator. They can't open an organisation's data. |
| Organisation Administrator | Settings → Organisation | Their organisation's workspaces and people, and each person's role in each workspace. Also the organisation-wide settings: roles & permissions, two-step rules, sign-in security, email & Teams. |
| Workspace administrator (the Administrator role in a workspace) | Settings | That workspace: workflows, boards, automation, custom fields, integrations, the service desk. |

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
- **Add admin:** a new Organisation Administrator, for an organisation that has lost all of its own.

## Adding a workspace (Organisation Administrator)

1. Settings → **Organisation** → **Workspaces**.
2. Give its **name** (Finance) and a **key** (2 to 10 capital letters or digits, such as FIN), then **Add workspace**.
3. You're its first member, as its Administrator. It starts with the standard service desk request types; its
   projects, boards, workflows and the rest are set up inside it.

**Rename** keeps everything in it. **Archive** closes it to everyone (nothing is deleted), and **Reactivate** opens
it again. You can't archive the last active workspace, or the one you have open.

## Adding people and giving them roles (Organisation Administrator)

1. Settings → **Organisation** → **People** → **Add person**.
2. Give their **username** (unique in your organisation), **full name**, and optionally title and email.
3. Under **Workspaces and roles**, choose their role in each workspace they should be in, or "Not in it". They need
   at least one workspace.
   - **Administrator:** everything in that workspace.
   - **Manager, Team Leader, Projects Assistant, Developer, Standard user:** what Settings → Roles & permissions
     gives each.
4. Tick **Organisation Administrator** only for people who should manage workspaces, people and organisation
   settings.
5. **Add and get a temporary password**, and pass it on safely. They choose their own at the first sign-in.

**Afterwards, in the People table:**
- **Change a role** in any workspace from its column.
- **"Not in it"** takes them out of that workspace, and closes their sessions there at once.
- **Organisation Administrator:** tick or untick it. There must always be at least one.
- **Remove** takes them out of the organisation. Their account goes; what they did stays, shown as a former user.

## Signing in, for everyone

1. The sign-in page asks for the **organisation code**, or takes it from a link like `…/#/o/acme`. This device
   remembers it; **Change** sets another.
2. Username and password, then the second step if they have two-step verification.
3. Someone in several workspaces chooses which to open. They can switch later from the top bar, without signing in
   again.

A wrong code, an unknown username and a wrong password all get the same message. That's on purpose, so nobody can
find out which organisations or accounts exist.
