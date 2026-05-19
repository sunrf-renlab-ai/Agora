import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { configPath, saveConfig } from "./config";
import { detectClis } from "./detect";

type Prompter = (question: string) => Promise<string>;

export interface SetupArgs {
  serverUrl?: string;
  workspaceId?: string;
  machineToken?: string;
  runtimeId?: string;
  interactive?: boolean;
  prompt?: Prompter;
}

function defaultPrompter(): { ask: Prompter; close: () => void } {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    ask: async (q: string) => {
      const a = await rl.question(q);
      return a.trim();
    },
    close: () => rl.close(),
  };
}

export async function runSetup(args: SetupArgs): Promise<void> {
  const interactive =
    args.interactive ??
    !(args.serverUrl && args.workspaceId && args.machineToken && args.runtimeId);

  let ask: Prompter;
  let close: (() => void) | null = null;
  if (args.prompt) {
    ask = args.prompt;
  } else if (interactive) {
    const p = defaultPrompter();
    ask = p.ask;
    close = p.close;
  } else {
    ask = async () => "";
  }

  try {
    if (interactive) {
      console.log("Welcome to Agora. We'll save your daemon config to:", configPath());
      const detected = detectClis();
      if (detected.length === 0) {
        console.warn(
          "No supported agent CLIs detected on PATH (claude, codex, gemini). You can still continue and install one later.",
        );
      } else {
        console.log("Detected CLIs:", detected.map((c) => `${c.kind}@${c.version}`).join(", "));
      }
    }

    const serverUrl =
      args.serverUrl ??
      ((await ask("Server URL [http://localhost:8080]: ")) || "http://localhost:8080");
    const workspaceId = args.workspaceId ?? (await ask("Workspace ID: "));
    const runtimeId = args.runtimeId ?? (await ask("Runtime ID: "));
    const machineToken = args.machineToken ?? (await ask("Machine token: "));

    if (!workspaceId || !runtimeId || !machineToken) {
      throw new Error("setup: workspaceId, runtimeId, and machineToken are required");
    }

    await saveConfig({ serverUrl, workspaceId, runtimeId, machineToken });
    console.log(`Saved config to ${configPath()}.`);
    if (interactive) {
      console.log("Next: run `agorad daemon start` to bring this runtime online.");
    }
  } finally {
    if (close) close();
  }
}
