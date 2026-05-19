import { Command } from "commander";
import { api } from "./client";

export const patCmd = new Command("pat").description(
  "Personal access tokens — manage long-lived API credentials",
);

interface Pat {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  token?: string; // only present on create response
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function printPatsTable(rows: Pat[]): void {
  console.log(["ID", "NAME", "PREFIX", "REVOKED", "EXPIRES", "CREATED"].join("\t"));
  for (const p of rows) {
    console.log(
      [
        shortId(p.id),
        p.name,
        p.tokenPrefix,
        p.revoked ? "yes" : "no",
        p.expiresAt ? p.expiresAt.slice(0, 10) : "never",
        p.createdAt.slice(0, 10),
      ].join("\t"),
    );
  }
}

patCmd
  .command("list")
  .description("List your personal access tokens")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = (await api("/api/me/tokens")) as Pat[];
    if (opts.output === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    printPatsTable(rows);
  });

patCmd
  .command("create")
  .description(
    "Create a new personal access token. The raw token is printed ONCE — save it now, it will never be shown again.",
  )
  .requiredOption("--name <name>", "Human-readable token name")
  .option("--expires-at <datetime>", "ISO 8601 expiry (e.g. 2027-01-01T00:00:00Z)")
  .option("--output <fmt>", "Output format: table|json (json exposes the raw token)", "json")
  .action(async (opts) => {
    const body: Record<string, string> = { name: opts.name };
    if (opts.expiresAt) body.expiresAt = opts.expiresAt;
    const r = (await api("/api/me/tokens", {
      method: "POST",
      body: JSON.stringify(body),
    })) as Pat;
    // Always emit JSON for create — the raw token must be visible
    console.log(JSON.stringify(r, null, 2));
  });

patCmd
  .command("revoke <tokenId>")
  .description("Revoke a personal access token")
  .option("--yes", "Skip confirmation", false)
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (tokenId: string, opts) => {
    if (!opts.yes) {
      console.error(`Refusing to revoke token ${tokenId} without --yes`);
      process.exit(2);
    }
    const r = (await api(`/api/me/tokens/${tokenId}/revoke`, {
      method: "POST",
    })) as Pat;
    if (opts.output === "table") {
      printPatsTable([r]);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });
