import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

const BUCKET = "attachments";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

// Sanitize the user-provided filename so the storage key is safe to round-trip.
// Drop traversal segments ('..') and empty segments, then join remaining
// path segments with '_', and finally replace any other unsafe character with '_'.
function sanitizeFilename(raw: string): string {
  const segments = raw.split("/").filter((s) => s.length > 0 && s !== "..");
  const joined = segments.join("_");
  const safe = joined.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe || "file";
}

export function buildStorageKey(
  workspaceId: string,
  ownerKind: "issue" | "comment" | "chat_message",
  ownerId: string,
  filename: string,
): string {
  return `${workspaceId}/${ownerKind}/${ownerId}/${randomUUID()}/${sanitizeFilename(filename)}`;
}

export interface SignedUploadResult {
  storageKey: string;
  uploadUrl: string;
  token: string;
}

// Issues a one-shot signed upload URL for the client to PUT the file directly into Storage.
export async function createSignedUploadUrl(
  workspaceId: string,
  ownerKind: "issue" | "comment" | "chat_message",
  ownerId: string,
  filename: string,
): Promise<SignedUploadResult> {
  const storageKey = buildStorageKey(workspaceId, ownerKind, ownerId, filename);
  const { data, error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUploadUrl(storageKey);
  if (error || !data) throw new Error(`signed upload url failed: ${error?.message ?? "unknown"}`);
  return { storageKey, uploadUrl: data.signedUrl, token: data.token };
}

// Issues a signed download URL valid for ttlSeconds (default 5 min).
export async function createSignedDownloadUrl(
  storageKey: string,
  ttlSeconds = 5 * 60,
): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(storageKey, ttlSeconds);
  if (error || !data) throw new Error(`signed download url failed: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

// Best-effort delete; logged by caller on failure.
export async function deleteFromStorage(storageKey: string): Promise<void> {
  await getSupabaseAdmin().storage.from(BUCKET).remove([storageKey]);
}
