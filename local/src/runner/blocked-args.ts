// Per-backend filterCustomArgs() helpers.
// Each backend defines a map of flag → blockedMode; user-supplied customArgs
// containing those flags are filtered out so they cannot break the
// daemon↔CLI communication protocol (e.g. swapping --output-format json
// when the daemon expects stream-json).

import type { Logger } from "./core";

export type BlockedMode =
  /** Standalone flag, e.g. `--yolo` (no value follows). */
  | "standalone"
  /** Flag that consumes one argument, e.g. `--model gpt-4`. */
  | "with-value";

export type BlockedArgs = Record<string, BlockedMode>;

export function filterCustomArgs(
  args: readonly string[],
  blocked: BlockedArgs,
  logger?: Logger,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== "string") continue;
    // Match both `--flag` and `--flag=value` forms.
    const eq = a.indexOf("=");
    const flag = eq === -1 ? a : a.slice(0, eq);
    const mode = blocked[flag];
    if (mode === undefined) {
      out.push(a);
      continue;
    }
    if (logger) logger.warn(`filterCustomArgs: dropping blocked flag ${flag}`);
    if (mode === "with-value" && eq === -1) {
      // Skip the next token (its value) as well.
      i++;
    }
  }
  return out;
}
