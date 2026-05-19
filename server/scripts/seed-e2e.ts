// Seed a complete workspace for the e2e test user (qa@agora.test01).
// Idempotent — re-runs replace existing seed data.
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  agents,
  issues,
  issueLabels,
  members,
  projects,
  runtimes,
  users,
  workspaces,
} from "../src/db/schema/index";

const SUPABASE_USER_ID = "e6c5e3fd-372d-4de9-bae7-3562c9458697";
const WORKSPACE_SLUG = "qa-e2e";
const WORKSPACE_NAME = "QA E2E";

const u = await db.query.users.findFirst({ where: eq(users.supabaseUserId, SUPABASE_USER_ID) });
if (!u) {
  console.error("user not found in public.user — login at least once first");
  process.exit(1);
}

// Mark onboarded so the gate doesn't redirect.
await db
  .update(users)
  .set({ onboardedAt: new Date() })
  .where(eq(users.id, u.id));

// Find or create workspace.
let ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, WORKSPACE_SLUG) });
if (!ws) {
  const [created] = await db
    .insert(workspaces)
    .values({
      slug: WORKSPACE_SLUG,
      name: WORKSPACE_NAME,
      issuePrefix: "QA",
      ownerId: u.id,
    })
    .returning();
  ws = created;
  console.log("created workspace", ws);
}

// Owner membership.
const existingMember = await db.query.members.findFirst({
  where: eq(members.workspaceId, ws!.id),
});
if (!existingMember || existingMember.userId !== u.id) {
  await db
    .insert(members)
    .values({ workspaceId: ws!.id, userId: u.id, role: "owner" })
    .onConflictDoNothing();
}

// Membership row (need it for runtime.member_id FK).
let memberRow = await db.query.members.findFirst({ where: eq(members.workspaceId, ws!.id) });
if (!memberRow || memberRow.userId !== u.id) {
  const [m] = await db
    .insert(members)
    .values({ workspaceId: ws!.id, userId: u.id, role: "owner" })
    .onConflictDoNothing()
    .returning();
  memberRow = m ?? memberRow;
}
if (!memberRow) {
  memberRow = await db.query.members.findFirst({ where: eq(members.workspaceId, ws!.id) });
}

// Runtime (online so onboarding gate passes).
let rt = await db.query.runtimes.findFirst({ where: eq(runtimes.workspaceId, ws!.id) });
if (!rt) {
  const [createdRt] = await db
    .insert(runtimes)
    .values({
      workspaceId: ws!.id,
      memberId: memberRow!.id,
      name: "Local QA",
      online: true,
      runtimeInfo: { os: "darwin", arch: "arm64", detectedClis: [{ kind: "claude_code" }] },
      machineTokenHash: "seedhash" + Math.random().toString(36).slice(2),
      detectedClis: [{ kind: "claude_code", version: "1.0.0" }],
    })
    .returning();
  rt = createdRt;
}

// Agent.
let ag = await db.query.agents.findFirst({ where: eq(agents.workspaceId, ws!.id) });
if (!ag) {
  const [createdAg] = await db
    .insert(agents)
    .values({
      workspaceId: ws!.id,
      runtimeId: rt!.id,
      ownerId: u.id,
      name: "QA Agent",
      cliKind: "claude_code",
      instructions: "You are the QA test agent.",
      maxConcurrentTasks: 3,
    })
    .returning();
  ag = createdAg;
}

// Project.
let pj = await db.query.projects.findFirst({ where: eq(projects.workspaceId, ws!.id) });
if (!pj) {
  const [createdPj] = await db
    .insert(projects)
    .values({
      workspaceId: ws!.id,
      title: "Web Redesign",
      description: "Q1 web redesign work.",
    })
    .returning();
  pj = createdPj;
}

// Labels.
const labelDefs = [
  { name: "bug", color: "#ef4444" },
  { name: "feature", color: "#3b82f6" },
  { name: "docs", color: "#10b981" },
];
for (const ld of labelDefs) {
  const exists = await db.query.issueLabels.findFirst({
    where: eq(issueLabels.workspaceId, ws!.id),
  });
  if (exists?.name === ld.name) continue;
  await db
    .insert(issueLabels)
    .values({ workspaceId: ws!.id, name: ld.name, color: ld.color })
    .onConflictDoNothing();
}

// Issues — variety of statuses, priorities, assignees.
const issueDefs: Array<{
  title: string;
  description: string;
  status: string;
  priority: string;
  number: number;
}> = [
  { title: "Sidebar collapse animation jitters on hover", description: "Steps to reproduce ...", status: "todo", priority: "high", number: 1 },
  { title: "Add filter bar to issue list", description: "Add filter pills to the issue list.", status: "in_progress", priority: "medium", number: 2 },
  { title: "Dark mode design tokens drift", description: "oklch values diverge between layouts.", status: "in_review", priority: "low", number: 3 },
  { title: "Comment composer should support TipTap", description: "Replace the textarea with a real rich text editor.", status: "done", priority: "medium", number: 4 },
  { title: "Inbox unread count missing", description: "Sidebar shows 'unread' but no count badge.", status: "todo", priority: "urgent", number: 5 },
  { title: "Runtime detail page", description: "/runtimes/[id] is missing.", status: "blocked", priority: "high", number: 6 },
  { title: "Agent task rerun endpoint", description: "POST /api/issues/:id/rerun.", status: "todo", priority: "medium", number: 7 },
  { title: "Execution logs section", description: "Show task runs in issue detail.", status: "in_progress", priority: "medium", number: 8 },
];

for (const def of issueDefs) {
  const existing = await db.query.issues.findFirst({
    where: eq(issues.workspaceId, ws!.id),
  });
  // crude dedupe — only seed if title not present in this workspace
  const all = await db.query.issues.findMany({ where: eq(issues.workspaceId, ws!.id) });
  if (all.some((i) => i.title === def.title)) continue;
  await db.insert(issues).values({
    workspaceId: ws!.id,
    creatorId: u.id,
    creatorKind: "member",
    assigneeId: ag!.id,
    assigneeKind: "agent",
    projectId: pj!.id,
    title: def.title,
    description: def.description,
    status: def.status as "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled" | "backlog",
    priority: def.priority as "urgent" | "high" | "medium" | "low" | "none",
    number: def.number,
  });
}

const allIssues = await db.query.issues.findMany({ where: eq(issues.workspaceId, ws!.id) });

// Bump workspace.issueCounter to max(number) so the next API-created issue
// gets a fresh number instead of colliding on (workspace_id, number).
const maxNumber = allIssues.reduce((m, i) => Math.max(m, i.number ?? 0), 0);
if (maxNumber > 0) {
  await db
    .update(workspaces)
    .set({ issueCounter: maxNumber })
    .where(eq(workspaces.id, ws!.id));
}

console.log(`✓ workspace: ${ws!.slug} (${ws!.id})`);
console.log(`✓ runtime: ${rt!.id} online=${rt!.online}`);
console.log(`✓ agent: ${ag!.name} (${ag!.id})`);
console.log(`✓ project: ${pj!.name} (${pj!.id})`);
console.log(`✓ labels: ${labelDefs.length}`);
console.log(`✓ issues: ${allIssues.length}`);
process.exit(0);
