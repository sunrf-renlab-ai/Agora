import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface SessionMap {
  [agentIssueKey: string]: { sessionId: string; workDir: string };
}

const SESSIONS_PATH = process.env.AGORAD_SESSIONS ?? join(homedir(), ".agora", "sessions.json");

function key(agentId: string, issueId: string | null) {
  return `${agentId}:${issueId ?? "_"}`;
}

export async function loadSessions(): Promise<SessionMap> {
  try {
    const raw = await readFile(SESSIONS_PATH, "utf8");
    return JSON.parse(raw) as SessionMap;
  } catch {
    return {};
  }
}

export async function saveSession(
  agentId: string,
  issueId: string | null,
  sessionId: string,
  workDir: string,
) {
  const all = await loadSessions();
  all[key(agentId, issueId)] = { sessionId, workDir };
  await mkdir(dirname(SESSIONS_PATH), { recursive: true });
  await writeFile(SESSIONS_PATH, JSON.stringify(all, null, 2), { mode: 0o600 });
}

export async function getSession(agentId: string, issueId: string | null) {
  const all = await loadSessions();
  return all[key(agentId, issueId)] ?? null;
}
