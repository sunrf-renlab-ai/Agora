import { submitFeedbackSchema } from "@agora/shared";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { feedback } from "../db/schema/index";
import { jsonError } from "../lib/errors";
import { authMiddleware, requireUser } from "../middleware/auth";

const app = new Hono();
app.use(authMiddleware);
app.use(requireUser);

const feedbackToJson = (f: typeof feedback.$inferSelect) => ({
  id: f.id,
  userId: f.userId ?? "",
  workspaceId: f.workspaceId,
  kind: f.kind,
  content: f.content,
  metadata: (f.metadata ?? {}) as Record<string, unknown>,
  createdAt: f.createdAt.toISOString(),
});

// GET — list current user's feedback submissions, newest first
app.get("/api/me/feedback", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(feedback)
    .where(eq(feedback.userId, user.id))
    .orderBy(desc(feedback.createdAt));
  return c.json(rows.map(feedbackToJson));
});

// POST — submit feedback. userId comes from auth (never trusted from body).
app.post("/api/feedback", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "Invalid JSON body");
  }
  const parsed = submitFeedbackSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const [row] = await db
    .insert(feedback)
    .values({
      userId: user.id,
      workspaceId: parsed.data.workspaceId ?? null,
      kind: parsed.data.kind,
      content: parsed.data.content,
      metadata: parsed.data.metadata,
    })
    .returning();
  if (!row) return jsonError(c, 500, "Failed to submit feedback");
  return c.json(feedbackToJson(row), 201);
});

export default app;
