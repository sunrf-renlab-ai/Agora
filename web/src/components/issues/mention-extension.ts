import Mention from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import { mergeAttributes } from "@tiptap/react";

/**
 * Mention extensions for the comment editor.
 *
 * Two distinct extensions share the same node attributes (id, label, kind)
 * but use different trigger characters and plugin keys:
 *
 *  - `mention`     — triggers on `@`, kind ∈ {"member", "agent"}
 *  - `issueMention` — triggers on `#`, kind = "issue"
 *
 * Both serialize to markdown the rest of the app already understands:
 *
 *   [@Name](mention://member/<id>)
 *   [@Name](mention://agent/<id>)
 *   [MUL-12](mention://issue/<id>)
 *
 * The Markdown renderer (`@/components/ui/Markdown`) already turns these
 * into inline chips, so the round-trip is consistent with the read view.
 *
 * Parsing markdown back into mention nodes is intentionally not wired —
 * the comment input is write-only.
 */
export type MentionKind = "member" | "agent" | "issue";

const sharedAttrs = {
  id: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-id"),
    renderHTML: (attrs: Record<string, unknown>) => ({ "data-id": attrs.id as string }),
  },
  label: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-label"),
    renderHTML: (attrs: Record<string, unknown>) => ({ "data-label": attrs.label as string }),
  },
  kind: {
    default: "member" as MentionKind,
    parseHTML: (el: HTMLElement) =>
      (el.getAttribute("data-kind") as MentionKind | null) ?? "member",
    renderHTML: (attrs: Record<string, unknown>) => ({
      "data-kind": (attrs.kind as string) ?? "member",
    }),
  },
};

function buildMention(name: "mention" | "issueMention") {
  return Mention.extend({
    name,
    addAttributes() {
      return sharedAttrs;
    },
    renderHTML({ node, HTMLAttributes }) {
      const kind = (node.attrs.kind as MentionKind) ?? "member";
      const label = (node.attrs.label as string | undefined) ?? (node.attrs.id as string);
      const display = kind === "issue" ? label : `@${label}`;
      const tone =
        kind === "agent"
          ? "bg-purple-100 text-purple-700"
          : kind === "member"
            ? "bg-blue-100 text-blue-700"
            : "bg-gray-100 text-gray-700";
      return [
        "span",
        mergeAttributes(
          {
            class: `inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${tone}`,
          },
          HTMLAttributes,
          {
            "data-mention-kind": kind,
            "data-mention-id": node.attrs.id as string,
          },
        ),
        display,
      ];
    },
    addStorage() {
      return {
        markdown: {
          serialize(
            state: { write: (s: string) => void },
            node: { attrs: Record<string, unknown> },
          ) {
            const id = node.attrs.id as string;
            const label = ((node.attrs.label as string | undefined) ?? id).replace(
              /([\\\[\]])/g,
              "\\$1",
            );
            const kind = ((node.attrs.kind as string | undefined) ?? "member") as MentionKind;
            const prefix = kind === "issue" ? "" : "@";
            state.write(`[${prefix}${label}](mention://${kind}/${id})`);
          },
          parse: {
            /* not wired — write-only editor */
          },
        },
      };
    },
  });
}

export const MemberMention = buildMention("mention");
export const IssueMention = buildMention("issueMention");

export const MemberMentionPluginKey = new PluginKey("memberMention");
export const IssueMentionPluginKey = new PluginKey("issueMention");
