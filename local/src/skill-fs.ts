import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SkillBundleFile {
  path: string;
  content: string;
}

export interface SkillBundle {
  skillId: string;
  name: string;
  description: string;
  content: string;
  files: SkillBundleFile[];
}

export interface LocalSkillSummary {
  key: string;
  name: string;
  description: string;
  sourcePath: string;
  provider: string;
  fileCount: number;
}

export interface LocalSkillBundle {
  name: string;
  description: string;
  content: string;
  sourcePath: string;
  provider: string;
  files: SkillBundleFile[];
}

const MAX_FILE_BYTES = 1 << 20; // 1 MiB
const MAX_FILES = 128;
const MAX_BUNDLE_BYTES = 8 << 20; // 8 MiB

function safeName(name: string): string {
  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    path.isAbsolute(name)
  ) {
    throw new Error(`invalid skill name: ${name}`);
  }
  return name;
}

function safeJoin(skillDir: string, rel: string): string {
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]+/).some((seg) => seg === "..")) {
    throw new Error(`invalid file path: ${rel}`);
  }
  const joined = path.resolve(skillDir, rel);
  if (joined !== skillDir && !joined.startsWith(skillDir + path.sep)) {
    throw new Error(`invalid file path: ${rel}`);
  }
  return joined;
}

async function listExistingFiles(dir: string): Promise<Set<string>> {
  const out = new Set<string>();
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.add(path.relative(dir, full));
    }
  }
  await walk(dir);
  return out;
}

/**
 * Writes each bundle to <baseDir>/<bundle.name>/SKILL.md and per-file paths.
 * Removes any directories whose name is in `removeNames`. Idempotent: files
 * present on disk but missing from the bundle are deleted.
 */
export async function applySkillSync(
  baseDir: string,
  bundles: SkillBundle[],
  removeNames: string[],
): Promise<void> {
  await mkdir(baseDir, { recursive: true });

  for (const name of removeNames) {
    const dir = path.join(baseDir, safeName(name));
    await rm(dir, { recursive: true, force: true });
  }

  for (const bundle of bundles) {
    // Validate file paths up front so we never partially-write a bundle.
    for (const f of bundle.files) {
      if (
        !f.path ||
        path.isAbsolute(f.path) ||
        f.path.split(/[\\/]+/).some((seg) => seg === "..")
      ) {
        throw new Error(`invalid file path: ${f.path}`);
      }
    }

    const dir = path.join(baseDir, safeName(bundle.name));
    await mkdir(dir, { recursive: true });

    const desired = new Set<string>(["SKILL.md", ...bundle.files.map((f) => f.path)]);
    const existing = await listExistingFiles(dir);
    for (const rel of existing) {
      const normalized = rel.split(path.sep).join("/");
      const desiredNormalized = new Set([...desired].map((p) => p.split(/[\\/]+/).join("/")));
      if (!desiredNormalized.has(normalized)) {
        await rm(path.join(dir, rel), { force: true });
      }
    }

    await writeFile(safeJoin(dir, "SKILL.md"), bundle.content, "utf8");
    for (const f of bundle.files) {
      const dest = safeJoin(dir, f.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, f.content, "utf8");
    }
  }
}

export async function defaultSkillBaseDir(): Promise<string> {
  const home = process.env.AGORA_SKILL_HOME ?? process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("home dir not resolvable");
  const dir = path.join(home, ".claude", "skills");
  await mkdir(dir, { recursive: true });
  return dir;
}

