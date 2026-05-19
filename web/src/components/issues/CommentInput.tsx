"use client";
import { useAgents } from "@/hooks/useAgents";
import { useUploadAttachment } from "@/hooks/useAttachments";
import { useMembers } from "@/hooks/useMembers";
import { api } from "@/lib/api";
import type { IssueSearchResult } from "@agora/shared";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import type { PluginKey } from "@tiptap/pm/state";
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Paperclip, X as XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Markdown } from "tiptap-markdown";
import { type MentionItem, MentionList, type MentionListHandle } from "./MentionList";
import {
  IssueMention,
  IssueMentionPluginKey,
  MemberMention,
  MemberMentionPluginKey,
} from "./mention-extension";

interface Props {
  token: string;
  workspaceId: string;
  issueId: string;
  /** Submit handler. Implementations call `api.createComment`. */
  onSubmit: (content: string) => Promise<void>;
  /** Reply mode: parent comment id, surfaced for future use by callers.
   *  Currently the agora API does not yet wire `parentCommentId` through
   *  `createComment`; we accept the prop and pass it on the future-proof
   *  shape for callers that already populate it. */
  parentCommentId?: string;
  /** Show "Cancel" button (used in reply mode). */
  onCancel?: () => void;
  /** Auto-focus on mount (used in reply mode). */
  autoFocus?: boolean;
  className?: string;
}

interface PendingAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** A blob URL preview for image attachments, or undefined. */
  previewUrl?: string;
  /** Markdown link to embed when the comment is submitted. */
  markdownRef: string;
}

interface Mentionable {
  id: string;
  name: string;
  kind: "member" | "agent";
}

