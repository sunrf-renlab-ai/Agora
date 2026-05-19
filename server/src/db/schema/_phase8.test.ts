import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

async function columnsOf(table: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = ${table}
  `);
  return (rows as unknown as { column_name: string }[]).map((r) => r.column_name);
}

describe("phase8 schema", () => {
  it("user has notification_preferences jsonb", async () => {
    const cols = await columnsOf("user");
    expect(cols).toContain("notification_preferences");
  });

  it("personal_access_token has the columns Phase 8 needs", async () => {
    const cols = await columnsOf("personal_access_token");
    for (const c of [
      "id",
      "user_id",
      "name",
      "token_hash",
      "token_prefix",
      "revoked",
      "last_used_at",
      "expires_at",
      "created_at",
    ])
      expect(cols).toContain(c);
  });

  it("feedback has workspace_id, kind, metadata", async () => {
    const cols = await columnsOf("feedback");
    for (const c of ["id", "user_id", "workspace_id", "content", "kind", "metadata", "created_at"])
      expect(cols).toContain(c);
  });
});
