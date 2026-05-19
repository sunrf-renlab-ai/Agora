import { Command } from "commander";
import { api, workspaceId } from "./client";

export const reactionCmd = new Command("reaction").description(
  "Emoji reactions on issues and comments",
);

interface Reaction {
  id: string;
  workspaceId: string;
  targetKind: "issue" | "comment";
  targetId: string;
  actorKind: string;
  actorId: string;
  emoji: string;
  createdAt: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function printReactionsTable(rows: Reaction[]): void {
  console.log(["ID", "EMOJI", "ACTOR_KIND", "ACTOR_ID", "CREATED"].join("\t"));
  for (const r of rows) {
    console.log(
      [
        shortId(r.id),
        r.emoji,
        r.actorKind,
        shortId(r.actorId),
        r.createdAt.slice(0, 10),
      ].join("\t"),
    );
  }
}

// ---- issue sub-command group ----
const issueReactionCmd = new Command("issue").description(
  "Reactions on issues",
);

issueReactionCmd
  .command("list <issueId>")
  .description("List reactions on an issue")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (issueId: string, opts) => {
    const rows = (await api(
      `/api/workspaces/${workspaceId()}/issues/${issueId}/reactions`,
    )) as Reaction[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printReactionsTable(rows);
  });

issueReactionCmd
  .command("add <issueId>")
  .description("Add an emoji reaction to an issue")
  .requiredOption("--emoji <emoji>", "Emoji character, e.g. 👍")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (issueId: string, opts) => {
    const r = (await api(
      `/api/workspaces/${workspaceId()}/issues/${issueId}/reactions`,
      { method: "POST", body: JSON.stringify({ emoji: opts.emoji }) },
    )) as Reaction;
    if (opts.output === "table") {
      printReactionsTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

issueReactionCmd
  .command("remove <issueId>")
  .description("Remove your emoji reaction from an issue")
  .requiredOption("--emoji <emoji>", "Emoji to remove")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (issueId: string, opts) => {
    const emoji = encodeURIComponent(opts.emoji);
    await api(
      `/api/workspaces/${workspaceId()}/issues/${issueId}/reactions/${emoji}`,
      { method: "DELETE" },
    );
    if (opts.output === "json") {
      console.log(JSON.stringify({ issueId, emoji: opts.emoji, removed: true }, null, 2));
      return;
    }
    console.log(`Reaction ${opts.emoji} removed from issue ${issueId}.`);
  });

// ---- comment sub-command group ----
const commentReactionCmd = new Command("comment").description(
  "Reactions on comments",
);

commentReactionCmd
  .command("list <commentId>")
  .description("List reactions on a comment")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (commentId: string, opts) => {
    const rows = (await api(
      `/api/workspaces/${workspaceId()}/comments/${commentId}/reactions`,
    )) as Reaction[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printReactionsTable(rows);
  });

commentReactionCmd
  .command("add <commentId>")
  .description("Add an emoji reaction to a comment")
  .requiredOption("--emoji <emoji>", "Emoji character, e.g. 🎉")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (commentId: string, opts) => {
    const r = (await api(
      `/api/workspaces/${workspaceId()}/comments/${commentId}/reactions`,
      { method: "POST", body: JSON.stringify({ emoji: opts.emoji }) },
    )) as Reaction;
    if (opts.output === "table") {
      printReactionsTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

commentReactionCmd
  .command("remove <commentId>")
  .description("Remove your emoji reaction from a comment")
  .requiredOption("--emoji <emoji>", "Emoji to remove")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (commentId: string, opts) => {
    const emoji = encodeURIComponent(opts.emoji);
    await api(
      `/api/workspaces/${workspaceId()}/comments/${commentId}/reactions/${emoji}`,
      { method: "DELETE" },
    );
    if (opts.output === "json") {
      console.log(
        JSON.stringify({ commentId, emoji: opts.emoji, removed: true }, null, 2),
      );
      return;
    }
    console.log(`Reaction ${opts.emoji} removed from comment ${commentId}.`);
  });

reactionCmd.addCommand(issueReactionCmd);
reactionCmd.addCommand(commentReactionCmd);
