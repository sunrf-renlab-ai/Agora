import type { DetectedCli } from "./detect";

export interface RegisterArgs {
  serverUrl: string;
  machineToken: string;
  name: string;
  daemonVersion: string;
  detectedClis: DetectedCli[];
  runtimeInfo: Record<string, unknown>;
}

export async function registerWithServer(args: RegisterArgs): Promise<{ runtimeId: string }> {
  const res = await fetch(`${args.serverUrl}/api/daemon/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.machineToken}`,
    },
    body: JSON.stringify({
      name: args.name,
      daemonVersion: args.daemonVersion,
      detectedClis: args.detectedClis,
      runtimeInfo: args.runtimeInfo,
    }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { runtimeId: string };
}
