import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { issues, members, users, workspaces } from "../src/db/schema/index";

const wsRows = await db.query.workspaces.findMany({});
console.log("workspaces:", wsRows.map(w => ({ id: w.id, slug: w.slug, name: w.name })));

const u = await db.query.users.findFirst({ where: eq(users.supabaseUserId, "e6c5e3fd-372d-4de9-bae7-3562c9458697") });
console.log("user:", u?.id, u?.email);

const ms = await db.query.members.findMany({ where: eq(members.userId, u!.id) });
console.log("user memberships:", ms);

const allIssues = await db.query.issues.findMany({});
console.log("total issues:", allIssues.length);
for (const i of allIssues.slice(0, 10)) {
  console.log(" -", i.workspaceId.slice(0,8), i.title);
}
process.exit(0);
