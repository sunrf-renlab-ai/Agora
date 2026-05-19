import { Command } from "commander";
import { api, workspaceId } from "./client";

export const autopilotCmd = new Command("autopilots").description(
  "Autopilot automation — CRUD, triggers, run history, manual fire",
);

// ── Types ────────────────────────────────────────────────────────────────────

type Autopilot = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  assigneeId: string;
  status: string;
  executionMode: string;
  issueTitleTemplate: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Trigger = {
  id: string;
  autopilotId: string;
  kind: string;
  enabled: boolean;
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: string | null;
  label: string | null;
  lastFiredAt: string | null;
  webhookToken?: string;
  createdAt: string;
  updatedAt: string;
};

type Run = {
  id: string;
  autopilotId: string;
  triggerId: string | null;
  source: string;
  status: string;
  issueId: string | null;
  taskId: string | null;
  triggeredAt: string;
  completedAt: string | null;
  failureReason: string | null;
  createdAt: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function fmt(d: string | null): string {
  if (!d) return "";
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function printAutopilotsTable(rows: Autopilot[]): void {
  console.log(["ID", "TITLE", "STATUS", "MODE", "LAST_RUN"].join("\t"));
  for (const a of rows) {
    console.log(
      [shortId(a.id), a.title.slice(0, 40), a.status, a.executionMode, fmt(a.lastRunAt)].join(
        "\t",
      ),
    );
  }
}

function printTriggersTable(rows: Trigger[]): void {
  console.log(["ID", "KIND", "ENABLED", "CRON", "NEXT_RUN", "LABEL"].join("\t"));
  for (const t of rows) {
    console.log(
      [
        shortId(t.id),
        t.kind,
        t.enabled ? "yes" : "no",
        t.cronExpression ?? "",
        fmt(t.nextRunAt),
        t.label ?? "",
      ].join("\t"),
    );
  }
}

function printRunsTable(rows: Run[]): void {
  console.log(["ID", "SOURCE", "STATUS", "TRIGGERED_AT", "COMPLETED_AT"].join("\t"));
  for (const r of rows) {
    console.log(
      [shortId(r.id), r.source, r.status, fmt(r.triggeredAt), fmt(r.completedAt)].join("\t"),
    );
  }
}

// ── Autopilot CRUD ───────────────────────────────────────────────────────────

autopilotCmd
  .command("list")
  .description("List autopilots in the workspace")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api(`/api/workspaces/${workspaceId()}/autopilots`)) as Autopilot[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printAutopilotsTable(rows);
  });

autopilotCmd
  .command("get <id>")
  .description("Get autopilot details including triggers")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const r = (await api(`/api/workspaces/${workspaceId()}/autopilots/${id}`)) as {
      autopilot: Autopilot;
      triggers: Trigger[];
    };
    if (opts.output === "table") {
      printAutopilotsTable([r.autopilot]);
      if (r.triggers.length > 0) {
        console.log("");
        printTriggersTable(r.triggers);
      }
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

autopilotCmd
  .command("create")
  .description("Create a new autopilot")
  .requiredOption("--title <title>", "Autopilot title (max 200 chars)")
  .requiredOption("--assignee-id <uuid>", "Agent UUID to assign as executor")
  .option("--description <text>", "Optional description")
  .option(
    "--execution-mode <mode>",
    "create_issue | run_only (default: create_issue)",
    "create_issue",
  )
  .option("--issue-title-template <tpl>", "Template for auto-created issue titles")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    const body: Record<string, unknown> = {
      title: opts.title,
      assigneeId: opts.assigneeId,
      executionMode: opts.executionMode,
    };
    if (opts.description) body.description = opts.description;
    if (opts.issueTitleTemplate) body.issueTitleTemplate = opts.issueTitleTemplate;
    const a = (await api(`/api/workspaces/${workspaceId()}/autopilots`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as Autopilot;
    if (opts.output === "table") {
      printAutopilotsTable([a]);
      return;
    }
    console.log(JSON.stringify(a, null, 2));
  });

autopilotCmd
  .command("update <id>")
  .description("Update an autopilot")
  .option("--title <title>", "New title")
  .option("--description <text>", "New description")
  .option("--assignee-id <uuid>", "New agent UUID")
  .option("--status <status>", "active | paused | archived")
  .option("--execution-mode <mode>", "create_issue | run_only")
  .option("--issue-title-template <tpl>", "New issue title template")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const body: Record<string, unknown> = {};
    if (opts.title) body.title = opts.title;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.assigneeId) body.assigneeId = opts.assigneeId;
    if (opts.status) body.status = opts.status;
    if (opts.executionMode) body.executionMode = opts.executionMode;
    if (opts.issueTitleTemplate !== undefined) body.issueTitleTemplate = opts.issueTitleTemplate;
    if (Object.keys(body).length === 0) {
      console.error("nothing to update — provide at least one option");
      process.exit(2);
    }
    const a = (await api(`/api/workspaces/${workspaceId()}/autopilots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as Autopilot;
    if (opts.output === "table") {
      printAutopilotsTable([a]);
      return;
    }
    console.log(JSON.stringify(a, null, 2));
  });

autopilotCmd
  .command("delete <id>")
  .description("Delete an autopilot")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to delete autopilot ${id} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/autopilots/${id}`, { method: "DELETE" });
    if (opts.output === "json") {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }
    console.log(`Autopilot ${id} deleted.`);
  });

