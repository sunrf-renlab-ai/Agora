import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Command } from "commander";
import { api, workspaceId } from "./client";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

function guessMime(filename: string): string {
  return MIME_MAP[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

export const attachmentCmd = new Command("attachment").description("Work with attachments");

interface DownloadResponse {
  url: string;
  filename?: string;
  expiresInSeconds?: number;
}

type OwnerKind = "issue" | "comment" | "chat_message";

interface Attachment {
  id: string;
  workspaceId: string;
  ownerKind: OwnerKind;
  ownerId: string;
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
  createdByUserId: string;
  createdAt: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function printAttachmentsTable(rows: Attachment[]): void {
  console.log(["ID", "FILENAME", "SIZE", "OWNER_KIND", "OWNER_ID", "CREATED"].join("\t"));
  for (const a of rows) {
    console.log(
      [
        shortId(a.id),
        a.filename,
        fmtSize(a.size),
        a.ownerKind,
        shortId(a.ownerId),
        a.createdAt.slice(0, 10),
      ].join("\t"),
    );
  }
}

// agora attachment upload <filepath> --owner-kind <kind> --owner-id <uuid>
attachmentCmd
  .command("upload <filepath>")
  .description("Upload a file as an attachment (3-phase: sign → PUT → finalize)")
  .requiredOption("--owner-kind <kind>", "issue | comment | chat_message")
  .requiredOption("--owner-id <uuid>", "UUID of the owning entity")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (filepath: string, opts) => {
    const wsId = workspaceId();
    const ownerKind = opts.ownerKind as OwnerKind;
    if (!["issue", "comment", "chat_message"].includes(ownerKind)) {
      console.error("--owner-kind must be one of: issue, comment, chat_message");
      process.exit(2);
    }

    const absPath = resolve(filepath);
    const fileStat = await stat(absPath);
    const filename = basename(absPath);
    const contentType = guessMime(filename);
    const size = fileStat.size;

    // Phase 1: get signed upload URL
    const sign = (await api(`/api/workspaces/${wsId}/attachments/sign-upload`, {
      method: "POST",
      body: JSON.stringify({ ownerKind, ownerId: opts.ownerId, filename, contentType, size }),
    })) as { uploadUrl: string; storageKey: string };

    // Phase 2: PUT file bytes directly to the signed URL (no auth headers)
    const bytes = await readFile(absPath);
    const putRes = await fetch(sign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
    });
    if (!putRes.ok) {
      const body = await putRes.text();
      throw new Error(`Upload to storage failed: HTTP ${putRes.status}: ${body}`);
    }

    // Phase 3: finalize the attachment record
    const attachment = (await api(`/api/workspaces/${wsId}/attachments`, {
      method: "POST",
      body: JSON.stringify({
        ownerKind,
        ownerId: opts.ownerId,
        filename,
        contentType,
        size,
        storageKey: sign.storageKey,
      }),
    })) as Attachment;

    if (opts.output === "table") {
      printAttachmentsTable([attachment]);
      return;
    }
    console.log(JSON.stringify(attachment, null, 2));
  });

// agora attachment list --owner-kind <kind> --owner-id <uuid>
attachmentCmd
  .command("list")
  .description("List attachments for an owner entity")
  .requiredOption("--owner-kind <kind>", "issue | comment | chat_message")
  .requiredOption("--owner-id <uuid>", "UUID of the owning entity")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const wsId = workspaceId();
    const rows = (await api(
      `/api/workspaces/${wsId}/attachments?ownerKind=${opts.ownerKind}&ownerId=${opts.ownerId}`,
    )) as Attachment[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printAttachmentsTable(rows);
  });

// agora attachment delete <id> --yes
attachmentCmd
  .command("delete <id>")
  .description("Delete an attachment")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (id: string, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to delete attachment ${id} without --yes`);
      process.exit(2);
    }
    await api(`/api/workspaces/${workspaceId()}/attachments/${id}`, { method: "DELETE" });
    if (opts.output === "json") {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }
    console.log(`Attachment ${id} deleted.`);
  });

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  // Try filename*=UTF-8''<encoded>
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, "").trim());
    } catch {
      /* fall through */
    }
  }
  const m = header.match(/filename="?([^";]+)"?/i);
  return m?.[1]?.trim() ?? null;
}

attachmentCmd
  .command("download <id>")
  .description("Download an attachment to a local file")
  .option("-o, --output-dir <path>", "Directory to save the downloaded file", ".")
  .action(async (id: string, opts: { outputDir: string }) => {
    const wsId = workspaceId();
    if (!wsId) {
      throw new Error("AGORA_WORKSPACE_ID env var required");
    }
    // Step 1: ask the server for a signed download URL.
    const meta = (await api(
      `/api/workspaces/${wsId}/attachments/${id}/download`,
    )) as DownloadResponse;
    if (!meta?.url) {
      throw new Error("attachment has no download URL");
    }

    // Step 2: fetch the signed URL directly (no auth headers — it's pre-signed).
    const res = await fetch(meta.url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`download failed: HTTP ${res.status}: ${body}`);
    }

    // Resolve filename: Content-Disposition wins, then meta.filename, then <id>.bin.
    const fromHeader = parseFilenameFromContentDisposition(res.headers.get("content-disposition"));
    const filename = fromHeader ?? meta.filename ?? `${id}.bin`;

    await mkdir(opts.outputDir, { recursive: true });
    const destPath = resolve(opts.outputDir, filename);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await Bun.write(destPath, bytes);

    console.error(`Downloaded: ${destPath}`);
    console.log(JSON.stringify({ id, filename, path: destPath, size: bytes.byteLength }, null, 2));
  });
