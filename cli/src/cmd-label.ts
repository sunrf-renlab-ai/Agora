import { Command } from "commander";
import { api, workspaceId } from "./client";

export const labelCmd = new Command("label").description("Work with issue labels");

type Label = {
  id: string;
  workspaceId?: string;
  name: string;
  color: string;
  createdAt?: string;
  updatedAt?: string;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(d?: string): string {
  if (!d) return "";
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function printLabelsTable(rows: Label[]): void {
  console.log(["ID", "NAME", "COLOR", "CREATED"].join("\t"));
  for (const l of rows) {
    console.log([shortId(l.id), l.name, l.color, formatDate(l.createdAt)].join("\t"));
  }
}

function printLabelTable(l: Label): void {
  console.log(["ID", "NAME", "COLOR", "CREATED"].join("\t"));
  console.log([shortId(l.id), l.name, l.color, formatDate(l.createdAt)].join("\t"));
}

labelCmd
  .command("list")
  .description("List labels in the workspace")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api(`/api/workspaces/${workspaceId()}/labels`)) as Label[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printLabelsTable(rows);
  });

labelCmd
  .command("get <id>")
  .description("Get label details")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    // No GET-by-id endpoint exists; resolve via the list response.
    const rows = (await api(`/api/workspaces/${workspaceId()}/labels`)) as Label[];
    const label = rows.find((l) => l.id === id);
    if (!label) {
      console.error(`Label ${id} not found`);
      process.exit(1);
    }
    if (opts.output === "table") {
      printLabelTable(label);
      return;
    }
    console.log(JSON.stringify(label, null, 2));
  });

labelCmd
  .command("create")
  .description("Create a new label")
  .requiredOption("--name <name>", "Label name")
  .requiredOption("--color <hex>", "Hex color like #3b82f6")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    const r = (await api(`/api/workspaces/${workspaceId()}/labels`, {
      method: "POST",
      body: JSON.stringify({ name: opts.name, color: opts.color }),
    })) as Label;
    if (opts.output === "table") {
      printLabelTable(r);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

labelCmd
  .command("update <id>")
  .description("Update a label")
  .option("--name <name>", "New name")
  .option("--color <hex>", "New hex color")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const body: Record<string, string> = {};
    if (opts.name) body.name = opts.name;
    if (opts.color) body.color = opts.color;
    if (Object.keys(body).length === 0) {
      console.error("nothing to update — provide --name and/or --color");
      process.exit(2);
    }
    const r = (await api(`/api/workspaces/${workspaceId()}/labels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as Label;
    if (opts.output === "table") {
      printLabelTable(r);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

labelCmd
  .command("delete <id>")
  .description("Delete a label")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to delete label ${id} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/labels/${id}`, { method: "DELETE" });
    if (opts.output === "json") {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }
    console.log(`Label ${id} deleted.`);
  });
