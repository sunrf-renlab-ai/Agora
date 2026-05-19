import { Command } from "commander";
import { api, workspaceId } from "./client";

export const chatCmd = new Command("chat").description(
  "Chat sessions and messages with workspace agents",
);

interface ChatSession {
  id: string;
  workspaceId: string;
  agentId: string;
  creatorId: string;
  title: string | null;
  updatedAt: string;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function printSessionsTable(rows: ChatSession[]): void {
  console.log(["ID", "TITLE", "AGENT_ID", "UPDATED"].join("\t"));
  for (const s of rows) {
    console.log(
      [
        shortId(s.id),
        s.title ?? "(untitled)",
        shortId(s.agentId),
        s.updatedAt.slice(0, 10),
      ].join("\t"),
    );
  }
}

function printMessagesTable(rows: ChatMessage[]): void {
  console.log(["ID", "ROLE", "CREATED", "CONTENT_PREVIEW"].join("\t"));
  for (const m of rows) {
    const preview = m.content.slice(0, 80).replace(/\n/g, " ");
    console.log(
      [shortId(m.id), m.role, m.createdAt.slice(0, 16), preview].join("\t"),
    );
  }
}

chatCmd
  .command("list")
  .description("List your chat sessions")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api(
      `/api/workspaces/${workspaceId()}/chat/sessions`,
    )) as ChatSession[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printSessionsTable(rows);
  });

chatCmd
  .command("create")
  .description("Create a new chat session")
  .requiredOption("--agent-id <uuid>", "Agent to chat with")
  .option("--title <title>", "Optional session title")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    const body: Record<string, string> = { agentId: opts.agentId };
    if (opts.title) body.title = opts.title;
    const session = (await api(
      `/api/workspaces/${workspaceId()}/chat/sessions`,
      { method: "POST", body: JSON.stringify(body) },
    )) as ChatSession;
    if (opts.output === "table") {
      printSessionsTable([session]);
      return;
    }
    console.log(JSON.stringify(session, null, 2));
  });

chatCmd
  .command("rename <sessionId>")
  .description("Rename a chat session")
  .requiredOption("--title <title>", "New session title")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (sessionId: string, opts) => {
    const session = (await api(
      `/api/workspaces/${workspaceId()}/chat/sessions/${sessionId}`,
      { method: "PATCH", body: JSON.stringify({ title: opts.title }) },
    )) as ChatSession;
    if (opts.output === "table") {
      printSessionsTable([session]);
      return;
    }
    console.log(JSON.stringify(session, null, 2));
  });

chatCmd
  .command("delete <sessionId>")
  .description("Delete a chat session")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (sessionId: string, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to delete session ${sessionId} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/chat/sessions/${sessionId}`, {
      method: "DELETE",
    });
    if (opts.output === "json") {
      console.log(JSON.stringify({ id: sessionId, deleted: true }, null, 2));
      return;
    }
    console.log(`Session ${sessionId} deleted.`);
  });

chatCmd
  .command("messages <sessionId>")
  .description("List messages in a chat session")
  .option("--limit <n>", "Max messages to return (server-side default applies)", "")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (sessionId: string, opts) => {
    const rows = (await api(
      `/api/workspaces/${workspaceId()}/chat/sessions/${sessionId}/messages`,
    )) as ChatMessage[];
    const limited = opts.limit ? rows.slice(0, Number(opts.limit)) : rows;
    if (opts.output === "json") {
      console.log(JSON.stringify(limited, null, 2));
      return;
    }
    printMessagesTable(limited);
  });

chatCmd
  .command("send <sessionId>")
  .description("Send a message to a chat session")
  .option("--content <text>", "Message text")
  .option("--content-stdin", "Read message from stdin", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (sessionId: string, opts) => {
    let content = opts.content ?? "";
    if (opts.contentStdin) {
      content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", (c) => chunks.push(c));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        process.stdin.on("error", reject);
      });
    }
    if (!content.trim()) {
      console.error("message content is empty — use --content or --content-stdin");
      process.exit(2);
    }
    const r = await api(
      `/api/workspaces/${workspaceId()}/chat/sessions/${sessionId}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
    );
    console.log(JSON.stringify(r, null, 2));
  });
