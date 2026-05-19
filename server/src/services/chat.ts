import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { agents, chatMessages, chatSessions } from "../db/schema/index";
import { enqueueTaskForChat } from "../lib/enqueue";
import { broadcastWorkspace } from "../lib/ws-hub";

export interface SendChatArgs {
  workspaceId: string;
  sessionId: string;
  userId: string;
  content: string;
}

const HISTORY_LIMIT = 20;

// Chat is now Agora's primary intake surface: there are no `+ New Issue`
// buttons or quick-create modals anywhere in the UI, every issue starts
// here. So the chat agent isn't a chatbot — it's an orchestrator. This
// prelude teaches it the four behaviours we need:
//
// 1. Try simple things in-thread (answer questions, fetch URLs, do math).
// 2. For real work, propose a plan first — what the parent issue should
//    say, what subtasks split out, who from the Team Agents roster
//    should own each subtask. Wait for the user's confirmation.
// 3. Only after explicit user confirmation, run `agora issue create` for
//    the parent + each subtask. Use `--parent <id>` for the children and
//    `--assignee-kind agent --assignee-id <id>` to delegate.
// 4. Reply with a one-line summary of what got filed + who's on it.
//
// Routing is grounded in the Team Agents roster CLAUDE.md ships
// (skills + MCP servers + online/saturated status). The agent reads
// that roster verbatim — we don't need to repeat it here.
const CHAT_ORCHESTRATOR_PRELUDE = [
  "## Your role in this chat",
  "",
  "You are this user's orchestrator. Agora's UI no longer has any 'New",
  "Issue' button or search bar — chat is the only way new work enters",
  "this workspace. So the user expects two distinct kinds of help from",
  "you, and you decide which on each turn:",
  "",
  "**Direct answer.** If the user is asking a question, requesting",
  "information, or doing something that fits in a single chat reply",
  "(check a URL, do a calculation, look something up on the web, look",
  "up an existing issue or agent, etc.), just answer in chat. Don't file",
  "an issue for it.",
  "",
  "**Orchestrate.** If the user is describing real work — a feature, a",
  "bug, a multi-step thing, anything that needs to be tracked or that",
  "needs more than one agent to handle — switch to orchestrator mode:",
  "",
  "1. Read the **Team Agents** section in your CLAUDE.md to see who's",
  "   available, what skills they have (`Skills:`), what MCP servers",
  "   they're wired to (`MCP:`), and their load. Pick assignees",
  "   accordingly — favor agents that are online, not saturated, and",
  "   have skills/MCP matching the subtask. Default to YOURSELF",
  "   (`--assignee-id <your-own-agent-id>`) for any subtask no one else",
  "   is a better fit for.",
  "2. Draft a plan and **post it in chat for the user to confirm**:",
  "   - One **parent issue** (title + 1–3 line description) representing",
  "     the whole ask.",
  "   - 1–N **subtasks** if decomposition helps; for each give title +",
  "     1-line description + which agent will own it (use the agent's",
  "     name, not its UUID).",
  "   - If the work is small enough to be a single issue, propose just",
  "     the parent and skip subtasks.",
  "3. **Express dependencies in the plan.** Subtasks default to parallel.",
  "   Mark serial chains explicitly with `(depends on X)` next to the",
  "   subtask label. The format the user expects:",
  "",
  "   ```",
  "   方案",
  "     父 issue: 给登录加 SSO                  [我自己]",
  "",
  "     并行 (一开始就能跑):",
  "       A. 注册 OAuth 应用                   [Backend Bob]",
  "       B. 设计 SSO 登录按钮 mock           [Frontend Charlie]",
  "",
  "     串行:",
  "       C. 后端集成 supabase-js              [Backend Bob]      (depends on A)",
  "       D. 前端登录按钮接线                  [Frontend Charlie] (depends on B, C)",
  "       E. 写 e2e 测试                       [QA Dora]          (depends on D)",
  "",
  "   ok 吗?",
  "   ```",
  "",
  "4. **Wait for the user to confirm.** Don't run any `agora issue` or",
  "   `agora dependencies` command yet. Acceptance signals: 'ok', 'yes',",
  "   'go', 'confirm', '可以', '好的', '行', '建吧'. Pushback signals",
  "   (any): revise the plan, ask one targeted question, propose again.",
  "",
  "5. **After confirmation, file the work in two passes:**",
  "   - Pass A: `agora issue create` for the parent (capture id), then",
  "     once per subtask with `--parent <parent-id> --assignee-kind agent",
  "     --assignee-id <id>`. Use `--description-stdin` + HEREDOC for any",
  "     multi-line description. Capture each child's returned id.",
  "   - Pass B: for every `(depends on X)` in your plan, run",
  "     `agora dependencies add <child-id> --target <X-id> --kind blocks`.",
  "     This is what makes the workflow agents wait for each other.",
  "",
  "6. **Reply in chat with one short line per filed issue:**",
  "   `[I-12] Parent title — assigned to <name>` then subtask lines",
  "   (annotate with `→ blocked by [I-13]` where applicable). No",
  "   commentary, no follow-up tool calls beyond the creates.",
  "",
  "When the user later asks 'how's it going', you can `agora issue get",
  "<id> --output json` and report status. Issues that have been unblocked",
  "(blocker resolved → server flipped them from `blocked` to `todo` and",
  "re-enqueued the assignee) will show up as in flight on their own.",
  "",
  "If the user comes back later asking 'how's it going', look up the",
  "issues you filed (`agora issue get <id> --output json`) and answer.",
  "",
].join("\n");

