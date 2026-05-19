import { readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Agent flow — proves the L3 task-message pipeline works end-to-end by
 * simulating a daemon via raw HTTP. No real `claude` CLI is spawned.
 *
 *   1. Provision a fresh runtime (user-side POST) → captures machineToken.
 *   2. Create a fresh agent bound to that runtime.
 *   3. Create an issue assigned to the agent → server auto-enqueues a task.
 *   4. Claim the task as the daemon (Bearer machineToken).
 *   5. Start the task (`/start`).
 *   6. POST a batch of messages (assistant + tool_use + tool_result).
 *   7. Read them back via the user-side endpoint, assert seq order + kinds.
 *   8. Render the issue detail page in the browser, expand the agent run
 *      card under the Execution logs tab, and assert the assistant text is
 *      visible. Screenshot for the report.
 *   9. Complete the task; assert the user-side task list shows status =
 *      "completed".
 *
 * Auth: the storageState fixture carries qa@agora.test01 supabase token
 * for user-side calls. Daemon-side calls use the machineToken returned
 * by provision. All node-side fetch goes direct to the server; only the
 * browser uses the route proxy, mirroring feature-walkthrough.spec.ts.
 */
import { type Page, type Route, expect, test } from "@playwright/test";

const SERVER = "http://localhost:8080";
const SLUG = "qa-e2e";
const BASE_QUERY = "?e2e=1";

function accessToken(): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "..", "fixtures", "agora-state.json"), "utf8"),
    );
    const sb = raw.cookies.find((c: { name: string }) => c.name === "sb-127-auth-token");
    if (!sb) return null;
    const v: string = sb.value.startsWith("base64-") ? sb.value.slice(7) : sb.value;
    return JSON.parse(Buffer.from(v, "base64").toString("utf8")).access_token ?? null;
  } catch {
    return null;
  }
}
const USER_TOKEN = accessToken();

// Pass-through proxy: attaches the user bearer to /api/workspaces calls so
// the browser-driven page can hit the server through CORS. Daemon-side
// calls are made directly from node, so they don't pass through the
// browser and don't need proxying.
async function attachApiProxy(page: Page) {
  if (!USER_TOKEN) return;
  await page.context().route(`${SERVER}/api/**`, async (route: Route) => {
    const req = route.request();
    try {
      const response = await fetch(req.url(), {
        method: req.method(),
        headers: {
          ...Object.fromEntries(
            Object.entries(req.headers()).filter(([k]) => !k.toLowerCase().startsWith("sec-fetch")),
          ),
          authorization: `Bearer ${USER_TOKEN}`,
        },
        body:
          req.method() === "GET" || req.method() === "HEAD"
            ? undefined
            : (req.postData() ?? undefined),
        redirect: "manual",
      });
      const body = Buffer.from(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        if (!k.toLowerCase().startsWith("access-control")) headers[k] = v;
      });
      headers["access-control-allow-origin"] = "http://localhost:3002";
      headers["access-control-allow-credentials"] = "true";
      await route.fulfill({ status: response.status, headers, body });
    } catch {
      await route.abort();
    }
  });
}

