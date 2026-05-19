"use client";
import { useAgents } from "@/hooks/useAgents";
import type { Agent, Member } from "@agora/shared";

interface Props {
  token: string | null;
  workspaceId: string | null;
  members: Member[];
  assigneeKind: "member" | "agent" | null;
  assigneeId: string | null;
  onChange: (kind: "member" | "agent" | null, id: string | null) => void;
}

export function AssigneePicker({
  token,
  workspaceId,
  members,
  assigneeKind,
  assigneeId,
  onChange,
}: Props) {
  const { data: agents = [] } = useAgents(token, workspaceId);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === "") {
      onChange(null, null);
      return;
    }
    const [kind, id] = val.split(":", 2);
    if ((kind === "member" || kind === "agent") && id !== undefined) {
      onChange(kind, id);
    }
  }

  const currentValue = assigneeKind && assigneeId ? `${assigneeKind}:${assigneeId}` : "";

  return (
    <select
      aria-label="Assignee"
      value={currentValue}
      onChange={handleChange}
      className="w-full border rounded px-2 py-1.5 text-sm"
    >
      <option value="">Unassigned</option>
      {members.length > 0 && (
        <optgroup label="Members">
          {members.map((m: Member) => (
            <option key={m.id} value={`member:${m.userId}`}>
              {m.user.name}
            </option>
          ))}
        </optgroup>
      )}
      {agents.length > 0 && (
        <optgroup label="Agents">
          {agents
            .filter((a: Agent) => !a.archivedAt)
            .map((a: Agent) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name}
              </option>
            ))}
        </optgroup>
      )}
    </select>
  );
}
