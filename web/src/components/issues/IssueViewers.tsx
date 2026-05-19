"use client";

interface Viewer {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
}

interface Props {
  viewers: Viewer[];
  selfUserId: string | null;
  max?: number;
}

/**
 * Avatar stack of users currently viewing the issue, excluding self.
 * Empty when nobody else is here. Hover any avatar to see the user's name.
 */
export function IssueViewers({ viewers, selfUserId, max = 3 }: Props) {
  const others = viewers.filter((v) => v.userId !== selfUserId);
  if (others.length === 0) return null;
  const visible = others.slice(0, max);
  const overflow = others.length - visible.length;

  return (
    <div className="flex items-center -space-x-1.5" aria-label="Currently viewing">
      {visible.map((v) => (
        <Avatar key={v.userId} viewer={v} />
      ))}
      {overflow > 0 && (
        <div
          className="w-6 h-6 rounded-full ring-2 ring-white bg-gray-200 text-[10px] font-semibold flex items-center justify-center text-gray-600"
          title={`${overflow} more`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

function Avatar({ viewer }: { viewer: Viewer }) {
  const label = viewer.name ?? "Unknown";
  const initial = label[0]?.toUpperCase() ?? "?";
  if (viewer.avatarUrl) {
    return (
      <img
        src={viewer.avatarUrl}
        alt={label}
        title={label}
        className="w-6 h-6 rounded-full ring-2 ring-white object-cover"
      />
    );
  }
  return (
    <div
      className="w-6 h-6 rounded-full ring-2 ring-white bg-indigo-100 text-indigo-700 text-[10px] font-semibold flex items-center justify-center"
      title={label}
    >
      {initial}
    </div>
  );
}
