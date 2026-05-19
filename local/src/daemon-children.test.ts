import { expect, it } from "bun:test";
import { ChildTracker, killAllChildren } from "./daemon-children";

it("tracks PIDs and kills them on shutdown", async () => {
  const tracker = new ChildTracker();
  const proc = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
  tracker.add(proc.pid);
  expect(tracker.size()).toBe(1);
  await killAllChildren(tracker, 1_000);
  // After SIGKILL fallback the process MUST be gone.
  const exitCode = await proc.exited;
  expect(typeof exitCode).toBe("number");
  expect(tracker.size()).toBe(0);
});

it("removes a PID when the child exits naturally", () => {
  const tracker = new ChildTracker();
  tracker.add(123);
  tracker.add(456);
  tracker.remove(123);
  expect(tracker.size()).toBe(1);
});
