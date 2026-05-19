"use client";
import DOMPurify from "dompurify";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  source: string | null | undefined;
  className?: string;
}

/**
 * Renders untrusted user-authored Markdown.
 *
 * Pipeline: source -> DOMPurify (strip raw HTML/scripts) -> react-markdown
 * (parse + render via remark-gfm) -> React tree.
 *
 * GFM (tables, task lists, strikethrough, autolinks) is enabled. Raw HTML
 * embedded in the source is dropped before parsing — react-markdown does not
 * pass HTML through by default, but we sanitize defensively.
 */
export function Markdown({ source, className }: Props) {
  const safe = useMemo(() => {
    if (!source) return null;
    // Strip any HTML tags from the source while preserving inner text. This
    // neutralizes <script>, <style>, event handlers, etc. before markdown
    // parsing. Markdown syntax itself is plain text, so it survives.
    return DOMPurify.sanitize(source, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
  }, [source]);

  if (!safe) return null;

  const wrapperClass =
    className ??
    [
      "max-w-none text-sm text-gray-700",
      "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2",
      "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2",
      "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-2",
      "[&_p]:my-2",
      "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2",
      "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2",
      "[&_li]:my-1",
      "[&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs",
      "[&_pre]:bg-gray-50 [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-2",
      "[&_pre>code]:bg-transparent [&_pre>code]:p-0",
      "[&_a]:text-indigo-600 [&_a]:underline",
      "[&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600",
      "[&_table]:border-collapse [&_table]:my-2",
      "[&_th]:border [&_th]:border-gray-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-gray-50",
      "[&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1",
      "[&_input[type=checkbox]]:mr-1",
    ].join(" ");

  return (
    <div className={wrapperClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Pass URLs through unchanged; the `a` component below sanitizes
        // each href and decides what to render. The default urlTransform
        // would strip non-http schemes including our `mention://` chips.
        urlTransform={(url) => url}
        components={{
          // Sanitize hrefs — only allow http(s), mailto, and our own
          // mention:// scheme. mention://kind/id renders as an inline chip
          // instead of a link so it visually matches GitHub @mentions.
          a: ({ href, children, ...rest }) => {
            if (typeof href === "string") {
              const m = href.match(/^mention:\/\/(agent|member|issue)\/([^/]+)$/);
              if (m) {
                const kind = m[1] as "agent" | "member" | "issue";
                const tone =
                  kind === "agent"
                    ? "bg-purple-100 text-purple-700"
                    : kind === "member"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-700";
                return (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${tone}`}
                    data-mention-kind={kind}
                  >
                    {children}
                  </span>
                );
              }
            }
            const safeHref =
              typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? href : undefined;
            return (
              <a {...rest} href={safeHref} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {safe}
      </ReactMarkdown>
    </div>
  );
}
