import { Command } from "commander";
import { api, workspaceId } from "./client";

export const workspaceCmd = new Command("workspace").description("Work with workspaces");

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
}

interface MemberRow {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string; avatarUrl?: string | null } | null;
}

function resolveWorkspaceId(arg: string | undefined): string {
  const wsId = arg ?? workspaceId();
  if (!wsId) {
    throw new Error("workspace ID is required: pass as argument or set AGORA_WORKSPACE_ID");
  }
  return wsId;
}

workspaceCmd
  .command("list")
  .description("List workspaces you belong to")
  .action(async () => {
    const rows = (await api("/api/workspaces")) as WorkspaceRow[];
    if (rows.length === 0) {
      console.error("No workspaces found.");
      return;
    }
    for (const ws of rows) {
      console.log(`${ws.id}\t${ws.slug}\t${ws.name}`);
    }
  });

workspaceCmd
  .command("get [id]")
  .description("Get workspace details")
  .option("--output <fmt>", "Output format: table or json", "table")
  .action(async (id: string | undefined, opts: { output: string }) => {
    const wsId = resolveWorkspaceId(id);
    const ws = (await api(`/api/workspaces/${wsId}`, { workspaceId: wsId })) as Record<
      string,
      unknown
    >;
    if (opts.output === "json") {
      console.log(JSON.stringify(ws, null, 2));
      return;
    }
    console.log(`ID:          ${ws.id ?? ""}`);
    console.log(`NAME:        ${ws.name ?? ""}`);
    console.log(`SLUG:        ${ws.slug ?? ""}`);
    console.log(`DESCRIPTION: ${ws.description ?? ""}`);
  });

workspaceCmd
  .command("members [id]")
  .description("List workspace members")
  .option("--output <fmt>", "Output format: table or json", "table")
  .action(async (id: string | undefined, opts: { output: string }) => {
    const wsId = resolveWorkspaceId(id);
    const rows = (await api(`/api/workspaces/${wsId}/members`, {
      workspaceId: wsId,
    })) as MemberRow[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log("USER ID\tNAME\tEMAIL\tROLE");
    for (const m of rows) {
      const u = m.user;
      console.log(`${m.userId}\t${u?.name ?? ""}\t${u?.email ?? ""}\t${m.role}`);
    }
  });
