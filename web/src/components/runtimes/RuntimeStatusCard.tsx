"use client";
import type { Runtime } from "@agora/shared";
import { useTranslations } from "next-intl";

interface Props {
  runtime: Runtime;
}

/**
 * Lower-level status surface for the runtime detail page.
 * Renders detected CLIs (kind + version), supported models when the daemon
 * advertises any, and machine info pulled from `runtimeInfo` (a free-form
 * jsonb blob the daemon writes — fields are best-effort and we render only
 * what's present so older daemons don't show empty rows).
 */
export function RuntimeStatusCard({ runtime }: Props) {
  const t = useTranslations("runtimes");
  const info = runtime.runtimeInfo ?? {};

  const hostname = typeof info.hostname === "string" ? info.hostname : null;
  const os = typeof info.os === "string" ? info.os : null;
  const arch = typeof info.arch === "string" ? info.arch : null;
  const supportedModels = Array.isArray(info.supportedModels)
    ? (info.supportedModels.filter((m) => typeof m === "string") as string[])
    : [];

  const hasMachine = hostname || os || arch;

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-2.5">
        <span className="text-[13px] font-semibold">{t("detail.status.title")}</span>
      </div>

      <dl className="divide-y divide-gray-100">
        <Row label={t("detail.status.detectedClis")}>
          {runtime.detectedClis.length === 0 ? (
            <span className="text-gray-400">—</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {runtime.detectedClis.map((c) => (
                <span
                  key={`${c.kind}:${c.version}`}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-0.5 font-mono text-[12px]"
                >
                  <span>{c.kind}</span>
                  <span className="text-gray-400">{c.version}</span>
                </span>
              ))}
            </div>
          )}
        </Row>

        <Row label={t("detail.status.models")}>
          {supportedModels.length === 0 ? (
            <span className="text-gray-400">—</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {supportedModels.map((m) => (
                <span
                  key={m}
                  className="rounded border border-gray-200 px-2 py-0.5 font-mono text-[12px]"
                >
                  {m}
                </span>
              ))}
            </div>
          )}
        </Row>

        <Row label={t("detail.status.machine")}>
          {!hasMachine ? (
            <span className="text-gray-400">—</span>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px]">
              {hostname && <span>{hostname}</span>}
              {(os || arch) && (
                <span className="text-gray-500">{[os, arch].filter(Boolean).join(" / ")}</span>
              )}
            </div>
          )}
        </Row>
      </dl>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-2.5">
      <dt className="text-[12px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="min-w-0 text-[13px]">{children}</dd>
    </div>
  );
}
