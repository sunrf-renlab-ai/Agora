import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { autopilotTriggers, autopilots } from "../db/schema/index";
import { jsonError } from "../lib/errors";
import { hashWebhookToken } from "../lib/webhook-token";
import { dispatchAutopilot } from "../services/autopilot";

const app = new Hono();

/**
 * Webhook entrypoint. Auth model: bearer-style — the URL token IS the secret.
 * Stored as sha256 hash; cleartext shown ONCE on trigger creation. Same model
 * as machine tokens. (DEFER: HMAC body-signature scheme — see plan footer.)
 *
 * No auth middleware: this endpoint is intended to be called by external
 * services (CI, GitHub webhooks, etc.) that have only the token, not a user JWT.
 */
app.post("/api/autopilot/webhook/:token", async (c) => {
  const cleartext = c.req.param("token");
  const hash = hashWebhookToken(cleartext);
  const trigger = await db.query.autopilotTriggers.findFirst({
    where: eq(autopilotTriggers.webhookTokenHash, hash),
  });
  if (!trigger || trigger.kind !== "webhook") return jsonError(c, 401, "unknown webhook token");
  if (!trigger.enabled) return jsonError(c, 403, "trigger is disabled");

  const ap = await db.query.autopilots.findFirst({
    where: eq(autopilots.id, trigger.autopilotId),
  });
  if (!ap) return jsonError(c, 404, "autopilot not found");
  if (ap.status !== "active") return jsonError(c, 422, "autopilot is not active");

  // Attempt to parse JSON body; tolerate empty / non-JSON.
  let payload: unknown = null;
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      payload = await c.req.json();
    } catch {
      payload = null;
    }
  }

  const run = await dispatchAutopilot(ap, {
    source: "webhook",
    triggerId: trigger.id,
    triggerPayload: payload,
  });

  // Also stamp last_fired_at on the trigger.
  await db
    .update(autopilotTriggers)
    .set({ lastFiredAt: new Date(), updatedAt: new Date() })
    .where(eq(autopilotTriggers.id, trigger.id));

  return c.json({
    runId: run.id,
    autopilotId: ap.id,
    status: run.status,
  });
});

export default app;
