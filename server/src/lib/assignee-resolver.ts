import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { agents, members, users } from "../db/schema/index";

export interface ResolvedAssignee {
  kind: "member" | "agent";
  id: string;
}

interface Candidate extends ResolvedAssignee {
  displayName: string;
}

export interface ResolveAssigneeResult {
  matched: ResolvedAssignee | null;
  ambiguous: boolean;
  candidates: ResolvedAssignee[];
}

/**
 * Fuzzy-resolve a free-form name to a workspace member or agent, so the agora
 * CLI's `--assignee <name>` / `--to <name>` flags can short-circuit a UUID
 * lookup.
 *
 * Match priority:
 *   1. Exact (case-insensitive) display-name match — wins outright.
 *   2. Case-insensitive prefix match.
 *   3. Case-insensitive substring match.
 * Within a bucket: one candidate -> match, multiple -> ambiguous. We only
 * fall to the next bucket when the current bucket is empty, so an exact
 * "Alex" never gets shadowed by a substring collision with "Alexandra".
 */
export async function resolveAssignee(
  workspaceId: string,
  name: string,
): Promise<ResolveAssigneeResult> {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { matched: null, ambiguous: false, candidates: [] };
  }
  const needle = trimmed.toLowerCase();

  // Workspace members → join `member` with `user` so we get the display name.
  const memberRows = await db
    .select({ id: users.id, displayName: users.name })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(eq(members.workspaceId, workspaceId));

  // Agents — only non-archived agents in this workspace are assignable.
  const agentRows = await db
    .select({ id: agents.id, displayName: agents.name })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), isNull(agents.archivedAt)));

  const pool: Candidate[] = [
    ...memberRows.map((r) => ({ kind: "member" as const, id: r.id, displayName: r.displayName })),
    ...agentRows.map((r) => ({ kind: "agent" as const, id: r.id, displayName: r.displayName })),
  ];

  const exact: Candidate[] = [];
  const prefix: Candidate[] = [];
  const substring: Candidate[] = [];

  for (const c of pool) {
    const lower = c.displayName.toLowerCase();
    if (lower === needle) {
      exact.push(c);
      continue;
    }
    if (lower.startsWith(needle)) {
      prefix.push(c);
      continue;
    }
    if (lower.includes(needle)) {
      substring.push(c);
    }
  }

  for (const bucket of [exact, prefix, substring]) {
    if (bucket.length === 0) continue;
    if (bucket.length === 1) {
      const [hit] = bucket;
      // biome-ignore lint/style/noNonNullAssertion: length is 1
      return { matched: { kind: hit!.kind, id: hit!.id }, ambiguous: false, candidates: [] };
    }
    return {
      matched: null,
      ambiguous: true,
      candidates: bucket.map((c) => ({ kind: c.kind, id: c.id })),
    };
  }

  return { matched: null, ambiguous: false, candidates: [] };
}
