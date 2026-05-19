import { describe, expect, it } from "bun:test";
import daemonWsRouter from "./daemon-ws";

describe("daemon WS endpoint", () => {
  it("endpoint is registered", () => {
    // Verify the router has been created and the endpoint exists
    expect(daemonWsRouter).toBeDefined();
    expect(daemonWsRouter.routes).toBeDefined();
    const hasWsRoute = daemonWsRouter.routes.some((route) => route.path.includes("/api/daemon/ws"));
    expect(hasWsRoute).toBe(true);
  });
});
