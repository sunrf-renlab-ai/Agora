"use client";
import type { ActivityEntry, Comment, IssuePriority, IssueStatus, WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AttachmentList } from "@/components/attachments/AttachmentList";
import { DependencyList } from "@/components/dependencies/DependencyList";
import { CommentList } from "@/components/issues/CommentList";
import { IssueViewers } from "@/components/issues/IssueViewers";
import { PropertyPanel } from "@/components/issues/PropertyPanel";
import { Timeline } from "@/components/issues/Timeline";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { ReactionBar } from "@/components/reactions/ReactionBar";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import { useIssue, useUpdateIssue } from "@/hooks/useIssues";
import { useWSChannel } from "@/hooks/useWSChannel";
import { ApiError, api } from "@/lib/api";


interface IssueDetailViewProps {
  issueId: string;
  workspaceSlug: string;
  token: string | null;
  workspaceId: string | null;
  userId: string | null;
  /** Hide the back button / fullscreen toggle when rendered inline (e.g.
   *  inside the inbox detail). Default false renders them. */
  embedded?: boolean;
}

export function IssueDetailView({
  issueId,
  workspaceSlug,
  token,
  workspaceId,
  userId,
  embedded = false,
}: IssueDetailViewProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [isMax, setIsMax] = useState<boolean>(false);
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const [viewers, setViewers] = useState<
    Array<{ userId: string; name: string | null; avatarUrl: string | null }>
  >([]);
  const t = useTranslations("issueDetail");

  // Load comments and activity when token/workspace become available.
  useEffect(() => {
    if (!token || !workspaceId) return;
    Promise.all([
      api.listComments(token, workspaceId, issueId),
      api.listActivity(token, workspaceId, issueId),
    ]).then(([c, a]) => {
      setComments(c as Comment[]);
      setActivity(a as ActivityEntry[]);
    });
  }, [token, workspaceId, issueId]);

  const { send: wsSend } = useWSChannel(workspaceId, (msg: WSMessage) => {
    const event = msg.event;
    if (
      event.type === "comment.created" &&
      (event.data as { issueId: string }).issueId === issueId
    ) {
      if (token && workspaceId) {
        api.listComments(token, workspaceId, issueId).then((c) => setComments(c as Comment[]));
      }
    }
    if (event.type === "issue.updated" && (event.data as { id: string }).id === issueId) {
      qc.invalidateQueries({ queryKey: ["issue", workspaceId, issueId] });
      if (token && workspaceId) {
        api
          .listActivity(token, workspaceId, issueId)
          .then((a) => setActivity(a as ActivityEntry[]));
      }
    }
    if (event.type === "presence.changed" && event.data.issueId === issueId) {
      setViewers(event.data.viewers);
    }
  });

  // Announce presence on this issue. Re-announce periodically: catches
  // server restarts (which would lose the in-memory presence map) AND covers
  // the WS-not-yet-open case (wsSend returns false silently and we just keep
  // trying on a fast schedule until the socket is up).
  useEffect(() => {
    if (!workspaceId || !issueId) return;
    let joined = false;
    const announce = () => {
      const ok = wsSend({ type: "presence:join", issueId });
      if (ok) joined = true;
    };
    announce();
    const fastRetry = setInterval(() => {
      if (!joined) announce();
    }, 500);
    const heartbeat = setInterval(announce, 30_000);
    return () => {
      wsSend({ type: "presence:leave" });
      clearInterval(fastRetry);
      clearInterval(heartbeat);
    };
  }, [workspaceId, issueId, wsSend]);

  const { data: issue } = useIssue(token, workspaceId, issueId);
  const updateIssue = useUpdateIssue(token, workspaceId);

  async function handleStatusChange(status: IssueStatus) {
    await updateIssue.mutateAsync({ issueId, data: { status } });
  }

  async function handlePriorityChange(priority: IssuePriority) {
    await updateIssue.mutateAsync({ issueId, data: { priority } });
  }

  async function handleAddComment(content: string) {
    if (!token || !workspaceId) return;
    const comment = await api.createComment(token, workspaceId, issueId, content);
    setComments((prev) => [...prev, comment as Comment]);
  }

  async function handleDeleteComment(commentId: string) {
    if (!token || !workspaceId) return;
    await api.deleteComment(token, workspaceId, issueId, commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }

  async function toggleSubscribe() {
    if (!token || !workspaceId || !issueId) return;
    try {
      if (subscribed) {
        // Server returns 204 No Content on success and 404 when the
        // subscription didn't exist. apiFetch already maps 204 → null, so
        // we just need to swallow the 404 case: it means local state was
        // stale and we're effectively unsubscribed either way.
        await api.unsubscribeFromIssue(token, workspaceId, issueId);
        setSubscribed(false);
        toast(t("subscribe.unsubscribed"), "success");
      } else {
        await api.subscribeToIssue(token, workspaceId, issueId);
        setSubscribed(true);
        toast(t("subscribe.subscribed"), "success");
      }
    } catch (err) {
      // 404 on unsubscribe: server says we weren't subscribed. Reconcile
      // local state silently — the user already sees the unsubscribed UI.
      if (err instanceof ApiError && err.status === 404 && subscribed) {
        setSubscribed(false);
        return;
      }
      toast(t("subscribe.failed"), "error");
    }
  }

  if (!issue) {
    return <div className="p-8 text-gray-400">{t("placeholders.loading")}</div>;
  }

  return (
    <div className="flex h-full">
      <div className={`flex-1 overflow-auto ${isMax ? "" : "max-w-3xl"}`}>
        {/* Breadcrumb bar — identifier · title (truncated) on
            the left, room for presence + subscribe + fullscreen on the right.
            Replaces the previous stacked "back · identifier+status · H1" so
            the title region reads like one clean editorial header. */}
        <div className="flex items-center gap-2 px-8 py-3 border-b border-gray-200/70 text-[12px] text-gray-500">
          {!embedded && (
            <button
              type="button"
              onClick={() => router.push(`/${workspaceSlug}/issues`)}
              className="font-mono text-gray-400 hover:text-gray-700 transition-colors shrink-0"
              title={t("backToIssues")}
            >
              {issue.identifier}
            </button>
          )}
          {embedded && (
            <span className="font-mono text-gray-400 shrink-0">{issue.identifier}</span>
          )}
          <span aria-hidden className="text-gray-300">·</span>
          <span className="truncate text-gray-700">{issue.title}</span>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <IssueViewers viewers={viewers} selfUserId={userId} />
            <button
              type="button"
              onClick={toggleSubscribe}
              className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors"
              aria-label={
                subscribed
                  ? t("subscribe.toggleAriaUnsubscribe")
                  : t("subscribe.toggleAriaSubscribe")
              }
              title={
                subscribed
                  ? t("subscribe.toggleAriaUnsubscribe")
                  : t("subscribe.toggleAriaSubscribe")
              }
            >
              {subscribed ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M12 2a7 7 0 00-7 7v3.586l-1.707 1.707A1 1 0 004 16h16a1 1 0 00.707-1.707L19 12.586V9a7 7 0 00-7-7zm0 20a3 3 0 003-3H9a3 3 0 003 3z" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 003.4 0" />
                </svg>
              )}
            </button>
            {!embedded && (
              <button
                type="button"
                onClick={() => setIsMax((v) => !v)}
                className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors"
                aria-label={isMax ? t("fullscreen.exit") : t("fullscreen.enter")}
                title={isMax ? t("fullscreen.exit") : t("fullscreen.enter")}
              >
                {isMax ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3.5 h-3.5"
                    aria-hidden="true"
                  >
                    <path d="M4 14h6v6" />
                    <path d="M20 10h-6V4" />
                    <path d="M14 10l7-7" />
                    <path d="M3 21l7-7" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3.5 h-3.5"
                    aria-hidden="true"
                  >
                    <path d="M15 3h6v6" />
                    <path d="M9 21H3v-6" />
                    <path d="M21 3l-7 7" />
                    <path d="M3 21l7-7" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="px-8 py-6">
          {/* Editorial header — single big H1, optional status chip
              underneath as a small ground-truth read for users who skip the
              right rail. */}
          <header className="mb-6">
            <h1 className="text-[28px] sm:text-[30px] leading-[1.2] tracking-tight font-semibold text-gray-900 mb-2">
              {issue.title}
            </h1>
            <div className="flex items-center gap-2">
              <StatusBadge status={issue.status} />
            </div>
          </header>

          {/* Description sits directly on white canvas — no bg-gray box.
              White paper, ink. The Markdown renderer carries its own
              prose-* classes for paragraph spacing, headings, lists,
              code blocks. */}
          <div className="mb-8">
            {issue.description ? (
              <Markdown source={issue.description} />
            ) : (
              <p className="text-[13px] text-gray-400 italic">{t("placeholders.noDescription")}</p>
            )}
          </div>

        {token && workspaceId && userId ? (
          <div className="mb-6">
            <ReactionBar
              token={token}
              workspaceId={workspaceId}
              target={{ kind: "issue", issueId }}
              currentUserId={userId}
            />
          </div>
        ) : null}

        {token && workspaceId ? (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">
              {t("dependencies.title")}
            </h2>
            <DependencyList token={token} workspaceId={workspaceId} issueId={issueId} />
          </div>
        ) : null}

        {token && workspaceId && userId ? (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">
              {t("attachments")}
            </h2>
            <AttachmentList
              token={token}
              workspaceId={workspaceId}
              ownerKind="issue"
              ownerId={issueId}
              currentUserId={userId}
            />
          </div>
        ) : null}

        {/* 动态 section — replaces the prior comments/activity/executionLogs
         *  tab system. One timeline of agent runs + system activity stacked
         *  together, with the comments section sitting at the bottom as its
         *  own thing. */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">{t("timeline.title")}</h2>
          </div>
          <Timeline
            activity={activity}
            token={token}
            workspaceId={workspaceId}
            issueId={issueId}
          />
        </div>

        <div className="border-t pt-6">
          <h2 className="text-base font-semibold mb-3">
            {t("tabs.comments", { count: comments.length })}
          </h2>
          <CommentList
            comments={comments}
            currentUserId={userId ?? ""}
            onAdd={handleAddComment}
            onDelete={handleDeleteComment}
            token={token}
            workspaceId={workspaceId}
            issueId={issueId}
          />
        </div>
        </div>
      </div>

      {/* Right sidebar — property panel. */}
      <aside className={`w-72 border-l h-full overflow-y-auto ${isMax ? "hidden" : ""}`}>
        <div className="p-4">
          <PropertyPanel
            issue={issue}
            token={token}
            workspaceId={workspaceId}
            issueId={issueId}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
          />
        </div>
      </aside>
    </div>
  );
}
