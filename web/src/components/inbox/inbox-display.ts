// Type-aware label + badge color for inbox items. Stays string-only (no
// JSX) so it can be imported by both list-item and detail panels without
// React deps.

const TYPE_LABELS: Record<string, string> = {
  issue_assigned: "Assigned",
  unassigned: "Unassigned",
  assignee_changed: "Reassigned",
  status_changed: "Status changed",
  priority_changed: "Priority changed",
  due_date_changed: "Due date changed",
  new_comment: "New comment",
  mentioned: "Mentioned",
  review_requested: "Review requested",
  task_completed: "Task completed",
  task_failed: "Task failed",
  agent_blocked: "Agent blocked",
  agent_completed: "Agent completed",
  reaction_added: "Reaction",
  quick_create_completed: "Created with agent",
  quick_create_failed: "Create with agent failed",
  issue_escalated: "Escalated to a human",
  issue_task_failed: "Agent task failed",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function typeBadgeColor(type: string): string {
  if (
    type === "quick_create_completed" ||
    type === "task_completed" ||
    type === "agent_completed"
  ) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (
    type === "quick_create_failed" ||
    type === "task_failed" ||
    type === "agent_blocked" ||
    type === "issue_escalated" ||
    type === "issue_task_failed"
  ) {
    return "bg-rose-50 text-rose-700";
  }
  if (type === "mentioned" || type === "review_requested") {
    return "bg-violet-50 text-violet-700";
  }
  if (type === "new_comment" || type === "reaction_added") {
    return "bg-sky-50 text-sky-700";
  }
  return "bg-gray-100 text-gray-700";
}
