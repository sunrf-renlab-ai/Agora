import { Command } from "commander";
import { api, workspaceId } from "./client";

export const activityCmd = new Command("activity").description("View issue activity feed");

type ActivityEntry = {
  id: string;
  issueId?: string;
  actorKind?: string;
  actorId?: string | null;
  actor?: { id: string; name?: string | null; avatarUrl?: string | null } | null;
  action: string;
  details?: Record<string, unknown>;
  createdAt?: string;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(d?: string): string {
  if (!d) return "";
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function actorLabel(e: ActivityEntry): string {
  if (e.actor?.name) return e.actor.name;
  if (e.actorId) return shortId(e.actorId);
  return e.actorKind ?? "system";
}

function printActivityTable(rows: ActivityEntry[]): void {
  console.log(["ID", "ACTOR", "ACTION", "CREATED"].join("\t"));
  for (const e of rows) {
    console.log([shortId(e.id), actorLabel(e), e.action, formatDate(e.createdAt)].join("\t"));
  }
}

activityCmd
  .command("list <issueId>")
  .description("List activity for an issue")
  .option("--limit <n>", "Max entries to show (default: all returned by server)", "")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (issueId, opts) => {
    let rows = (await api(
      `/api/workspaces/${workspaceId()}/issues/${issueId}/activity`,
    )) as ActivityEntry[];
    if (opts.limit) {
      const n = parseInt(opts.limit, 10);
      if (Number.isNaN(n) || n <= 0) {
        console.error("--limit must be a positive integer");
        process.exit(2);
      }
      rows = rows.slice(0, n);
    }
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printActivityTable(rows);
  });
