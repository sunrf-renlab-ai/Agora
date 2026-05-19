import { Command } from "commander";
import { api, workspaceId } from "./client";

export const issueCmd = new Command("issue").description("Work with issues");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read mutually-exclusive `--<name>` and `--<name>-stdin` flags. Returns the
 * resolved string + a present flag. Errors via process.exit if both are set,
 * or if neither is set when `required` is true.
 */
async function resolveTextFlag(
  opts: Record<string, unknown>,
  name: string,
  { required = false }: { required?: boolean } = {},
): Promise<{ value: string | undefined; present: boolean }> {
  const stdinKey = `${name}Stdin`;
  const inline = opts[name];
  const useStdin = opts[stdinKey];
  if (inline && useStdin) {
    console.error(`--${name} and --${name}-stdin are mutually exclusive`);
    process.exit(2);
  }
  if (useStdin) {
    const raw = await Bun.stdin.text();
    const trimmed = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    return { value: trimmed, present: true };
  }
  if (typeof inline === "string") {
    return { value: inline, present: true };
  }
  if (required) {
    console.error(`one of --${name} or --${name}-stdin is required`);
    process.exit(2);
  }
  return { value: undefined, present: false };
}

/**
 * Print `data` as JSON when mode === "json"; otherwise hand off to `tableFn`.
 * Empty table output is suppressed so we don't print spurious blank lines.
 */
function formatOutput<T>(data: T, mode: string, tableFn: (d: T) => string): void {
  if (mode === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const text = tableFn(data);
  if (text.length > 0) console.log(text);
}

type IssueRow = {
  id?: string;
  identifier?: string;
  title?: string;
  status?: string;
  priority?: string;
  description?: string | null;
  dueDate?: string | null;
  parentIssueId?: string | null;
  projectId?: string | null;
  assigneeKind?: string | null;
  assigneeId?: string | null;
  assignee?: { name?: string } | null;
  creatorKind?: string | null;
  creatorId?: string | null;
  creator?: { name?: string } | null;
  createdAt?: string;
  updatedAt?: string;
};

function assigneeName(issue: IssueRow): string {
  return issue.assignee?.name ?? "-";
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

issueCmd
  .command("list")
  .option("--status <status>", "Filter by status")
  .option("--priority <p>", "Filter by priority")
  .option("--assignee <name>", "Filter by assignee name (fuzzy match)")
  .option("--assignee-id <uuid>", "Filter by assignee UUID")
  .option("--project <id>", "Filter by project id")
  .option("--limit <n>", "Maximum number of issues to return")
  .option("--offset <n>", "Number of issues to skip")
  .option("--output <fmt>", "Output format: table|json", "table")
  .option("--json", "Shortcut for --output json", false)
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", String(opts.status));
    if (opts.priority) params.set("priority", String(opts.priority));
    if (opts.assignee) params.set("assignee", String(opts.assignee));
    if (opts.assigneeId) params.set("assigneeId", String(opts.assigneeId));
    if (opts.project) params.set("projectId", String(opts.project));
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    const qs = params.toString() ? `?${params.toString()}` : "";

    const rows = (await api(`/api/workspaces/${workspaceId()}/issues${qs}`)) as IssueRow[];

    const mode = opts.json ? "json" : (opts.output as string);
    formatOutput(rows, mode, (data) =>
      data
        .map(
          (r) =>
            `${r.identifier ?? "-"}\t${r.status ?? "-"}\t${r.priority ?? "-"}\t${assigneeName(r)}\t${r.title ?? ""}`,
        )
        .join("\n"),
    );
  });

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

issueCmd
  .command("get <id>")
  .option("--output <fmt>", "Output format: table|json", "table")
  .option("--json", "Shortcut for --output json", false)
  .action(async (id, opts) => {
    const issue = (await api(`/api/workspaces/${workspaceId()}/issues/${id}`)) as IssueRow;
    const mode = opts.json ? "json" : (opts.output as string);
    formatOutput(issue, mode, (i) => {
      const lines = [
        `${i.identifier ?? "-"}  ${i.title ?? ""}`,
        `Status:    ${i.status ?? "-"}`,
        `Priority:  ${i.priority ?? "-"}`,
        `Assignee:  ${assigneeName(i)}`,
        `Due date:  ${i.dueDate ?? "-"}`,
        `Project:   ${i.projectId ?? "-"}`,
        `Parent:    ${i.parentIssueId ?? "-"}`,
        `Creator:   ${i.creator?.name ?? "-"}`,
        `Created:   ${i.createdAt ?? "-"}`,
        `Updated:   ${i.updatedAt ?? "-"}`,
        "",
        i.description ?? "(no description)",
      ];
      return lines.join("\n");
    });
  });

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

