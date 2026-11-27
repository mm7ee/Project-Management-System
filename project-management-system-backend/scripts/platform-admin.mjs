// Makes a Platform Administrator (multi-tenancy, phase (d)): the first one can only be made here, by whoever holds
// the database's connection string. They then sign in at /platform with the temporary password printed below,
// choose their own, and set up an authenticator app before they can do anything.
//
//   node scripts/platform-admin.mjs create dev|stage|main <username> "<Full name>"
//   node scripts/platform-admin.mjs list   dev|stage|main
//
// Reads PG_DEV / PG_STAGE / PG_MAIN from .dev.vars, like scripts/db.mjs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { hashPassword, newToken, tempPassword } from "../src/auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, target, username, name] = process.argv.slice(2);
function fail(message) {
  console.error(message);
  process.exit(1);
}
const key = { main: "PG_MAIN", dev: "PG_DEV", stage: "PG_STAGE" }[target];
if (!["create", "list"].includes(command) || !key) fail('Usage: node scripts/platform-admin.mjs create|list dev|stage|main [<username> "<Full name>"]');
function connectionString() {
  if (process.env[key]) return process.env[key];
  const line = readFileSync(join(root, ".dev.vars"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  if (!line) fail(`${key} isn't in .dev.vars`);
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}
const sql = postgres(connectionString(), { max: 1, onnotice: () => undefined });
try {
  if (command === "list") {
    const rows = await sql`SELECT username, name, created_at, last_login_at, mfa_secret IS NOT NULL AS has_app FROM platform_admins ORDER BY created_at`;
    for (const r of rows) console.log(`${r.username}\t${r.name}\tmade ${r.created_at}\tlast sign-in ${r.last_login_at ?? "never"}\tapp ${r.has_app ? "set up" : "not yet"}`);
    if (!rows.length) console.log("No Platform Administrators yet.");
  } else {
    const u = String(username ?? "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(u)) fail("Username: 3–32 letters, numbers, dots, dashes");
    if (!name?.trim()) fail("Give their full name, in quotes");
    if ((await sql`SELECT 1 FROM platform_admins WHERE lower(username) = ${u}`).length) fail("That username is taken");
    const temp = tempPassword();
    await sql`INSERT INTO platform_admins (id, username, name, password_hash, must_change_password, created_at)
              VALUES (${newToken().slice(0, 16)}, ${u}, ${name.trim().slice(0, 80)}, ${await hashPassword(temp)}, 1, ${new Date().toISOString()})`;
    await sql`INSERT INTO platform_activity (at, actor, action, target, detail) VALUES (${new Date().toISOString()}, 'command line', 'platform_admin_created', ${u}, '{}')`;
    console.log(`${target}: Platform Administrator "${u}" made.`);
    console.log(`Temporary password (shown once): ${temp}`);
    console.log("They sign in at /platform, choose their own password and set up an authenticator app.");
  }
} finally {
  await sql.end();
}
