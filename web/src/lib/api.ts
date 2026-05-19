// Fall back to "" (same-origin relative paths) so production builds without
// NEXT_PUBLIC_API_URL still work via Vercel's /api/* → Render rewrite.
// localhost:8080 only kicks in for `next dev` where the env file sets it.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function apiFetch(
  path: string,
  options: RequestInit & { token?: string; workspaceId?: string } = {},
) {
  const { token, workspaceId, ...rest } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspaceId) headers["X-Workspace-ID"] = workspaceId;

  const res = await fetch(`${API_URL}${path}`, { ...rest, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Request failed");
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getMe: (token: string) => apiFetch("/api/me", { token }),
  patchMe: (token: string, data: { name?: string }) =>
    apiFetch("/api/me", { method: "PATCH", token, body: JSON.stringify(data) }),

  // Pre-approve a CLI pair code so the install script can fetch a PAT
  // without the user running `agorad login`.
  quickPair: (token: string) => apiFetch("/api/cli/quick-pair", { method: "POST", token }),

  listWorkspaces: (token: string) => apiFetch("/api/workspaces", { token }),
  createWorkspace: (token: string, data: { name: string; slug: string; description?: string }) =>
    apiFetch("/api/workspaces", { method: "POST", token, body: JSON.stringify(data) }),
  getWorkspace: (token: string, id: string) =>
    apiFetch(`/api/workspaces/${id}`, { token, workspaceId: id }),
  updateWorkspace: (
    token: string,
    id: string,
    data: Partial<{ name: string; description: string }>,
  ) =>
    apiFetch(`/api/workspaces/${id}`, {
      method: "PATCH",
      token,
      workspaceId: id,
      body: JSON.stringify(data),
    }),

  listMembers: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/members`, { token, workspaceId }),
  inviteMember: (
    token: string,
    workspaceId: string,
    data: { email?: string; role?: string },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/members`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateMember: (token: string, workspaceId: string, memberId: string, data: { role: string }) =>
    apiFetch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  removeMember: (token: string, workspaceId: string, memberId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  listInvitations: (token: string) => apiFetch("/api/invitations", { token }),
  getInvitation: (token: string, invToken: string) =>
    apiFetch(`/api/invitations/${invToken}`, { token }),
  acceptInvitation: (token: string, invToken: string) =>
    apiFetch(`/api/invitations/${invToken}/accept`, { method: "POST", token }),
  declineInvitation: (token: string, invToken: string) =>
    apiFetch(`/api/invitations/${invToken}/decline`, { method: "POST", token }),

  // Issues
  listIssues: (
    token: string,
    workspaceId: string,
    params?: { status?: string; labelIds?: string[]; projectId?: string },
  ) => {
    const qp = new URLSearchParams();
    if (params?.status) qp.set("status", params.status);
    if (params?.labelIds && params.labelIds.length > 0)
      qp.set("labelIds", params.labelIds.join(","));
    if (params?.projectId) qp.set("projectId", params.projectId);
    const qs = qp.toString();
    return apiFetch(`/api/workspaces/${workspaceId}/issues${qs ? `?${qs}` : ""}`, {
      token,
      workspaceId,
    });
  },
  searchIssues: (token: string, workspaceId: string, q: string, offset = 0) =>
    apiFetch(
      `/api/workspaces/${workspaceId}/issues/search?q=${encodeURIComponent(q)}&offset=${offset}`,
      { token, workspaceId },
    ),
  getIssue: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}`, { token, workspaceId }),
  createIssue: (
    token: string,
    workspaceId: string,
    data: {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeKind?: string;
      assigneeId?: string;
      parentIssueId?: string;
      projectId?: string;
      dueDate?: string;
    },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateIssue: (
    token: string,
    workspaceId: string,
    issueId: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deleteIssue: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
  rerunIssue: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/rerun`, {
      method: "POST",
      token,
      workspaceId,
    }),
  batchUpdateIssues: (
    token: string,
    workspaceId: string,
    ids: string[],
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/batch-update`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ ids, ...data }),
    }),
  batchDeleteIssues: (token: string, workspaceId: string, ids: string[]) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/batch-delete`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ ids }),
    }),

  // Comments
  listComments: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/comments`, { token, workspaceId }),
  createComment: (token: string, workspaceId: string, issueId: string, content: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/comments`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ content }),
    }),
  updateComment: (
    token: string,
    workspaceId: string,
    issueId: string,
    commentId: string,
    content: string,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/comments/${commentId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify({ content }),
    }),
  deleteComment: (token: string, workspaceId: string, issueId: string, commentId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/comments/${commentId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  // Subscribers
  subscribeToIssue: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/subscribers`, {
      method: "POST",
      token,
      workspaceId,
    }),
  unsubscribeFromIssue: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/subscribers`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  // Activity
  listActivity: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/activity`, { token, workspaceId }),

  // Agents
  listAgents: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/agents`, { token, workspaceId }),
  getAgent: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/agents/${id}`, { token, workspaceId }),
  createAgent: (token: string, workspaceId: string, data: Record<string, unknown>) =>
    apiFetch(`/api/workspaces/${workspaceId}/agents`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateAgent: (token: string, workspaceId: string, id: string, data: Record<string, unknown>) =>
    apiFetch(`/api/workspaces/${workspaceId}/agents/${id}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  archiveAgent: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/agents/${id}/archive`, {
      method: "POST",
      token,
      workspaceId,
    }),

  // Runtimes
  listRuntimes: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/runtimes`, { token, workspaceId }),
  deleteRuntime: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/runtimes/${id}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  // Tasks
  listTasksForIssue: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/tasks`, { token, workspaceId }),
  cancelTask: (token: string, workspaceId: string, taskId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/cancel`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({}),
    }),
  listTaskMessages: (
    token: string,
    workspaceId: string,
    taskId: string,
    params?: { since?: number; limit?: number },
  ) => {
    const qp = new URLSearchParams();
    if (params?.since !== undefined) qp.set("since", String(params.since));
    if (params?.limit !== undefined) qp.set("limit", String(params.limit));
    const qs = qp.toString();
    return apiFetch(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/messages${qs ? `?${qs}` : ""}`,
      { token, workspaceId },
    );
  },

  // Quick Create
  quickCreateIssue: (token: string, workspaceId: string, agentId: string, prompt: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/quick-create`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ agentId, prompt }),
    }),

  // Autopilots
  listAutopilots: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots`, { token, workspaceId }),
  getAutopilot: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${id}`, { token, workspaceId }),
  createAutopilot: (token: string, workspaceId: string, data: Record<string, unknown>) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateAutopilot: (
    token: string,
    workspaceId: string,
    id: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${id}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deleteAutopilot: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${id}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
  manualTriggerAutopilot: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${id}/trigger`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({}),
    }),
  createTrigger: (
    token: string,
    workspaceId: string,
    autopilotId: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${autopilotId}/triggers`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateTrigger: (
    token: string,
    workspaceId: string,
    autopilotId: string,
    triggerId: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${autopilotId}/triggers/${triggerId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deleteTrigger: (token: string, workspaceId: string, autopilotId: string, triggerId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${autopilotId}/triggers/${triggerId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
  listAutopilotRuns: (token: string, workspaceId: string, autopilotId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/autopilots/${autopilotId}/runs`, {
      token,
      workspaceId,
    }),

  // Inbox
  listInbox: (token: string, workspaceId: string, archived = false) =>
    apiFetch(`/api/workspaces/${workspaceId}/inbox?archived=${archived}`, { token, workspaceId }),
  markInboxRead: (token: string, workspaceId: string, itemId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/inbox/${itemId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify({ read: true }),
    }),
  markAllInboxRead: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/inbox/mark-all-read`, {
      method: "POST",
      token,
      workspaceId,
    }),
  archiveInbox: (token: string, workspaceId: string, itemId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/inbox/${itemId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify({ archived: true }),
    }),
  archiveAllInbox: (token: string, workspaceId: string, scope: "all" | "read" = "all") =>
    apiFetch(`/api/workspaces/${workspaceId}/inbox/archive-all?scope=${scope}`, {
      method: "POST",
      token,
      workspaceId,
    }),

  // Chat
  listChatSessions: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/chat/sessions`, { token, workspaceId }),
  createChatSession: (
    token: string,
    workspaceId: string,
    data: { agentId: string; title?: string },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/chat/sessions`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  renameChatSession: (token: string, workspaceId: string, sessionId: string, title: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/chat/sessions/${sessionId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify({ title }),
    }),
  deleteChatSession: (token: string, workspaceId: string, sessionId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/chat/sessions/${sessionId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
  listChatMessages: (token: string, workspaceId: string, sessionId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/chat/sessions/${sessionId}/messages`, {
      token,
      workspaceId,
    }),
  sendChatMessage: (token: string, workspaceId: string, sessionId: string, content: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/chat/sessions/${sessionId}/messages`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ content }),
    }),

  // Projects
  listProjects: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/projects`, { token, workspaceId }),
  getProject: (token: string, workspaceId: string, projectId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/projects/${projectId}`, { token, workspaceId }),
  createProject: (token: string, workspaceId: string, data: Record<string, unknown>) =>
    apiFetch(`/api/workspaces/${workspaceId}/projects`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateProject: (
    token: string,
    workspaceId: string,
    projectId: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/projects/${projectId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deleteProject: (token: string, workspaceId: string, projectId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/projects/${projectId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
  addProjectResource: (
    token: string,
    workspaceId: string,
    projectId: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/projects/${projectId}/resources`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  removeProjectResource: (
    token: string,
    workspaceId: string,
    projectId: string,
    resourceId: string,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  // Skills
  listSkills: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/skills`, { token, workspaceId }),
  getSkill: (token: string, workspaceId: string, skillId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/skills/${skillId}`, { token, workspaceId }),
  createSkill: (token: string, workspaceId: string, data: Record<string, unknown>) =>
    apiFetch(`/api/workspaces/${workspaceId}/skills`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateSkill: (
    token: string,
    workspaceId: string,
    skillId: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/skills/${skillId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deleteSkill: (token: string, workspaceId: string, skillId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/skills/${skillId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
  importSkillUrl: (token: string, workspaceId: string, url: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/skills/import`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ url }),
    }),

  // Agent ↔ Skills
  listAgentSkills: (token: string, workspaceId: string, agentId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/agents/${agentId}/skills`, { token, workspaceId }),
  setAgentSkills: (token: string, workspaceId: string, agentId: string, skillIds: string[]) =>
    apiFetch(`/api/workspaces/${workspaceId}/agents/${agentId}/skills`, {
      method: "PUT",
      token,
      workspaceId,
      body: JSON.stringify({ skillIds }),
    }),

  // Local skill discovery
  requestLocalSkillList: (token: string, workspaceId: string, runtimeId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/list`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({}),
    }),
  getLocalSkillListRequest: (
    token: string,
    workspaceId: string,
    runtimeId: string,
    requestId: string,
  ) =>
    apiFetch(
      `/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/list/${requestId}`,
      { token, workspaceId },
    ),
  requestLocalSkillImport: (
    token: string,
    workspaceId: string,
    runtimeId: string,
    data: {
      skillKey: string;
      name?: string;
      description?: string;
      visibility?: "workspace" | "public";
    },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/import`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  getLocalSkillImportRequest: (
    token: string,
    workspaceId: string,
    runtimeId: string,
    requestId: string,
  ) =>
    apiFetch(
      `/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/import/${requestId}`,
      { token, workspaceId },
    ),

  // ---------- Phase 7: Labels ----------
  listLabels: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/labels`, { token, workspaceId }),
  createLabel: (token: string, workspaceId: string, data: { name: string; color: string }) =>
    apiFetch(`/api/workspaces/${workspaceId}/labels`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateLabel: (
    token: string,
    workspaceId: string,
    labelId: string,
    data: Partial<{ name: string; color: string }>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/labels/${labelId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deleteLabel: (token: string, workspaceId: string, labelId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/labels/${labelId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
  // Server uses PUT-replace semantics for issue label bindings.
  setIssueLabels: (token: string, workspaceId: string, issueId: string, labelIds: string[]) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/labels`, {
      method: "PUT",
      token,
      workspaceId,
      body: JSON.stringify({ labelIds }),
    }),

  // ---------- Onboarding: provision a new runtime token ----------
  provisionRuntime: (token: string, workspaceId: string, data: { name: string }) =>
    apiFetch(`/api/workspaces/${workspaceId}/runtimes/provision`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }) as Promise<{ runtimeId: string; machineToken: string }>,

  // ---------- Phase 7: Dependencies ----------
  listDependencies: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/dependencies`, {
      token,
      workspaceId,
    }),
  listAllDependencies: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/dependencies`, { token, workspaceId }),
  addDependency: (
    token: string,
    workspaceId: string,
    issueId: string,
    data: { dependsOnIssueId: string; type: "blocks" | "related" },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/dependencies`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  removeDependency: (token: string, workspaceId: string, issueId: string, depId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/dependencies/${depId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  // ---------- Phase 7: Reactions ----------
  listIssueReactions: (token: string, workspaceId: string, issueId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/reactions`, { token, workspaceId }),
  addIssueReaction: (token: string, workspaceId: string, issueId: string, emoji: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/issues/${issueId}/reactions`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ emoji }),
    }),
  removeIssueReaction: (token: string, workspaceId: string, issueId: string, emoji: string) =>
    apiFetch(
      `/api/workspaces/${workspaceId}/issues/${issueId}/reactions/${encodeURIComponent(emoji)}`,
      { method: "DELETE", token, workspaceId },
    ),
  listCommentReactions: (token: string, workspaceId: string, commentId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/comments/${commentId}/reactions`, {
      token,
      workspaceId,
    }),
  addCommentReaction: (token: string, workspaceId: string, commentId: string, emoji: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/comments/${commentId}/reactions`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify({ emoji }),
    }),
  removeCommentReaction: (token: string, workspaceId: string, commentId: string, emoji: string) =>
    apiFetch(
      `/api/workspaces/${workspaceId}/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`,
      { method: "DELETE", token, workspaceId },
    ),

  // ---------- Phase 7: Attachments ----------
  signAttachmentUpload: (
    token: string,
    workspaceId: string,
    data: {
      ownerKind: "issue" | "comment" | "chat_message";
      ownerId: string;
      filename: string;
      contentType: string;
      size: number;
    },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/attachments/sign-upload`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  recordAttachment: (
    token: string,
    workspaceId: string,
    data: {
      ownerKind: "issue" | "comment" | "chat_message";
      ownerId: string;
      filename: string;
      contentType: string;
      size: number;
      storageKey: string;
    },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/attachments`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  listAttachments: (token: string, workspaceId: string, ownerKind: string, ownerId: string) =>
    apiFetch(
      `/api/workspaces/${workspaceId}/attachments?ownerKind=${ownerKind}&ownerId=${ownerId}`,
      { token, workspaceId },
    ),
  getAttachmentDownloadUrl: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/attachments/${id}/download`, {
      token,
      workspaceId,
    }),
  deleteAttachment: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/attachments/${id}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  // ---------- Phase 7: Pins ----------
  listPins: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/pins`, { token, workspaceId }),
  createPin: (
    token: string,
    workspaceId: string,
    data: { itemType: "issue" | "project" | "agent"; itemId: string },
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/pins`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deletePin: (token: string, workspaceId: string, id: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/pins/${id}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),

  // ---------- Phase 8: Notification preferences, PATs, Feedback, Profile ----------
  getNotificationPreferences: (token: string) =>
    apiFetch("/api/me/notification-preferences", { token }),
  updateNotificationPreferences: (token: string, prefs: Record<string, unknown>) =>
    apiFetch("/api/me/notification-preferences", {
      method: "PATCH",
      token,
      body: JSON.stringify(prefs),
    }),
  listPats: (token: string) => apiFetch("/api/me/tokens", { token }),
  createPat: (token: string, data: { name: string; expiresAt?: string | null }) =>
    apiFetch("/api/me/tokens", { method: "POST", token, body: JSON.stringify(data) }),
  revokePat: (token: string, tokenId: string) =>
    apiFetch(`/api/me/tokens/${tokenId}/revoke`, { method: "POST", token }),
  listMyFeedback: (token: string) => apiFetch("/api/me/feedback", { token }),
  submitFeedback: (token: string, data: Record<string, unknown>) =>
    apiFetch("/api/feedback", { method: "POST", token, body: JSON.stringify(data) }),
  updateMe: (token: string, data: { name?: string; avatarUrl?: string | null }) =>
    apiFetch("/api/me", { method: "PATCH", token, body: JSON.stringify(data) }),

  // ---------- Connections (per-user OAuth) ----------
  listMyConnections: (token: string) => apiFetch("/api/me/connections", { token }),
  listWorkspaceConnections: (token: string, workspaceId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/connections`, { token, workspaceId }),
  startConnection: (token: string, kind: string) =>
    apiFetch(`/api/connections/${kind}/start`, { method: "POST", token }) as Promise<{
      authorizeUrl: string;
    }>,
  disconnectConnection: (token: string, kind: string) =>
    apiFetch(`/api/me/connections/${kind}`, { method: "DELETE", token }),

  // ---------- Knowledge base ----------
  listKnowledge: (token: string, workspaceId: string, projectId?: string) =>
    apiFetch(
      `/api/workspaces/${workspaceId}/knowledge${projectId ? `?projectId=${projectId}` : ""}`,
      { token, workspaceId },
    ),
  getKnowledge: (token: string, workspaceId: string, docId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/knowledge/${docId}`, { token, workspaceId }),
  createKnowledge: (token: string, workspaceId: string, data: Record<string, unknown>) =>
    apiFetch(`/api/workspaces/${workspaceId}/knowledge`, {
      method: "POST",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  updateKnowledge: (
    token: string,
    workspaceId: string,
    docId: string,
    data: Record<string, unknown>,
  ) =>
    apiFetch(`/api/workspaces/${workspaceId}/knowledge/${docId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: JSON.stringify(data),
    }),
  deleteKnowledge: (token: string, workspaceId: string, docId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/knowledge/${docId}`, {
      method: "DELETE",
      token,
      workspaceId,
    }),
};
