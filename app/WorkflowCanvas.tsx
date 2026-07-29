"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  getViewportForBounds,
  MarkerType,
  MiniMap,
  ReactFlow,
  ViewportPortal,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Check,
  Copy,
  GitFork,
  Image as ImageIcon,
  Maximize2,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toBlob } from "html-to-image";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildMiniMapEdgeSegments,
  isDenseMiniMap,
} from "../lib/minimap";
import {
  countSubAgents,
  createWorkflowPolicy,
  validateGraph,
  wouldCreateCycle,
  type WorkflowEdge,
  type WorkflowTaskNode,
} from "../lib/workflow";
import { useStudioStore } from "./store";
import type { ShowNotice } from "./studio-types";
import { TaskNode } from "./TaskNode";
import {
  WorkflowMiniMapNode,
  WorkflowMiniMapProvider,
} from "./WorkflowMiniMapNode";

const nodeTypes = { workflowTask: TaskNode };
const GROUP_COLORS = ["#d79a3c", "#5085c7", "#708f58", "#9b6cc0", "#c76675"];

type WorkflowCanvasProps = {
  showNotice: ShowNotice;
  panelLayoutKey: string;
  isInspectorCollapsed: boolean;
  onTaskSelect: () => void;
};

type GroupBoundary = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

