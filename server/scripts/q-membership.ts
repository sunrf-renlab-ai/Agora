import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, members, workspaces } from "../src/db/schema/index";

const supabaseUserId = "e6c5e3fd-372d-4de9-bae7-3562c9458697";
const u = await db.query.users.findFirst({ where: eq(users.supabaseUserId, supabaseUserId) });
console.log("user:", u);
if (u) {
  const memberships = await db.query.members.findMany({
    where: eq(members.userId, u.id),
  });
  console.log("memberships:", memberships);
  for (const m of memberships) {
    const w = await db.query.workspaces.findFirst({ where: eq(workspaces.id, m.workspaceId) });
    console.log("workspace:", w);
  }
}
process.exit(0);
