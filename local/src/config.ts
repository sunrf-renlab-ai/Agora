import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DaemonConfig {
  serverUrl: string;
  workspaceId: string;
  runtimeId: string;
  machineToken: string;
}

function resolveConfigPath(): string {
  return process.env.AGORAD_CONFIG ?? join(homedir(), ".agora", "daemon.json");
}

export async function loadConfig(): Promise<DaemonConfig | null> {
  try {
    const raw = await readFile(resolveConfigPath(), "utf8");
    return JSON.parse(raw) as DaemonConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(cfg: DaemonConfig): Promise<void> {
  const path = resolveConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function configPath(): string {
  return resolveConfigPath();
}
