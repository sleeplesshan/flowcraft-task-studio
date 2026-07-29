import { describe, expect, it } from "vitest";
import {
  buildMiniMapEdgeSegments,
  clipEdgeToNodeBounds,
  isDenseMiniMap,
  type MiniMapNodeRect,
} from "../lib/minimap";
import type { WorkflowEdge, WorkflowTaskNode } from "../lib/workflow";

const left: MiniMapNodeRect = {
  id: "left",
  x: 0,
  y: 0,
  width: 100,
  height: 60,
};

describe("MiniMap direction geometry", () => {
  it("clips left-to-right edges to both node boundaries", () => {
    const segment = clipEdgeToNodeBounds(left, {
      id: "right",
      x: 200,
      y: 0,
      width: 100,
      height: 60,
    });

    expect(segment).toEqual({ x1: 100, y1: 30, x2: 200, y2: 30 });
  });

  it("clips top-to-bottom edges to both node boundaries", () => {
    const segment = clipEdgeToNodeBounds(left, {
      id: "bottom",
      x: 0,
      y: 160,
      width: 100,
      height: 60,
    });

    expect(segment).toEqual({ x1: 50, y1: 60, x2: 50, y2: 160 });
  });

  it("clips diagonal edges without ending beneath the target node", () => {
    const segment = clipEdgeToNodeBounds(left, {
      id: "diagonal",
      x: 200,
      y: 120,
      width: 100,
      height: 60,
    });

    expect(segment).not.toBeNull();
    expect(segment?.x1).toBeCloseTo(100);
    expect(segment?.y1).toBeCloseTo(60);
    expect(segment?.x2).toBeCloseTo(200);
    expect(segment?.y2).toBeCloseTo(120);
  });

  it("skips coincident nodes and edges with missing endpoints", () => {
    expect(clipEdgeToNodeBounds(left, { ...left, id: "same" })).toBeNull();

    const nodes = [
      {
        id: "left",
        type: "workflowTask",
        data: {},
        position: { x: 0, y: 0 },
        measured: { width: 100, height: 60 },
      },
    ] as WorkflowTaskNode[];
    const edges = [
      {
        id: "missing",
        source: "left",
        target: "missing",
        type: "smoothstep",
      },
    ] as WorkflowEdge[];

    expect(buildMiniMapEdgeSegments(nodes, edges)).toEqual([]);
  });

  it("keeps ordinary graphs legible and softens only dense edge layers", () => {
    expect(isDenseMiniMap(12, 18)).toBe(false);
    expect(isDenseMiniMap(12, 24)).toBe(false);
    expect(isDenseMiniMap(12, 25)).toBe(true);
    expect(isDenseMiniMap(12, 66)).toBe(true);
  });

  it("builds finite directional segments for a dense 12-node DAG", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index + 1}`,
      type: "workflowTask",
      data: {},
      position: { x: index * 320, y: (index % 3) * 220 },
      measured: { width: 270, height: 170 },
    })) as WorkflowTaskNode[];
    const edges = nodes.flatMap((source, sourceIndex) =>
      nodes.slice(sourceIndex + 1).map((target) => ({
        id: `${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        type: "smoothstep" as const,
      })),
    );

    const segments = buildMiniMapEdgeSegments(nodes, edges);
    expect(segments).toHaveLength(66);
    expect(
      segments.every((segment) =>
        [segment.x1, segment.y1, segment.x2, segment.y2].every(Number.isFinite),
      ),
    ).toBe(true);
    expect(
      segments.every(
        (segment) =>
          segment.x1 !== segment.x2 || segment.y1 !== segment.y2,
      ),
    ).toBe(true);
  });
});
