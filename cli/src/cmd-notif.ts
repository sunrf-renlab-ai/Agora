import { Command } from "commander";
import { api } from "./client";

export const notifCmd = new Command("notif").description(
  "Notification preferences — view and toggle notification settings",
);

type NotifKey =
  | "assignments"
  | "status_changes"
  | "comments"
  | "updates"
  | "agent_activity";

interface NotifGroup {
  enabled: boolean;
}

type NotifPrefs = Record<NotifKey, NotifGroup>;

const VALID_KEYS: NotifKey[] = [
  "assignments",
  "status_changes",
  "comments",
  "updates",
  "agent_activity",
];

function printPrefsTable(prefs: NotifPrefs): void {
  console.log(["KEY", "ENABLED"].join("\t"));
  for (const key of VALID_KEYS) {
    const g = prefs[key];
    console.log([key, g?.enabled ? "true" : "false"].join("\t"));
  }
}

notifCmd
  .command("get")
  .description("Show current notification preferences")
  .option("--output <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const prefs = (await api("/api/me/notification-preferences")) as NotifPrefs;
    if (opts.output === "json") {
      console.log(JSON.stringify(prefs, null, 2));
      return;
    }
    printPrefsTable(prefs);
  });

notifCmd
  .command("set")
  .description(
    `Set a single notification preference flag. Keys: ${VALID_KEYS.join(", ")}`,
  )
  .requiredOption("--key <key>", "Preference key (e.g. assignments)")
  .requiredOption("--value <bool>", "true or false")
  .option("--output <fmt>", "Output format: table|json", "json")
  .action(async (opts) => {
    if (!(VALID_KEYS as string[]).includes(opts.key)) {
      console.error(
        `--key must be one of: ${VALID_KEYS.join(", ")}`,
      );
      process.exit(2);
    }
    if (opts.value !== "true" && opts.value !== "false") {
      console.error("--value must be 'true' or 'false'");
      process.exit(2);
    }
    const enabled = opts.value === "true";
    const body = { [opts.key]: { enabled } };
    const prefs = (await api("/api/me/notification-preferences", {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as NotifPrefs;
    if (opts.output === "table") {
      printPrefsTable(prefs);
      return;
    }
    console.log(JSON.stringify(prefs, null, 2));
  });
