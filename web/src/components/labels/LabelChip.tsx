"use client";

// Compute the YIQ luminance of a hex color so we can pick black or white text.
function isLightColor(hex: string): boolean {
  const v = hex.replace("#", "");
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

export function LabelChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color: string;
  onRemove?: () => void;
}) {
  const fg = isLightColor(color) ? "#000" : "#fff";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
      style={{ backgroundColor: color, color: fg }}
    >
      {name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-70 hover:opacity-100"
          aria-label={`Remove label ${name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
