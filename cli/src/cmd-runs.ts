import { Command } from "commander";
import { api, workspaceId } from "./client";

export const runsCmd = new Command("runs")
  .description("List recent task runs for the current agent")
  .option("--agent <id>")
  .action(async (opts) => {
    const id = opts.agent ?? process.env.AGORA_AGENT_ID;
    if (!id) {
      console.error("--agent or AGORA_AGENT_ID required");
      process.exit(2);
    }
    const r = await api(`/api/workspaces/${workspaceId()}/agents/${id}/tasks`);
    console.log(JSON.stringify(r, null, 2));
  });
