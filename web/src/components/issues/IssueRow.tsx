import type { Issue } from "@agora/shared";
import { IssueCard } from "./IssueCard";

interface Props {
  issue: Issue;
  workspaceSlug: string;
}

/**
 * Backwards-compatible row wrapper. Internally renders the shared {@link IssueCard}
 * in `row` variant so list pages get the richer card content (labels, snippet,
 * priority pill, assignee avatar) without changing their callers.
 */
export function IssueRow({ issue, workspaceSlug }: Props) {
  return <IssueCard issue={issue} workspaceSlug={workspaceSlug} variant="row" />;
}
