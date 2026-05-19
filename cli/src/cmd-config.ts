import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";

const AUTH_PATH = join(homedir(), ".agora", "auth.json");

export type AuthFile = {
  token?: string;
  serverUrl?: string;
  workspaceId?: string;
};

export async function loadAuth(): Promise<AuthFile> {
  try {
    const raw = await readFile(AUTH_PATH, "utf-8");
    return JSON.parse(raw) as AuthFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function saveAuth(next: AuthFile): Promise<void> {
  await mkdir(dirname(AUTH_PATH), { recursive: true });
  await writeFile(AUTH_PATH, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
}

export const configCmd = new Command("config").description(
  "Manage Agora CLI configuration (~/.agora/auth.json)",
);

configCmd
  .command("show")
  .description("Show current CLI configuration (token redacted)")
  .action(async () => {
    const cfg = await loadAuth();
    const display = {
      token: cfg.token ? `${cfg.token.slice(0, 8)}...` : "(not set)",
      serverUrl: cfg.serverUrl ?? "(not set)",
      workspaceId: cfg.workspaceId ?? "(not set)",
    };
    console.log(`Config file: ${AUTH_PATH}`);
    console.log(`token:       ${display.token}`);
    console.log(`serverUrl:   ${display.serverUrl}`);
    console.log(`workspaceId: ${display.workspaceId}`);
  });

configCmd
  .command("set <key> <value>")
  .description("Set a CLI configuration value (supported keys: serverUrl, workspaceId)")
  .action(async (key: string, value: string) => {
    const cfg = await loadAuth();
    switch (key) {
      case "serverUrl":
        cfg.serverUrl = value;
        break;
      case "workspaceId":
        cfg.workspaceId = value;
        break;
      default:
        throw new Error(`unknown config key "${key}" (supported: serverUrl, workspaceId)`);
    }
    await saveAuth(cfg);
    console.error(`Set ${key} = ${value}`);
  });
