"use client";
import type { Issue, IssueDependency } from "@agora/shared";
import Link from "next/link";
import { useMemo } from "react";
import { StatusBadge } from "./StatusBadge";
import { PriorityIcon } from "./pickers/icons";

interface Props {
  issues: Issue[];
  dependencies: IssueDependency[];
  workspaceSlug: string;
}

interface Node {
  issue: Issue;
  layer: number; // depth from a root (no incoming blocks edge)
  x: number;
  y: number;
}

const NODE_W = 240;
const NODE_H = 108;
const COL_GAP = 88;
const ROW_GAP = 28;

/**
 * Workspace-level dependency graph. Renders issues as nodes laid out in
 * columns by topological depth (computed from `blocks` edges); arrows go
 * from blocker → blocked. Issues with no `blocks` relationship at all
 * appear in a separate "unlinked" pile at the bottom.
 *
 * Not a force-directed layout — just a deterministic columnar one. Good
 * enough for hundreds of issues; if a workspace grows past that we'd swap
 * to a real graph library.
 */
export function DependencyGraph({ issues, dependencies, workspaceSlug }: Props) {
  const blocksEdges = useMemo(
    () => dependencies.filter((d) => d.type === "blocks"),
    [dependencies],
  );

  const layout = useMemo(() => layoutGraph(issues, blocksEdges), [issues, blocksEdges]);

  if (layout.nodes.length === 0) {
    return (
      <div className="p-8 text-[13px] text-gray-500">
        No issues in this workspace yet — create some and they'll appear here.
      </div>
    );
  }

  const width = layout.cols * (NODE_W + COL_GAP) + COL_GAP;
  const height = layout.rows * (NODE_H + ROW_GAP) + ROW_GAP;

  const idToNode = new Map(layout.nodes.map((n) => [n.issue.id, n]));

  return (
    <div className="h-full overflow-auto p-6">
      <svg
        width={width}
        height={height}
        className="text-gray-300"
        role="img"
        aria-label="Dependency graph"
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {blocksEdges.map((e) => {
          const from = idToNode.get(e.issueId);
          const to = idToNode.get(e.dependsOnIssueId);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          // Horizontal S-curve: straight diagonals tangle once layers fan
          // out — a bezier with horizontal tangents at both ends reads as
          // a clean flow from blocker to blocked.
          const c = Math.max(36, Math.abs(x2 - x1) * 0.4);
          return (
            <path
              key={e.id}
              d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
          );
        })}
      </svg>
      {/* Nodes are absolutely positioned over the SVG so links stay clickable */}
      <div className="relative" style={{ marginTop: -height, width, height }}>
        {layout.nodes.map((n) => (
          <Link
            key={n.issue.id}
            href={`/${workspaceSlug}/issues/${n.issue.id}`}
            className="group absolute flex flex-col bg-white border border-gray-200 rounded-md px-3 py-2.5 hover:border-gray-300 hover:shadow-[0_2px_6px_rgba(0,0,0,0.04)] transition-all"
            style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-display italic text-[12px] text-gray-400 tabular-nums">
                {n.issue.identifier}
              </span>
              {n.issue.priority !== "none" && (
                <span className="ml-auto">
                  <PriorityIcon priority={n.issue.priority} className="size-3.5" />
                </span>
              )}
            </div>
            <div className="flex-1 text-[13px] font-medium text-gray-900 line-clamp-2 leading-snug">
              {n.issue.title}
            </div>
            <div className="mt-1.5">
              <StatusBadge status={n.issue.status} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function layoutGraph(
  issues: Issue[],
  blocksEdges: IssueDependency[],
): { nodes: Node[]; cols: number; rows: number } {
  const ids = new Set(issues.map((i) => i.id));
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const e of blocksEdges) {
    if (!ids.has(e.issueId) || !ids.has(e.dependsOnIssueId)) continue;
    if (!incoming.has(e.dependsOnIssueId)) incoming.set(e.dependsOnIssueId, new Set());
    incoming.get(e.dependsOnIssueId)?.add(e.issueId);
    if (!outgoing.has(e.issueId)) outgoing.set(e.issueId, new Set());
    outgoing.get(e.issueId)?.add(e.dependsOnIssueId);
  }

  // BFS from roots (issues with no incoming "blocks" edge AND that participate
  // in some edge) to compute layer = longest-path-from-root.
  const layer = new Map<string, number>();
  const inGraph = new Set<string>();
  for (const e of blocksEdges) {
    if (ids.has(e.issueId) && ids.has(e.dependsOnIssueId)) {
      inGraph.add(e.issueId);
      inGraph.add(e.dependsOnIssueId);
    }
  }
  const roots = Array.from(inGraph).filter((id) => !incoming.has(id));
  // Iterative relaxation — caps at issues.length passes which is plenty for any
  // acyclic graph; a cycle wouldn't infinite-loop since we cap.
  for (const r of roots) layer.set(r, 0);
  const maxPasses = issues.length;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const e of blocksEdges) {
      if (!ids.has(e.issueId) || !ids.has(e.dependsOnIssueId)) continue;
      const fromLayer = layer.get(e.issueId);
      if (fromLayer === undefined) continue;
      const want = fromLayer + 1;
      const current = layer.get(e.dependsOnIssueId);
      if (current === undefined || current < want) {
        layer.set(e.dependsOnIssueId, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Issues outside the dep graph go in their own layer at the end.
  const orphanLayer = layer.size > 0 ? Math.max(...layer.values()) + 1 : 0;
  for (const i of issues) {
    if (!inGraph.has(i.id)) layer.set(i.id, orphanLayer);
  }

  // Group by layer, then assign x/y based on column index + position-in-column.
  const byLayer = new Map<number, Issue[]>();
  for (const issue of issues) {
    const l = layer.get(issue.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)?.push(issue);
  }
  const sortedLayers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  const nodes: Node[] = [];
  let maxRows = 0;
  for (let col = 0; col < sortedLayers.length; col++) {
    const l = sortedLayers[col] as number;
    const layerIssues = byLayer.get(l) ?? [];
    layerIssues.sort((a, b) => a.number - b.number);
    if (layerIssues.length > maxRows) maxRows = layerIssues.length;
    for (let row = 0; row < layerIssues.length; row++) {
      const issue = layerIssues[row] as Issue;
      nodes.push({
        issue,
        layer: l,
        x: COL_GAP + col * (NODE_W + COL_GAP),
        y: ROW_GAP + row * (NODE_H + ROW_GAP),
      });
    }
  }
  return { nodes, cols: sortedLayers.length, rows: maxRows };
}
