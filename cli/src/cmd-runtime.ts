import { Command } from "commander";
import { api, workspaceId } from "./client";

export const runtimeCmd = new Command("runtimes").description("Daemon runtime health");

type Runtime = {
  id: string;
  workspaceId: string;
  memberId: string;
  name: string;
  daemonVersion: string | null;
  detectedClis: unknown;
  online: boolean;
  lastHeartbeatAt: string | null;
  runtimeInfo: unknown;
  createdAt: string;
  updatedAt: string;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function printRuntimesTable(rows: Runtime[]): void {
  console.log(["ID", "NAME", "ONLINE", "VERSION", "LAST_SEEN"].join("\t"));
  for (const r of rows) {
    console.log(
      [
        shortId(r.id),
        r.name,
        r.online ? "yes" : "no",
        r.daemonVersion ?? "",
        formatDate(r.lastHeartbeatAt),
      ].join("\t"),
    );
  }
}

runtimeCmd
  .command("list")
  .description("List daemon runtimes in the workspace")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api(`/api/workspaces/${workspaceId()}/runtimes`)) as Runtime[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printRuntimesTable(rows);
  });

runtimeCmd
  .command("get <id>")
  .description("Get details for a single runtime (resolved via list)")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const rows = (await api(`/api/workspaces/${workspaceId()}/runtimes`)) as Runtime[];
    const runtime = rows.find((r) => r.id === id);
    if (!runtime) {
      console.error(`Runtime ${id} not found`);
      process.exit(1);
    }
    if (opts.output === "table") {
      printRuntimesTable([runtime]);
      return;
    }
    console.log(JSON.stringify(runtime, null, 2));
  });

runtimeCmd
  .command("delete <id>")
  .description("Delete (deregister) a runtime row — requires admin/owner role")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to delete runtime ${id} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/runtimes/${id}`, { method: "DELETE" });
    if (opts.output === "json") {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }
    console.log(`Runtime ${id} deleted.`);
  });
