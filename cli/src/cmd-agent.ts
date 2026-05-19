import { Command } from "commander";
import { api, workspaceId } from "./client";

export const agentCmd = new Command("agent").description("Work with agents");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const raw = await Bun.stdin.text();
  return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}

async function resolveTextFlag(
  inline: string | undefined,
  fromStdin: boolean | undefined,
  flagName: string,
): Promise<string | undefined> {
  if (inline !== undefined && fromStdin) {
    console.error(`--${flagName} and --${flagName}-stdin are mutually exclusive`);
    process.exit(2);
  }
  if (fromStdin) return await readStdin();
  return inline;
}

function parseCustomArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  return trimmed.split(/\s+/);
}

function appendCustomEnv(val: string, prev: Record<string, string>): Record<string, string> {
  const idx = val.indexOf("=");
  if (idx === -1) {
    console.error(`--custom-env expects KEY=VALUE, got: ${val}`);
    process.exit(2);
  }
  const key = val.slice(0, idx);
  const value = val.slice(idx + 1);
  return { ...prev, [key]: value };
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

type AgentRow = {
  id?: string;
  name?: string;
  runtimeId?: string | null;
  cliKind?: string | null;
  archivedAt?: string | null;
};

function printAgentTable(rows: AgentRow[]): void {
  if (rows.length === 0) {
    console.log("(no agents)");
    return;
  }
  const headers = ["ID", "NAME", "RUNTIME", "CLI", "ARCHIVED"];
  const data = rows.map((a) => [
    a.id ?? "",
    a.name ?? "",
    a.runtimeId ?? "",
    a.cliKind ?? "",
    a.archivedAt ? "yes" : "",
  ]);
  printTable(headers, data);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ");
  console.log(fmt(headers));
  for (const r of rows) console.log(fmt(r));
}

// ---------------------------------------------------------------------------
// list / get
// ---------------------------------------------------------------------------

agentCmd
  .command("list")
  .option("--include-archived", "Include archived agents", false)
  .option("--output <fmt>", "Output format: table or json", "table")
  .action(async (opts) => {
    const qs = opts.includeArchived ? "?archived=true" : "";
    const rows = (await api(`/api/workspaces/${workspaceId()}/agents${qs}`)) as AgentRow[];
    if (opts.output === "json") {
      printJson(rows);
    } else {
      printAgentTable(rows);
    }
  });

agentCmd
  .command("get <id>")
  .option("--output <fmt>", "Output format: table or json", "table")
  .action(async (id, opts) => {
    const a = (await api(`/api/workspaces/${workspaceId()}/agents/${id}`)) as AgentRow & {
      description?: string | null;
      model?: string | null;
      maxConcurrentTasks?: number;
    };
    if (opts.output === "json") {
      printJson(a);
      return;
    }
    const headers = ["ID", "NAME", "RUNTIME", "CLI", "MODEL", "MAX_TASKS", "ARCHIVED"];
    const row = [
      a.id ?? "",
      a.name ?? "",
      a.runtimeId ?? "",
      a.cliKind ?? "",
      a.model ?? "",
      String(a.maxConcurrentTasks ?? ""),
      a.archivedAt ? "yes" : "",
    ];
    printTable(headers, [row]);
  });

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

agentCmd
  .command("create")
  .requiredOption("--name <s>", "Agent name (required)")
  .option("--description <s>", "Agent description")
  .option("--instructions <s>", "Agent instructions")
  .option("--instructions-stdin", "Read --instructions from stdin")
  .requiredOption("--runtime-id <uuid>", "Runtime ID (required)")
  .option("--model <s>", "Model identifier")
  .option("--cli-kind <s>", "CLI kind (claude_code, codex, ...)", "claude_code")
  .option("--custom-args <s>", "Custom CLI arguments (space-separated)")
  .option(
    "--custom-env <kv>",
    "Custom env var KEY=VAL (repeatable)",
    appendCustomEnv,
    {} as Record<string, string>,
  )
  .option("--max-concurrent-tasks <n>", "Maximum concurrent tasks", (v) => parseInt(v, 10))
  .option("--output <fmt>", "Output format: table or json", "json")
  .action(async (opts) => {
    const instructions = await resolveTextFlag(
      opts.instructions,
      opts.instructionsStdin,
      "instructions",
    );

    const body: Record<string, unknown> = {
      name: opts.name,
      runtimeId: opts.runtimeId,
      cliKind: opts.cliKind,
    };
    if (opts.description !== undefined) body.description = opts.description;
    if (instructions !== undefined) body.instructions = instructions;
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.customArgs !== undefined) body.customArgs = parseCustomArgs(opts.customArgs);
    if (opts.customEnv && Object.keys(opts.customEnv).length > 0) {
      body.customEnv = opts.customEnv;
    }
    if (opts.maxConcurrentTasks !== undefined) {
      body.maxConcurrentTasks = opts.maxConcurrentTasks;
    }

    const r = await api(`/api/workspaces/${workspaceId()}/agents`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (opts.output === "json") {
      printJson(r);
    } else {
      const a = r as AgentRow;
      console.log(`Agent created: ${a.name ?? ""} (${a.id ?? ""})`);
    }
  });

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

agentCmd
  .command("update <id>")
  .option("--name <s>")
  .option("--description <s>")
  .option("--instructions <s>")
  .option("--instructions-stdin", "Read --instructions from stdin")
  .option("--runtime-id <uuid>")
  .option("--model <s>")
  .option("--custom-args <s>", "Custom CLI arguments (space-separated)")
  .option(
    "--custom-env <kv>",
    "Custom env var KEY=VAL (repeatable)",
    appendCustomEnv,
    {} as Record<string, string>,
  )
  .option("--max-concurrent-tasks <n>", "Maximum concurrent tasks", (v) => parseInt(v, 10))
  .option("--output <fmt>", "Output format: table or json", "json")
  .action(async (id, opts) => {
    const instructions = await resolveTextFlag(
      opts.instructions,
      opts.instructionsStdin,
      "instructions",
    );

    const body: Record<string, unknown> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.description !== undefined) body.description = opts.description;
    if (instructions !== undefined) body.instructions = instructions;
    if (opts.runtimeId !== undefined) body.runtimeId = opts.runtimeId;
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.customArgs !== undefined) body.customArgs = parseCustomArgs(opts.customArgs);
    if (opts.customEnv && Object.keys(opts.customEnv).length > 0) {
      body.customEnv = opts.customEnv;
    }
    if (opts.maxConcurrentTasks !== undefined) {
      body.maxConcurrentTasks = opts.maxConcurrentTasks;
    }

    if (Object.keys(body).length === 0) {
      console.error(
        "no fields to update; pass --name, --description, --instructions, --runtime-id, --model, --custom-args, --custom-env, or --max-concurrent-tasks",
      );
      process.exit(2);
    }

    const r = await api(`/api/workspaces/${workspaceId()}/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (opts.output === "json") {
      printJson(r);
    } else {
      const a = r as AgentRow;
      console.log(`Agent updated: ${a.name ?? ""} (${a.id ?? ""})`);
    }
  });

// ---------------------------------------------------------------------------
// archive / restore
// ---------------------------------------------------------------------------

agentCmd
  .command("archive <id>")
  .option("--output <fmt>", "Output format: table or json", "json")
  .action(async (id, opts) => {
    const r = await api(`/api/workspaces/${workspaceId()}/agents/${id}/archive`, {
      method: "POST",
    });
    if (opts.output === "json") {
      printJson(r);
    } else {
      const a = r as AgentRow;
      console.log(`Agent archived: ${a.name ?? ""} (${a.id ?? ""})`);
    }
  });

agentCmd
  .command("restore <id>")
  .option("--output <fmt>", "Output format: table or json", "json")
  .action(async (id, opts) => {
    const r = await api(`/api/workspaces/${workspaceId()}/agents/${id}/restore`, {
      method: "POST",
    });
    if (opts.output === "json") {
      printJson(r);
    } else {
      const a = r as AgentRow;
      console.log(`Agent restored: ${a.name ?? ""} (${a.id ?? ""})`);
    }
  });

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

agentCmd
  .command("tasks <id>")
  .option("--output <fmt>", "Output format: table or json", "table")
  .action(async (id, opts) => {
    const tasks = (await api(`/api/workspaces/${workspaceId()}/agents/${id}/tasks`)) as Array<{
      id?: string;
      issueId?: string | null;
      status?: string;
      createdAt?: string;
    }>;
    if (opts.output === "json") {
      printJson(tasks);
      return;
    }
    if (tasks.length === 0) {
      console.log("(no tasks)");
      return;
    }
    const headers = ["ID", "ISSUE_ID", "STATUS", "CREATED_AT"];
    const rows = tasks.map((t) => [
      t.id ?? "",
      t.issueId ?? "",
      t.status ?? "",
      t.createdAt ?? "",
    ]);
    printTable(headers, rows);
  });

// ---------------------------------------------------------------------------
// skills (sub-noun)
// ---------------------------------------------------------------------------

const skillsSub = agentCmd.command("skills").description("Manage skill bindings on an agent");

skillsSub
  .command("list <agentId>")
  .option("--output <fmt>", "Output format: table or json", "table")
  .action(async (agentId, opts) => {
    const skills = (await api(`/api/workspaces/${workspaceId()}/agents/${agentId}/skills`)) as Array<{
      id?: string;
      name?: string;
      description?: string | null;
    }>;
    if (opts.output === "json") {
      printJson(skills);
      return;
    }
    if (skills.length === 0) {
      console.log("(no skills)");
      return;
    }
    const headers = ["ID", "NAME", "DESCRIPTION"];
    const rows = skills.map((s) => [s.id ?? "", s.name ?? "", s.description ?? ""]);
    printTable(headers, rows);
  });

skillsSub
  .command("set <agentId> [skillIds...]")
  .description("Replace the agent's skill set with the given skill IDs")
  .option("--output <fmt>", "Output format: table or json", "json")
  .action(async (agentId: string, skillIds: string[], opts) => {
    const r = await api(`/api/workspaces/${workspaceId()}/agents/${agentId}/skills`, {
      method: "PUT",
      body: JSON.stringify({ skillIds }),
    });
    if (opts.output === "json") {
      printJson(r);
    } else {
      console.log(`Skills updated for agent ${agentId}`);
    }
  });
