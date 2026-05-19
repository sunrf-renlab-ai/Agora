"use client";
import { forwardRef } from "react";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

// Compact pill button used for property triggers in the create-issue dialog
// (Status / Priority / Assignee / DueDate / Project / Parent / Sub-issues).
// Small height, subtle border, inline icon + label via children.
export const PillButton = forwardRef<HTMLButtonElement, Props>(function PillButton(
  { className = "", active = false, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-50 ${active ? "bg-gray-50" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
