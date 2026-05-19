import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/client";
import { runtimes } from "../db/schema/index";
import { jsonError } from "../lib/errors";
import { hashMachineToken } from "../lib/machine-token";

declare module "hono" {
  interface ContextVariableMap {
    runtime: typeof runtimes.$inferSelect;
  }
}

export const daemonAuthMiddleware = createMiddleware(async (c, next) => {
  // /api/daemon/ws authenticates via query string (token=...) inside the WS
  // upgrade handler. Skip Bearer-token check here.
  const path = new URL(c.req.url).pathname;
  if (path === "/api/daemon/ws") {
    await next();
    return;
  }

  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return jsonError(c, 401, "Missing daemon token");
  }
  const token = auth.slice(7);
  const hash = hashMachineToken(token);
  const runtime = await db.query.runtimes.findFirst({ where: eq(runtimes.machineTokenHash, hash) });
  if (!runtime) return jsonError(c, 401, "Invalid daemon token");
  c.set("runtime", runtime);
  await next();
});
