"use client";
import {
  useAddCommentReaction,
  useAddIssueReaction,
  useCommentReactions,
  useIssueReactions,
  useRemoveCommentReaction,
  useRemoveIssueReaction,
} from "@/hooks/useReactions";
import type { Reaction } from "@agora/shared";
import { useState } from "react";

const PALETTE = ["👍", "❤️", "🎉", "🚀", "👀", "😄"];

type Target = { kind: "issue"; issueId: string } | { kind: "comment"; commentId: string };

export function ReactionBar({
  token,
  workspaceId,
  target,
  currentUserId,
}: {
  token: string;
  workspaceId: string;
  target: Target;
  currentUserId: string;
}) {
  const issueReactions = useIssueReactions(
    token,
    workspaceId,
    target.kind === "issue" ? target.issueId : null,
  );
  const commentReactions = useCommentReactions(
    token,
    workspaceId,
    target.kind === "comment" ? target.commentId : null,
  );
  const addIssue = useAddIssueReaction(token, workspaceId);
  const removeIssue = useRemoveIssueReaction(token, workspaceId);
  const addComment = useAddCommentReaction(token, workspaceId);
  const removeComment = useRemoveCommentReaction(token, workspaceId);
  const [pickerOpen, setPickerOpen] = useState(false);

  const reactions: Reaction[] =
    target.kind === "issue" ? (issueReactions.data ?? []) : (commentReactions.data ?? []);

  const grouped = new Map<string, Reaction[]>();
  for (const r of reactions) {
    const arr = grouped.get(r.emoji) ?? [];
    arr.push(r);
    grouped.set(r.emoji, arr);
  }

  const toggle = (emoji: string, mine: boolean) => {
    if (target.kind === "issue") {
      if (mine) removeIssue.mutate({ issueId: target.issueId, emoji });
      else addIssue.mutate({ issueId: target.issueId, emoji });
    } else {
      if (mine) removeComment.mutate({ commentId: target.commentId, emoji });
      else addComment.mutate({ commentId: target.commentId, emoji });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {Array.from(grouped.entries()).map(([emoji, list]) => {
        const mine = list.some((x) => x.actorKind === "member" && x.actorId === currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => toggle(emoji, mine)}
            className={`rounded border px-2 py-0.5 text-xs ${
              mine ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white"
            }`}
            title={list.map((x) => x.actorId).join(", ")}
          >
            <span>{emoji}</span>
            <span className="ml-1">{list.length}</span>
          </button>
        );
      })}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
          aria-label="Add reaction"
        >
          +
        </button>
        {pickerOpen ? (
          <div className="absolute z-10 mt-1 flex gap-1 rounded border border-gray-200 bg-white p-1 shadow">
            {PALETTE.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  toggle(e, false);
                  setPickerOpen(false);
                }}
                className="rounded px-1 hover:bg-gray-100"
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
