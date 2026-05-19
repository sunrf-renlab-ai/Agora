import { Command } from "commander";
import { api, workspaceId } from "./client";

export const inboxCmd = new Command("inbox").description("Workspace inbox and notifications");

type InboxItem = {
  id: string;
  workspaceId: string;
  recipientKind: string;
  recipientId: string;
  type: string;
  severity: string;
  issueId: string | null;
  title: string;
  body: string | null;
  read: boolean;
  archived: boolean;
  createdAt: string;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(d: string): string {
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function printItemsTable(rows: InboxItem[]): void {
  console.log(["ID", "TYPE", "SEVERITY", "TITLE", "READ", "CREATED"].join("\t"));
  for (const item of rows) {
    console.log(
      [
        shortId(item.id),
        item.type,
        item.severity,
        item.title.slice(0, 40),
        item.read ? "yes" : "no",
        formatDate(item.createdAt),
      ].join("\t"),
    );
  }
}

inboxCmd
  .command("list")
  .description("List inbox items")
  .option("--unread", "Show only unread items", false)
  .option("--archived", "Show archived items instead of active", false)
  .option("--limit <n>", "Max items to display (client-side)", "50")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.archived) params.set("archived", "true");
    const qs = params.toString() ? `?${params}` : "";
    let rows = (await api(
      `/api/workspaces/${workspaceId()}/inbox${qs}`,
    )) as InboxItem[];
    if (opts.unread) rows = rows.filter((r) => !r.read);
    const limit = Number(opts.limit);
    if (!Number.isNaN(limit) && limit > 0) rows = rows.slice(0, limit);
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printItemsTable(rows);
  });

inboxCmd
  .command("read <itemId>")
  .description("Mark an inbox item as read")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (itemId, opts) => {
    const r = (await api(`/api/workspaces/${workspaceId()}/inbox/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    })) as InboxItem;
    if (opts.output === "table") {
      printItemsTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

inboxCmd
  .command("archive <itemId>")
  .description("Archive an inbox item")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (itemId, opts) => {
    const r = (await api(`/api/workspaces/${workspaceId()}/inbox/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    })) as InboxItem;
    if (opts.output === "table") {
      printItemsTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

inboxCmd
  .command("mark-all-read")
  .description("Mark all inbox items as read")
  .option("--yes", "Skip confirmation", false)
  .action(async (opts) => {
    if (!opts.yes) {
      console.error("Refusing to mark all read without --yes");
      process.exit(2);
    }
    const r = await api(`/api/workspaces/${workspaceId()}/inbox/mark-all-read`, {
      method: "POST",
    });
    console.log(JSON.stringify(r, null, 2));
  });

inboxCmd
  .command("archive-all")
  .description("Archive all inbox items")
  .option("--yes", "Skip confirmation", false)
  .option("--scope <scope>", "all | read (archive only already-read items)", "all")
  .action(async (opts) => {
    if (!opts.yes) {
      console.error("Refusing to archive all without --yes");
      process.exit(2);
    }
    const qs = opts.scope !== "all" ? `?scope=${opts.scope}` : "";
    const r = await api(`/api/workspaces/${workspaceId()}/inbox/archive-all${qs}`, {
      method: "POST",
    });
    console.log(JSON.stringify(r, null, 2));
  });
