"use client";
import { InboxDetail } from "@/components/inbox/InboxDetail";
import { InboxListItem } from "@/components/inbox/InboxListItem";
import { useToast } from "@/components/ui/Toast";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { InboxItem, WSMessage } from "@agora/shared";
import { Archive, BookCheck, CheckCheck, Inbox as InboxIcon, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

const supabase = createClient();

export default function InboxPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const t = useTranslations("inbox");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id") ?? "";
  const { toast } = useToast();

  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async (tk: string, wsid: string) => {
    const data = (await api.listInbox(tk, wsid)) as InboxItem[];
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setLoading(false);
        return;
      }
      const tk = data.session.access_token;
      setToken(tk);
      const me = await api.getMe(tk);
      setUserId((me as { id: string }).id);
      const workspaces = await api.listWorkspaces(tk);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (!ws) {
        setLoading(false);
        return;
      }
      setWorkspaceId(ws.id);
      await loadInbox(tk, ws.id);
    });
  }, [workspaceSlug, loadInbox]);

  // Refresh on inbox.created (server fires this on quick-create complete/fail).
  useWSChannel(workspaceId, (msg: WSMessage) => {
    if (msg.event.type === "inbox.created" && token && workspaceId) {
      loadInbox(token, workspaceId);
    }
  });

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  const setSelected = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      if (id) sp.set("id", id);
      else sp.delete("id");
      router.replace(`/${workspaceSlug}/inbox${sp.toString() ? `?${sp.toString()}` : ""}`);
    },
    [router, searchParams, workspaceSlug],
  );

  // Auto mark-read whenever a selected item is unread
  useEffect(() => {
    if (!selected || selected.read || !token || !workspaceId) return;
    void api.markInboxRead(token, workspaceId, selected.id);
    setItems((prev) => prev.map((i) => (i.id === selected.id ? { ...i, read: true } : i)));
  }, [selected, token, workspaceId]);

  const unreadCount = items.filter((i) => !i.read).length;

  async function handleMarkAllRead() {
    if (!token || !workspaceId) return;
    await api.markAllInboxRead(token, workspaceId);
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setMenuOpen(false);
  }

  async function handleArchive(itemId: string) {
    if (!token || !workspaceId) return;
    await api.archiveInbox(token, workspaceId, itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    if (selectedId === itemId) setSelected("");
  }

  async function handleArchiveAll(scope: "all" | "read") {
    if (!token || !workspaceId) return;
    try {
      await api.archiveAllInbox(token, workspaceId, scope);
      if (scope === "all") {
        setItems([]);
        setSelected("");
      } else {
        const remaining = items.filter((i) => !i.read);
        setItems(remaining);
        if (selected && !remaining.find((i) => i.id === selected.id)) setSelected("");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t("archiveFailed"), "error");
    }
    setMenuOpen(false);
  }

  return (
    <div className="flex h-full">
      {/* List panel */}
      <aside className="flex w-[340px] flex-col border-r border-gray-200">
        {/* List header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[14px] font-semibold text-gray-900">{t("title")}</h1>
            {unreadCount > 0 && (
              <span className="text-[11px] text-gray-500">{t("unreadCount", { count: unreadCount })}</span>
            )}
          </div>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t("ariaActions")}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                >
                  <CheckCheck className="size-3.5 text-gray-500" />
                  {t("markAllAsRead")}
                </button>
                <button
                  type="button"
                  onClick={() => handleArchiveAll("read")}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                >
                  <BookCheck className="size-3.5 text-gray-500" />
                  {t("archiveRead")}
                </button>
                <button
                  type="button"
                  onClick={() => handleArchiveAll("all")}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                >
                  <Archive className="size-3.5 text-gray-500" />
                  {t("archiveAll")}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* List body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-400">
              <InboxIcon className="size-8" />
              <p className="text-[13px]">{t("empty")}</p>
              <p className="text-[11px] text-gray-400">{t("emptySubtitle")}</p>
            </div>
          ) : (
            items.map((item) => (
              <InboxListItem
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onClick={() => setSelected(item.id)}
                onArchive={() => handleArchive(item.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* Detail panel */}
      <main className="flex-1 overflow-hidden bg-white">
        {selected ? (
          <InboxDetail
            item={selected}
            workspaceSlug={workspaceSlug}
            token={token}
            workspaceId={workspaceId}
            userId={userId}
            onArchive={() => handleArchive(selected.id)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-gray-400">
            <InboxIcon className="size-10 text-gray-300" />
            <p className="mt-3 text-[13px]">
              {items.length === 0 ? t("emptyMain") : t("selectNotification")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
