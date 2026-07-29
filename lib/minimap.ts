import type { WorkflowEdge, WorkflowTaskNode } from "./workflow";

export type MiniMapNodeRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MiniMapEdgeSegment = {
  id: string;
  source: string;
  target: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const FALLBACK_NODE_WIDTH = 270;
const FALLBACK_NODE_HEIGHT = 170;

export function isDenseMiniMap(
  nodeCount: number,
  edgeCount: number,
): boolean {
  return edgeCount > Math.max(18, nodeCount * 2);
}

export function clipEdgeToNodeBounds(
  source: MiniMapNodeRect,
  target: MiniMapNodeRect,
): Omit<MiniMapEdgeSegment, "id" | "source" | "target"> | null {
  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  if (dx === 0 && dy === 0) return null;

  const sourceScale =
    1 /
    Math.max(
      Math.abs(dx) / (source.width / 2),
      Math.abs(dy) / (source.height / 2),
    );
  const targetScale =
    1 /
    Math.max(
      Math.abs(dx) / (target.width / 2),
      Math.abs(dy) / (target.height / 2),
    );

  return {
    x1: sourceCenter.x + dx * sourceScale,
    y1: sourceCenter.y + dy * sourceScale,
    x2: targetCenter.x - dx * targetScale,
    y2: targetCenter.y - dy * targetScale,
  };
}

function toRect(node: WorkflowTaskNode): MiniMapNodeRect {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? FALLBACK_NODE_WIDTH,
    height: node.measured?.height ?? node.height ?? FALLBACK_NODE_HEIGHT,
  };
}

export function buildMiniMapEdgeSegments(
  nodes: WorkflowTaskNode[],
  edges: WorkflowEdge[],
): MiniMapEdgeSegment[] {
  const rectById = new Map(
    nodes
      .filter((node) => !node.hidden)
      .map((node) => [node.id, toRect(node)]),
  );

  return edges.flatMap((edge) => {
    const source = rectById.get(edge.source);
    const target = rectById.get(edge.target);
    if (!source || !target) return [];

    const segment = clipEdgeToNodeBounds(source, target);
    if (!segment) return [];

    return [
      {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...segment,
      },
    ];
  });
}
