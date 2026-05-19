import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { api, workspaceId } from "./client";

/**
 * `agora knowledge` — workspace-shared knowledge base CRUD.
 *
 * Designed to be invoked by an agent at the end of a task to "sediment"
 * a non-obvious learning into something the next agent can read in
 * its CLAUDE.md context (the daemon inlines KB docs there).
 *
 * Idiomatic agent flow when wrapping up a task:
 *
 *   agora knowledge create \
 *     --kind decision \
 *     --title "Render preview deploys for PRs" \
 *     --content-stdin <<'DOC'
 *   We use Vercel preview deploys for PRs, not Render. Render free
 *   tier doesn't support preview environments; the cost ($/PR) on the
 *   paid tier was deemed not worth it. Decision date: 2026-05-13.
 *   DOC
 *
 * Use `--kind decision` for irreversible team decisions, `faq` for
 * common questions, `runbook` for operational steps, `onboarding` for
 * setup notes, `general` otherwise.
 */
export const knowledgeCmd = new Command("knowledge")
  .alias("kb")
  .description("Workspace knowledge base — sediment learnings other agents can use");

const KIND_VALUES = ["general", "faq", "decision", "runbook", "onboarding"] as const;

knowledgeCmd
  .command("list")
  .option("--kind <kind>", `filter by kind: ${KIND_VALUES.join(" / ")}`)
  .action(async (opts) => {
    const r = (await api(`/api/workspaces/${workspaceId()}/knowledge`)) as Array<{
      id: string;
      kind: string;
      title: string;
      updatedAt: string;
    }>;
    const filtered = opts.kind ? r.filter((d) => d.kind === opts.kind) : r;
    console.log(JSON.stringify(filtered, null, 2));
  });

knowledgeCmd.command("get <id>").action(async (id) => {
  const r = await api(`/api/workspaces/${workspaceId()}/knowledge/${id}`);
  console.log(JSON.stringify(r, null, 2));
});

async function readContentArg(opts: {
  content?: string;
  contentStdin?: boolean;
  contentFile?: string;
}): Promise<string> {
  // Three input modes mirror `agora issue create` / `comment add` so the
  // agent only learns one pattern. Multi-line content is the common case
  // for KB so we strongly recommend stdin or file.
  if (opts.contentStdin) {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (c) => chunks.push(c));
      process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      process.stdin.on("error", reject);
    });
  }
  if (opts.contentFile) return await readFile(opts.contentFile, "utf8");
  return opts.content ?? "";
}

knowledgeCmd
  .command("create")
  .requiredOption("--title <title>", "short summary, max 200 chars")
  .option("--kind <kind>", `${KIND_VALUES.join(" / ")} (default: general)`, "general")
  .option(
    "--content <markdown>",
    "Inline body. Prefer --content-stdin or --content-file for multi-line.",
  )
  .option("--content-stdin", "Read body from stdin (recommended for HEREDOC)", false)
  .option("--content-file <path>", "Read body from file")
  .action(async (opts) => {
    if (!KIND_VALUES.includes(opts.kind)) {
      console.error(`error: --kind must be one of ${KIND_VALUES.join(" / ")}`);
      process.exit(2);
    }
    const content = await readContentArg(opts);
    const r = await api(`/api/workspaces/${workspaceId()}/knowledge`, {
      method: "POST",
      body: JSON.stringify({ kind: opts.kind, title: opts.title, content }),
    });
    console.log(JSON.stringify(r, null, 2));
  });

knowledgeCmd
  .command("update <id>")
  .option("--kind <kind>", KIND_VALUES.join(" / "))
  .option("--title <title>")
  .option("--content <markdown>")
  .option("--content-stdin", "Read new body from stdin", false)
  .option("--content-file <path>", "Read new body from file")
  .action(async (id, opts) => {
    const body: Record<string, string> = {};
    if (opts.kind) {
      if (!KIND_VALUES.includes(opts.kind)) {
        console.error(`error: --kind must be one of ${KIND_VALUES.join(" / ")}`);
        process.exit(2);
      }
      body.kind = opts.kind;
    }
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.contentStdin || opts.contentFile || opts.content !== undefined) {
      body.content = await readContentArg(opts);
    }
    const r = await api(`/api/workspaces/${workspaceId()}/knowledge/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    console.log(JSON.stringify(r, null, 2));
  });

knowledgeCmd.command("delete <id>").action(async (id) => {
  await api(`/api/workspaces/${workspaceId()}/knowledge/${id}`, { method: "DELETE" });
  console.log("ok");
});
