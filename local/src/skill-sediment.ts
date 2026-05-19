import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const MAX_SKILL_BYTES = 1 << 20; // 1 MiB

export interface SedimentCandidate {
  path: string;
  content: string;
  mtime: Date;
}

/**
 * Look for a SKILL.md at the root of the agent's working directory whose
 * mtime is strictly later than `baseline`. The baseline must be captured
 * BEFORE the agent process spawns so a leftover SKILL.md from a previous
 * rerun on the same persistent workdir doesn't get re-sedimented.
 *
 * Returns null whenever the file is absent, stale, or oversized. Never
 * throws — sedimentation is best-effort and must not break a healthy
 * task completion.
 */
export async function findSedimentCandidate(
  workDir: string,
  baseline: Date,
): Promise<SedimentCandidate | null> {
  const file = join(workDir, "SKILL.md");
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(file);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  if (st.mtime.getTime() <= baseline.getTime()) return null;
  if (st.size > MAX_SKILL_BYTES) {
    console.warn(
      `[agorad] sediment: ${file} exceeds ${MAX_SKILL_BYTES} bytes (${st.size}); skipping.`,
    );
    return null;
  }
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch (e) {
    console.warn(`[agorad] sediment: read failed for ${file}: ${(e as Error).message}`);
    return null;
  }
  return { path: file, content, mtime: st.mtime };
}

export interface PostSedimentArgs {
  serverUrl: string;
  taskToken: string;
  taskId: string;
  content: string;
}

/**
 * Push a discovered SKILL.md content to the server's daemon-only sediment
 * endpoint. Best-effort: logs and swallows errors so a transient 500
 * doesn't fail the surrounding task.
 */
export async function postSedimentSkill(args: PostSedimentArgs): Promise<void> {
  const url = `${args.serverUrl}/api/daemon/tasks/${args.taskId}/sediment-skill`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.taskToken}`,
      },
      body: JSON.stringify({ content: args.content }),
    });
    if (!r.ok) {
      console.warn(`[agorad] sediment: server replied ${r.status} ${await r.text()}`);
    }
  } catch (e) {
    console.warn(`[agorad] sediment: POST failed: ${(e as Error).message}`);
  }
}
