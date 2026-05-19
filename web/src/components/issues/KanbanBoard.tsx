"use client";
import { useUpdateIssue } from "@/hooks/useIssues";
import type { Issue, IssuePriority, IssueStatus } from "@agora/shared";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import { IssueCard } from "./IssueCard";
import { StatusIcon } from "./pickers/icons";

const STATUS_KEYS = new Set<string>([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
]);

type GroupBy = "status" | "priority" | "assignee";

interface ColumnDef {
  key: string;
  label: string;
  // For status grouping the patch payload is { status: <key> }; for others
  // we patch the column's natural field.
  patch: (key: string) => Partial<{
    status: IssueStatus;
    priority: IssuePriority;
    assigneeKind: "member" | "agent" | null;
    assigneeId: string | null;
  }>;
}

const STATUS_COLUMNS: ColumnDef[] = [
  { key: "backlog", label: "Backlog", patch: (k) => ({ status: k as IssueStatus }) },
  { key: "todo", label: "Todo", patch: (k) => ({ status: k as IssueStatus }) },
  { key: "in_progress", label: "In Progress", patch: (k) => ({ status: k as IssueStatus }) },
  { key: "in_review", label: "In Review", patch: (k) => ({ status: k as IssueStatus }) },
  { key: "done", label: "Done", patch: (k) => ({ status: k as IssueStatus }) },
  { key: "blocked", label: "Blocked", patch: (k) => ({ status: k as IssueStatus }) },
  { key: "cancelled", label: "Cancelled", patch: (k) => ({ status: k as IssueStatus }) },
];

const PRIORITY_COLUMNS: ColumnDef[] = [
  { key: "urgent", label: "Urgent", patch: (k) => ({ priority: k as IssuePriority }) },
  { key: "high", label: "High", patch: (k) => ({ priority: k as IssuePriority }) },
  { key: "medium", label: "Medium", patch: (k) => ({ priority: k as IssuePriority }) },
  { key: "low", label: "Low", patch: (k) => ({ priority: k as IssuePriority }) },
  { key: "none", label: "No priority", patch: (k) => ({ priority: k as IssuePriority }) },
];

interface Props {
  issues: Issue[];
  workspaceSlug: string;
  token: string | null;
  workspaceId: string | null;
}

/**
 * Kanban board with selectable group-by axis and multi-select drag.
 *
 * - **Group by** (top-right toggle): Status / Priority / Assignee. The drag
 *   payload is whichever field maps to the column the card lands in.
 * - **Multi-select**: shift-click cards to add them to a selection set;
 *   click without shift clears selection. Dragging a selected card moves
 *   the entire selection together (one PATCH per issue, all to the same
 *   target column).
 */
