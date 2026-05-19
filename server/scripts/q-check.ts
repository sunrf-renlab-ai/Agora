import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { members, users, workspaces } from "../src/db/schema/index";
const us = await db.query.users.findMany({});
console.log("users:", us.map(u => ({ id: u.id, supabaseUserId: u.supabaseUserId, email: u.email })));
const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, "qa-e2e") });
console.log("workspace:", ws?.id, ws?.name);
if (ws) {
  const ms = await db.query.members.findMany({ where: eq(members.workspaceId, ws.id) });
  console.log("memberships:");
  for (const m of ms) {
    const u = await db.query.users.findFirst({ where: eq(users.id, m.userId) });
    console.log(" -", u?.email, "supa=", u?.supabaseUserId);
  }
}
process.exit(0);
