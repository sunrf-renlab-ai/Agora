import { Command } from "commander";

export const versionCmd = new Command("version").description("Print CLI version").action(() => {
  console.log("agora cli 0.0.1");
});
