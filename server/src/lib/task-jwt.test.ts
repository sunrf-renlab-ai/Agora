import { describe, expect, it } from "bun:test";
import { mintTaskJwt, verifyTaskJwt } from "./task-jwt";

const SECRET = "phase3-test-secret-32-chars-min!!";

describe("task JWT", () => {
  it("round-trips claims", async () => {
    const token = await mintTaskJwt({ taskId: "t", agentId: "a", workspaceId: "w" }, SECRET, 300);
    const claims = await verifyTaskJwt(token, SECRET);
    expect(claims.taskId).toBe("t");
    expect(claims.agentId).toBe("a");
    expect(claims.workspaceId).toBe("w");
  });

  it("rejects expired tokens", async () => {
    const token = await mintTaskJwt({ taskId: "t", agentId: "a", workspaceId: "w" }, SECRET, -1);
    await expect(verifyTaskJwt(token, SECRET)).rejects.toThrow();
  });
});