function parseFrontmatter(content: string): { name: string; description: string } {
  if (!content.startsWith("---")) return { name: "", description: "" };
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { name: "", description: "" };
  let name = "";
  let description = "";
  for (const raw of content.slice(3, end).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("name:")) {
      name = line
        .slice(5)
        .trim()
        .replace(/^['"]|['"]$/g, "");
    } else if (line.startsWith("description:")) {
      description = line
        .slice(12)
        .trim()
        .replace(/^['"]|['"]$/g, "");
    }
  }
  return { name, description };
}

function isIgnored(name: string): boolean {
  if (!name || name.startsWith(".")) return true;
  const lower = name.toLowerCase();
  return lower === "license" || lower === "license.md" || lower === "license.txt";
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (isIgnored(e.name)) continue;
      const full = path.join(current, e.name);
      if (e.isFile()) count++;
      else if (e.isDirectory()) await walk(full);
    }
  }
  await walk(dir);
  return count;
}

function tildify(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

/**
 * Walks `baseDir` looking for `SKILL.md` files. Each directory containing a
 * SKILL.md becomes one summary entry. Recurses up to depth 4 so nested layouts
 * (e.g. ~/.claude/skills/foo/bar/SKILL.md) are discovered.
 */
export async function scanLocalSkills(
  baseDir: string,
  provider = "claude",
): Promise<LocalSkillSummary[]> {
  const out: LocalSkillSummary[] = [];
  const visited = new Set<string>();

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 4) return;
    if (visited.has(current)) return;
    visited.add(current);
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (isIgnored(e.name)) continue;
      const full = path.join(current, e.name);
      const st = await stat(full).catch(() => null);
      if (!st || !st.isDirectory()) continue;
      const skillMd = path.join(full, "SKILL.md");
      const skillStat = await stat(skillMd).catch(() => null);
      if (skillStat?.isFile()) {
        const raw = await readFile(skillMd, "utf8").catch(() => "");
        const content = raw.slice(0, MAX_FILE_BYTES);
        const fm = parseFrontmatter(content);
        const fileCount = await countFiles(full);
        const rel = path.relative(baseDir, full).split(path.sep).join("/");
        out.push({
          key: rel,
          name: fm.name || path.basename(full),
          description: fm.description,
          sourcePath: tildify(full),
          provider,
          fileCount,
        });
      } else {
        await walk(full, depth + 1);
      }
    }
  }

  await walk(baseDir, 0);
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/**
 * Reads `<baseDir>/<skillKey>/` and returns the bundle: `SKILL.md` content
 * plus every other file under the directory. Enforces size + count caps so a
 * malicious or oversized skill cannot OOM the daemon.
 */
export async function loadLocalSkillBundle(
  baseDir: string,
  skillKey: string,
  provider = "claude",
): Promise<LocalSkillBundle> {
  const cleaned = path.posix.normalize(skillKey);
  if (cleaned.startsWith("..") || cleaned.startsWith("/") || path.isAbsolute(cleaned)) {
    throw new Error("invalid skill key");
  }
  const dir = path.resolve(baseDir, cleaned);
  if (dir !== baseDir && !dir.startsWith(baseDir + path.sep)) {
    throw new Error("invalid skill key");
  }

  const content = await readFile(path.join(dir, "SKILL.md"), "utf8");
  const fm = parseFrontmatter(content);
  const files: SkillBundleFile[] = [];
  let totalSize = 0;

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      if (isIgnored(e.name)) continue;
      const full = path.join(current, e.name);
      // Skip the top-level SKILL.md; it's returned as `content`.
      if (current === dir && e.name === "SKILL.md") continue;
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        if (files.length >= MAX_FILES) throw new Error("too many files in skill bundle");
        const buf = await readFile(full);
        if (buf.byteLength > MAX_FILE_BYTES) continue;
        totalSize += buf.byteLength;
        if (totalSize > MAX_BUNDLE_BYTES) throw new Error("skill bundle too large");
        const rel = path.relative(dir, full).split(path.sep).join("/");
        files.push({ path: rel, content: buf.toString("utf8") });
      }
    }
  }

  await walk(dir);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    name: fm.name || path.basename(dir),
    description: fm.description,
    content,
    sourcePath: tildify(dir),
    provider,
    files,
  };
}
