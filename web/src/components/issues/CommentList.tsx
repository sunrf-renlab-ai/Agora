"use client";
import { Markdown } from "@/components/ui/Markdown";
import type { Comment } from "@agora/shared";
import { CommentInput } from "./CommentInput";

interface Props {
  comments: Comment[];
  currentUserId: string;
  onAdd: (content: string) => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
  /** Required for mention lookups + attachment uploads. When missing, the
   *  composer renders disabled (auth still resolving). */
  token: string | null;
  workspaceId: string | null;
  issueId: string;
}

export function CommentList({
  comments,
  currentUserId,
  onAdd,
  onDelete,
  token,
  workspaceId,
  issueId,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-4">
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-200 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              {c.author?.name[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">{c.author?.name ?? "Unknown"}</span>
                <span className="text-xs text-gray-400">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
                {c.authorId === currentUserId && onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="text-xs text-red-400 hover:text-red-600 ml-auto"
                  >
                    Delete
                  </button>
                )}
              </div>
              <Markdown source={c.content} />
            </div>
          </div>
        ))}
      </div>

      <div className="border-t pt-4 mt-2">
        {token && workspaceId ? (
          <CommentInput
            token={token}
            workspaceId={workspaceId}
            issueId={issueId}
            onSubmit={onAdd}
          />
        ) : (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-400">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
