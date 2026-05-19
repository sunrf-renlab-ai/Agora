import { Command } from "commander";
import { api, workspaceId } from "./client";

export const dependencyCmd = new Command("dependencies").description(
  "Manage issue dependency graph",
);

type Dep = {
  id: string;
  issueId: string;
  dependsOnIssueId: string;
  type: string;
  createdAt?: string;
};

type IssueDepGraph = {
  blocks: Dep[];
  blockedBy: Dep[];
  related: Dep[];
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(d?: string): string {
  if (!d) return "";
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function printDepsTable(rows: Dep[]): void {
  console.log(["ID", "ISSUE", "DEPENDS_ON", "TYPE", "CREATED"].join("\t"));
  for (const d of rows) {
    console.log(
      [shortId(d.id), shortId(d.issueId), shortId(d.dependsOnIssueId), d.type, formatDate(d.createdAt)].join(
        "\t",
      ),
    );
  }
}

dependencyCmd
  .command("list")
  .description("List dependencies (workspace-wide or for a single issue)")
  .option("--issue <issueId>", "Filter to a single issue (returns blocks/blockedBy/related)")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    if (opts.issue) {
      const graph = (await api(
        `/api/workspaces/${workspaceId()}/issues/${opts.issue}/dependencies`,
      )) as IssueDepGraph;
      if (opts.output === "json") {
        console.log(JSON.stringify(graph, null, 2));
        return;
      }
      const allWithLabel = [
        ...graph.blocks.map((d) => ({ ...d, type: "blocks" })),
        ...graph.blockedBy.map((d) => ({ ...d, type: "blocked_by" })),
        ...graph.related.map((d) => ({ ...d, type: "related" })),
      ];
      if (allWithLabel.length === 0) {
        console.log("No dependencies.");
        return;
      }
      printDepsTable(allWithLabel);
    } else {
      const rows = (await api(
        `/api/workspaces/${workspaceId()}/dependencies`,
      )) as Dep[];
      if (opts.output === "json") {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      printDepsTable(rows);
    }
  });

dependencyCmd
  .command("add <issueId>")
  .description("Add a dependency edge")
  .requiredOption("--target <issueId>", "Target issue ID")
  .requiredOption("--kind <kind>", "blocks|related  (blocked_by = add from other direction)")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (issueId, opts) => {
    const allowed = ["blocks", "related"];
    if (!allowed.includes(opts.kind)) {
      console.error(`--kind must be one of: ${allowed.join(", ")}`);
      process.exit(2);
    }
    const r = (await api(`/api/workspaces/${workspaceId()}/issues/${issueId}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ dependsOnIssueId: opts.target, type: opts.kind }),
    })) as Dep;
    if (opts.output === "table") {
      printDepsTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

dependencyCmd
  .command("remove <issueId> <depId>")
  .description("Remove a dependency edge")
  .option("--yes", "Skip confirmation", false)
  .action(async (issueId, depId, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to remove dependency ${depId} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/issues/${issueId}/dependencies/${depId}`, {
      method: "DELETE",
    });
    console.log(`Dependency ${depId} removed.`);
  });
