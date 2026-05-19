import type { MentionRef } from "@agora/shared";

const MENTION_RE = /\[@?(.+?)\]\(mention:\/\/(member|agent|issue|all)\/([0-9a-fA-F-]+|all)\)/g;

export function parseMentions(content: string): MentionRef[] {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const m of content.matchAll(MENTION_RE)) {
    const kind = m[2] as MentionRef["kind"];
    const id = m[3] as string;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id });
  }
  return out;
}

export function hasMentionAll(mentions: MentionRef[]): boolean {
  return mentions.some((m) => m.kind === "all");
}

export async function expandIssueIdentifiers(
  content: string,
  prefix: string,
  lookup: (number: number) => Promise<{ id: string } | null>,
): Promise<string> {
  if (!prefix) return content;

  const skip = findSkipRegions(content);
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\W)(${escaped}-(\\d+))(?:\\W|$)`, "g");

  type Repl = { start: number; end: number; text: string };
  const replacements: Repl[] = [];

  for (const m of content.matchAll(re)) {
    const fullStart = (m.index ?? 0) + (m[0].startsWith(m[1] as string) ? 0 : 1);
    const ident = m[1] as string;
    const numStr = m[2] as string;
    const start = fullStart;
    const end = start + ident.length;
    if (inSkipRegion(start, skip)) continue;
    if (insideMarkdownLink(content, start, end)) continue;
    const num = Number(numStr);
    if (!Number.isFinite(num) || num <= 0) continue;
    const issue = await lookup(num);
    if (!issue) continue;
    replacements.push({ start, end, text: `[${ident}](mention://issue/${issue.id})` });
  }
  if (replacements.length === 0) return content;
  let out = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i] as Repl;
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

interface Region {
  start: number;
  end: number;
}

function findSkipRegions(content: string): Region[] {
  const regions: Region[] = [];
  const fence = /```[\s\S]*?```/g;
  for (const m of content.matchAll(fence)) {
    const i = m.index ?? 0;
    regions.push({ start: i, end: i + (m[0]?.length ?? 0) });
  }
  const inline = /`[^`\n]+`/g;
  for (const m of content.matchAll(inline)) {
    const i = m.index ?? 0;
    regions.push({ start: i, end: i + (m[0]?.length ?? 0) });
  }
  return regions;
}

function inSkipRegion(pos: number, regions: Region[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

function insideMarkdownLink(content: string, start: number, end: number): boolean {
  const before = content.slice(0, start).trimEnd();
  if (before.endsWith("[")) return true;
  const after = content.slice(end);
  if (after.startsWith("](")) return true;
  const idx = content.lastIndexOf("](", start);
  if (idx >= 0) {
    const between = content.slice(idx, start);
    if (!between.includes(")")) return true;
  }
  return false;
}
