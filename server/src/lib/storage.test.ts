import { describe, expect, it } from "bun:test";
import { buildStorageKey } from "./storage";

describe("storage", () => {
  it("buildStorageKey lays out workspace/owner/random/filename", () => {
    const key = buildStorageKey("ws-1", "issue", "iss-1", "shot.png");
    expect(key.startsWith("ws-1/issue/iss-1/")).toBe(true);
    expect(key.endsWith("/shot.png")).toBe(true);
    expect(key.length).toBeGreaterThan("ws-1/issue/iss-1/x/shot.png".length);
  });

  it("buildStorageKey sanitizes filename (no slashes, no '..')", () => {
    const key = buildStorageKey("ws", "comment", "c", "../../etc/passwd");
    expect(key).not.toContain("..");
    expect(key.split("/").pop()).toBe("etc_passwd");
  });
});
