import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";

const app = new Hono();

// Render hits /healthz as the container liveness probe. We ping the
// database so an unreachable Supabase shows up as a failing health
// check rather than a silent half-up service.
//
// Response shape preserves `status: "ok"` for the existing test and
// adds `ok` + `db` for clients (Render's UI, future external monitors)
// that key on the documented contract.
app.get("/healthz", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", ok: true, db: "up" });
  } catch (err) {
    console.error("[healthz] db ping failed:", err);
    return c.json({ status: "error", ok: false, db: "down" }, 503);
  }
});

export default app;
