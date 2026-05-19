"use client";
import { ToastProvider } from "@/components/ui/Toast";
import { getQueryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const qc = getQueryClient();
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
      {/* Devtools opt-in only — tropical-island floating button overlapped the
          Help link in the sidebar. Set NEXT_PUBLIC_RQ_DEVTOOLS=1 to re-enable. */}
      {process.env.NEXT_PUBLIC_RQ_DEVTOOLS === "1" && <ReactQueryDevtools />}
    </QueryClientProvider>
  );
}
