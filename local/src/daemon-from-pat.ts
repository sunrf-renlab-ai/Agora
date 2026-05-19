import { hostname } from "node:os";
import { type DaemonConfig, saveConfig } from "./config";
import { runDaemon } from "./daemon";
import { detectClis } from "./detect";

interface Workspace {
  id: string;
  slug: string;
  name: string;
}

interface ProvisionResponse {
  runtimeId: string;
  machineToken: string;
}

/**
 * PAT-driven daemon start.
 *
 * Replaces the old setup → save UUIDs → start flow. The user only ever
 * holds a PAT (from `agorad login`). On start we:
 *   1. List the PAT owner's workspaces
 *   2. Pick the first one (TODO: support multi-workspace)
 *   3. Provision a runtime + machine token for this device in that
 *      workspace
 *   4. Save the resulting DaemonConfig and hand off to the existing
 *      runDaemon loop, which already knows how to keep one connection alive
 *
 * Multi-workspace users: this picks workspace[0]. A future iteration can
 * fan out one daemon connection per workspace; the existing daemon loop is
 * a single-runtime singleton today.
 */
export async function startDaemonFromPat(args: {
  serverUrl: string;
  token: string;
}): Promise<void> {
  const { serverUrl, token } = args;
  const headers = { Authorization: `Bearer ${token}` };

  // Step 1: list workspaces
  const wsRes = await fetch(`${serverUrl}/api/workspaces`, { headers });
  if (!wsRes.ok) {
    console.error(`[agorad] Could not list workspaces: ${wsRes.status} ${await wsRes.text()}`);
    process.exit(1);
  }
  const workspaces = (await wsRes.json()) as Workspace[];
  if (workspaces.length === 0) {
    console.error(
      "[agorad] You're not a member of any workspaces yet. Create one in the web app first.",
    );
    process.exit(1);
  }
  const ws = workspaces[0];
  if (!ws) {
    console.error("[agorad] No workspaces returned");
    process.exit(1);
  }
  if (workspaces.length > 1) {
    console.warn(
      `[agorad] You have ${workspaces.length} workspaces. Connecting to "${ws.name}". Multi-workspace support coming.`,
    );
  }

  // Step 2: provision a runtime in that workspace
  const detected = detectClis();
  const runtimeName = detected[0] ? `${hostname()} (${detected[0].kind})` : hostname();
  const provRes = await fetch(`${serverUrl}/api/workspaces/${ws.id}/runtimes/provision`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "X-Workspace-ID": ws.id },
    body: JSON.stringify({ name: runtimeName }),
  });
  if (!provRes.ok) {
    console.error(
      `[agorad] Could not provision runtime: ${provRes.status} ${await provRes.text()}`,
    );
    process.exit(1);
  }
  const prov = (await provRes.json()) as ProvisionResponse;

  // Step 3: persist + start the daemon loop
  const cfg: DaemonConfig = {
    serverUrl,
    workspaceId: ws.id,
    runtimeId: prov.runtimeId,
    machineToken: prov.machineToken,
  };
  await saveConfig(cfg);
  console.log(`[agorad] Connected to workspace "${ws.name}". Runtime: ${prov.runtimeId}`);
  await runDaemon(cfg);
}
