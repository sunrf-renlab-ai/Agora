import { Command } from "commander";
import { api } from "./client";

export const meCmd = new Command("me").description("Current user identity and profile");

type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function printUserTable(u: User): void {
  console.log(["FIELD", "VALUE"].join("\t"));
  console.log(["id", u.id].join("\t"));
  console.log(["name", u.name].join("\t"));
  console.log(["email", u.email].join("\t"));
  console.log(["avatarUrl", u.avatarUrl ?? ""].join("\t"));
  console.log(["onboardedAt", u.onboardedAt ?? ""].join("\t"));
  console.log(["createdAt", u.createdAt].join("\t"));
  console.log(["updatedAt", u.updatedAt].join("\t"));
}

meCmd
  .command("get")
  .description("Fetch current user identity")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const u = (await api("/api/me")) as User;
    if (opts.output === "json") {
      console.log(JSON.stringify(u, null, 2));
      return;
    }
    printUserTable(u);
  });

meCmd
  .command("update")
  .description("Update current user profile")
  .option("--name <name>", "Display name (1-100 chars)")
  .option("--avatar-url <url>", "Avatar URL (set to empty string to clear)")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    const body: Record<string, string | null> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.avatarUrl !== undefined) body.avatarUrl = opts.avatarUrl === "" ? null : opts.avatarUrl;
    if (Object.keys(body).length === 0) {
      console.error("nothing to update — provide --name and/or --avatar-url");
      process.exit(2);
    }
    const u = (await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as User;
    if (opts.output === "table") {
      printUserTable(u);
      return;
    }
    console.log(JSON.stringify(u, null, 2));
  });
