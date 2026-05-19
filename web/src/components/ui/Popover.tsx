"use client";
import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Align = "start" | "center" | "end";
type Side = "bottom" | "top";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement<{ ref?: React.Ref<HTMLElement>; onClick?: (e: React.MouseEvent) => void }>;
  align?: Align;
  side?: Side;
  children: React.ReactNode;
  className?: string;
}

// Lightweight popover. No Radix; we position relative to the trigger via
// getBoundingClientRect, render through a Portal so we can escape any
// overflow-hidden parent (e.g. the create-issue dialog body), and close
// on outside click / Escape.
export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "start",
  side = "bottom",
  children,
  className,
}: Props) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const compute = () => {
      const trig = triggerRef.current;
      const pop = popoverRef.current;
      if (!trig || !pop) return;
      const r = trig.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      let top = side === "bottom" ? r.bottom + 4 : r.top - popRect.height - 4;
      let left = r.left;
      if (align === "center") left = r.left + (r.width - popRect.width) / 2;
      else if (align === "end") left = r.right - popRect.width;
      // Clamp within viewport
      const margin = 8;
      left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - popRect.height - margin));
      setPos({ top, left });
    };
    compute();
    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, align, side]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const pop = popoverRef.current;
      const trig = triggerRef.current;
      const target = e.target as Node;
      if (pop?.contains(target) || trig?.contains(target)) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange]);

  const triggerEl = trigger;
  const origRef = (triggerEl as { ref?: React.Ref<HTMLElement> }).ref;
  const cloned = cloneElement(triggerEl, {
    ref: (el: HTMLElement) => {
      triggerRef.current = el;
      if (typeof origRef === "function") origRef(el);
      else if (origRef && "current" in (origRef as { current: unknown })) {
        (origRef as { current: HTMLElement | null }).current = el;
      }
    },
    onClick: (e: React.MouseEvent) => {
      triggerEl.props.onClick?.(e);
      if (!e.defaultPrevented) onOpenChange(!open);
    },
  });

  return (
    <>
      {cloned}
      {open &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              visibility: pos ? "visible" : "hidden",
              zIndex: 60,
            }}
            className={`bg-white border border-gray-200 rounded-md shadow-lg ${className ?? ""}`}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
