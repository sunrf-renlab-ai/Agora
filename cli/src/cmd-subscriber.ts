import { Command } from "commander";
import { api, workspaceId } from "./client";

type Member = { userId: string; user?: { name?: string; email?: string } | null };
type Agent = { id: string; name?: string };

export const subscriberCmd = new Command("subscriber").description("Issue subscribers");

subscriberCmd.command("list <issueId>").action(async (issueId) => {
  const r = await api(`/api/workspaces/${workspaceId()}/issues/${issueId}/subscribers`);
  console.log(JSON.stringify(r, null, 2));
});

subscriberCmd
  .command("add <issueId>")
  .option("--user <name>", "Member or agent name to subscribe (fuzzy match; defaults to caller)")
  .option(
    "--user-id <uuid>",
    "Member or agent UUID to subscribe (mutually exclusive with --user)",
  )
  .option(
    "--kind <member|agent>",
    "Required when --user-id is used; selects which entity --user-id refers to",
  )
  .action(async (issueId, opts) => {
    const body = await resolveSubscriberBody(opts);
    await api(`/api/workspaces/${workspaceId()}/issues/${issueId}/subscribers`, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
    console.log("subscribed");
  });

subscriberCmd
  .command("remove <issueId>")
  .option("--user <name>", "Member or agent name to unsubscribe (fuzzy match; defaults to caller)")
  .option(
    "--user-id <uuid>",
    "Member or agent UUID to unsubscribe (mutually exclusive with --user)",
  )
  .option(
    "--kind <member|agent>",
    "Required when --user-id is used; selects which entity --user-id refers to",
  )
  .action(async (issueId, opts) => {
    const body = await resolveSubscriberBody(opts);
    await api(`/api/workspaces/${workspaceId()}/issues/${issueId}/subscribers`, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    });
    console.log("unsubscribed");
  });

// resolveSubscriberBody turns the (--user, --user-id, --kind) flag combo into the
// { subscriberKind, subscriberId } body the server expects. Returns undefined when
// neither flag is given so callers fall back to the legacy "subscribe self" path.
async function resolveSubscriberBody(opts: {
  user?: string;
  userId?: string;
  kind?: string;
}): Promise<{ subscriberKind: "member" | "agent"; subscriberId: string } | undefined> {
  if (opts.user && opts.userId) {
    throw new Error("--user and --user-id are mutually exclusive");
  }
  if (opts.userId) {
    if (!opts.kind) {
      throw new Error("--kind <member|agent> is required when --user-id is used");
    }
    if (opts.kind !== "member" && opts.kind !== "agent") {
      throw new Error(`--kind must be "member" or "agent", got "${opts.kind}"`);
    }
    return { subscriberKind: opts.kind, subscriberId: opts.userId };
  }
  if (opts.user) {
    return await resolveByName(opts.user);
  }
  return undefined;
}

async function resolveByName(
  name: string,
): Promise<{ subscriberKind: "member" | "agent"; subscriberId: string }> {
  const ws = workspaceId();
  const lower = name.toLowerCase();
  const members = (await api(`/api/workspaces/${ws}/members`)) as Member[];
  const agents = (await api(`/api/workspaces/${ws}/agents`)) as Agent[];

  type Match = { kind: "member" | "agent"; id: string; name: string };
  const exact: Match[] = [];
  const partial: Match[] = [];
  const classify = (kind: "member" | "agent", id: string, displayName: string) => {
    if (!displayName) return;
    if (displayName.toLowerCase() === lower) {
      exact.push({ kind, id, name: displayName });
      return;
    }
    if (displayName.toLowerCase().includes(lower)) {
      partial.push({ kind, id, name: displayName });
    }
  };
  for (const m of members) classify("member", m.userId, m.user?.name ?? m.user?.email ?? "");
  for (const a of agents) classify("agent", a.id, a.name ?? "");

  for (const bucket of [exact, partial]) {
    if (bucket.length === 1) {
      const hit = bucket[0]!;
      return { subscriberKind: hit.kind, subscriberId: hit.id };
    }
    if (bucket.length > 1) {
      const formatted = bucket.map((m) => `  ${m.kind} "${m.name}" (${m.id})`).join("\n");
      throw new Error(`ambiguous user "${name}"; matches:\n${formatted}`);
    }
  }
  throw new Error(`no member or agent found matching "${name}"`);
}
