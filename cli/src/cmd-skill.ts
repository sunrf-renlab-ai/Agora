import { Command } from "commander";
import { api, workspaceId } from "./client";

export const skillCmd = new Command("skill").description("Manage skills");

skillCmd.command("list").action(async () => {
  const r = await api(`/api/workspaces/${workspaceId()}/skills`);
  console.log(JSON.stringify(r, null, 2));
});

skillCmd.command("get <id>").action(async (id) => {
  const r = await api(`/api/workspaces/${workspaceId()}/skills/${id}`);
  console.log(JSON.stringify(r, null, 2));
});

skillCmd
  .command("create")
  .requiredOption("--name <name>")
  .option("--description <text>", "", "")
  .option("--content <markdown>", "SKILL.md body", "")
  .action(async (opts) => {
    const r = await api(`/api/workspaces/${workspaceId()}/skills`, {
      method: "POST",
      body: JSON.stringify({
        name: opts.name,
        description: opts.description,
        content: opts.content,
        files: [],
      }),
    });
    console.log(JSON.stringify(r, null, 2));
  });

skillCmd
  .command("update <id>")
  .option("--name <name>")
  .option("--description <text>")
  .option("--content <markdown>")
  .action(async (id, opts) => {
    const body: Record<string, string> = {};
    if (opts.name) body.name = opts.name;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.content !== undefined) body.content = opts.content;
    const r = await api(`/api/workspaces/${workspaceId()}/skills/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    console.log(JSON.stringify(r, null, 2));
  });

skillCmd.command("delete <id>").action(async (id) => {
  await api(`/api/workspaces/${workspaceId()}/skills/${id}`, { method: "DELETE" });
  console.log("ok");
});

skillCmd
  .command("import")
  .requiredOption("--url <url>")
  .action(async (opts) => {
    const r = await api(`/api/workspaces/${workspaceId()}/skills/import`, {
      method: "POST",
      body: JSON.stringify({ url: opts.url }),
    });
    console.log(JSON.stringify(r, null, 2));
  });

// ---------------------------------------------------------------------------
// skill files
// ---------------------------------------------------------------------------

const skillFilesCmd = skillCmd.command("files").description("Work with skill files");

interface SkillFileRow {
  id: string;
  skillId: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

skillFilesCmd
  .command("list <skillId>")
  .description("List files for a skill")
  .option("--output <fmt>", "Output format: table or json", "table")
  .action(async (skillId: string, opts: { output: string }) => {
    const rows = (await api(
      `/api/workspaces/${workspaceId()}/skills/${skillId}/files`,
    )) as SkillFileRow[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log("ID\tPATH\tBYTES\tUPDATED_AT");
    for (const f of rows) {
      const len = f.content?.length ?? 0;
      console.log(`${f.id}\t${f.path}\t${len}\t${f.updatedAt}`);
    }
  });

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

skillFilesCmd
  .command("upsert <skillId>")
  .description("Create or update a skill file (keyed by path)")
  .requiredOption("--path <relative>", "Path within the skill (required)")
  .option("--content <markdown>", "File content")
  .option("--content-stdin", "Read file content from stdin", false)
  .option("--output <fmt>", "Output format: table or json", "json")
  .action(
    async (
      skillId: string,
      opts: { path: string; content?: string; contentStdin?: boolean; output: string },
    ) => {
      const hasInline = opts.content !== undefined;
      const useStdin = !!opts.contentStdin;
      if (hasInline === useStdin) {
        throw new Error("specify exactly one of --content or --content-stdin");
      }
      const content = useStdin ? await readStdin() : (opts.content ?? "");
      const r = (await api(`/api/workspaces/${workspaceId()}/skills/${skillId}/files`, {
        method: "POST",
        body: JSON.stringify({ path: opts.path, content }),
      })) as SkillFileRow;
      if (opts.output === "json") {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      console.log(`Skill file upserted: ${r.path} (${r.id})`);
    },
  );

skillFilesCmd
  .command("delete <skillId> <fileId>")
  .description("Delete a skill file")
  .action(async (skillId: string, fileId: string) => {
    await api(`/api/workspaces/${workspaceId()}/skills/${skillId}/files/${fileId}`, {
      method: "DELETE",
    });
    console.log(`Skill file deleted: ${fileId}`);
  });
