const SERVER = process.env.AGORA_SERVER_URL ?? "http://localhost:8080";
const TOKEN = process.env.AGORA_TOKEN ?? "";
const WORKSPACE = process.env.AGORA_WORKSPACE_ID ?? "";

if (process.env.AGORA_REQUIRE_AUTH !== "0") {
  if (!TOKEN) {
    console.error("AGORA_TOKEN env var required (mint by daemon when spawning).");
  }
  if (!WORKSPACE) {
    console.error("AGORA_WORKSPACE_ID env var required.");
  }
}

export async function api(
  path: string,
  init: RequestInit & { workspaceId?: string } = {},
): Promise<unknown> {
  const ws = init.workspaceId ?? WORKSPACE;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
    "X-Workspace-ID": ws,
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${SERVER}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return await res.json();
}

export function workspaceId(): string {
  return WORKSPACE;
}
