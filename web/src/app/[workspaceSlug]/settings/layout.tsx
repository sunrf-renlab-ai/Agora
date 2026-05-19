"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { use } from "react";

export default function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const pathname = usePathname();
  const t = useTranslations("settings");

  const sections: { href: string; label: string }[] = [
    { href: `/${workspaceSlug}/settings/profile`, label: t("profile") },
    { href: `/${workspaceSlug}/settings/connections`, label: t("connections") },
    { href: `/${workspaceSlug}/settings/notifications`, label: t("notifications") },
    { href: `/${workspaceSlug}/settings/tokens`, label: t("tokens") },
    { href: `/${workspaceSlug}/settings/feedback`, label: t("feedback") },
    { href: `/${workspaceSlug}/settings/members`, label: t("members") },
  ];

  return (
    <div className="flex h-full">
      <aside className="w-56 p-6 shrink-0">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-3 px-2">
          {t("title")}
        </div>
        <nav className="flex flex-col gap-0.5 text-[13px]">
          {sections.map((s) => {
            const active = pathname === s.href;
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`px-2.5 py-1.5 rounded-sm transition-colors ${
                  active
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-gray-700 hover:bg-gray-200/60 hover:text-gray-900"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