issueCmd
  .command("create")
  .requiredOption("--title <title>")
  .option("--description <md>")
  .option("--description-stdin", "Read description from stdin", false)
  .option("--status <status>")
  .option("--priority <p>")
  .option("--assignee <name>", "Assignee name (fuzzy match)")
  .option("--assignee-kind <k>", "Assignee kind: member|agent")
  .option("--assignee-id <id>")
  .option("--parent <issueId>", "Parent issue id")
  .option("--project <projectId>", "Project id")
  .option("--due-date <iso>", "Due date (ISO 8601)")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    const body: Record<string, unknown> = { title: opts.title };

    const desc = await resolveTextFlag(opts, "description");
    if (desc.present && desc.value !== undefined) body.description = desc.value;

    if (opts.status) body.status = opts.status;
    if (opts.priority) body.priority = opts.priority;
    if (opts.assigneeKind) body.assigneeKind = opts.assigneeKind;
    if (opts.assigneeId) body.assigneeId = opts.assigneeId;
    // Server resolves --assignee fuzzy-name to (kind, id). Server-side rule:
    // if assigneeId is also present, the id wins and the name is ignored.
    if (opts.assignee && !opts.assigneeId) {
      body.assigneeName = opts.assignee;
    }
    if (opts.parent) body.parentIssueId = opts.parent;
    if (opts.project) body.projectId = opts.project;
    if (opts.dueDate) body.dueDate = opts.dueDate;

    // Auto-stamp origin when the daemon spawned this CLI for a quick-create
    // task. Lets the server's completion handler find the resulting issue
    // by origin_id without a timestamp guess.
    const qcId = process.env.AGORA_QUICK_CREATE_TASK_ID;
    if (qcId) {
      body.originType = "quick_create";
      body.originId = qcId;
    }

    const created = (await api(`/api/workspaces/${workspaceId()}/issues`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as IssueRow;

    formatOutput(
      created,
      (opts.output as string) ?? "json",
      (i) => `${i.identifier ?? "-"}\t${i.title ?? ""}`,
    );
  });

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

issueCmd
  .command("update <id>")
  .option("--title <title>")
  .option("--description <md>")
  .option("--description-stdin", "Read description from stdin", false)
  .option("--status <status>")
  .option("--priority <p>")
  .option("--assignee <name>", "Assignee name (fuzzy match)")
  .option("--assignee-id <id>")
  .option("--project <id>", "Project id")
  .option("--parent <issueId>", 'Parent issue id (use "" to clear)')
  .option("--due-date <iso>", 'Due date (ISO 8601, "" to clear)')
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const body: Record<string, unknown> = {};
    if (opts.title !== undefined) body.title = opts.title;

    const desc = await resolveTextFlag(opts, "description");
    if (desc.present) body.description = desc.value === "" ? null : desc.value;

    if (opts.status !== undefined) body.status = opts.status;
    if (opts.priority !== undefined) body.priority = opts.priority;
    if (opts.assigneeId !== undefined) {
      body.assigneeId = opts.assigneeId === "" ? null : opts.assigneeId;
    }
    if (opts.project !== undefined) {
      body.projectId = opts.project === "" ? null : opts.project;
    }
    if (opts.parent !== undefined) {
      body.parentIssueId = opts.parent === "" ? null : opts.parent;
    }
    if (opts.dueDate !== undefined) {
      body.dueDate = opts.dueDate === "" ? null : opts.dueDate;
    }
    // Server resolves --assignee fuzzy-name to (kind, id). If --assignee-id
    // is also set, the server prefers the id and silently ignores the name.
    if (opts.assignee && !opts.assigneeId) {
      body.assigneeName = opts.assignee;
    }

    const updated = (await api(`/api/workspaces/${workspaceId()}/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as IssueRow;

    formatOutput(
      updated,
      (opts.output as string) ?? "json",
      (i) =>
        `${i.identifier ?? "-"}\t${i.status ?? "-"}\t${i.priority ?? "-"}\t${assigneeName(i)}\t${i.title ?? ""}`,
    );
  });

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

issueCmd.command("status <id> <status>").action(async (id, status) => {
  await api(`/api/workspaces/${workspaceId()}/issues/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  console.log("OK");
});

// ---------------------------------------------------------------------------
// escalate — hand the issue to a human when no agent can complete it
// ---------------------------------------------------------------------------

issueCmd
  .command("escalate <id>")
  .requiredOption("--reason <reason>", "Why no agent can complete this — needs a human")
  .action(async (id, opts) => {
    await api(`/api/workspaces/${workspaceId()}/issues/${id}/escalate`, {
      method: "POST",
      body: JSON.stringify({ reason: opts.reason }),
    });
    console.log("OK — escalated to a human; issue moved to blocked.");
  });

