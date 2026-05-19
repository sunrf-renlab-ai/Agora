import { describe, expect, it } from "bun:test";
import cliDistRouter from "./cli-dist";

describe("GET /api/cli/install.ps1 — Windows installer renderer", () => {
  it("returns a PowerShell script with the right Content-Type", async () => {
    const res = await cliDistRouter.request("/api/cli/install.ps1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    // Shape: the PS1 must reference the iwr|iex usage and the
    // windows-x64 target. Bare-bones smoke that we wired the renderer
    // up and didn't ship an empty body or the install.sh template.
    expect(body).toContain("iwr -useb");
    expect(body).toContain("windows-x64");
    expect(body).toContain("schtasks.exe");
    expect(body).toContain("Install-Service");
  });

  it("embeds a pair code when ?code= is present and pass-throughs valid chars", async () => {
    const res = await cliDistRouter.request("/api/cli/install.ps1?code=ABC123-XYZ");
    const body = await res.text();
    expect(body).toContain('$PairCode  = "ABC123-XYZ"');
  });

  it("scrubs an invalid pair code to empty rather than echoing attacker input", async () => {
    // The renderer accepts [A-Z0-9-]{0,32}; anything else gets replaced
    // with "" so we don't shell-interpolate attacker-controlled bytes.
    const res = await cliDistRouter.request(
      "/api/cli/install.ps1?code=%22%3E%3Bevil",
    );
    const body = await res.text();
    expect(body).toContain('$PairCode  = ""');
    expect(body).not.toContain("evil");
  });
});
