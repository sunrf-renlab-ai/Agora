#!/usr/bin/env bun
// Verify both web locales have matching key trees.
//
// Compares the flat key paths of web/src/i18n/en.json and zh-Hans.json.
// Exits 0 if they match, 1 with a diff otherwise. Wire this into CI to
// catch lopsided locale edits before they reach the runtime — next-intl
// falls back silently to the key string when a translation is missing,
// which makes drift invisible during dev.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const EN_PATH = resolve(ROOT, "web/src/i18n/en.json");
const ZH_PATH = resolve(ROOT, "web/src/i18n/zh-Hans.json");

function flatten(obj: unknown, prefix = "", out: Set<string> = new Set()): Set<string> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    out.add(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out.add(path);
  }
  return out;
}

const en = JSON.parse(readFileSync(EN_PATH, "utf8"));
const zh = JSON.parse(readFileSync(ZH_PATH, "utf8"));
const enKeys = flatten(en);
const zhKeys = flatten(zh);

const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k)).sort();
const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k)).sort();

if (onlyEn.length === 0 && onlyZh.length === 0) {
  console.log(`[i18n] locales match: ${enKeys.size} keys each`);
  process.exit(0);
}

console.error("[i18n] locale key trees differ\n");
if (onlyEn.length > 0) {
  console.error(`Only in en.json (${onlyEn.length}):`);
  for (const k of onlyEn) console.error(`  + ${k}`);
}
if (onlyZh.length > 0) {
  if (onlyEn.length > 0) console.error("");
  console.error(`Only in zh-Hans.json (${onlyZh.length}):`);
  for (const k of onlyZh) console.error(`  + ${k}`);
}
process.exit(1);