export function KanbanBoard({ issues, workspaceSlug, token, workspaceId }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const update = useUpdateIssue(token, workspaceId);

  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const columns: ColumnDef[] = useMemo(() => {
    if (groupBy === "status") return STATUS_COLUMNS;
    if (groupBy === "priority") return PRIORITY_COLUMNS;
    // Assignee groups: one column per distinct assignee + "Unassigned".
    const seen = new Map<string, string>(); // key -> label
    seen.set("__unassigned", "Unassigned");
    for (const i of issues) {
      if (!i.assigneeId) continue;
      const label = i.assignee?.name ?? `Assignee ${i.assigneeId.slice(0, 6)}…`;
      seen.set(i.assigneeId, label);
    }
    return Array.from(seen.entries()).map(([key, label]) => ({
      key,
      label,
      patch: (k) =>
        k === "__unassigned"
          ? { assigneeKind: null, assigneeId: null }
          : // assigneeKind is preserved on the issue when only id changes; pick
            // member by default for cross-column drags. (Agents typically aren't
            // re-assigned via Kanban anyway.)
            { assigneeKind: "member", assigneeId: k },
    }));
  }, [groupBy, issues]);

  const grouped = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const c of columns) map.set(c.key, []);
    for (const i of issues) {
      const k = bucketFor(i, groupBy);
      const bucket = map.get(k) ?? [];
      bucket.push(i);
      map.set(k, bucket);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [issues, columns, groupBy]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const draggedId = String(active.id);

    // Resolve the target column key.
    const overId = String(over.id);
    let targetKey: string;
    let targetPosition: number;
    if (overId.startsWith("column:")) {
      targetKey = overId.slice("column:".length);
      const col = grouped.get(targetKey) ?? [];
      const last = col[col.length - 1];
      targetPosition = last ? last.position + 1024 : 1024;
    } else {
      const overIssue = issues.find((i) => i.id === overId);
      if (!overIssue) return;
      targetKey = bucketFor(overIssue, groupBy);
      targetPosition = overIssue.position;
    }

    // The patch shape comes from the column definition for this group-by.
    const col = columns.find((c) => c.key === targetKey);
    if (!col) return;
    const patch = col.patch(targetKey);

    // If the dragged card is part of the multi-selection, move them all.
    // Otherwise just move the dragged card. Position only applies to the
    // primary card; followers append to the column with widening gaps.
    const moving = selected.has(draggedId) ? Array.from(selected) : [draggedId];

    let posCursor = targetPosition;
    for (const id of moving) {
      const issue = issues.find((x) => x.id === id);
      if (!issue) continue;
      // Skip if nothing would change.
      const sameBucket = bucketFor(issue, groupBy) === targetKey;
      const samePos = id === draggedId && issue.position === targetPosition;
      if (sameBucket && samePos) continue;
      update.mutate({
        issueId: id,
        data: { ...patch, position: posCursor },
      });
      posCursor += 16; // small gap so React Query refetch keeps the order stable
    }
    // Selection survives the drag so users can keep nudging things.
  }

  function toggleSelected(id: string, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        // Plain click: select-only this card if not already alone-selected.
        if (next.size === 1 && next.has(id)) {
          next.clear();
        } else {
          next.clear();
          next.add(id);
        }
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Group by</span>
          <div className="inline-flex items-center bg-gray-100 rounded-md p-0.5">
            {(["status", "priority", "assignee"] as GroupBy[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroupBy(g);
                  setSelected(new Set());
                }}
                aria-pressed={groupBy === g}
                className={`px-2.5 py-0.5 rounded-sm font-medium transition-colors ${
                  groupBy === g
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        {selected.size > 0 && (
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <span>{selected.size} selected</span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-indigo-600 hover:underline"
            >
              clear
            </button>
          </div>
        )}
      </div>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 p-4 flex-1 overflow-x-auto">
          {columns.map((col) => {
            const colIssues = grouped.get(col.key) ?? [];
            return (
              <KanbanColumn
                key={col.key}
                columnKey={col.key}
                label={col.label}
                issues={colIssues}
                workspaceSlug={workspaceSlug}
                selected={selected}
                onSelect={toggleSelected}
                draggingId={activeId}
              />
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}

function bucketFor(issue: Issue, groupBy: GroupBy): string {
  if (groupBy === "status") return issue.status;
  if (groupBy === "priority") return issue.priority;
  return issue.assigneeId ?? "__unassigned";
}

interface KanbanColumnProps {
  columnKey: string;
  label: string;
  issues: Issue[];
  workspaceSlug: string;
  selected: Set<string>;
  onSelect: (id: string, shift: boolean) => void;
  draggingId: string | null;
}

function KanbanColumn({
  columnKey,
  label,
  issues,
  workspaceSlug,
  selected,
  onSelect,
  draggingId,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${columnKey}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-72 shrink-0 rounded-lg p-2.5 transition-colors ${
        isOver
          ? "bg-indigo-50/60 ring-1 ring-inset ring-indigo-200"
          : "bg-gray-100/60"
      }`}
    >
      <div className="flex items-center gap-2 px-1.5 pb-2.5 mb-1.5 border-b border-gray-200/70">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-800">
          {STATUS_KEYS.has(columnKey) && (
            <StatusIcon status={columnKey as IssueStatus} className="size-3.5" />
          )}
          {label}
        </span>
        <span className="font-display italic text-[12px] text-gray-400 tabular-nums ml-auto">
          {issues.length}
        </span>
      </div>
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 min-h-[2rem]">
          {issues.length === 0 ? (
            <div className="text-[11px] text-gray-400 italic px-2 py-3">empty</div>
          ) : (
            issues.map((issue) => (
              <SortableIssueCard
                key={issue.id}
                issue={issue}
                workspaceSlug={workspaceSlug}
                selected={selected.has(issue.id)}
                onSelect={onSelect}
                isDraggingPrimary={draggingId === issue.id}
                isDraggingFollower={
                  draggingId !== null &&
                  draggingId !== issue.id &&
                  selected.has(issue.id) &&
                  selected.has(draggingId)
                }
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

interface SortableIssueCardProps {
  issue: Issue;
  workspaceSlug: string;
  selected: boolean;
  onSelect: (id: string, shift: boolean) => void;
  isDraggingPrimary: boolean;
  isDraggingFollower: boolean;
}

function SortableIssueCard({
  issue,
  workspaceSlug,
  selected,
  onSelect,
  isDraggingPrimary,
  isDraggingFollower,
}: SortableIssueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || isDraggingFollower ? 0.4 : 1,
  };
  // Click selects; the dnd handle is the card body. Stop click propagation
  // when shift is held so the parent link doesn't navigate.
  function handleClick(e: React.MouseEvent) {
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(issue.id, true);
    } else if (selected) {
      // Clicking an already-selected card without shift is treated as a
      // "deselect this one" rather than navigate, so the user can recover
      // from accidental selection. Plain click on an unselected card still
      // navigates (link inside IssueCard handles that).
      e.preventDefault();
      e.stopPropagation();
      onSelect(issue.id, false);
    }
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.shiftKey) onSelect(issue.id, true);
      }}
      className={`${selected ? "ring-2 ring-indigo-500 rounded-lg" : ""} ${
        isDraggingPrimary ? "shadow-lg" : ""
      }`}
    >
      <IssueCard issue={issue} workspaceSlug={workspaceSlug} variant="card" />
    </div>
  );
}
