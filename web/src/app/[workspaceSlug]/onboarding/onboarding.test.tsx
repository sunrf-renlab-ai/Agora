import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, StrictMode } from "react";

// Regression test for the double-agent bug. The onboarding page mints a
// default agent the moment a usable runtime appears, guarded by
// `agents.some(a => a.ownerId === me.id)`. But `agents` comes from a
// React Query hook and is the default [] until the query settles — so a
// member who already owns an agent (e.g. bounced back to /onboarding by
// the gate after a runtime blip) would create a SECOND identical agent
// if the runtime resolved before the agents query did.
//
// The fix gates creation on `agentsFetched`. These tests render the real
// OnboardingPage and pin both directions.

// React's use() reads a thenable synchronously when it is already marked
// fulfilled — no Suspense, no hang.
function fulfilled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status: string; value: T };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

const createAgentMock = mock(async () => ({ id: "agent-1" }));
const routerReplace = mock((_: string) => {});
const routerPush = mock((_: string) => {});

const ONLINE_RUNTIME = {
  id: "rt-1",
  workspaceId: "ws-1",
  memberId: "member-1",
  name: "test-machine",
  daemonVersion: "0.0.1",
  online: true,
  detectedClis: [{ kind: "claude_code", version: "1.0" }],
  lastHeartbeatAt: null,
  runtimeInfo: {},
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

// Mutated per test, before render. The mock returns this exact reference
// so it stays stable across renders (a fresh object each render would
// change effect deps and spin an infinite re-render loop).
let agentsResult: { data: unknown[]; isFetched: boolean } = { data: [], isFetched: true };

// Every mocked hook must return a STABLE reference across renders.
const SUPABASE_CLIENT = {
  auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) },
};
const ROUTER = { push: routerPush, replace: routerReplace };
const RUNTIMES_RESULT = { data: [ONLINE_RUNTIME], isFetched: true };
const CREATE_AGENT_RESULT = { mutateAsync: createAgentMock, isPending: false };
const MEMBERS_RESULT = {
  data: [{ id: "member-1", userId: "user-1", workspaceId: "ws-1", role: "member" }],
  isFetched: true,
};
const TOAST_RESULT = { toast: () => {} };
const QUERY_CLIENT = { invalidateQueries: () => {} };
const API = {
  listWorkspaces: async () => [{ id: "ws-1", slug: "demo" }],
  getMe: async () => ({ id: "user-1", name: "Runfeng", email: "r@example.com" }),
  quickPair: async () => ({ code: "PAIRCODE" }),
};

mock.module("@/lib/supabase/client", () => ({ createClient: () => SUPABASE_CLIENT }));
mock.module("@/lib/api", () => ({ api: API }));
mock.module("@/hooks/useRuntimes", () => ({ useRuntimes: () => RUNTIMES_RESULT }));
mock.module("@/hooks/useAgents", () => ({
  useAgents: () => agentsResult,
  useCreateAgent: () => CREATE_AGENT_RESULT,
}));
mock.module("@/hooks/useMembers", () => ({ useMembers: () => MEMBERS_RESULT }));
mock.module("@/hooks/useWSChannel", () => ({ useWSChannel: () => {} }));
mock.module("@/components/ui/Toast", () => ({ useToast: () => TOAST_RESULT }));
mock.module("@tanstack/react-query", () => ({ useQueryClient: () => QUERY_CLIENT }));
mock.module("next/navigation", () => ({ useRouter: () => ROUTER }));

// Import AFTER the mocks are registered so the page picks them up.
const { render, cleanup } = await import("@testing-library/react");
const OnboardingPage = (await import("./page")).default;

// Drive React: flush the async getSession chain and effects.
async function pump(ticks = 25): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function renderOnboarding(): Promise<void> {
  await act(async () => {
    render(
      <StrictMode>
        <OnboardingPage params={fulfilled({ workspaceSlug: "demo" })} />
      </StrictMode>,
    );
  });
}

describe("OnboardingPage — default agent creation", () => {
  beforeEach(() => {
    createAgentMock.mockClear();
    routerReplace.mockClear();
    routerPush.mockClear();
  });
  afterEach(() => cleanup());

  test("does NOT create an agent while the agents query is still loading", async () => {
    // isFetched:false → `agents` is an unconfirmed []. Creating here is the
    // bug: a member who already owns an agent gets a duplicate.
    agentsResult = { data: [], isFetched: false };
    await renderOnboarding();
    await pump();
    expect(createAgentMock).not.toHaveBeenCalled();
  });

  test("creates exactly one agent once the agents query confirms none exist", async () => {
    agentsResult = { data: [], isFetched: true };
    await renderOnboarding();
    await pump();
    expect(createAgentMock).toHaveBeenCalledTimes(1);
  });

  test("does not create an agent when this member already owns one", async () => {
    agentsResult = {
      data: [{ id: "existing", ownerId: "user-1", workspaceId: "ws-1" }],
      isFetched: true,
    };
    await renderOnboarding();
    await pump();
    expect(createAgentMock).not.toHaveBeenCalled();
  });
});
