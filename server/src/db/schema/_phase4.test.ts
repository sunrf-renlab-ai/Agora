import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

describe("phase4 schema", () => {
  it("autopilot tables have expected columns", async () => {
    const cols = await db.execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('autopilot', 'autopilot_trigger', 'autopilot_run')
    `);
    const rows = cols as unknown as { table_name: string; column_name: string }[];
    const apCols = rows.filter((r) => r.table_name === "autopilot").map((r) => r.column_name);
    expect(apCols).toContain("assignee_id");
    expect(apCols).toContain("execution_mode");
    expect(apCols).toContain("issue_title_template");
    expect(apCols).toContain("last_run_at");

    const trigCols = rows
      .filter((r) => r.table_name === "autopilot_trigger")
      .map((r) => r.column_name);
    expect(trigCols).toContain("cron_expression");
    expect(trigCols).toContain("webhook_token_hash");
    expect(trigCols).toContain("next_run_at");

    const runCols = rows.filter((r) => r.table_name === "autopilot_run").map((r) => r.column_name);
    expect(runCols).toContain("source");
    expect(runCols).toContain("status");
    expect(runCols).toContain("trigger_payload");
  });
});
