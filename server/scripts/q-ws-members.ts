import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { members, users, workspaces, agents, issues } from "../src/db/schema/index";
const wsId = "8e3c5cef-00a8-4beb-b3b8-08a20e3bbdea";
const ms = await db.query.members.findMany({ where: eq(members.workspaceId, wsId) });
console.log("members:", ms);
for (const m of ms) {
  const u = await db.query.users.findFirst({ where: eq(users.id, m.userId) });
  console.log(" -", u?.email, u?.id);
}
const issueCount = (await db.query.issues.findMany({ where: eq(issues.workspaceId, wsId) })).length;
console.log("issue count:", issueCount);
const agentCount = (await db.query.agents.findMany({ where: eq(agents.workspaceId, wsId) })).length;
console.log("agent count:", agentCount);
process.exit(0);
