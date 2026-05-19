import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { api, workspaceId } from "./client";

export const projectCmd = new Command("projects").description("Manage workspace projects");

type Project = {
  id: string;
  workspaceId?: string;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  icon?: string | null;
  color?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type Resource = {
  id: string;
  projectId: string;
  resourceType: string;
  resourceRef: string;
  label?: string | null;
  createdAt?: string;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(d?: string): string {
  if (!d) return "";
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function printProjectsTable(rows: Project[]): void {
  console.log(["ID", "TITLE", "STATUS", "PRIORITY", "CREATED"].join("\t"));
  for (const p of rows) {
    console.log(
      [shortId(p.id), p.title, p.status ?? "", p.priority ?? "", formatDate(p.createdAt)].join(
        "\t",
      ),
    );
  }
}

function printProjectTable(p: Project): void {
  console.log(["ID", "TITLE", "STATUS", "PRIORITY", "CREATED"].join("\t"));
  console.log(
    [shortId(p.id), p.title, p.status ?? "", p.priority ?? "", formatDate(p.createdAt)].join("\t"),
  );
}

async function readDescriptionArg(opts: {
  description?: string;
  descriptionStdin?: boolean;
  descriptionFile?: string;
}): Promise<string | undefined> {
  if (opts.descriptionStdin) {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (c) => chunks.push(c));
      process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      process.stdin.on("error", reject);
    });
  }
  if (opts.descriptionFile) return await readFile(opts.descriptionFile, "utf8");
  return opts.description;
}

projectCmd
  .command("list")
  .description("List projects in the workspace")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api(`/api/workspaces/${workspaceId()}/projects`)) as Project[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printProjectsTable(rows);
  });

projectCmd
  .command("get <id>")
  .description("Get project details")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const p = (await api(`/api/workspaces/${workspaceId()}/projects/${id}`)) as Project;
    if (opts.output === "table") {
      printProjectTable(p);
      return;
    }
    console.log(JSON.stringify(p, null, 2));
  });

projectCmd
  .command("create")
  .description("Create a new project")
  .requiredOption("--title <title>", "Project title")
  .option("--description <md>", "Inline description")
  .option("--description-stdin", "Read description from stdin", false)
  .option("--description-file <path>", "Read description from file")
  .option("--status <status>", "planning|active|paused|completed|archived")
  .option("--priority <priority>", "urgent|high|medium|low|none")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    const description = await readDescriptionArg(opts);
    const body: Record<string, unknown> = { title: opts.title };
    if (description !== undefined) body.description = description;
    if (opts.status) body.status = opts.status;
    if (opts.priority) body.priority = opts.priority;
    const r = (await api(`/api/workspaces/${workspaceId()}/projects`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as Project;
    if (opts.output === "table") {
      printProjectTable(r);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

projectCmd
  .command("update <id>")
  .description("Update a project")
  .option("--title <title>", "New title")
  .option("--description <md>", "New description")
  .option("--description-stdin", "Read description from stdin", false)
  .option("--description-file <path>", "Read description from file")
  .option("--status <status>", "planning|active|paused|completed|archived")
  .option("--priority <priority>", "urgent|high|medium|low|none")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    const body: Record<string, unknown> = {};
    if (opts.title) body.title = opts.title;
    if (opts.status) body.status = opts.status;
    if (opts.priority) body.priority = opts.priority;
    if (opts.descriptionStdin || opts.descriptionFile || opts.description !== undefined) {
      body.description = await readDescriptionArg(opts);
    }
    if (Object.keys(body).length === 0) {
      console.error("nothing to update — provide at least one option");
      process.exit(2);
    }
    const r = (await api(`/api/workspaces/${workspaceId()}/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as Project;
    if (opts.output === "table") {
      printProjectTable(r);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

projectCmd
  .command("delete <id>")
  .description("Delete a project")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to delete project ${id} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/projects/${id}`, { method: "DELETE" });
    if (opts.output === "json") {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }
    console.log(`Project ${id} deleted.`);
  });

const resourceCmd = projectCmd
  .command("resource")
  .description("Manage project resource attachments");

resourceCmd
  .command("add <projectId>")
  .description("Attach a resource to a project")
  .requiredOption("--resource-type <type>", "repo|url|doc")
  .requiredOption("--resource-ref <ref>", "URL or reference string")
  .option("--label <label>", "Optional display label")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (projectId, opts) => {
    const body: Record<string, unknown> = {
      resourceType: opts.resourceType,
      resourceRef: opts.resourceRef,
    };
    if (opts.label) body.label = opts.label;
    const r = (await api(`/api/workspaces/${workspaceId()}/projects/${projectId}/resources`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as Resource;
    if (opts.output === "table") {
      console.log(["ID", "TYPE", "REF", "LABEL"].join("\t"));
      console.log([shortId(r.id), r.resourceType, r.resourceRef, r.label ?? ""].join("\t"));
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

resourceCmd
  .command("remove <projectId> <resourceId>")
  .description("Detach a resource from a project")
  .option("--yes", "Skip confirmation", false)
  .action(async (projectId, resourceId, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to remove resource ${resourceId} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/projects/${projectId}/resources/${resourceId}`, {
      method: "DELETE",
    });
    console.log(`Resource ${resourceId} removed from project ${projectId}.`);
  });