// ---------------------------------------------------------------------------
// assign
// ---------------------------------------------------------------------------

issueCmd
  .command("assign <id>")
  .option("--to <name>", "Assignee name (fuzzy match)")
  .option("--to-id <uuid>", "Assignee UUID (mutually exclusive with --to)")
  .option("--kind <member|agent>", "Assignee kind (required with --to-id)")
  .option("--unassign", "Remove the current assignee", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  // back-compat: previous CLI used --kind/--target; --target is an alias for --to-id
  .option("--target <id>", "[deprecated] use --to-id")
  .action(async (id, opts) => {
    const body: Record<string, unknown> = {};
    if (opts.unassign) {
      body.assigneeKind = null;
      body.assigneeId = null;
    } else if (opts.to && opts.toId) {
      console.error("--to and --to-id are mutually exclusive");
      process.exit(2);
    } else if (opts.toId || opts.target) {
      if (!opts.kind) {
        console.error("--kind is required with --to-id (member|agent)");
        process.exit(2);
      }
      body.assigneeKind = opts.kind;
      body.assigneeId = opts.toId ?? opts.target;
    } else if (opts.to) {
      // Server resolves the fuzzy name to (kind, id). Hitting the same
      // PATCH endpoint (`issue update`) means name resolution stays in one
      // place; `assign` is just sugar.
      body.assigneeName = opts.to;
    } else {
      console.error("provide --to, --to-id, or --unassign");
      process.exit(2);
    }

    const updated = (await api(`/api/workspaces/${workspaceId()}/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as IssueRow;

    formatOutput(
      updated,
      (opts.output as string) ?? "json",
      (i) => `${i.identifier ?? "-"}\t${assigneeName(i)}`,
    );
  });

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string;
  agentId?: string;
  status?: string;
  attempt?: number;
  maxAttempts?: number;
  triggerSummary?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

issueCmd
  .command("runs <id>")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (id, opts) => {
    const rows = (await api(`/api/workspaces/${workspaceId()}/issues/${id}/tasks`)) as TaskRow[];
    formatOutput(rows, (opts.output as string) ?? "table", (data) =>
      data
        .map(
          (r) =>
            `${r.id}\t${r.status ?? "-"}\t${r.attempt ?? "-"}/${r.maxAttempts ?? "-"}\t${r.createdAt ?? "-"}\t${r.triggerSummary ?? ""}`,
        )
        .join("\n"),
    );
  });

// ---------------------------------------------------------------------------
// rerun
// ---------------------------------------------------------------------------

issueCmd
  .command("rerun <id>")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const r = (await api(`/api/workspaces/${workspaceId()}/issues/${id}/rerun`, {
      method: "POST",
      body: "{}",
    })) as Record<string, unknown>;
    formatOutput(r, (opts.output as string) ?? "json", () => "OK");
  });

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

type SearchResp = {
  items: Array<{
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string | null;
    snippet: string | null;
  }>;
  total: number;
  offset: number;
  limit: number;
};

issueCmd
  .command("search <query>")
  .option("--limit <n>", "Maximum number of results", "20")
  .option("--offset <n>", "Number of results to skip", "0")
  .option("--include-closed", "Include done and cancelled issues", false)
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (query, opts) => {
    const params = new URLSearchParams();
    params.set("q", query);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    if (opts.includeClosed) params.set("includeClosed", "1");
    const r = (await api(
      `/api/workspaces/${workspaceId()}/issues/search?${params.toString()}`,
    )) as SearchResp;
    formatOutput(r, (opts.output as string) ?? "table", (data) =>
      data.items
        .map((i) => `${i.identifier}\t${i.status}\t${i.priority ?? "-"}\t${i.title}`)
        .join("\n"),
    );
  });

// ===== issue label management =====
const issueLabelCmd = new Command("label").description("Attach/detach labels on an issue");

issueLabelCmd
  .command("add <issueId> <labelId>")
  .description("Attach a label to an issue")
  .action(async (issueId, labelId) => {
    const r = await api(`/api/workspaces/${workspaceId()}/issues/${issueId}/labels`, {
      method: "POST",
      body: JSON.stringify({ labelId }),
    });
    console.log(JSON.stringify(r ?? { ok: true }, null, 2));
  });

issueLabelCmd
  .command("remove <issueId> <labelId>")
  .description("Detach a label from an issue")
  .action(async (issueId, labelId) => {
    await api(`/api/workspaces/${workspaceId()}/issues/${issueId}/labels/${labelId}`, {
      method: "DELETE",
    });
    console.log(JSON.stringify({ ok: true }, null, 2));
  });

issueCmd.addCommand(issueLabelCmd);
