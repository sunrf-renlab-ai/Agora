import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";

const app = new Hono();

app.get("/metrics", async (c) => {
  const taskCounts = await db.execute(sql`
    SELECT status, COUNT(*)::int as count FROM agent_task_queue
    WHERE created_at > now() - interval '24 hours'
    GROUP BY status
  `);
  const counts: Record<string, number> = {};
  for (const row of taskCounts as unknown as Array<{ status: string; count: number }>) {
    counts[row.status] = row.count;
  }

  const runtimes = await db.execute(sql`
    SELECT online, COUNT(*)::int as count FROM runtime GROUP BY online
  `);
  const runtimeCounts: Record<string, number> = {};
  for (const row of runtimes as unknown as Array<{ online: boolean; count: number }>) {
    runtimeCounts[row.online ? "online" : "offline"] = row.count;
  }

  return c.json({
    ts: new Date().toISOString(),
    tasks24h: counts,
    runtimes: runtimeCounts,
  });
});

export default app;
