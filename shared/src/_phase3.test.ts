import { describe, expect, it } from "bun:test";
import { createAgentSchema, daemonRegisterRequestSchema, quickCreateIssueSchema } from "./index";

describe("phase3 zod schemas", () => {
  it("createAgentSchema requires name + cliKind", () => {
    expect(createAgentSchema.safeParse({}).success).toBe(false);
    expect(
      createAgentSchema.safeParse({ name: "alice-agent", cliKind: "claude_code" }).success,
    ).toBe(true);
  });

  it("quickCreateIssueSchema requires agentId + prompt", () => {
    expect(
      quickCreateIssueSchema.safeParse({
        agentId: "00000000-0000-0000-0000-000000000001",
        prompt: "Fix the build",
      }).success,
    ).toBe(true);
  });

  it("daemonRegisterRequestSchema validates detectedClis", () => {
    expect(
      daemonRegisterRequestSchema.safeParse({
        name: "alice-mbp",
        daemonVersion: "0.1.0",
        detectedClis: [{ kind: "claude_code", version: "1.2.3" }],
        runtimeInfo: { os: "darwin" },
      }).success,
    ).toBe(true);
  });
});
