import { createWorkspaceSchema, updateWorkspaceSchema } from "@agora/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { members, workspaces } from "../db/schema/index";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { hub } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);

function wsToJson(ws: typeof workspaces.$inferSelect) {
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    description: ws.description,
    issuePrefix: ws.issuePrefix,
    settings: ws.settings,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  };
}

app.get("/api/workspaces", async (c) => {
  const user = c.get("user");
  const userMembers = await db.query.members.findMany({
    where: eq(members.userId, user.id),
    with: { workspace: true } as any,
  });
  return c.json(userMembers.map((m: any) => wsToJson(m.workspace)));
});

app.post("/api/workspaces", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = createWorkspaceSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const { name, slug, description } = parsed.data;

  const existing = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (existing) return jsonError(c, 409, "Slug already taken");

  const [ws] = await db
    .insert(workspaces)
    .values({
      name,
      slug,
      description,
      issuePrefix:
        slug
          .replace(/[^a-zA-Z]/g, "")
          .toUpperCase()
          .slice(0, 5) || "ISS",
    })
    .returning();

  // biome-ignore lint/style/noNonNullAssertion: returning() always yields a row after insert
  await db.insert(members).values({ workspaceId: ws!.id, userId: user.id, role: "owner" });

  // biome-ignore lint/style/noNonNullAssertion: returning() always yields a row after insert
  return c.json(wsToJson(ws!), 201);
});

app.get("/api/workspaces/:workspaceId", workspaceMiddleware, async (c) => {
  const workspaceId = c.get("workspaceId");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) return notFound(c, "Workspace");
  return c.json(wsToJson(ws));
});

app.patch("/api/workspaces/:workspaceId", workspaceMiddleware, async (c) => {
  const role = c.get("memberRole");
  if (role === "member") return forbidden(c);

  const workspaceId = c.get("workspaceId");
  const body = await c.req.json();
  const parsed = updateWorkspaceSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const [updated] = await db
    .update(workspaces)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "workspace.updated",
    data: { id: workspaceId },
  });
  // biome-ignore lint/style/noNonNullAssertion: returning() always yields a row after update
  return c.json(wsToJson(updated!));
});

export default app;