/** Build the prompt that the daemon will hand to the CLI for a chat task.
 *  Last `HISTORY_LIMIT` messages are flattened as `User:` / `Agent:` lines so
 *  fresh CLI sessions still get conversational context.
 *
 *  Trailing "REPLY:" sentinel matters: without it, Claude tends to mimic the
 *  preceding role-prefix pattern and echo `User: <last_msg>\n\nReply to the
 *  user.` into its output. The explicit trailer + instruction nips that. */
async function buildChatPrompt(sessionId: string, agentInstructions: string): Promise<string> {
  const recent = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatSessionId, sessionId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_LIMIT);
  const transcript = recent
    .reverse()
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n\n");
  const trailer =
    "Respond to the most recent User message above as the Agent. " +
    "Output ONLY your reply text — do not prefix it with `Agent:`, do not " +
    "echo the conversation history, do not write anything from the User's " +
    "perspective.";
  return [
    CHAT_ORCHESTRATOR_PRELUDE,
    agentInstructions,
    "",
    "Conversation so far:",
    transcript,
    "",
    trailer,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function sendChatMessage(args: SendChatArgs) {
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, args.sessionId), eq(chatSessions.workspaceId, args.workspaceId)),
  });
  if (!session) throw new Error("chat session not found");
  if (session.creatorId !== args.userId) throw new Error("not your chat session");
  if (session.status !== "active") throw new Error("chat session is archived");

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, session.agentId) });
  if (!agent) throw new Error("agent missing");
  if (!agent.runtimeId) throw new Error("agent has no runtime");

  // Insert the user message first so the daemon can read it as part of history.
  const [msg] = await db
    .insert(chatMessages)
    .values({
      chatSessionId: session.id,
      role: "user",
      content: args.content,
    })
    .returning();
  if (!msg) throw new Error("failed to create chat message");

  const prompt = await buildChatPrompt(session.id, agent.instructions);

  const task = await enqueueTaskForChat({
    workspaceId: session.workspaceId,
    chatSessionId: session.id,
    agentId: agent.id,
    runtimeId: agent.runtimeId,
    prompt,
  });

  // Stamp the message with its task id so the UI can cross-link.
  await db.update(chatMessages).set({ taskId: task.id }).where(eq(chatMessages.id, msg.id));

  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, session.id));

  broadcastWorkspace(session.workspaceId, {
    type: "chat.message_added",
    data: { sessionId: session.id },
  });

  return { message: { ...msg, taskId: task.id }, taskId: task.id };
}

/** Called by the daemon's `complete` handler when the finished task is a chat
 *  task and the runner returned `result.reply`. */
export async function appendAssistantReply(args: {
  workspaceId: string;
  sessionId: string;
  taskId: string;
  content: string;
  elapsedMs: number | null;
}) {
  await db.insert(chatMessages).values({
    chatSessionId: args.sessionId,
    role: "assistant",
    content: args.content,
    taskId: args.taskId,
    elapsedMs: args.elapsedMs,
  });
  broadcastWorkspace(args.workspaceId, {
    type: "chat.message_added",
    data: { sessionId: args.sessionId },
  });
}

/** Called by the daemon's `fail` handler for chat tasks: synthesize an
 *  assistant message marked with failureReason so the UI can render the
 *  error bubble instead of leaving the user staring at a hung input. */
export async function appendAssistantFailure(args: {
  workspaceId: string;
  sessionId: string;
  taskId: string;
  failureReason: string;
  errorMessage: string;
}) {
  await db.insert(chatMessages).values({
    chatSessionId: args.sessionId,
    role: "assistant",
    content: args.errorMessage,
    taskId: args.taskId,
    failureReason: args.failureReason,
  });
  broadcastWorkspace(args.workspaceId, {
    type: "chat.message_added",
    data: { sessionId: args.sessionId },
  });
}

export async function listMessages(workspaceId: string, sessionId: string, userId: string) {
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.workspaceId, workspaceId)),
  });
  if (!session) throw new Error("chat session not found");
  if (session.creatorId !== userId) throw new Error("not your chat session");
  return await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatSessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));
}
