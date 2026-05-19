import { describe, expect, it } from "bun:test";
import type { SkillSyncFrame } from "@agora/shared";
import { daemonHub } from "./daemon-hub";

describe("daemonHub", () => {
  it("stores online sockets per runtime and notifies them", () => {
    const sent: string[] = [];
    const fakeWs = {
      readyState: 1,
      send: (s: string) => sent.push(s),
    } as unknown as WebSocket;
    daemonHub.attach("rt-1", fakeWs);
    daemonHub.notifyTaskAvailable("rt-1", "task-1");
    expect(sent.length).toBe(1);
    expect(JSON.parse(sent[0] as string)).toMatchObject({
      type: "task.available",
      runtimeId: "rt-1",
      taskId: "task-1",
    });
    expect(daemonHub.isOnline("rt-1")).toBe(true);
    daemonHub.detach("rt-1", fakeWs);
    expect(daemonHub.isOnline("rt-1")).toBe(false);
  });
});

describe("daemonHub.notifySkillSync", () => {
  it("sends a skill.sync frame to all sockets attached to the runtime", () => {
    const sent: string[] = [];
    const fakeWs = { readyState: 1, send: (s: string) => sent.push(s) };
    daemonHub.attach("rt-1", fakeWs);
    const payload: Omit<SkillSyncFrame, "type" | "runtimeId"> = {
      bundles: [{ skillId: "s-1", name: "demo", description: "", content: "# hi", files: [] }],
      removeNames: [],
    };
    daemonHub.notifySkillSync("rt-1", payload);
    daemonHub.detach("rt-1", fakeWs);
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0] as string);
    expect(frame.type).toBe("skill.sync");
    expect(frame.runtimeId).toBe("rt-1");
    expect(frame.bundles[0].name).toBe("demo");
  });

  it("notifySkillDiscover sends a skill.discover frame with kind+requestId", () => {
    const sent: string[] = [];
    const fakeWs = { readyState: 1, send: (s: string) => sent.push(s) };
    daemonHub.attach("rt-2", fakeWs);
    daemonHub.notifySkillDiscover("rt-2", "req-1", "list");
    daemonHub.detach("rt-2", fakeWs);
    const frame = JSON.parse(sent[0] as string);
    expect(frame.type).toBe("skill.discover");
    expect(frame.requestId).toBe("req-1");
    expect(frame.kind).toBe("list");
  });

  it("notifySkillDiscover passes skillKey when kind=import", () => {
    const sent: string[] = [];
    const fakeWs = { readyState: 1, send: (s: string) => sent.push(s) };
    daemonHub.attach("rt-3", fakeWs);
    daemonHub.notifySkillDiscover("rt-3", "req-2", "import", "my-skill");
    daemonHub.detach("rt-3", fakeWs);
    const frame = JSON.parse(sent[0] as string);
    expect(frame.kind).toBe("import");
    expect(frame.skillKey).toBe("my-skill");
  });
});

describe("daemonHub.notifySkillSync (push helper coverage)", () => {
  it("sends skill.sync frame to attached sockets", () => {
    const sent: string[] = [];
    const fakeWs = {
      readyState: 1,
      send: (s: string) => sent.push(s),
    } as unknown as WebSocket;
    daemonHub.attach("rt-skill", fakeWs);
    daemonHub.notifySkillSync("rt-skill", {
      bundles: [
        {
          skillId: "s-fmt",
          name: "fmt",
          description: "",
          content: "do fmt",
          files: [{ path: "SKILL.md", content: "do fmt" }],
        },
      ],
      removeNames: ["old"],
    });
    expect(sent.length).toBe(1);
    const f = JSON.parse(sent[0] as string);
    expect(f.type).toBe("skill.sync");
    expect(f.bundles?.[0]?.name).toBe("fmt");
    expect(f.removeNames).toEqual(["old"]);
    daemonHub.detach("rt-skill", fakeWs);
  });

  it("no-ops when runtime has no attached sockets", () => {
    expect(() =>
      daemonHub.notifySkillSync("rt-missing", {
        bundles: [],
        removeNames: [],
      }),
    ).not.toThrow();
  });
});

describe("daemonHub.notifySkillDiscover (push helper coverage)", () => {
  it("sends skill.discover frame", () => {
    const sent: string[] = [];
    const fakeWs = {
      readyState: 1,
      send: (s: string) => sent.push(s),
    } as unknown as WebSocket;
    daemonHub.attach("rt-disc", fakeWs);
    const delivered = daemonHub.notifySkillDiscover("rt-disc", "req-1", "list");
    expect(delivered).toBe(true);
    expect(sent.length).toBe(1);
    const f = JSON.parse(sent[0] as string);
    expect(f.type).toBe("skill.discover");
    expect(f.requestId).toBe("req-1");
    expect(f.kind).toBe("list");
    daemonHub.detach("rt-disc", fakeWs);
  });

  it("returns false when runtime has no online sockets", () => {
    const delivered = daemonHub.notifySkillDiscover("rt-offline", "req-x", "list");
    expect(delivered).toBe(false);
  });
});
