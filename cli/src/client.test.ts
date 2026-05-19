import { describe, expect, it } from "bun:test";

describe("cli client", () => {
  it("imports without throwing", async () => {
    process.env.AGORA_REQUIRE_AUTH = "0";
    const mod = await import("./client");
    expect(typeof mod.api).toBe("function");
  });
});
