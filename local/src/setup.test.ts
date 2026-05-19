import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetup } from "./setup";

let tmpHome: string;
let originalConfig: string | undefined;
let configFile: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "agora-setup-test-"));
  originalConfig = process.env.AGORAD_CONFIG;
  configFile = join(tmpHome, "daemon.json");
  process.env.AGORAD_CONFIG = configFile;
});

afterEach(() => {
  if (originalConfig === undefined) process.env.AGORAD_CONFIG = undefined;
  else process.env.AGORAD_CONFIG = originalConfig;
});

it("non-interactive: writes config when all four args provided", async () => {
  await runSetup({
    serverUrl: "http://localhost:8080",
    workspaceId: "ws-1",
    runtimeId: "rt-1",
    machineToken: "mt-1",
    interactive: false,
  });
  const written = JSON.parse(await Bun.file(configFile).text());
  expect(written.serverUrl).toBe("http://localhost:8080");
  expect(written.runtimeId).toBe("rt-1");
});

it("interactive: prompts for missing args via injected reader", async () => {
  const answers = ["http://localhost:8080", "ws-1", "rt-1", "mt-1"];
  await runSetup({
    interactive: true,
    prompt: async (_q: string) => answers.shift() ?? "",
  });
  const written = JSON.parse(await Bun.file(configFile).text());
  expect(written.workspaceId).toBe("ws-1");
});
