"use client";
import { Popover } from "@/components/ui/Popover";
import { PillButton } from "@/components/ui/PillButton";
import { useAgents } from "@/hooks/useAgents";
import { useMembers } from "@/hooks/useMembers";
import type { Agent } from "@agora/shared";
import { Bot, Check, User as UserIcon, X } from "lucide-react";
import { useMemo, useState } from "react";

export type AssigneeKind = "member" | "agent";

interface Props {
  token: string | null;
  workspaceId: string | null;
  assigneeKind: AssigneeKind | null;
  assigneeId: string | null;
  onChange: (kind: AssigneeKind | null, id: string | null) => void;
}

export function AssigneePicker({ token, workspaceId, assigneeKind, assigneeId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { data: members = [] } = useMembers(token, workspaceId);
  const { data: agents = [] } = useAgents(token, workspaceId);

  const reachableAgents = useMemo(
    () => (agents as Agent[]).filter((a) => !a.archivedAt),
    [agents],
  );

  const filteredMembers = useMemo(
    () =>
      filter.trim() === ""
        ? members
        : members.filter((m) => `${m.user.name} ${m.user.email}`.toLowerCase().includes(filter.toLowerCase())),
    [members, filter],
  );
  const filteredAgents = useMemo(
    () =>
      filter.trim() === ""
        ? reachableAgents
        : reachableAgents.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase())),
    [reachableAgents, filter],
  );

  const current =
    assigneeKind === "member"
      ? members.find((m) => m.id === assigneeId)
      : assigneeKind === "agent"
        ? reachableAgents.find((a) => a.id === assigneeId)
        : null;

  const label =
    assigneeKind === "member" && current && "user" in current
      ? current.user.name
      : assigneeKind === "agent" && current && "name" in current
        ? current.name
        : "Unassigned";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-64 py-1"
      trigger={
        <PillButton aria-label="Change assignee">
          {assigneeKind === "agent" ? (
            <Bot className="size-3.5 text-violet-600" />
          ) : (
            <UserIcon className="size-3.5 text-gray-500" />
          )}
          <span>{label}</span>
        </PillButton>
      }
    >
      <div className="px-2 pt-1.5 pb-2 border-b border-gray-100">
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search members + agents…"
          className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-600 focus:outline-none"
        />
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {assigneeKind && (
          <button
            type="button"
            onClick={() => {
              onChange(null, null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
          >
            <X className="size-3.5 text-gray-400" />
            <span className="flex-1 text-gray-500">Unassign</span>
          </button>
        )}
        {filteredAgents.length > 0 && (
          <>
            <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              Agents
            </div>
            {filteredAgents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onChange("agent", a.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                <Bot className="size-3.5 text-violet-600" />
                <span className="flex-1 truncate">{a.name}</span>
                {assigneeKind === "agent" && assigneeId === a.id && (
                  <Check className="size-3 text-gray-500" />
                )}
              </button>
            ))}
          </>
        )}
        {filteredMembers.length > 0 && (
          <>
            <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              Members
            </div>
            {filteredMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange("member", m.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                <UserIcon className="size-3.5 text-gray-500" />
                <span className="flex-1 truncate">{m.user.name}</span>
                {assigneeKind === "member" && assigneeId === m.id && (
                  <Check className="size-3 text-gray-500" />
                )}
              </button>
            ))}
          </>
        )}
        {filteredAgents.length === 0 && filteredMembers.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-gray-400">No matches.</div>
        )}
      </div>
    </Popover>
  );
}
