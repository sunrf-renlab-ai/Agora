import { basename } from "node:path";
import { Command } from "commander";
import { api, workspaceId } from "./client";

export const commentCmd = new Command("comment").description("Issue comments");

type Comment = {
  id: string;
  authorKind?: string;
  authorId?: string;
  createdAt: string;
  content: string;
};

type SignedUpload = {
  storageKey: string;
  uploadUrl: string;
  token: string;
};

type AttachmentRecord = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
};

// Best-effort content type from extension. Falls back to octet-stream.
function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "txt":
    case "log":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "html":
    case "htm":
      return "text/html";
    case "zip":
      return "application/zip";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

// Upload a single file as an attachment owned by `(ownerKind, ownerId)` and
// return the recorded attachment row. Two-step Supabase Storage protocol:
//   1. POST /attachments/sign-upload  -> signed PUT URL
//   2. PUT bytes to that URL
//   3. POST /attachments              -> record metadata row
async function uploadAttachment(
  filePath: string,
  ownerKind: "issue" | "comment" | "chat_message",
  ownerId: string,
): Promise<AttachmentRecord> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`attachment not found: ${filePath}`);
  }
  const filename = basename(filePath);
  const size = file.size;
  if (size <= 0) {
    throw new Error(`attachment is empty: ${filePath}`);
  }
  const contentType = file.type && file.type !== "application/octet-stream"
    ? file.type
    : guessContentType(filename);

  const ws = workspaceId();

  // 1. Ask the server to sign an upload URL.
  const signed = (await api(`/api/workspaces/${ws}/attachments/sign-upload`, {
    method: "POST",
    body: JSON.stringify({ ownerKind, ownerId, filename, contentType, size }),
  })) as SignedUpload;

  // 2. PUT the bytes directly into Storage. This call goes to the storage
  //    provider, NOT our API, so we can't use the `api()` helper.
  const bytes = await file.arrayBuffer();
  const putRes = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      // Supabase signed-upload URLs accept the bearer-style token directly
      // in the URL, but also tolerate (and require for some configs) an
      // Authorization header. The `uploadUrl` already encodes the token.
    },
    body: bytes,
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    throw new Error(`upload PUT failed (${putRes.status}): ${body}`);
  }

  // 3. Record metadata so the workspace can list/download the attachment.
  const recorded = (await api(`/api/workspaces/${ws}/attachments`, {
    method: "POST",
    body: JSON.stringify({
      ownerKind,
      ownerId,
      filename,
      contentType,
      size,
      storageKey: signed.storageKey,
    }),
  })) as AttachmentRecord;

  return recorded;
}

commentCmd
  .command("list <issueId>")
  .option("--output <fmt>", "Output format: table|json", "table")
  .option("--limit <n>", "Max comments to return")
  .option("--since <iso>", "Only comments created after this ISO timestamp")
  .action(async (issueId, opts) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.since) params.set("since", String(opts.since));
    const qs = params.toString() ? `?${params.toString()}` : "";
    const rows = (await api(
      `/api/workspaces/${workspaceId()}/issues/${issueId}/comments${qs}`,
    )) as Comment[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    for (const c of rows) {
      const author = [c.authorKind, c.authorId].filter(Boolean).join(":") || "?";
      const firstLine = c.content.split("\n")[0] ?? "";
      const truncated = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
      console.log(`${c.id}\t${author}\t${c.createdAt}\t${truncated}`);
    }
  });

commentCmd
  .command("add <issueId>")
  .option("--content <md>", "Comment body (markdown)")
  .option("--content-stdin", "Read comment body from stdin")
  .option("--parent <commentId>", "Reply to this comment id")
  .option(
    "--attachment <path>",
    "File path to attach (repeatable)",
    (val: string, prev: string[]) => prev.concat([val]),
    [] as string[],
  )
  .action(async (issueId, opts) => {
    if (opts.content && opts.contentStdin) {
      console.error("--content and --content-stdin are mutually exclusive");
      process.exit(2);
    }
    if (!opts.content && !opts.contentStdin) {
      console.error("one of --content or --content-stdin is required");
      process.exit(2);
    }

    let content: string;
    if (opts.contentStdin) {
      const raw = await Bun.stdin.text();
      content = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    } else {
      content = opts.content as string;
    }

    const attachmentPaths: string[] = Array.isArray(opts.attachment) ? opts.attachment : [];

    // Pre-validate attachment paths before posting the comment, so a bad
    // path doesn't leave behind an orphaned comment with no files.
    for (const p of attachmentPaths) {
      const f = Bun.file(p);
      if (!(await f.exists())) {
        console.error(`attachment not found: ${p}`);
        process.exit(2);
      }
    }

    const body: Record<string, unknown> = { content };
    if (opts.parent) body.parentCommentId = opts.parent;

    const created = (await api(
      `/api/workspaces/${workspaceId()}/issues/${issueId}/comments`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    )) as { id: string };

    // Upload each attachment scoped to the freshly created comment. The
    // attachment table links rows to (ownerKind=comment, ownerId=commentId);
    // listing the comment's attachments uses that pairing.
    const uploaded: AttachmentRecord[] = [];
    for (const filePath of attachmentPaths) {
      try {
        const rec = await uploadAttachment(filePath, "comment", created.id);
        uploaded.push(rec);
        console.error(`Uploaded ${filePath}`);
      } catch (e) {
        console.error(`upload attachment ${filePath}: ${(e as Error).message}`);
        process.exit(1);
      }
    }

    console.log(JSON.stringify({ ...created, attachments: uploaded }, null, 2));
  });

commentCmd
  .command("delete <issueId> <commentId>")
  .description("Delete a comment")
  .option("--yes", "Skip confirmation prompt")
  .action(async (issueId, commentId, opts) => {
    if (!opts.yes) {
      process.stdout.write(`Delete comment ${commentId}? [y/N] `);
      const raw = await Bun.stdin.text();
      const answer = raw.trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        console.log("Cancelled.");
        process.exit(0);
      }
    }
    await api(
      `/api/workspaces/${workspaceId()}/issues/${issueId}/comments/${commentId}`,
      { method: "DELETE" },
    );
    console.error(`Comment ${commentId} deleted.`);
  });
