"use client";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useImperativeHandle } from "react";
import { Markdown } from "tiptap-markdown";

export interface ContentEditorRef {
  /** Returns current contents serialized as markdown. */
  getMarkdown: () => string;
  /** Replaces editor contents and resets selection. */
  setMarkdown: (md: string) => void;
  /** Clear all content. */
  clearContent: () => void;
  focus: () => void;
}

interface Props {
  defaultValue?: string;
  placeholder?: string;
  /** Fires on every change with the current markdown. */
  onUpdate?: (md: string) => void;
  /** Submit shortcut (⌘↵). Returning false cancels. */
  onSubmit?: () => void | boolean | Promise<void | boolean>;
  className?: string;
  /** Auto-grow up to this height (px), then scroll. Defaults to no cap. */
  maxHeight?: number;
}

// TipTap rich text editor that exports markdown. No file upload (image
// paste is intentionally not handled in this round). Used for both manual
// description and the AI prompt.
export const ContentEditor = forwardRef<ContentEditorRef, Props>(function ContentEditor(
  { defaultValue = "", placeholder, onUpdate, onSubmit, className = "", maxHeight },
  ref,
) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "rounded bg-gray-100 px-2 py-1 text-[12px]" } },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-indigo-600 underline" } }),
      Markdown.configure({ html: false, transformPastedText: true, linkify: true, breaks: true }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none text-[13px] leading-relaxed",
      },
      handleKeyDown(_view, event) {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onSubmit?.();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      // biome-ignore lint/suspicious/noExplicitAny: storage type is loose
      const md = (editor.storage.markdown as any).getMarkdown() as string;
      onUpdate?.(md);
    },
    immediatelyRender: false,
  });

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => {
        if (!editor) return "";
        // biome-ignore lint/suspicious/noExplicitAny: storage type
        return (editor.storage.markdown as any).getMarkdown() as string;
      },
      setMarkdown: (md: string) => {
        if (!editor) return;
        editor.commands.setContent(md);
      },
      clearContent: () => {
        editor?.commands.clearContent();
      },
      focus: () => {
        editor?.commands.focus();
      },
    }),
    [editor],
  );

  return (
    <EditorContent
      editor={editor}
      className={className}
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    />
  );
});