function colorForGroup(groupId: string): string {
  const hash = [...groupId].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

function viewportDuration(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 220;
}

function getGroupBoundaries(nodes: WorkflowTaskNode[]): GroupBoundary[] {
  const groups = new Map<string, WorkflowTaskNode[]>();
  nodes.forEach((node) => {
    const group = node.data.parallelGroupId?.trim();
    if (group) groups.set(group, [...(groups.get(group) ?? []), node]);
  });

  return [...groups].map(([id, members]) => {
    const padding = 26;
    const left = Math.min(...members.map((node) => node.position.x));
    const top = Math.min(...members.map((node) => node.position.y));
    const right = Math.max(
      ...members.map(
        (node) => node.position.x + (node.measured?.width ?? node.width ?? 270),
      ),
    );
    const bottom = Math.max(
      ...members.map(
        (node) =>
          node.position.y + (node.measured?.height ?? node.height ?? 210),
      ),
    );
    return {
      id,
      x: left - padding,
      y: top - padding - 18,
      width: right - left + padding * 2,
      height: bottom - top + padding * 2 + 18,
      color: colorForGroup(id),
    };
  });
}

export function WorkflowCanvas({
  showNotice,
  panelLayoutKey,
  isInspectorCollapsed,
  onTaskSelect,
}: WorkflowCanvasProps) {
  const {
    agentBudget,
    nodes,
    edges,
    selectedNodeId,
    past,
    future,
    layoutDirection,
    requiresMigrationReview,
    selectNode,
    setLayoutDirection,
    applyNodeChanges,
    applyEdgeChanges,
    beginNodeDrag,
    endNodeDrag,
    connect,
    autoLayout,
    duplicateSelected,
    deleteSelected,
    addNode,
    undo,
    redo,
  } = useStudioStore();
  const graph = useMemo(
    () => ({ schemaVersion: 2 as const, nodes, edges }),
    [nodes, edges],
  );
  const policy = useMemo(
    () => createWorkflowPolicy(agentBudget),
    [agentBudget],
  );
  const validation = useMemo(
    () => validateGraph(graph, policy),
    [graph, policy],
  );
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const delegatedCount = countSubAgents(graph);
  const boundaries = useMemo(() => getGroupBoundaries(nodes), [nodes]);
  const miniMapSegments = useMemo(
    () => buildMiniMapEdgeSegments(nodes, edges),
    [edges, nodes],
  );
  const miniMapIsDense = isDenseMiniMap(nodes.length, miniMapSegments.length);
  const firstMiniMapNodeId =
    nodes.find((node) => !node.hidden)?.id ?? null;
  const miniMapMarkerId = `workflow-minimap-arrow-${useId().replaceAll(":", "")}`;
  const lastBreakpoint = useRef<boolean | null>(null);
  const flowInstance = useRef<
    ReactFlowInstance<WorkflowTaskNode, WorkflowEdge> | null
  >(null);
  const previousPanelLayoutKey = useRef(panelLayoutKey);
  const pendingFocusNodeId = useRef<string | null>(null);
  const canvasWrap = useRef<HTMLDivElement | null>(null);
  const [isCopyingImage, setIsCopyingImage] = useState(false);

  const fitGraph = useCallback(() => {
    void flowInstance.current?.fitView({
      padding: 0.18,
      duration: viewportDuration(),
      maxZoom: 1,
    });
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    const instance = flowInstance.current;
    const node = instance?.getNode(nodeId);
    if (!instance || !node) {
      fitGraph();
      return;
    }
    const width = node.measured?.width ?? node.width ?? 270;
    const height = node.measured?.height ?? node.height ?? 170;
    const zoom = Math.min(1, Math.max(instance.getZoom(), 0.76));
    void instance.setCenter(
      node.position.x + width / 2,
      node.position.y + height / 2,
      { zoom, duration: viewportDuration() },
    );
  }, [fitGraph]);

  const createWorkflowImage = useCallback(async (): Promise<Blob> => {
    const instance = flowInstance.current;
    const viewport = canvasWrap.current?.querySelector<HTMLElement>(
      ".react-flow__viewport",
    );
    if (!instance || !viewport || !nodes.length) {
      throw new Error("복사할 작업 흐름을 찾지 못했습니다.");
    }

    const bounds = instance.getNodesBounds(nodes);
    const isPortrait = bounds.height > bounds.width * 1.15;
    const imageWidth = isPortrait ? 1200 : 1600;
    const imageHeight = isPortrait ? 1600 : 1000;
    const exportViewport = getViewportForBounds(
      bounds,
      imageWidth,
      imageHeight,
      0.1,
      2,
      0.12,
    );

    canvasWrap.current?.classList.add("canvas-wrap--exporting");
    try {
      await document.fonts?.ready;
      const blob = await toBlob(viewport, {
        backgroundColor: "#f4f6f9",
        width: imageWidth,
        height: imageHeight,
        pixelRatio: 1.5,
        cacheBust: true,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${exportViewport.x}px, ${exportViewport.y}px) scale(${exportViewport.zoom})`,
        },
      });
      if (!blob) {
        throw new Error("작업 흐름 이미지를 만들지 못했습니다.");
      }
      return blob;
    } finally {
      canvasWrap.current?.classList.remove("canvas-wrap--exporting");
    }
  }, [nodes]);

  const copyWorkflowImage = useCallback(() => {
    if (isCopyingImage) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      showNotice({
        type: "error",
        message:
          "이 브라우저는 이미지 복사를 지원하지 않습니다. 최신 브라우저에서 다시 시도해 주세요.",
      });
      return;
    }

    setIsCopyingImage(true);
    const imagePromise = createWorkflowImage();
    void navigator.clipboard
      .write([new ClipboardItem({ "image/png": imagePromise })])
      .then(() => {
        showNotice({
          type: "success",
          message:
            "작업 흐름 이미지를 복사했습니다. 작업 지시서와 함께 첨부하세요.",
        });
      })
      .catch((error: unknown) => {
        showNotice({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "작업 흐름 이미지 복사에 실패했습니다.",
        });
      })
      .finally(() => setIsCopyingImage(false));
  }, [createWorkflowImage, isCopyingImage, showNotice]);

  useEffect(() => {
    if (previousPanelLayoutKey.current === panelLayoutKey) return;
    previousPanelLayoutKey.current = panelLayoutKey;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const nodeId = pendingFocusNodeId.current;
        pendingFocusNodeId.current = null;
        if (nodeId) {
          focusNode(nodeId);
        } else {
          fitGraph();
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [fitGraph, focusNode, panelLayoutKey]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const applyBreakpoint = (matches: boolean) => {
      if (lastBreakpoint.current === matches) return;
      lastBreakpoint.current = matches;
      setLayoutDirection(matches ? "TB" : "LR");
    };
    applyBreakpoint(media.matches);
    const onChange = (event: MediaQueryListEvent) =>
      applyBreakpoint(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [setLayoutDirection]);

  const onConnect = (connection: Connection) => {
    const result = connect(connection);
    showNotice({
      type: result.ok ? "success" : "error",
      message: result.message ?? "작업 의존성을 연결했습니다.",
    });
  };

  const isValidConnection = (
    connection: Connection | (typeof edges)[number],
  ) => {
    if (!connection.source || !connection.target) return false;
    if (
      edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target,
      )
    ) {
      return false;
    }
    return !wouldCreateCycle(connection.source, connection.target, edges);
  };

  return (
    <section className="canvas-panel" aria-labelledby="canvas-title">
      <div className="canvas-toolbar">
        <div className="canvas-title">
          <span className="step-label">3단계</span>
          <h2 id="canvas-title" tabIndex={-1}>
            작업 흐름
          </h2>
          <span
            className={`count-chip ${
              nodes.length > policy.maxTotalNodes ? "count-chip--over" : ""
            }`}
          >
            작업 {nodes.length}/{policy.maxTotalNodes}
          </span>
          <span
            className={`count-chip ${
              delegatedCount > policy.maxSubAgents ? "count-chip--over" : ""
            }`}
          >
            위임 {delegatedCount}/{policy.maxSubAgents}
          </span>
        </div>
        <div className="toolbar-actions" aria-label="캔버스 편집 도구">
          <button
            type="button"
            className="icon-button"
            onClick={undo}
            disabled={!past.length}
            aria-label="실행 취소"
            title="실행 취소"
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={redo}
            disabled={!future.length}
            aria-label="다시 실행"
            title="다시 실행"
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            className="icon-button"
            onClick={autoLayout}
            aria-label={`${layoutDirection} 방향 작업 자동 배치`}
            title={`${layoutDirection} 방향 작업 자동 배치`}
          >
            {layoutDirection === "LR" ? (
              <AlignHorizontalDistributeCenter size={16} aria-hidden="true" />
            ) : (
              <AlignVerticalDistributeCenter size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={fitGraph}
            aria-label="작업 흐름 전체 맞춤"
            title="작업 흐름 전체 맞춤"
          >
            <Maximize2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button toolbar-map-copy-button"
            onClick={copyWorkflowImage}
            disabled={isCopyingImage}
            aria-label="작업 흐름 이미지 복사"
            title="전체 작업 흐름을 PNG 이미지로 복사"
          >
            <ImageIcon size={15} aria-hidden="true" />
            <span>{isCopyingImage ? "복사 중" : "맵 복사"}</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={duplicateSelected}
            disabled={!selectedNode}
            aria-label="선택 작업 복제"
            title="선택 작업 복제"
          >
            <Copy size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button icon-button--danger"
            onClick={deleteSelected}
            disabled={!selectedNode || nodes.length === 1}
            aria-label="선택 작업 삭제"
            title="선택 작업 삭제"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button toolbar-add-button"
            onClick={addNode}
          >
            <Plus size={15} aria-hidden="true" />
            <span>노드 추가</span>
          </button>
        </div>
      </div>

      <div className="canvas-wrap" ref={canvasWrap}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={applyNodeChanges}
          onEdgesChange={applyEdgeChanges}
          onNodeDragStart={beginNodeDrag}
          onNodeDragStop={endNodeDrag}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, node) => {
            selectNode(node.id);
            if (isInspectorCollapsed) {
              pendingFocusNodeId.current = node.id;
            }
            onTaskSelect();
          }}
          onPaneClick={() => selectNode(null)}
          onInit={(instance) => {
            flowInstance.current = instance;
          }}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.7}
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={["Backspace", "Delete"]}
          defaultEdgeOptions={{
            type: "smoothstep",
            interactionWidth: 36,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "#77849d", strokeWidth: 1.6 },
          }}
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.1}
            color="#cbd2df"
          />
          <ViewportPortal>
            {boundaries.map((boundary) => (
              <div
                key={boundary.id}
                className="parallel-group-boundary"
                style={{
                  left: boundary.x,
                  top: boundary.y,
                  width: boundary.width,
                  height: boundary.height,
                  borderColor: boundary.color,
                  backgroundColor: `${boundary.color}0d`,
                }}
                aria-hidden="true"
              >
                <span style={{ color: boundary.color }}>
                  병렬 · {boundary.id}
                </span>
              </div>
            ))}
          </ViewportPortal>
          <Controls
            position="bottom-left"
            showInteractive={false}
            showFitView={false}
          />
          <WorkflowMiniMapProvider
            firstNodeId={firstMiniMapNodeId}
            markerId={miniMapMarkerId}
            segments={miniMapSegments}
          >
            <MiniMap
              className={`workflow-minimap ${
                miniMapIsDense ? "workflow-minimap--dense" : ""
              }`}
              position="bottom-right"
              pannable
              zoomable
              nodeComponent={WorkflowMiniMapNode}
              nodeColor={(node) =>
                node.data.assignee === "delegated" ? "#e0a341" : "#263652"
              }
              maskColor="rgba(242, 244, 248, 0.72)"
              ariaLabel="작업 흐름 미니맵. 화살표는 작업 진행 방향을 나타냅니다."
            />
          </WorkflowMiniMapProvider>
        </ReactFlow>

        <div className="canvas-legend" aria-label="작업 담당 범례">
          <span>
            <i className="legend-dot legend-dot--sequential" />
            메인 담당
          </span>
          <span>
            <i className="legend-dot legend-dot--parallel" />
            서브에이전트 담당
          </span>
        </div>
      </div>

      <div
        className={`validation-bar ${
          validation.errors.length
            ? "validation-bar--error"
            : requiresMigrationReview
              ? "validation-bar--warning"
              : ""
        }`}
        role="status"
      >
        {validation.errors.length ? (
          <>
            <X size={14} aria-hidden="true" />
            {validation.errors[0]}
          </>
        ) : requiresMigrationReview ? (
          <>
            <GitFork size={14} aria-hidden="true" />
            변환된 작업 계약을 검토한 뒤 내보낼 수 있습니다.
          </>
        ) : validation.warnings.length ? (
          <>
            <GitFork size={14} aria-hidden="true" />
            {validation.warnings[0]}
          </>
        ) : (
          <>
            <Check size={14} aria-hidden="true" />
            그래프 오류 없음
          </>
        )}
      </div>
    </section>
  );
}
