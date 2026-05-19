import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// CLI pair codes survive Render redeploys + scale events. Was an in-memory
// Map, which silently dropped every code on container restart — caused
// real users to see 404 on /pair/exchange after we'd redeployed mid-flow.
//
// TTL is enforced at read-time (purge query); we don't run a cron. The
// table stays small because consumePair deletes on success and the
// purge query reaps the rest on every read.
export const cliPairCodes = pgTable("cli_pair_code", {
  code: text("code").primaryKey(),
  // Set by approve / quick-pair once a user authorizes the pairing.
  token: text("token"),
  userId: uuid("user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
