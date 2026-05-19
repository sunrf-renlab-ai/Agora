import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { agents, issueLabels, issueToLabel, issues, users } from "../db/schema/index";

export type ActorKind = "member" | "agent";

export type ResolvedActor = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
};

export type LabelJson = {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export function issueIdentifier(prefix: string, number: number) {
  return `${prefix}-${number}`;
}

export async function resolveActor(
  kind: ActorKind | null,
  id: string | null,
): Promise<ResolvedActor | null> {
  if (!kind || !id) return null;
  if (kind === "member") {
    const u = await db.query.users.findFirst({ where: eq(users.id, id) });
    return u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null;
  }
  const a = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  return a ? { id: a.id, name: a.name, email: null, avatarUrl: a.avatarUrl ?? null } : null;
}

/**
 * Bulk-resolve actors for a batch of issues to avoid N+1 queries.
 * Returns Maps keyed by id for O(1) lookup per row.
 */
export async function loadActorsForIssues(rows: Array<typeof issues.$inferSelect>): Promise<{
  members: Map<string, ResolvedActor>;
  agents: Map<string, ResolvedActor>;
}> {
  const memberIds = new Set<string>();
  const agentIds = new Set<string>();
  for (const r of rows) {
    if (r.creatorKind === "member") memberIds.add(r.creatorId);
    else if (r.creatorKind === "agent") agentIds.add(r.creatorId);
    if (r.assigneeId && r.assigneeKind === "member") memberIds.add(r.assigneeId);
    else if (r.assigneeId && r.assigneeKind === "agent") agentIds.add(r.assigneeId);
  }
  const memberMap = new Map<string, ResolvedActor>();
  const agentMap = new Map<string, ResolvedActor>();
  if (memberIds.size > 0) {
    const userRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(inArray(users.id, [...memberIds]));
    for (const u of userRows) {
      memberMap.set(u.id, { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl });
    }
  }
  if (agentIds.size > 0) {
    const agentRows = await db
      .select({
        id: agents.id,
        name: agents.name,
        avatarUrl: agents.avatarUrl,
      })
      .from(agents)
      .where(inArray(agents.id, [...agentIds]));
    for (const a of agentRows) {
      agentMap.set(a.id, { id: a.id, name: a.name, email: null, avatarUrl: a.avatarUrl ?? null });
    }
  }
  return { members: memberMap, agents: agentMap };
}

export function pickActor(
  maps: { members: Map<string, ResolvedActor>; agents: Map<string, ResolvedActor> },
  kind: ActorKind | null,
  id: string | null,
): ResolvedActor | null {
  if (!kind || !id) return null;
  return (kind === "member" ? maps.members : maps.agents).get(id) ?? null;
}

export async function loadLabelsForIssues(issueIds: string[]): Promise<Map<string, LabelJson[]>> {
  const map = new Map<string, LabelJson[]>();
  if (issueIds.length === 0) return map;
  const rows = await db
    .select({
      issueId: issueToLabel.issueId,
      id: issueLabels.id,
      workspaceId: issueLabels.workspaceId,
      name: issueLabels.name,
      color: issueLabels.color,
      createdAt: issueLabels.createdAt,
      updatedAt: issueLabels.updatedAt,
    })
    .from(issueToLabel)
    .innerJoin(issueLabels, eq(issueToLabel.labelId, issueLabels.id))
    .where(inArray(issueToLabel.issueId, issueIds));
  for (const r of rows) {
    const arr = map.get(r.issueId) ?? [];
    arr.push({
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      color: r.color,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    });
    map.set(r.issueId, arr);
  }
  return map;
}

export function issueToJson(
  issue: typeof issues.$inferSelect,
  prefix: string,
  opts: {
    creator: ResolvedActor | null;
    assignee: ResolvedActor | null;
    labels: LabelJson[];
  },
) {
  return {
    id: issue.id,
    workspaceId: issue.workspaceId,
    number: issue.number,
    identifier: issueIdentifier(prefix, issue.number),
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    assigneeKind: issue.assigneeKind,
    assigneeId: issue.assigneeId,
    assignee: opts.assignee,
    creatorKind: issue.creatorKind,
    creatorId: issue.creatorId,
    creator: opts.creator,
    parentIssueId: issue.parentIssueId,
    projectId: issue.projectId,
    position: issue.position,
    dueDate: issue.dueDate?.toISOString() ?? null,
    labels: opts.labels,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

/**
 * Convenience: serialize a single issue, doing the bulk-load helpers
 * with a one-row batch. Used by GET-by-id, POST, PATCH paths.
 */
export async function issueToJsonSingle(
  issue: typeof issues.$inferSelect,
  prefix: string,
): Promise<ReturnType<typeof issueToJson>> {
  const [creator, assignee, labelMap] = await Promise.all([
    resolveActor(issue.creatorKind, issue.creatorId),
    resolveActor(issue.assigneeKind, issue.assigneeId),
    loadLabelsForIssues([issue.id]),
  ]);
  return issueToJson(issue, prefix, {
    creator,
    assignee,
    labels: labelMap.get(issue.id) ?? [],
  });
}
