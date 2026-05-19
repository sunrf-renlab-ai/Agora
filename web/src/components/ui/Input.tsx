import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Standardized text input + textarea. Wraps the native element in a
 * consistent border + focus ring (3px brand-blue glow at 60% opacity)
 * so every form field across the app reads the same way without
 * each caller copying a tailwind string.
 */

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

const baseField =
  "w-full bg-white border rounded-md px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 transition-shadow focus:outline-none disabled:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed";

const focusRing =
  "focus:border-indigo-300 focus:shadow-[0_0_0_3px_oklch(0.93_0.04_255_/_0.6)]";

const invalidRing =
  "border-red-300 focus:border-red-400 focus:shadow-[0_0_0_3px_oklch(0.93_0.06_27.325_/_0.55)]";

export function Input({ className = "", invalid, ...rest }: InputProps) {
  return (
    <input
      className={`${baseField} ${invalid ? invalidRing : `border-gray-200 ${focusRing}`} ${className}`}
      {...rest}
    />
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export function Textarea({ className = "", invalid, ...rest }: TextareaProps) {
  return (
    <textarea
      className={`${baseField} resize-y leading-relaxed ${invalid ? invalidRing : `border-gray-200 ${focusRing}`} ${className}`}
      {...rest}
    />
  );
}
