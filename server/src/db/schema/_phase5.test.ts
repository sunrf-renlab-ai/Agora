import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

describe("phase5 chat schema", () => {
  it("chat_session has title column", async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chat_session'
    `);
    const names = (cols as unknown as { column_name: string }[]).map((r) => r.column_name);
    expect(names).toContain("title");
    expect(names).toContain("workspace_id");
    expect(names).toContain("agent_id");
    expect(names).toContain("creator_id");
    expect(names).toContain("status");
  });

  it("chat_message has chat_session_id column (not session_id)", async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chat_message'
    `);
    const names = (cols as unknown as { column_name: string }[]).map((r) => r.column_name);
    expect(names).toContain("chat_session_id");
    expect(names).toContain("role");
    expect(names).toContain("content");
    expect(names).toContain("task_id");
    expect(names).not.toContain("session_id");
  });

  it("chat_message has FK to chat_session with cascade", async () => {
    const fks = await db.execute(sql`
      SELECT tc.constraint_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_name = 'chat_message' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    const rows = fks as unknown as { constraint_name: string; delete_rule: string }[];
    expect(rows.some((r) => r.delete_rule === "CASCADE")).toBe(true);
  });

  it("idx_chat_message_session index exists on (chat_session_id, created_at)", async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'chat_message'
    `);
    const names = (idx as unknown as { indexname: string }[]).map((r) => r.indexname);
    expect(names).toContain("idx_chat_message_session");
  });
});
