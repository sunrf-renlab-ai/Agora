import { Command } from "commander";
import { api, workspaceId } from "./client";

export const memberCmd = new Command("member").description(
  "Manage workspace members",
);

type Role = "admin" | "member" | "owner";

interface Member {
  id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  user: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  createdAt: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function printMembersTable(rows: Member[]): void {
  console.log(["ID", "USER_ID", "EMAIL", "ROLE", "JOINED"].join("\t"));
  for (const m of rows) {
    console.log(
      [
        shortId(m.id),
        shortId(m.userId),
        m.user?.email ?? "",
        m.role,
        m.createdAt.slice(0, 10),
      ].join("\t"),
    );
  }
}

function printMemberTable(m: Member): void {
  printMembersTable([m]);
}

memberCmd
  .command("list")
  .description("List workspace members")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api(
      `/api/workspaces/${workspaceId()}/members`,
    )) as Member[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printMembersTable(rows);
  });

memberCmd
  .command("add")
  .description("Invite a user by email (creates a workspace invitation)")
  .requiredOption("--email <email>", "Invitee email address")
  .option("--role <role>", "admin | member", "member")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    const r = await api(`/api/workspaces/${workspaceId()}/members`, {
      method: "POST",
      body: JSON.stringify({ email: opts.email, role: opts.role }),
    });
    if (opts.output === "table") {
      // Returns invitation object, not a member row
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

memberCmd
  .command("update <memberId>")
  .description("Update a member's role")
  .requiredOption("--role <role>", "New role: admin | member")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (memberId: string, opts) => {
    const r = (await api(
      `/api/workspaces/${workspaceId()}/members/${memberId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ role: opts.role }),
      },
    )) as Member;
    if (opts.output === "table") {
      printMemberTable(r);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

memberCmd
  .command("remove <memberId>")
  .description("Remove a member from the workspace")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (memberId: string, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to remove member ${memberId} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/members/${memberId}`, {
      method: "DELETE",
    });
    if (opts.output === "json") {
      console.log(JSON.stringify({ id: memberId, removed: true }, null, 2));
      return;
    }
    console.log(`Member ${memberId} removed.`);
  });
