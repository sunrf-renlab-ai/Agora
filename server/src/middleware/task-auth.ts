import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/client";
import { agentTaskQueue, agents } from "../db/schema/index";
import { jsonError } from "../lib/errors";
import { verifyTaskJwt } from "../lib/task-jwt";

declare module "hono" {
  interface ContextVariableMap {
    taskId: string;
    agentId: string;
    cliWorkspaceId: string;
  }
}

const SECRET = process.env.TASK_JWT_SECRET ?? "dev-task-secret-change-me!!!!!!!!";

export const taskAuthMiddleware = createMiddleware(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return jsonError(c, 401, "Missing task token");
  let claims: Awaited<ReturnType<typeof verifyTaskJwt>>;
  try {
    claims = await verifyTaskJwt(auth.slice(7), SECRET);
  } catch {
    return jsonError(c, 401, "Invalid task token");
  }
  const task = await db.query.agentTaskQueue.findFirst({
    where: and(eq(agentTaskQueue.id, claims.taskId), eq(agentTaskQueue.agentId, claims.agentId)),
  });
  if (
    !task ||
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "cancelled"
  ) {
    return jsonError(c, 401, "Task token no longer valid");
  }
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, claims.agentId) });
  if (!agent) return jsonError(c, 401, "Agent missing");
  c.set("taskId", claims.taskId);
  c.set("agentId", claims.agentId);
  c.set("cliWorkspaceId", claims.workspaceId);
  c.set("workspaceId", claims.workspaceId);
  c.set("memberRole", "member");
  await next();
});
