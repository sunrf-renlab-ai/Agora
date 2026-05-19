import { Command } from "commander";
import { api } from "./client";

export const invitationCmd = new Command("invitation").description(
  "Manage pending workspace invitations (invitee side)",
);

interface Invitation {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  email: string;
  role: string;
  token: string;
  createdAt: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function printInvitationsTable(rows: Invitation[]): void {
  console.log(["ID", "WORKSPACE", "EMAIL", "ROLE", "TOKEN", "CREATED"].join("\t"));
  for (const inv of rows) {
    console.log(
      [
        shortId(inv.id),
        inv.workspaceName ?? shortId(inv.workspaceId),
        inv.email,
        inv.role,
        inv.token.slice(0, 12) + "…",
        inv.createdAt.slice(0, 10),
      ].join("\t"),
    );
  }
}

invitationCmd
  .command("list")
  .description("List your pending invitations")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api("/api/invitations")) as Invitation[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printInvitationsTable(rows);
  });

invitationCmd
  .command("get <token>")
  .description("Get details for an invitation by token")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (token: string, opts) => {
    const inv = (await api(`/api/invitations/${token}`)) as Invitation;
    if (opts.output === "table") {
      printInvitationsTable([inv]);
      return;
    }
    console.log(JSON.stringify(inv, null, 2));
  });

invitationCmd
  .command("accept <token>")
  .description("Accept an invitation and join the workspace")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (token: string, opts) => {
    const r = await api(`/api/invitations/${token}/accept`, { method: "POST" });
    console.log(JSON.stringify(r, null, 2));
  });

invitationCmd
  .command("decline <token>")
  .description("Decline an invitation")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (token: string, _opts) => {
    await api(`/api/invitations/${token}/decline`, { method: "POST" });
    console.log(JSON.stringify({ token, declined: true }, null, 2));
  });