export function CommentInput({
  token,
  workspaceId,
  issueId,
  onSubmit,
  onCancel,
  autoFocus = false,
  className = "",
}: Props) {
  const t = useTranslations("comments.input");
  const { data: members = [] } = useMembers(token, workspaceId);
  const { data: agents = [] } = useAgents(token, workspaceId);
  const upload = useUploadAttachment(token, workspaceId);

  const [submitting, setSubmitting] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mention sources stay fresh via refs so the suggestion render closure
  // always reads the latest list without recreating the editor.
  const membersRef = useRef(members);
  membersRef.current = members;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const wsIdRef = useRef(workspaceId);
  wsIdRef.current = workspaceId;

  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  // ---- Editor ------------------------------------------------------------

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "rounded bg-gray-100 px-2 py-1 text-[12px]" } },
      }),
      Placeholder.configure({ placeholder: t("placeholder") }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-indigo-600 underline" },
      }),
      Markdown.configure({ html: false, transformPastedText: true, linkify: true, breaks: true }),
      MemberMention.configure({
        HTMLAttributes: { "data-type": "mention" },
        suggestion: buildSuggestion("@", MemberMentionPluginKey, async (query) => {
          const merged = mergeMentionables(
            membersRef.current as Array<{ user?: { id?: string; name?: string | null } | null }>,
            agentsRef.current as Array<{ id: string; name: string }>,
          );
          const q = query.toLowerCase();
          const matches = merged.filter((it) => it.name.toLowerCase().includes(q)).slice(0, 5);
          return matches.map<MentionItem>((m) => ({ id: m.id, label: m.name, kind: m.kind }));
        }),
      }),
      IssueMention.configure({
        HTMLAttributes: { "data-type": "mention" },
        suggestion: buildSuggestion("#", IssueMentionPluginKey, async (query) => {
          if (!query.trim()) return [];
          const tk = tokenRef.current;
          const ws = wsIdRef.current;
          if (!tk || !ws) return [];
          try {
            const res = (await api.searchIssues(tk, ws, query)) as {
              results?: IssueSearchResult[];
            };
            const list = res?.results ?? [];
            return list.slice(0, 5).map<MentionItem>((iss) => ({
              id: iss.id,
              label: iss.identifier,
              kind: "issue",
              hint: iss.title,
            }));
          } catch {
            return [];
          }
        }),
      }),
    ],
    content: "",
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none text-[13px] leading-relaxed min-h-[60px]",
      },
      handleKeyDown(_view, event) {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          void handleSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: ed }) {
      const md = (ed.storage.markdown as any).getMarkdown() as string;
      setIsEmpty(md.trim().length === 0);
    },
  });

  // ---- Submit ------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!editor || submitting) return;
    const md = ((editor.storage.markdown as any).getMarkdown() as string).trim();
    const attachmentRefs = attachments.map((a) => a.markdownRef).join("\n");
    const content = [md, attachmentRefs].filter(Boolean).join("\n\n").trim();
    if (!content) return;
    setSubmitting(true);
    try {
      await onSubmitRef.current(content);
      editor.commands.clearContent();
      setAttachments([]);
      setIsEmpty(true);
    } finally {
      setSubmitting(false);
    }
  }, [editor, attachments, submitting]);

  // ---- File upload -------------------------------------------------------

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        upload.mutate(
          { file, ownerKind: "issue", ownerId: issueId },
          {
            onSuccess: (rec) => {
              const r = rec as {
                id: string;
                filename: string;
                contentType: string;
                size: number;
              };
              const isImage = r.contentType.startsWith("image/");
              const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
              const markdownRef = isImage
                ? `![${r.filename}](attachment://${r.id})`
                : `[📎 ${r.filename}](attachment://${r.id})`;
              setAttachments((prev) => [
                ...prev,
                {
                  id: r.id,
                  filename: r.filename,
                  contentType: r.contentType,
                  size: r.size,
                  previewUrl,
                  markdownRef,
                },
              ]);
            },
          },
        );
      }
    },
    [upload, issueId],
  );

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const next = prev.filter((a) => a.id !== id);
      const removed = prev.find((a) => a.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  // Cleanup blob URLs on unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
  }, []);

  // ---- DnD ---------------------------------------------------------------

  function onDragEnter(e: ReactDragEvent<HTMLFormElement>) {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }
  function onDragOver(e: ReactDragEvent<HTMLFormElement>) {
    e.preventDefault();
  }
  function onDragLeave(e: ReactDragEvent<HTMLFormElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }
  function onDrop(e: ReactDragEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSubmit();
  }

  const hasContent = !isEmpty || attachments.length > 0;

  return (
    <form
      onSubmit={onFormSubmit}
      className={`relative flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-2 ${className}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <EditorContent editor={editor} className="max-h-56 min-h-[60px] overflow-y-auto px-1" />

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-1">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs"
            >
              {a.previewUrl ? (
                <img src={a.previewUrl} alt="" className="size-6 shrink-0 rounded object-cover" />
              ) : (
                <span aria-hidden="true">📎</span>
              )}
              <span className="truncate text-gray-700">{a.filename}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.filename}`}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label={t("attachFile")}
          title={t("attachFile")}
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <Paperclip className="size-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="mr-auto text-[11px] text-gray-400">⌘↵</span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            {t("cancel")}
          </button>
        )}
        <button
          type="submit"
          disabled={!hasContent || submitting || upload.isPending}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "…" : t("submit")}
        </button>
      </div>

      {isDragOver && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-indigo-500 bg-indigo-50/80 text-xs font-medium text-indigo-700"
        >
          Drop file to attach
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeMentionables(
  members: Array<{ user?: { id?: string; name?: string | null } | null }>,
  agents: Array<{ id: string; name: string }>,
): Mentionable[] {
  const out: Mentionable[] = [];
  for (const a of agents) out.push({ id: a.id, name: a.name, kind: "agent" });
  for (const m of members) {
    const u = m.user;
    if (u?.id && u.name) out.push({ id: u.id, name: u.name, kind: "member" });
  }
  return out;
}

function buildSuggestion(
  char: "@" | "#",
  pluginKey: PluginKey,
  resolve: (query: string) => Promise<MentionItem[]>,
): any {
  return {
    char,
    pluginKey,
    items: ({ query }: { query: string }) => resolve(query),
    command: ({ editor, range, props }: any) => {
      const item = props as MentionItem;
      const nodeName = char === "#" ? "issueMention" : "mention";
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: nodeName,
            attrs: { id: item.id, label: item.label, kind: item.kind },
          },
          { type: "text", text: " " },
        ])
        .run();
    },
    render: () => {
      let component: ReactRenderer<MentionListHandle, any> | null = null;
      let popup: HTMLDivElement | null = null;

      const place = (rect: DOMRect | null | undefined) => {
        if (!popup || !rect) return;
        popup.style.position = "fixed";
        popup.style.top = `${rect.bottom + 4}px`;
        popup.style.left = `${rect.left}px`;
        popup.style.zIndex = "70";
      };

      return {
        onStart: (props: any) => {
          component = new ReactRenderer(MentionList, {
            props: {
              items: props.items as MentionItem[],
              command: (it: MentionItem) => props.command(it),
              header: char === "#" ? "Issues" : undefined,
            },
            editor: props.editor,
          });
          popup = document.createElement("div");
          popup.appendChild(component.element);
          document.body.appendChild(popup);
          place(props.clientRect?.());
        },
        onUpdate: (props: any) => {
          component?.updateProps({
            items: props.items as MentionItem[],
            command: (it: MentionItem) => props.command(it),
            header: char === "#" ? "Issues" : undefined,
          });
          place(props.clientRect?.());
        },
        onKeyDown: (props: any) => {
          if (props.event.key === "Escape") {
            popup?.remove();
            return true;
          }
          if (!component) return false;
          return component.ref?.onKeyDown(props.event as KeyboardEvent) ?? false;
        },
        onExit: () => {
          popup?.remove();
          component?.destroy();
          popup = null;
          component = null;
        },
      };
    },
  };
}