// ── Manual fire ──────────────────────────────────────────────────────────────

autopilotCmd
  .command("fire <id>")
  .description("Manually fire an autopilot (autopilot must be active)")
  .option("--payload <json>", "Optional JSON payload to pass to the run")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const body: Record<string, unknown> = {};
    if (opts.payload) {
      try {
        body.payload = JSON.parse(opts.payload);
      } catch {
        console.error("--payload must be valid JSON");
        process.exit(2);
      }
    }
    const run = (await api(`/api/workspaces/${workspaceId()}/autopilots/${id}/trigger`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as Run;
    if (opts.output === "table") {
      printRunsTable([run]);
      return;
    }
    console.log(JSON.stringify(run, null, 2));
  });

// ── Run history ──────────────────────────────────────────────────────────────

autopilotCmd
  .command("runs <id>")
  .description("List run history for an autopilot")
  .option("--limit <n>", "Max runs to fetch (server cap 100)", "20")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (id, opts) => {
    const qs = `?limit=${opts.limit}`;
    const res = (await api(
      `/api/workspaces/${workspaceId()}/autopilots/${id}/runs${qs}`,
    )) as { runs: Run[]; total: number };
    if (opts.output === "json") {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    printRunsTable(res.runs);
  });

autopilotCmd
  .command("run-get <autopilotId> <runId>")
  .description("Get a single run by ID")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (autopilotId, runId, opts) => {
    const run = (await api(
      `/api/workspaces/${workspaceId()}/autopilots/${autopilotId}/runs/${runId}`,
    )) as Run;
    if (opts.output === "table") {
      printRunsTable([run]);
      return;
    }
    console.log(JSON.stringify(run, null, 2));
  });

// ── Trigger management ───────────────────────────────────────────────────────

const triggerCmd = autopilotCmd
  .command("trigger")
  .description("Manage autopilot triggers (add / update / remove)");

triggerCmd
  .command("add <autopilotId>")
  .description("Add a trigger to an autopilot")
  .requiredOption("--kind <kind>", "schedule | webhook | api")
  .option("--cron <expression>", "Cron expression (required for schedule triggers)")
  .option("--timezone <tz>", "Timezone for schedule triggers (default: UTC)", "UTC")
  .option("--label <label>", "Human-readable label for this trigger")
  .option("--disabled", "Create trigger in disabled state", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (autopilotId, opts) => {
    const body: Record<string, unknown> = {
      kind: opts.kind,
      enabled: !opts.disabled,
      timezone: opts.timezone,
    };
    if (opts.cron) body.cronExpression = opts.cron;
    if (opts.label) body.label = opts.label;
    const t = (await api(
      `/api/workspaces/${workspaceId()}/autopilots/${autopilotId}/triggers`,
      { method: "POST", body: JSON.stringify(body) },
    )) as Trigger;
    if (opts.output === "table") {
      printTriggersTable([t]);
      if (t.webhookToken) {
        console.log(`\nwebhookToken: ${t.webhookToken}  (shown once — save it now)`);
      }
      return;
    }
    console.log(JSON.stringify(t, null, 2));
  });

triggerCmd
  .command("update <autopilotId> <triggerId>")
  .description("Update an existing trigger")
  .option("--cron <expression>", "New cron expression")
  .option("--timezone <tz>", "New timezone")
  .option("--label <label>", "New label")
  .option("--enabled <bool>", "true | false")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (autopilotId, triggerId, opts) => {
    const body: Record<string, unknown> = {};
    if (opts.cron !== undefined) body.cronExpression = opts.cron;
    if (opts.timezone !== undefined) body.timezone = opts.timezone;
    if (opts.label !== undefined) body.label = opts.label;
    if (opts.enabled !== undefined) body.enabled = opts.enabled === "true";
    if (Object.keys(body).length === 0) {
      console.error("nothing to update — provide at least one option");
      process.exit(2);
    }
    const t = (await api(
      `/api/workspaces/${workspaceId()}/autopilots/${autopilotId}/triggers/${triggerId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    )) as Trigger;
    if (opts.output === "table") {
      printTriggersTable([t]);
      return;
    }
    console.log(JSON.stringify(t, null, 2));
  });

triggerCmd
  .command("remove <autopilotId> <triggerId>")
  .description("Delete a trigger")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (autopilotId, triggerId, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to delete trigger ${triggerId} without --yes`);
      process.exit(2);
    }
    await api(
      `/api/workspaces/${workspaceId()}/autopilots/${autopilotId}/triggers/${triggerId}`,
      { method: "DELETE" },
    );
    if (opts.output === "json") {
      console.log(JSON.stringify({ triggerId, deleted: true }, null, 2));
      return;
    }
    console.log(`Trigger ${triggerId} removed.`);
  });
