import { Hono } from "hono";
import { db } from "../db/client";
import { personalAccessTokens } from "../db/schema/index";
import {
  approvePair as approvePairCode,
  consumePair,
  getPair,
  startPair,
} from "../lib/cli-pair-store";
import { jsonError } from "../lib/errors";
import { generatePat } from "../lib/pat-token";
import { authMiddleware } from "../middleware/auth";

const app = new Hono();

const APP_URL = process.env.APP_URL ?? "http://localhost:3001";

// CLI calls this on `agorad login` to get a one-time pairing code. No auth.
app.post("/api/cli/pair/start", async (c) => {
  const { code, expiresAt } = await startPair();
  return c.json({
    code,
    browserUrl: `${APP_URL}/cli/pair?code=${encodeURIComponent(code)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

// Web checks if the code exists + is unclaimed. Lets the approval page
// show "this code is invalid" instead of waiting forever.
app.get("/api/cli/pair/:code", async (c) => {
  const code = c.req.param("code");
  const row = await getPair(code);
  if (!row) return jsonError(c, 404, "Pair code not found or expired");
  return c.json({
    code: row.code,
    claimed: row.token !== null,
    expiresAt: new Date(row.expiresAt).toISOString(),
  });
});

// Authenticated user approves a code from the browser. We mint a PAT
// scoped to this device, store it on the pair row, and the polling CLI
// picks it up next round.
const approveApp = new Hono();
approveApp.use("/api/cli/pair/:code/approve", authMiddleware);
approveApp.post("/api/cli/pair/:code/approve", async (c) => {
  const code = c.req.param("code");
  const row = await getPair(code);
  if (!row) return jsonError(c, 404, "Pair code not found or expired");
  if (row.token) return jsonError(c, 409, "Pair code already approved");

  const user = c.get("user");
  const { token, hash, prefix } = generatePat();
  const [pat] = await db
    .insert(personalAccessTokens)
    .values({
      userId: user.id,
      name: `CLI device (${code})`,
      tokenHash: hash,
      tokenPrefix: prefix,
    })
    .returning();
  if (!pat) return jsonError(c, 500, "Failed to mint token");

  await approvePairCode(code, user.id, token);
  return c.json({ ok: true });
});
app.route("/", approveApp);

// One-shot start+approve for the "skip login" install flow. The web
// onboarding page (where the user is already signed in) calls this and
// bakes the resulting code into the install URL. The install script
// then runs /pair/exchange itself, so the user never has to run
// `agorad login` separately.
const quickApp = new Hono();
quickApp.use("/api/cli/quick-pair", authMiddleware);
quickApp.post("/api/cli/quick-pair", async (c) => {
  const user = c.get("user");
  const { code, expiresAt } = await startPair();
  const { token, hash, prefix } = generatePat();
  const [pat] = await db
    .insert(personalAccessTokens)
    .values({
      userId: user.id,
      name: `CLI install (${code})`,
      tokenHash: hash,
      tokenPrefix: prefix,
    })
    .returning();
  if (!pat) return jsonError(c, 500, "Failed to mint token");
  await approvePairCode(code, user.id, token);
  return c.json({ code, expiresAt: new Date(expiresAt).toISOString() });
});
app.route("/", quickApp);

// CLI polls this every 2s after start. 202 = still waiting; 200 = approved.
app.post("/api/cli/pair/exchange", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const code = (body as { code?: string }).code ?? "";
  if (!code) return jsonError(c, 400, "code is required");
  const row = await getPair(code);
  if (!row) return jsonError(c, 404, "Pair code not found or expired");
  if (!row.token) return c.body(null, 202);
  const consumed = await consumePair(code);
  if (!consumed) return jsonError(c, 500, "Race: code disappeared");
  return c.json({ token: consumed.token, userId: consumed.userId });
});

export default app;
