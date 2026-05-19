/**
 * Shimmer placeholder. Use anywhere a query is loading and the user
 * would otherwise see a flash of text or a layout-shifting fallback.
 *
 * Two variants:
 *   <Skeleton className="h-4 w-32" />          // single bar
 *   <Skeleton.Lines count={3} />                // stacked bars with
 *                                              // varied widths
 *
 * The shimmer animation is CSS-only (in globals.css). Respects
 * `prefers-reduced-motion`: the bar is still visible, just doesn't
 * animate.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`agora-skeleton bg-gray-200/70 rounded ${className}`}
      aria-hidden
    />
  );
}

Skeleton.Lines = function SkeletonLines({
  count = 3,
  className = "",
}: { count?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === count - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
};

Skeleton.Card = function SkeletonCard() {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
};
