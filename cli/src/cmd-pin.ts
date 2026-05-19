import { Command } from "commander";
import { api, workspaceId } from "./client";

export const pinCmd = new Command("pins").description("Manage workspace pinned items");

type Pin = {
  id: string;
  workspaceId?: string;
  userId?: string;
  itemType: string;
  itemId: string;
  position?: number;
  createdAt?: string;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(d?: string): string {
  if (!d) return "";
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function printPinsTable(rows: Pin[]): void {
  console.log(["PIN_ID", "ITEM_TYPE", "ITEM_ID", "POSITION", "CREATED"].join("\t"));
  for (const p of rows) {
    console.log(
      [
        shortId(p.id),
        p.itemType,
        shortId(p.itemId),
        String(p.position ?? ""),
        formatDate(p.createdAt),
      ].join("\t"),
    );
  }
}

pinCmd
  .command("list")
  .description("List pins for the current user in this workspace")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api(`/api/workspaces/${workspaceId()}/pins`)) as Pin[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printPinsTable(rows);
  });

pinCmd
  .command("add <itemId>")
  .description("Pin an item (default item-type: issue)")
  .option("--item-type <type>", "issue|project|agent", "issue")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (itemId, opts) => {
    const allowed = ["issue", "project", "agent"];
    if (!allowed.includes(opts.itemType)) {
      console.error(`--item-type must be one of: ${allowed.join(", ")}`);
      process.exit(2);
    }
    const r = (await api(`/api/workspaces/${workspaceId()}/pins`, {
      method: "POST",
      body: JSON.stringify({ itemType: opts.itemType, itemId }),
    })) as Pin;
    if (opts.output === "table") {
      printPinsTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

pinCmd
  .command("remove <pinId>")
  .description("Unpin an item by pin ID")
  .option("--yes", "Skip confirmation", false)
  .action(async (pinId, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to remove pin ${pinId} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/pins/${pinId}`, { method: "DELETE" });
    console.log(`Pin ${pinId} removed.`);
  });
