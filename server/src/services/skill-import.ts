const MAX_FILE_BYTES = 1 << 20; // 1MB cap per file

export interface ImportedSkill {
  name: string;
  description: string;
  content: string;
  files: { path: string; content: string }[];
}

export type ImportSource = "clawhub" | "skills_sh";

export interface DetectResult {
  source: ImportSource;
  url: string;
}

export function detectImportSource(raw: string): DetectResult {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty URL");
  const normalized = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("invalid URL");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "skills.sh" || host === "www.skills.sh")
    return { source: "skills_sh", url: normalized };
  if (host === "clawhub.ai" || host === "www.clawhub.ai")
    return { source: "clawhub", url: normalized };
  throw new Error(`unsupported source: ${host} (supported: clawhub.ai, skills.sh)`);
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "user-agent": "agora-skill-importer/1" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return (await r.json()) as T;
}

async function getText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "user-agent": "agora-skill-importer/1" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error(`file ${url} > ${MAX_FILE_BYTES}B`);
  return new TextDecoder().decode(buf);
}

export function parseSkillFrontmatter(content: string): { name: string; description: string } {
  if (!content.startsWith("---")) return { name: "", description: "" };
  const end = content.indexOf("---", 3);
  if (end < 0) return { name: "", description: "" };
  let name = "";
  let description = "";
  for (const raw of content.slice(3, end).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("name:"))
      name = line
        .slice(5)
        .trim()
        .replace(/^['"]|['"]$/g, "");
    else if (line.startsWith("description:"))
      description = line
        .slice(12)
        .trim()
        .replace(/^['"]|['"]$/g, "");
  }
  return { name, description };
}

interface ClawhubGetResponse {
  skill: { slug: string; displayName: string; summary: string; tags?: Record<string, string> };
  latestVersion?: { version: string };
}
interface ClawhubVersionResponse {
  version: { version: string; files: { path: string; size: number }[] };
}

async function fetchFromClawhub(rawUrl: string): Promise<ImportedSkill> {
  const parsed = new URL(rawUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const slug = parts[parts.length - 1];
  if (!slug) throw new Error("missing skill slug in URL");
  const apiBase = "https://clawhub.ai/api/v1";
  const meta = await getJson<ClawhubGetResponse>(`${apiBase}/skills/${encodeURIComponent(slug)}`);
  const version = meta.skill.tags?.latest ?? meta.latestVersion?.version ?? "";
  const files: { path: string; content: string }[] = [];
  let content = "";
  if (version) {
    const v = await getJson<ClawhubVersionResponse>(
      `${apiBase}/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
    );
    for (const f of v.version.files) {
      const url = `${apiBase}/skills/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(f.path)}&version=${encodeURIComponent(version)}`;
      const body = await getText(url);
      if (f.path === "SKILL.md") content = body;
      else files.push({ path: f.path, content: body });
    }
  }
  return {
    name: meta.skill.displayName || slug,
    description: meta.skill.summary || "",
    content,
    files,
  };
}

interface GithubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  url: string;
}

async function fetchFromSkillsSh(rawUrl: string): Promise<ImportedSkill> {
  const parsed = new URL(rawUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 3) throw new Error("expected URL: skills.sh/{owner}/{repo}/{skill-name}");
  const [owner, repo, skillName] = parts;
  if (!owner || !repo || !skillName)
    throw new Error("expected URL: skills.sh/{owner}/{repo}/{skill-name}");
  const repoMeta = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  );
  const defaultBranch = repoMeta.ok
    ? (((await repoMeta.json()) as { default_branch?: string }).default_branch ?? "main")
    : "main";
  const candidates = [
    `skills/${skillName}`,
    `.claude/skills/${skillName}`,
    `plugin/skills/${skillName}`,
    skillName,
  ];
  let skillDir = "";
  let skillMd = "";
  for (const dir of candidates) {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(defaultBranch)}/${dir}/SKILL.md`;
    const r = await fetch(url);
    if (r.ok) {
      skillMd = await r.text();
      skillDir = dir;
      break;
    }
  }
  if (!skillMd) throw new Error(`SKILL.md not found in ${owner}/${repo} for skill ${skillName}`);
  const fm = parseSkillFrontmatter(skillMd);
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${skillDir}?ref=${encodeURIComponent(defaultBranch)}`;
  const dirResp = await fetch(apiUrl);
  const files: { path: string; content: string }[] = [];
  if (dirResp.ok) {
    const entries = (await dirResp.json()) as GithubContentEntry[];
    await collectFiles(entries, files, `${skillDir}/`);
  }
  return {
    name: fm.name || skillName,
    description: fm.description,
    content: skillMd,
    files,
  };
}

async function collectFiles(
  entries: GithubContentEntry[],
  out: { path: string; content: string }[],
  basePrefix: string,
): Promise<void> {
  for (const e of entries) {
    const lower = e.name.toLowerCase();
    if (
      lower === "skill.md" ||
      lower === "license" ||
      lower === "license.md" ||
      lower === "license.txt"
    )
      continue;
    if (e.type === "file" && e.download_url) {
      const body = await getText(e.download_url);
      out.push({ path: e.path.replace(basePrefix, ""), content: body });
    } else if (e.type === "dir") {
      const r = await fetch(e.url);
      if (r.ok) {
        const sub = (await r.json()) as GithubContentEntry[];
        await collectFiles(sub, out, basePrefix);
      }
    }
  }
}

export async function fetchImportedSkill(rawUrl: string): Promise<ImportedSkill> {
  const { source, url } = detectImportSource(rawUrl);
  if (source === "clawhub") return fetchFromClawhub(url);
  return fetchFromSkillsSh(url);
}
