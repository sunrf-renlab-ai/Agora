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

describe("phase6 schema", () => {
  it("project has title/icon/priority/lead_type/lead_id columns", async () => {
    const cols = await columnsOf("project");
    for (const c of ["title", "icon", "priority", "lead_type", "lead_id", "workspace_id", "status"])
      expect(cols).toContain(c);
  });

  it("project_resource has workspace_id, resource_type, resource_ref, label, position, created_by", async () => {
    const cols = await columnsOf("project_resource");
    for (const c of [
      "workspace_id",
      "project_id",
      "resource_type",
      "resource_ref",
      "label",
      "position",
      "created_by",
    ])
      expect(cols).toContain(c);
    const idx = await indexesOf("project_resource");
    expect(idx).toContain("uq_project_resource_ref");
  });

  it("skill has owner_id and visibility", async () => {
    const cols = await columnsOf("skill");
    for (const c of ["owner_id", "visibility", "name", "description", "content", "config"])
      expect(cols).toContain(c);
    const idx = await indexesOf("skill");
    expect(idx).toContain("uq_skill_workspace_name");
  });

  it("skill_file has unique (skill_id, path)", async () => {
    const idx = await indexesOf("skill_file");
    expect(idx).toContain("uq_skill_file_path");
  });

  it("agent_skill is a (agent_id, skill_id) PK with created_at", async () => {
    const cols = await columnsOf("agent_skill");
    for (const c of ["agent_id", "skill_id", "created_at"]) expect(cols).toContain(c);
  });

  it("runtime_local_skill_list_request has status + skills jsonb + error", async () => {
    const cols = await columnsOf("runtime_local_skill_list_request");
    for (const c of ["runtime_id", "status", "skills", "supported", "error", "created_at"])
      expect(cols).toContain(c);
  });

  it("runtime_local_skill_import_request has skill_key + skill_id + creator_id", async () => {
    const cols = await columnsOf("runtime_local_skill_import_request");
    for (const c of [
      "runtime_id",
      "skill_key",
      "skill_id",
      "creator_id",
      "status",
      "name",
      "description",
    ])
      expect(cols).toContain(c);
  });
});