// User-side fetch helper. Adds Authorization + X-Workspace-ID headers and
// JSON-parses the body. Throws with a useful preview on non-2xx so test
// failures point at the actual server error, not a cryptic JSON.parse.
async function userFetch<T = unknown>(
  path: string,
  init: { method?: string; workspaceId?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${USER_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (init.workspaceId) headers["X-Workspace-ID"] = init.workspaceId;
  const res = await fetch(`${SERVER}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `userFetch ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

// Daemon-side fetch helper. Uses the machineToken instead of the user
// bearer; doesn't need X-Workspace-ID because daemon routes are auth'd by
// the runtime id encoded in the token.
async function daemonFetch<T = unknown>(
  path: string,
  machineToken: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T | null> {
  const res = await fetch(`${SERVER}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${machineToken}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `daemonFetch ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return text ? (JSON.parse(text) as T) : (null as T);
}

type Workspace = { id: string; slug: string };
type Agent = { id: string; name: string; runtimeId: string | null };
type Issue = { id: string; number: number; identifier: string; title: string };
type Task = { id: string; status: string };
type ProvisionResp = { runtimeId: string; machineToken: string };
type ClaimResp = {
  task: { id: string; workspaceId: string; agentId: string; issueId: string | null };
  agent: { id: string; name: string };
  issue: { id: string; title: string } | null;
  taskToken: string;
};
type TaskMessage = {
  id: string;
  taskId: string;
  seq: number;
  kind: string;
  content: Record<string, unknown> | null;
};

// Shared state — beforeAll provisions the daemon-side context, the test
// drives it through the full message lifecycle, and the final assertions
// confirm both the user-side endpoint and the rendered UI.
let workspaceId = "";
let runtimeId = "";
let machineToken = "";
let agentId = "";
let issueId = "";
let taskId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  expect(USER_TOKEN, "USER_TOKEN must be present in agora-state.json").toBeTruthy();

  // Step 0 — resolve the qa-e2e workspace id from the user's membership list.
  const workspaces = await userFetch<Workspace[]>("/api/workspaces");
  const ws = workspaces.find((w) => w.slug === SLUG);
  expect(ws, "qa-e2e workspace must exist (run server/scripts/seed-e2e.ts)").toBeTruthy();
  workspaceId = ws!.id;

  // Step 1 — provision a fresh runtime. Idempotent on (workspace, member,
  // name); we include a timestamp so re-runs always rotate to a brand new
  // machine token rather than colliding with the seed's runtime.
  const provName = `e2e-agent-flow-${Date.now()}`;
  const prov = await userFetch<ProvisionResp>(`/api/workspaces/${workspaceId}/runtimes/provision`, {
    method: "POST",
    workspaceId,
    body: { name: provName },
  });
  expect(prov.runtimeId).toBeTruthy();
  expect(prov.machineToken).toMatch(/^agm_/);
  runtimeId = prov.runtimeId;
  machineToken = prov.machineToken;

  // Step 2 — create a fresh agent bound to the new runtime. Unique name so
  // the test is repeatable without bumping into a duplicate.
  const agent = await userFetch<Agent>(`/api/workspaces/${workspaceId}/agents`, {
    method: "POST",
    workspaceId,
    body: {
      name: `E2E Agent ${Date.now()}`,
      cliKind: "claude_code",
      runtimeId,
    },
  });
  expect(agent.id).toBeTruthy();
  expect(agent.runtimeId).toBe(runtimeId);
  agentId = agent.id;

  // Step 3 — create an issue assigned to the agent. Server auto-enqueues
  // an agent_task_queue row when assigneeKind=agent and the agent has a
  // runtime bound.
  const issue = await userFetch<Issue>(`/api/workspaces/${workspaceId}/issues`, {
    method: "POST",
    workspaceId,
    body: {
      title: `Agent flow e2e ${Date.now()}`,
      description: "Triggers the daemon-message pipeline end-to-end.",
      assigneeKind: "agent",
      assigneeId: agentId,
    },
  });
  expect(issue.id).toBeTruthy();
  issueId = issue.id;

  // Confirm the auto-enqueue happened. The list endpoint returns newest
  // first; we pick the queued/dispatched row for this agent.
  const tasks = await userFetch<Task[]>(`/api/workspaces/${workspaceId}/issues/${issueId}/tasks`, {
    workspaceId,
  });
  expect(tasks.length).toBeGreaterThanOrEqual(1);
  taskId = tasks[0]!.id;
});

test("daemon claim → POST messages → user read → render in UI → complete", async ({
  page,
}, info) => {
  // Step 4 — claim as the daemon. The endpoint pops the next queued task
  // for this runtime, transitions it to "dispatched", and returns the
  // task envelope plus a short-lived taskToken the agora CLI would use
  // for issue/comment writes.
  const claim = await daemonFetch<ClaimResp>(
    `/api/daemon/runtimes/${runtimeId}/tasks/claim`,
    machineToken,
    { method: "POST", body: {} },
  );
  expect(claim, "claim must not return 204 when a task is queued").toBeTruthy();
  expect(claim!.task.id).toBe(taskId);
  expect(claim!.task.workspaceId).toBe(workspaceId);
  expect(claim!.task.agentId).toBe(agentId);
  expect(claim!.task.issueId).toBe(issueId);
  expect(claim!.agent.id).toBe(agentId);
  expect(claim!.issue?.id).toBe(issueId);
  expect(claim!.taskToken, "claim must include taskToken").toBeTruthy();

  // Step 5 — start the task. /complete requires status=running; without
  // /start the task stays in dispatched and /complete 404s.
  await daemonFetch(`/api/daemon/tasks/${taskId}/start`, machineToken, {
    method: "POST",
    body: { sessionId: null, workDir: "/tmp/e2e" },
  });

  // Step 6 — POST a batch of three messages spanning the kinds the UI
  // actually renders differently. seq is monotonically increasing per
  // task; the server dedupes on (taskId, seq) via onConflictDoNothing.
  const postRes = await daemonFetch<{ ok: boolean; latestSeq: number }>(
    `/api/daemon/tasks/${taskId}/messages`,
    machineToken,
    {
      method: "POST",
      body: {
        messages: [
          { seq: 1, kind: "assistant", content: { text: "Hello from the simulated daemon" } },
          { seq: 2, kind: "tool_use", content: { name: "Read", input: { path: "/tmp/foo" } } },
          { seq: 3, kind: "tool_result", content: { output: "file contents" } },
        ],
      },
    },
  );
  expect(postRes).toEqual({ ok: true, latestSeq: 3 });

  // Step 7 — read back from the user-side endpoint. The server returns an
  // envelope `{ messages, nextSince }` so callers can drive incremental
  // refetch off `nextSince` without reducing-max over the page themselves.
  const envelope = await userFetch<{ messages: TaskMessage[]; nextSince: number | null }>(
    `/api/workspaces/${workspaceId}/tasks/${taskId}/messages`,
    { workspaceId },
  );
  expect(Array.isArray(envelope.messages)).toBe(true);
  expect(envelope.messages).toHaveLength(3);
  expect(envelope.nextSince).toBe(3);
  const userMessages = envelope.messages;
  expect(userMessages.map((m) => m.seq)).toEqual([1, 2, 3]);
  expect(userMessages[0]!.kind).toBe("assistant");
  expect(userMessages[0]!.content).toMatchObject({ text: "Hello from the simulated daemon" });
  expect(userMessages[1]!.kind).toBe("tool_use");
  expect(userMessages[1]!.content).toMatchObject({ name: "Read", input: { path: "/tmp/foo" } });
  expect(userMessages[2]!.kind).toBe("tool_result");
  expect(userMessages[2]!.content).toMatchObject({ output: "file contents" });

  // Step 8 — render the issue detail page, click the Execution logs tab,
  // expand the agent run card, and assert the assistant text appears.
  await attachApiProxy(page);
  await page.goto(`/${SLUG}/issues/${issueId}${BASE_QUERY}`, { waitUntil: "networkidle" });

  // Switch to the Execution logs tab. The tablist is bilingual depending
  // on the agora-locale cookie — match either label.
  const execTab = page.getByRole("tab", { name: /执行记录|Execution logs/i });
  await expect(execTab).toBeVisible({ timeout: 8000 });
  await execTab.click();
  await page.waitForTimeout(500);

  // Expand the AgentRunCard to fetch the message stream. The expand
  // button is the only "Expand" / "展开" text in the panel.
  const expandBtn = page.getByRole("button", { name: /Expand|展开/i }).first();
  await expect(expandBtn).toBeVisible({ timeout: 5000 });
  await expandBtn.click();
  await page.waitForTimeout(500);

  // The assistant message text should appear in the timeline. This is
  // the most specific evidence that the daemon → DB → user-side endpoint
  // → React Query → DOM render path actually works.
  await expect(page.getByText("Hello from the simulated daemon")).toBeVisible({
    timeout: 5000,
  });
  // The tool_result block renders the daemon's `output` payload verbatim;
  // a unique string here proves the tool_result kind round-tripped too.
  await expect(page.getByText("file contents").first()).toBeVisible({ timeout: 5000 });

  const shotPath = "e2e/screenshots/agent-flow/01-execution-logs.png";
  await page.screenshot({ path: shotPath, fullPage: true });
  await info.attach("01-execution-logs", { path: shotPath, contentType: "image/png" });

  // Step 9 — complete the task. /complete moves running → completed and
  // broadcasts task.completed; the user-side task list should reflect it.
  await daemonFetch(`/api/daemon/tasks/${taskId}/complete`, machineToken, {
    method: "POST",
    body: { result: { exitCode: 0 }, sessionId: null, workDir: "/tmp/e2e" },
  });

  const finalTasks = await userFetch<Task[]>(
    `/api/workspaces/${workspaceId}/issues/${issueId}/tasks`,
    { workspaceId },
  );
  const finalTask = finalTasks.find((t) => t.id === taskId);
  expect(finalTask?.status).toBe("completed");
});
