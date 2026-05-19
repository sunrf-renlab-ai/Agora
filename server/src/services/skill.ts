import path from "node:path";
import type { SkillFile, SkillWithFiles } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { skillFiles, skills } from "../db/schema/index";

function sanitizeNullBytes(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping NUL bytes for postgres TEXT safety
  return s.replace(/\u0000/g, "");
}

function validateFilePath(p: string): boolean {
  if (!p) return false;
  if (path.isAbsolute(p)) return false;
  const cleaned = path.posix.normalize(p);
  if (cleaned === "." || cleaned.startsWith("../") || cleaned === "..") return false;
  return true;
}

export interface CreateSkillInput {
  workspaceId: string;
  ownerId: string | null;
  name: string;
  description: string;
  content: string;
  config: Record<string, unknown>;
  visibility: "workspace" | "private" | "public";
  files: { path: string; content: string }[];
}

function rowToSkill(row: typeof skills.$inferSelect): Omit<SkillWithFiles, "files"> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description,
    content: row.content,
    config: row.config as Record<string, unknown>,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToSkillFile(row: typeof skillFiles.$inferSelect): SkillFile {
  return {
    id: row.id,
    skillId: row.skillId,
    path: row.path,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createSkillWithFiles(input: CreateSkillInput): Promise<SkillWithFiles> {
  for (const f of input.files) {
    if (!validateFilePath(f.path)) throw new Error(`invalid file path: ${f.path}`);
  }
  return await db.transaction(async (tx) => {
    let skillRow: typeof skills.$inferSelect | undefined;
    try {
      [skillRow] = await tx
        .insert(skills)
        .values({
          workspaceId: input.workspaceId,
          ownerId: input.ownerId,
          name: sanitizeNullBytes(input.name),
          description: sanitizeNullBytes(input.description),
          content: sanitizeNullBytes(input.content),
          config: input.config,
          visibility: input.visibility,
        })
        .returning();
    } catch (e) {
      const cause = (e as { cause?: { constraint_name?: string; message?: string } }).cause;
      const blob = `${String(e)} ${cause?.message ?? ""} ${cause?.constraint_name ?? ""}`;
      if (blob.includes("uq_skill_workspace_name"))
        throw new Error("a skill with this name already exists");
      throw e;
    }
    if (!skillRow) throw new Error("failed to insert skill");
    const fileRows: SkillFile[] = [];
    for (const f of input.files) {
      const [r] = await tx
        .insert(skillFiles)
        .values({
          skillId: skillRow.id,
          path: sanitizeNullBytes(f.path),
          content: sanitizeNullBytes(f.content),
        })
        .returning();
      if (r) fileRows.push(rowToSkillFile(r));
    }
    return { ...rowToSkill(skillRow), files: fileRows };
  });
}

export async function replaceSkillFiles(
  skillId: string,
  files: { path: string; content: string }[],
): Promise<SkillFile[]> {
  for (const f of files) {
    if (!validateFilePath(f.path)) throw new Error(`invalid file path: ${f.path}`);
  }
  return await db.transaction(async (tx) => {
    await tx.delete(skillFiles).where(eq(skillFiles.skillId, skillId));
    const out: SkillFile[] = [];
    for (const f of files) {
      const [r] = await tx
        .insert(skillFiles)
        .values({
          skillId,
          path: sanitizeNullBytes(f.path),
          content: sanitizeNullBytes(f.content),
        })
        .returning();
      if (r) out.push(rowToSkillFile(r));
    }
    await tx.update(skills).set({ updatedAt: new Date() }).where(eq(skills.id, skillId));
    return out;
  });
}

export async function listSkillFiles(skillId: string): Promise<SkillFile[]> {
  const rows = await db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.skillId, skillId))
    .orderBy(skillFiles.path);
  return rows.map(rowToSkillFile);
}

export async function upsertSkillFile(
  skillId: string,
  filePath: string,
  content: string,
): Promise<SkillFile> {
  if (!validateFilePath(filePath)) throw new Error(`invalid file path: ${filePath}`);
  return await db.transaction(async (tx) => {
    const cleanPath = sanitizeNullBytes(filePath);
    const cleanContent = sanitizeNullBytes(content);
    const [row] = await tx
      .insert(skillFiles)
      .values({ skillId, path: cleanPath, content: cleanContent })
      .onConflictDoUpdate({
        target: [skillFiles.skillId, skillFiles.path],
        set: { content: cleanContent, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("failed to upsert skill file");
    await tx.update(skills).set({ updatedAt: new Date() }).where(eq(skills.id, skillId));
    return rowToSkillFile(row);
  });
}

export async function deleteSkillFile(skillId: string, fileId: string): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(skillFiles)
      .where(and(eq(skillFiles.id, fileId), eq(skillFiles.skillId, skillId)))
      .returning();
    if (!deleted) return false;
    await tx.update(skills).set({ updatedAt: new Date() }).where(eq(skills.id, skillId));
    return true;
  });
}

export async function loadSkillWithFiles(
  skillId: string,
  workspaceId: string,
): Promise<SkillWithFiles | null> {
  const skill = await db.query.skills.findFirst({
    where: (t, { and, eq: e }) => and(e(t.id, skillId), e(t.workspaceId, workspaceId)),
  });
  if (!skill) return null;
  const files = await db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.skillId, skillId))
    .orderBy(skillFiles.path);
  return { ...rowToSkill(skill), files: files.map(rowToSkillFile) };
}
