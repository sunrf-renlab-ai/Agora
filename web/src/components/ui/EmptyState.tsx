import type { ReactNode } from "react";
import { Button } from "./Button";

interface Props {
  title: string;
  description?: string;
  icon?: ReactNode;
  cta?: { label: string; onClick: () => void };
}

/**
 * Empty-state placeholder. Used when a list/table loaded but has zero
 * results. Centered, restrained — the icon sits inside a soft tinted
 * disc rather than floating naked, giving the page a focal point
 * without competing with the page header.
 */
export function EmptyState({ title, description, icon, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      {icon && (
        <div className="mb-5 w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-gray-900">{title}</p>
      {description && (
        <p className="mt-1.5 text-[13px] text-gray-500 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {cta && (
        <Button onClick={cta.onClick} className="mt-5" size="md">
          {cta.label}
        </Button>
      )}
    </div>
  );
}
