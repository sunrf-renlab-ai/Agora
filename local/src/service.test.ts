import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { detectSupervisor, servicePaths } from "./service";

describe("servicePaths", () => {
  test("derives the install.sh-matching paths under the home dir", () => {
    const p = servicePaths();
    const home = homedir();
    expect(p.label).toBe("com.agora.daemon");
    expect(p.unitName).toBe("agora-daemon.service");
    expect(p.plist).toBe(`${home}/Library/LaunchAgents/com.agora.daemon.plist`);
    expect(p.systemdUnit).toBe(`${home}/.config/systemd/user/agora-daemon.service`);
    expect(p.logFile).toBe(`${home}/.agora/daemon.log`);
    expect(p.configDir).toBe(`${home}/.agora`);
    expect(p.binPath).toBe(process.execPath);
  });
});

describe("detectSupervisor", () => {
  test("returns the supervisor matching this platform", () => {
    const sup = detectSupervisor();
    expect(["launchd", "systemd", "none"]).toContain(sup);
    if (process.platform === "darwin") expect(sup).toBe("launchd");
    if (process.platform !== "darwin" && process.platform !== "linux") {
      expect(sup).toBe("none");
    }
  });
});
