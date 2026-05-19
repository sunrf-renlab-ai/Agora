"use client";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useState } from "react";

type ToastKind = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional richer body — overrides the plain `message` line. */
  node?: ReactNode;
}

interface ToastCtx {
  toast: (message: string, kind?: ToastKind) => void;
  /** Custom toast with arbitrary content (e.g. a "View issue" link). */
  toastNode: (node: ReactNode, kind?: ToastKind, durationMs?: number) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

const AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const toastNode = useCallback(
    (node: ReactNode, kind: ToastKind = "info", durationMs = 6000) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, kind, message: "", node }]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast, toastNode }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none w-[min(360px,calc(100vw-2.5rem))]">
        {toasts.map((t) => (
          <ToastBubble key={t.id} entry={t} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastBubble({ entry }: { entry: ToastEntry }) {
  // Toast visual = white card, hairline border, color-coded icon. Keeps
  // the surface neutral so a long error message stays readable, while
  // the leading icon carries the kind. Slide-in animation uses the same
  // utility class as page reveals — feels native.
  const Icon =
    entry.kind === "success"
      ? CheckCircle2
      : entry.kind === "error"
        ? AlertCircle
        : Info;
  const iconColor =
    entry.kind === "success"
      ? "text-emerald-600"
      : entry.kind === "error"
        ? "text-red-600"
        : "text-indigo-600";

  return (
    <div
      role="status"
      className="agora-fade-in-up pointer-events-auto rounded-md border border-gray-200 bg-white shadow-md px-3.5 py-2.5 flex items-start gap-2.5 text-[13px] text-gray-900"
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} aria-hidden />
      <div className="min-w-0 flex-1 leading-snug">{entry.node ?? entry.message}</div>
    </div>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}
