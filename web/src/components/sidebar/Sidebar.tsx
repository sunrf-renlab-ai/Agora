"use client";
import { useUiStore } from "@/lib/ui-store";
import {
  Bot,
  Folder,
  HelpCircle,
  Inbox,
  Library,
  ListChecks,
  MessageCircle,
  Repeat,
  Settings as SettingsIcon,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarSection } from "./SidebarSection";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

interface Props {
  token: string | null;
  workspaceId: string | null;
  workspaceSlug: string;
}

export function Sidebar({ token, workspaceId, workspaceSlug }: Props) {
  const setShortcutsHelpOpen = useUiStore((s) => s.setShortcutsHelpOpen);
  const t = useTranslations("sidebar");
  const pathname = usePathname() ?? "";

  // Active state: match by route prefix so "/compare/issues/<id>" still
  // highlights "Issues". The order in resolveActive matters — longest prefix
  // wins so /settings doesn't accidentally light up under /skills.
  //
  // The workspace root (`/<slug>`) is exact-only — without that, every other
  // page (which always starts with `/<slug>/...`) would also light up Home.
  function isActive(href: string, exact = false) {
    if (href === pathname) return true;
    if (exact) return false;
    return pathname.startsWith(`${href}/`);
  }

  function NavLink({
    href,
    icon: Icon,
    exact,
    children,
  }: {
    href: string;
    icon: typeof Inbox;
    exact?: boolean;
    children: React.ReactNode;
  }) {
    const active = isActive(href, exact);
    return (
      <Link
        href={href}
        className={`group relative flex items-center gap-2.5 pl-3 pr-2.5 py-1.5 text-[13px] rounded-md transition-colors ${
          active
            ? "bg-white text-gray-900 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            : "text-gray-700 hover:bg-gray-200/60 hover:text-gray-900"
        }`}
      >
        {/* 2px brand accent bar on the active item — single visual cue
            replaces the gray fill that used to look like a system menu. */}
        <span
          aria-hidden
          className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-sm transition-colors ${
            active ? "bg-indigo-600" : "bg-transparent group-hover:bg-gray-300"
          }`}
        />
        <Icon
          className={`w-4 h-4 transition-colors ${active ? "text-indigo-600" : "text-gray-500 group-hover:text-gray-700"}`}
        />
        {children}
      </Link>
    );
  }

  return (
    <aside className="w-60 bg-gray-50 text-gray-800 flex flex-col p-3 shrink-0 overflow-y-auto border-r border-gray-200">
      <div className="mb-3 pb-3 border-b border-gray-200/70">
        <WorkspaceSwitcher token={token} currentSlug={workspaceSlug} />
      </div>

      {/* Primary CTA — chat with workspace agents. Special visual on
       *  purpose: larger, accent-tinted, sparkles icon. This is the
       *  workspace's main entry point, not a sibling nav link. */}
      <Link
        href={`/${workspaceSlug}`}
        className={`group relative flex items-center gap-2.5 px-3 py-2.5 mb-3 rounded-md text-[14px] font-medium transition-colors ${
          pathname === `/${workspaceSlug}` || pathname === `/${workspaceSlug}/`
            ? "bg-indigo-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-indigo-700"
            : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 ring-1 ring-indigo-100"
        }`}
      >
        <MessageCircle className="w-4 h-4" />
        <span>{t("home")}</span>
      </Link>

      <div className="flex flex-col gap-0.5 mb-3">
        <NavLink href={`/${workspaceSlug}/inbox`} icon={Inbox}>
          {t("inbox")}
        </NavLink>
        <NavLink href={`/${workspaceSlug}/my-issues`} icon={UserIcon}>
          {t("myIssues")}
        </NavLink>
      </div>

      <SidebarSection title={t("workspace")} storageKey="workspace" defaultOpen={true}>
        <NavLink href={`/${workspaceSlug}/issues`} icon={ListChecks}>
          {t("issues")}
        </NavLink>
        <NavLink href={`/${workspaceSlug}/knowledge`} icon={Library}>
          {t("knowledge")}
        </NavLink>
        <NavLink href={`/${workspaceSlug}/projects`} icon={Folder}>
          {t("projects")}
        </NavLink>
        <NavLink href={`/${workspaceSlug}/autopilots`} icon={Repeat}>
          {t("autopilots")}
        </NavLink>
        <NavLink href={`/${workspaceSlug}/agents`} icon={Bot}>
          {t("agents")}
        </NavLink>
      </SidebarSection>

      <SidebarSection title={t("config")} storageKey="config" defaultOpen={false}>
        <NavLink href={`/${workspaceSlug}/skills`} icon={Wrench}>
          {t("skills")}
        </NavLink>
        <NavLink href={`/${workspaceSlug}/settings`} icon={SettingsIcon}>
          {t("settings")}
        </NavLink>
      </SidebarSection>

      <div className="mt-auto pt-3 border-t border-gray-200/70">
        <button
          type="button"
          onClick={() => setShortcutsHelpOpen(true)}
          className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] rounded-md text-gray-500 hover:bg-gray-200/60 hover:text-gray-900 w-full transition-colors"
          aria-label={t("help")}
          title="Keyboard shortcuts"
        >
          <span className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4" /> {t("help")}
          </span>
          <kbd className="font-mono text-[10px] text-gray-500 bg-white border border-gray-200 rounded px-1.5 py-0.5">
            ?
          </kbd>
        </button>
      </div>
    </aside>
  );
}
