import type { agents } from "../db/schema/index";

/**
 * Who may enqueue a task on an agent.
 *
 * Routing work to an agent runs it on that agent owner's machine, using
 * their compute and model credentials. So a human may only invoke an
 * agent they own; routing work across members is an AI decision — the
 * orchestrator (a task-JWT-authenticated agent CLI) may invoke any agent.
 *
 * `isAgentCall` is true when the request carries `taskAuth` — i.e. it's a
 * daemon-spawned agent acting, not a human.
 */
export function canInvokeAgent(
  agent: Pick<typeof agents.$inferSelect, "ownerId">,
  userId: string,
  isAgentCall: boolean,
): boolean {
  return isAgentCall || agent.ownerId === userId;
}

export const CROSS_MEMBER_INVOKE_MESSAGE =
  "You can only assign work to your own agents — cross-member routing is handled by the orchestrator.";
