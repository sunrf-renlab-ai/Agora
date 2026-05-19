"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function SidebarSection({ title, storageKey, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const key = `sidebar.section.${storageKey}.collapsed`;

  useEffect(() => {
    const v = localStorage.getItem(key);
    if (v === "1") setOpen(false);
    if (v === "0") setOpen(true);
  }, [key]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      // Store "1" when collapsed, "0" when open (matches the key name "collapsed")
      localStorage.setItem(key, next ? "0" : "1");
      return next;
    });
  }

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500 hover:text-gray-700 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 -ml-0.5 opacity-60" />
        ) : (
          <ChevronRight className="w-3 h-3 -ml-0.5 opacity-60" />
        )}
        {title}
      </button>
      {open && <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>}
    </div>
  );
}
