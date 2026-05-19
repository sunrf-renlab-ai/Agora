import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

describe("phase3 schema", () => {
  it("agent_task_queue has workspace_id, priority, partial unique index", async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agent_task_queue'
    `);
    const names = (cols as unknown as { column_name: string }[]).map((r) => r.column_name);
    expect(names).toContain("workspace_id");
    expect(names).toContain("priority");
    expect(names).toContain("chat_session_id");
    expect(names).toContain("quick_create_prompt");

    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'agent_task_queue'
    `);
    const idxNames = (idx as unknown as { indexname: string }[]).map((r) => r.indexname);
    expect(idxNames).toContain("uq_one_active_task_per_issue");

    const partial = await db.execute(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename IN ('agent_task_queue', 'agent')
        AND indexname IN ('uq_one_active_task_per_issue', 'uq_one_active_task_per_chat', 'idx_task_claim_candidate', 'idx_agent_workspace_active')
    `);
    const partialNames = partial as unknown as { indexname: string; indexdef: string }[];
    expect(
      partialNames.find((r) => r.indexname === "uq_one_active_task_per_issue")?.indexdef,
    ).toContain("WHERE");
    expect(
      partialNames.find((r) => r.indexname === "uq_one_active_task_per_chat")?.indexdef,
    ).toContain("WHERE");
    expect(
      partialNames.find((r) => r.indexname === "idx_task_claim_candidate")?.indexdef,
    ).toContain("WHERE");
    expect(
      partialNames.find((r) => r.indexname === "idx_agent_workspace_active")?.indexdef,
    ).toContain("WHERE");
  });
});
