"use client";
import type { IssuePriority, IssueStatus } from "@agora/shared";

// ---------------------------------------------------------------------------
// Status icon. ViewBox 0 0 14 14, center 7,7.
// Renders a dashed outer ring + pie-wedge progress fill, with per-status
// embellishments (dotted ring for backlog, check for done, slash for blocked,
// X for cancelled).
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<IssueStatus, string> = {
  backlog: "text-muted-foreground",
  todo: "text-muted-foreground",
  in_progress: "text-amber-500",
  in_review: "text-violet-500",
  done: "text-emerald-500",
  blocked: "text-rose-500",
  cancelled: "text-muted-foreground",
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

export function statusLabel(s: IssueStatus): string {
  return STATUS_LABELS[s];
}

const CX = 7;
const CY = 7;
const OUTER_R = 6;
const FILL_R = 3.5;

/** Pie-wedge SVG path from 12 o'clock, clockwise. */
function piePath(cx: number, cy: number, r: number, progress: number): string {
  const angle = 2 * Math.PI * progress;
  const endX = cx + r * Math.sin(angle);
  const endY = cy - r * Math.cos(angle);
  const largeArc = progress > 0.5 ? 1 : 0;
  return `M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${largeArc},1 ${endX},${endY} Z`;
}

function ProgressCircle({
  progress,
  children,
}: {
  progress: number;
  children?: React.ReactNode;
}) {
  return (
    <>
      <circle
        cx={CX}
        cy={CY}
        r={OUTER_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray="3.14 0"
        strokeDashoffset={-0.7}
      />
      {progress === 1 ? (
        <circle cx={CX} cy={CY} r={OUTER_R} fill="currentColor" />
      ) : progress > 0 ? (
        <path d={piePath(CX, CY, FILL_R, progress)} fill="currentColor" />
      ) : null}
      {children}
    </>
  );
}

function BacklogIcon() {
  const count = 16;
  const dotR = 0.55;
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={CX + OUTER_R * Math.cos(angle)}
            cy={CY + OUTER_R * Math.sin(angle)}
            r={dotR}
            fill="currentColor"
          />
        );
      })}
    </g>
  );
}

function TodoIcon() {
  return <ProgressCircle progress={0} />;
}

function InProgressIcon() {
  return <ProgressCircle progress={0.5} />;
}

function InReviewIcon() {
  return <ProgressCircle progress={0.75} />;
}

function DoneIcon() {
  return (
    <ProgressCircle progress={1}>
      <path
        d="M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z"
        fill="white"
        stroke="none"
      />
    </ProgressCircle>
  );
}

function BlockedIcon() {
  return (
    <ProgressCircle progress={0}>
      <line
        x1={CX + FILL_R * Math.cos(Math.PI * 0.75)}
        y1={CY - FILL_R * Math.sin(Math.PI * 0.75)}
        x2={CX + FILL_R * Math.cos(-Math.PI * 0.25)}
        y2={CY - FILL_R * Math.sin(-Math.PI * 0.25)}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </ProgressCircle>
  );
}

function CancelledIcon() {
  return (
    <ProgressCircle progress={0}>
      <path
        d="M5 5 L9 9 M9 5 L5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </ProgressCircle>
  );
}

const STATUS_RENDERERS: Record<IssueStatus, () => React.ReactNode> = {
  backlog: BacklogIcon,
  todo: TodoIcon,
  in_progress: InProgressIcon,
  in_review: InReviewIcon,
  done: DoneIcon,
  blocked: BlockedIcon,
  cancelled: CancelledIcon,
};

export function StatusIcon({
  status,
  className = "",
}: {
  status: IssueStatus;
  className?: string;
}) {
  const color = STATUS_COLORS[status];
  const Renderer = STATUS_RENDERERS[status];
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      className={`${color} shrink-0 ${className}`}
      aria-hidden="true"
    >
      <Renderer />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Priority icon. Horizontal stacked bars rising
// from the bottom (tiny bar chart). "none" renders a single horizontal dash.
// ---------------------------------------------------------------------------

const PRIORITY_LABELS: Record<IssuePriority, string> = {
  none: "无优先级",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

export function priorityLabel(p: IssuePriority): string {
  return PRIORITY_LABELS[p];
}

const PRIORITY_BARS: Record<IssuePriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

const PRIORITY_COLORS: Record<IssuePriority, string> = {
  urgent: "text-rose-500",
  high: "text-amber-500",
  medium: "text-amber-500",
  low: "text-sky-500",
  none: "text-muted-foreground",
};

export function PriorityIcon({
  priority,
  className = "",
}: {
  priority: IssuePriority;
  className?: string;
}) {
  const bars = PRIORITY_BARS[priority];
  const color = PRIORITY_COLORS[priority];

  if (bars === 0) {
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${color} shrink-0 ${className}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <line x1="3" y1="8" x2="13" y2="8" />
      </svg>
    );
  }

  const isUrgent = priority === "urgent";

  return (
    <svg
      viewBox="0 0 16 16"
      className={`${color} shrink-0 ${className}`}
      fill="currentColor"
      style={isUrgent ? { animation: "priority-pulse 2s ease-in-out infinite" } : undefined}
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={1 + i * 4}
          width="3"
          rx="0.5"
          style={{
            y: 12 - (i + 1) * 3,
            height: (i + 1) * 3,
            opacity: i < bars ? 1 : 0.2,
            transition: "y 0.2s ease, height 0.2s ease, opacity 0.2s ease",
          }}
        />
      ))}
      {isUrgent && (
        <style>{`@keyframes priority-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}`}</style>
      )}
    </svg>
  );
}
