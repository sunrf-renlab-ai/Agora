import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The single source of truth for buttons. Four variants cover every
 * surface in the app:
 *
 *   primary       brand-blue fill, white text       Send / Save / Confirm
 *   secondary     white fill, hairline border       Cancel / outline action
 *   ghost         transparent, text-only            Tertiary inline action
 *   destructive   red fill, white text              Delete / archive
 *
 * Three sizes (sm / md / lg). Default md.
 *
 * Press feedback (active:scale-[0.97]) + transition-colors are baked
 * in so the keyboard and the mouse get the same affordance signal
 * without each consumer remembering to add them.
 */
type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: Variant;
  size?: Size;
  /** Defaults to "button" so it doesn't accidentally submit a form. */
  type?: "button" | "submit" | "reset";
  /** Optional icon — renders to the LEFT of the label. */
  leadingIcon?: ReactNode;
  /** Optional icon — renders to the RIGHT of the label. */
  trailingIcon?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-sm disabled:bg-gray-200 disabled:text-gray-400 disabled:hover:shadow-none",
  secondary:
    "bg-white text-gray-700 border border-gray-200 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white",
  ghost:
    "bg-transparent text-gray-700 hover:text-gray-900 hover:bg-gray-100/80 disabled:opacity-50",
  destructive:
    "bg-red-600 text-white hover:bg-red-700 hover:shadow-sm disabled:bg-gray-200 disabled:text-gray-400",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1 text-[12px] rounded gap-1",
  md: "px-3.5 py-1.5 text-[13px] rounded-md gap-1.5",
  lg: "px-5 py-2.5 text-[14px] rounded-md gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  leadingIcon,
  trailingIcon,
  className = "",
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium transition-all active:scale-[0.97] disabled:active:scale-100 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
