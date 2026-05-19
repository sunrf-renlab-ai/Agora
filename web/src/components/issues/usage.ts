import type { AgentTask } from "@agora/shared";

interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  runs: number;
}

/**
 * Sum `task.usage.{input,output,cache}Tokens` across a list of tasks for
 * the right-sidebar agent stats. Tolerant of nulls and missing keys —
 * the daemon stores usage verbatim from the CLI tail and some legacy
 * runs predate the field. `runs` is the count of tasks regardless of
 * whether usage was reported.
 */
export function aggregateUsage(tasks: Array<Pick<AgentTask, "usage" | "status">>): UsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  for (const task of tasks) {
    const u = (task.usage ?? {}) as Record<string, unknown>;
    inputTokens += typeof u.inputTokens === "number" ? u.inputTokens : 0;
    outputTokens += typeof u.outputTokens === "number" ? u.outputTokens : 0;
    cacheTokens += typeof u.cacheTokens === "number" ? u.cacheTokens : 0;
  }
  return { inputTokens, outputTokens, cacheTokens, runs: tasks.length };
}
