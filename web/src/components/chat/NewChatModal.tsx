"use client";
import { useAgents } from "@/hooks/useAgents";
import { useCreateChatSession } from "@/hooks/useChatSessions";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | null;
  workspaceId: string | null;
  workspaceSlug: string;
}

export function NewChatModal({ open, onClose, token, workspaceId, workspaceSlug }: Props) {
  const router = useRouter();
  const { data: agents = [] } = useAgents(token, workspaceId);
  const createSession = useCreateChatSession(token, workspaceId);
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");

  const activeAgents = agents.filter((a) => a.archivedAt === null);

  useEffect(() => {
    const first = activeAgents[0];
    if (open && agentId === "" && first) {
      setAgentId(first.id);
    }
  }, [open, agentId, activeAgents]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (agentId === "") return;
    const session = await createSession.mutateAsync({
      agentId,
      title: title.trim() === "" ? undefined : title.trim(),
    });
    setTitle("");
    onClose();
    router.push(`/${workspaceSlug}/chat/${session.id}`);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        // biome-ignore lint/a11y/useSemanticElements: native <dialog open> uses fixed positioning that conflicts with parent flex centering
        role="dialog"
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-modal="true"
        aria-label="New chat"
      >
        <h2 className="text-lg font-bold mb-4">New chat</h2>
        {activeAgents.length === 0 ? (
          <div className="text-sm text-gray-500">
            <p className="mb-3">You need at least one active agent to start a chat.</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 border rounded"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label htmlFor="new-chat-agent" className="sr-only">
              Agent
            </label>
            <select
              id="new-chat-agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              required
            >
              {activeAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <label htmlFor="new-chat-title" className="sr-only">
              Title
            </label>
            <input
              id="new-chat-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="border rounded px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 border rounded"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createSession.isPending}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded font-medium disabled:bg-gray-300"
              >
                {createSession.isPending ? "Starting…" : "Start"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
