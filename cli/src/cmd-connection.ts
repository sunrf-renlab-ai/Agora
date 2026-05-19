import { Command } from "commander";
import { api } from "./client";

export const connectionCmd = new Command("connection").description(
  "Third-party data source connections (OAuth)",
);

interface UserConnection {
  kind: string;
  status: "pending" | "connected" | "revoked";
  connectedAt: string | null;
}

function printConnectionsTable(rows: UserConnection[]): void {
  console.log(["KIND", "STATUS", "CONNECTED_AT"].join("\t"));
  for (const c of rows) {
    console.log(
      [c.kind, c.status, c.connectedAt ? c.connectedAt.slice(0, 10) : "—"].join("\t"),
    );
  }
}

connectionCmd
  .command("list")
  .description("List all supported connections and their status")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const res = (await api("/api/me/connections")) as { kinds: UserConnection[] };
    const rows = res.kinds;
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printConnectionsTable(rows);
  });

connectionCmd
  .command("start <kind>")
  .description(
    "Begin an OAuth flow for a connection kind. Prints the authorization URL — open it in your browser.",
  )
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (kind: string, opts) => {
    const r = (await api(`/api/connections/${kind}/start`, {
      method: "POST",
    })) as { authorizeUrl: string };
    if (opts.output === "table") {
      console.log(`Open this URL in your browser:\n${r.authorizeUrl}`);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

connectionCmd
  .command("remove <kind>")
  .description("Disconnect and remove a third-party connection")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (kind: string, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to remove ${kind} connection without --yes`);
      process.exit(2);
    }
    await api(`/api/me/connections/${kind}`, { method: "DELETE" });
    if (opts.output === "json") {
      console.log(JSON.stringify({ kind, removed: true }, null, 2));
      return;
    }
    console.log(`Connection '${kind}' removed.`);
  });
