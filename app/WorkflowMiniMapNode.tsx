"use client";

import { MiniMapNode, type MiniMapNodeProps } from "@xyflow/react";
import { createContext, type ReactNode, useContext } from "react";
import type { MiniMapEdgeSegment } from "../lib/minimap";

type WorkflowMiniMapContextValue = {
  firstNodeId: string | null;
  markerId: string;
  segments: MiniMapEdgeSegment[];
};

const WorkflowMiniMapContext =
  createContext<WorkflowMiniMapContextValue | null>(null);

type WorkflowMiniMapProviderProps = WorkflowMiniMapContextValue & {
  children: ReactNode;
};

export function WorkflowMiniMapProvider({
  children,
  firstNodeId,
  markerId,
  segments,
}: WorkflowMiniMapProviderProps) {
  return (
    <WorkflowMiniMapContext.Provider
      value={{ firstNodeId, markerId, segments }}
    >
      {children}
    </WorkflowMiniMapContext.Provider>
  );
}

export function WorkflowMiniMapNode(props: MiniMapNodeProps) {
  const context = useContext(WorkflowMiniMapContext);
  const rendersDirectionLayer = context?.firstNodeId === props.id;

  return (
    <>
      {rendersDirectionLayer ? (
        <>
          <defs>
            <marker
              id={context.markerId}
              className="workflow-minimap__arrow"
              viewBox="0 0 4 4"
              refX="3.6"
              refY="2"
              markerWidth="4"
              markerHeight="4"
              markerUnits="strokeWidth"
              orient="auto"
            >
              <path d="M 0 0 L 4 2 L 0 4 Z" />
            </marker>
          </defs>
          <g
            className="workflow-minimap__edges"
            aria-hidden="true"
            pointerEvents="none"
          >
            {context.segments.map((segment) => (
              <line
                key={segment.id}
                className="workflow-minimap__edge"
                data-edge-id={segment.id}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                markerEnd={`url(#${context.markerId})`}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        </>
      ) : null}
      <MiniMapNode {...props} />
    </>
  );
}
