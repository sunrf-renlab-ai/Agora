import { Command } from "commander";
import { api, workspaceId } from "./client";

export const feedbackCmd = new Command("feedback").description(
  "Submit and review product feedback",
);

type FeedbackKind = "general" | "bug" | "feature";

interface Feedback {
  id: string;
  userId: string;
  workspaceId: string | null;
  kind: FeedbackKind;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function printFeedbackTable(rows: Feedback[]): void {
  console.log(["ID", "KIND", "CREATED", "CONTENT_PREVIEW"].join("\t"));
  for (const f of rows) {
    const preview = f.content.slice(0, 60).replace(/\n/g, " ");
    console.log(
      [shortId(f.id), f.kind, f.createdAt.slice(0, 10), preview].join("\t"),
    );
  }
}

feedbackCmd
  .command("list")
  .description("List your feedback submissions")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api("/api/me/feedback")) as Feedback[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printFeedbackTable(rows);
  });

feedbackCmd
  .command("create")
  .description("Submit feedback")
  .option("--content <text>", "Inline feedback text")
  .option("--content-stdin", "Read feedback body from stdin", false)
  .option(
    "--kind <kind>",
    "general | bug | feature (default: general)",
    "general",
  )
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    if (!["general", "bug", "feature"].includes(opts.kind)) {
      console.error("--kind must be one of: general, bug, feature");
      process.exit(2);
    }

    let content = opts.content ?? "";
    if (opts.contentStdin) {
      content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", (c) => chunks.push(c));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        process.stdin.on("error", reject);
      });
    }
    if (!content.trim()) {
      console.error("feedback content is empty — use --content or --content-stdin");
      process.exit(2);
    }

    const wsId = workspaceId();
    const body: Record<string, unknown> = {
      content,
      kind: opts.kind,
    };
    if (wsId) body.workspaceId = wsId;

    const r = (await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify(body),
    })) as Feedback;

    if (opts.output === "table") {
      printFeedbackTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });
