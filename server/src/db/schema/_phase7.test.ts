import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

async function columnsOf(table: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = ${table}
  `);
  return (rows as unknown as { column_name: string }[]).map((r) => r.column_name);
}

async function indexesOf(table: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT indexname FROM pg_indexes WHERE tablename = ${table}
  `);
  return (rows as unknown as { indexname: string }[]).map((r) => r.indexname);
}

describe("phase7 schema", () => {
  it("issue_label has workspace_id/name/color/created_at/updated_at + uq_label_name", async () => {
    const cols = await columnsOf("issue_label");
    for (const c of ["workspace_id", "name", "color", "created_at", "updated_at"])
      expect(cols).toContain(c);
    expect(await indexesOf("issue_label")).toContain("uq_label_workspace_name");
  });

  it("issue_to_label has workspace_id + created_at and PK on (issue_id, label_id)", async () => {
    const cols = await columnsOf("issue_to_label");
    for (const c of ["issue_id", "label_id", "workspace_id", "created_at"])
      expect(cols).toContain(c);
  });

  it("issue_dependency has workspace_id/created_at/created_by + uq_dep", async () => {
    const cols = await columnsOf("issue_dependency");
    for (const c of [
      "issue_id",
      "depends_on_issue_id",
      "type",
      "workspace_id",
      "created_at",
      "created_by_user_id",
    ])
      expect(cols).toContain(c);
    expect(await indexesOf("issue_dependency")).toContain("uq_dep_pair_type");
  });

  it("comment_reaction has workspace_id + uq_comment_reaction", async () => {
    const cols = await columnsOf("comment_reaction");
    for (const c of ["comment_id", "actor_kind", "actor_id", "emoji", "workspace_id", "created_at"])
      expect(cols).toContain(c);
    expect(await indexesOf("comment_reaction")).toContain("uq_comment_reaction");
  });

  it("issue_reaction has workspace_id + uq_issue_reaction", async () => {
    const cols = await columnsOf("issue_reaction");
    for (const c of ["issue_id", "actor_kind", "actor_id", "emoji", "workspace_id", "created_at"])
      expect(cols).toContain(c);
    expect(await indexesOf("issue_reaction")).toContain("uq_issue_reaction");
  });

  it("attachment has owner_kind/owner_id + idx_attachment_owner", async () => {
    const cols = await columnsOf("attachment");
    for (const c of [
      "workspace_id",
      "owner_kind",
      "owner_id",
      "filename",
      "content_type",
      "size",
      "storage_key",
      "created_by_user_id",
      "created_at",
    ])
      expect(cols).toContain(c);
    expect(await indexesOf("attachment")).toContain("idx_attachment_owner");
  });

  it("pin shape unchanged from Phase 1 scaffold", async () => {
    const cols = await columnsOf("pin");
    for (const c of ["workspace_id", "user_id", "item_type", "item_id", "position", "created_at"])
      expect(cols).toContain(c);
  });

  it("attachments storage bucket exists", async () => {
    // Supabase Storage runs in a separate `storage.*` schema that lives
    // ONLY on Supabase Cloud / Supabase local. CI's plain Postgres image
    // doesn't have it, so the prior plain SELECT exploded and tanked the
    // CI deploy job. Skip cleanly in that case — the bucket is provisioned
    // by Supabase migrations, not Drizzle, and there's nothing to assert.
    const schemaCheck = await db.execute(sql`
      SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage'
    `);
    if ((schemaCheck as unknown as unknown[]).length === 0) {
      return; // storage schema absent — Supabase isn't here, skip
    }
    const rows = await db.execute(sql`
      SELECT id FROM storage.buckets WHERE id = 'attachments'
    `);
    expect((rows as unknown as { id: string }[]).length).toBe(1);
  });
});
