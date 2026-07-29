"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  MarkerType,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  layoutGraph,
  parseWorkflowGraph,
  sampleGraph,
  serializeGraph,
  WORKFLOW_SCHEMA_VERSION,
  type MigrationIssue,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowTaskData,
  type WorkflowTaskNode,
  wouldCreateCycle,
} from "../lib/workflow";

export type LayoutDirection = "LR" | "TB";

export type ImportReview = {
  requiresMigrationReview: boolean;
  migrationIssues: MigrationIssue[];
};

export type Snapshot = Pick<
  StudioState,
  "nodes" | "edges" | "requiresMigrationReview" | "migrationIssues"
>;

type ReplaceGraphOptions = ImportReview;

export type StudioState = {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  rawContent: string;
  generatedPrompt: string;
  jsonDraft: string;
  agentBudget: number;
  layoutDirection: LayoutDirection;
  nodes: WorkflowTaskNode[];
  edges: WorkflowEdge[];
  requiresMigrationReview: boolean;
  migrationIssues: MigrationIssue[];
  selectedNodeId: string | null;
  past: Snapshot[];
  future: Snapshot[];
  dragStartSnapshot: Snapshot | null;
  setRawContent: (value: string) => void;
  setGeneratedPrompt: (value: string) => void;
  setJsonDraft: (value: string) => void;
  setAgentBudget: (value: number) => void;
  setLayoutDirection: (value: LayoutDirection) => void;
  selectNode: (id: string | null) => void;
  replaceGraph: (graph: WorkflowGraph, options?: ReplaceGraphOptions) => void;
  confirmMigrationReview: () => void;
  applyNodeChanges: (changes: NodeChange<WorkflowTaskNode>[]) => void;
  applyEdgeChanges: (changes: EdgeChange<WorkflowEdge>[]) => void;
  beginNodeDrag: () => void;
  endNodeDrag: () => void;
  addNode: () => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  updateSelectedData: (patch: Partial<WorkflowTaskData>) => void;
  connect: (connection: Connection) => { ok: boolean; message?: string };
  autoLayout: () => void;
  undo: () => void;
  redo: () => void;
  restoreExample: () => void;
};

export type PersistedStudioState = Pick<
  StudioState,
  | "schemaVersion"
  | "rawContent"
  | "generatedPrompt"
  | "jsonDraft"
  | "agentBudget"
  | "layoutDirection"
  | "nodes"
  | "edges"
  | "requiresMigrationReview"
  | "migrationIssues"
>;

export const STUDIO_STORAGE_KEY = "multi-agent-workflow-studio-v1";
export const STUDIO_PERSIST_VERSION = 4;
const initialGraph = sampleGraph;
const initialJsonDraft = "";

function graphFrom(
  nodes: WorkflowTaskNode[],
  edges: WorkflowEdge[],
): WorkflowGraph {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes,
    edges,
  };
}

function cloneSnapshot(state: Snapshot): Snapshot {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    requiresMigrationReview: state.requiresMigrationReview,
    migrationIssues: structuredClone(state.migrationIssues),
  };
}

function commitGraph(
  state: StudioState,
  graph: WorkflowGraph,
  review: ImportReview = {
    requiresMigrationReview: state.requiresMigrationReview,
    migrationIssues: state.migrationIssues,
  },
): Partial<StudioState> {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: graph.nodes,
    edges: graph.edges,
    requiresMigrationReview: review.requiresMigrationReview,
    migrationIssues: structuredClone(review.migrationIssues),
    past: [...state.past.slice(-49), cloneSnapshot(state)],
    future: [],
    dragStartSnapshot: null,
  };
}

function snapshotPositionsDiffer(a: Snapshot, b: Snapshot): boolean {
  if (a.nodes.length !== b.nodes.length) return true;
  const positions = new Map(
    a.nodes.map((node) => [node.id, `${node.position.x}:${node.position.y}`]),
  );
  return b.nodes.some(
    (node) =>
      positions.get(node.id) !== `${node.position.x}:${node.position.y}`,
  );
}

function layoutForDirection(
  graph: WorkflowGraph,
  direction: LayoutDirection,
): WorkflowGraph {
  const laidOut = layoutGraph(graph);
  if (direction === "LR") return laidOut;
  return {
    ...laidOut,
    nodes: laidOut.nodes.map((node) => ({
      ...node,
      position: {
        x: node.position.y,
        y: node.position.x,
      },
    })),
  };
}

function isLayoutDirection(value: unknown): value is LayoutDirection {
  return value === "LR" || value === "TB";
}

function sanitizeMigrationIssues(
  value: unknown,
  validNodeIds: Set<string>,
): MigrationIssue[] {
  if (!Array.isArray(value)) return [];
  const issues = value.flatMap((item): MigrationIssue[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<MigrationIssue>;
    if (
      typeof candidate.nodeId !== "string" ||
      !validNodeIds.has(candidate.nodeId) ||
      !Array.isArray(candidate.fields) ||
      typeof candidate.message !== "string"
    ) {
      return [];
    }
    const fields = [
      ...new Set(
        candidate.fields.filter(
          (field): field is string =>
            typeof field === "string" && Boolean(field.trim()),
        ),
      ),
    ];
    return [
      {
        nodeId: candidate.nodeId,
        fields,
        message: candidate.message,
      },
    ];
  });
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.nodeId}|${issue.fields.join(",")}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function legacyReviewIssues(
  value: unknown,
  validNodeIds: Set<string>,
): MigrationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((nodeId): MigrationIssue[] =>
    typeof nodeId === "string" && validNodeIds.has(nodeId)
      ? [
          {
            nodeId,
            fields: ["assignee"],
            message:
              "이전 저장 상태에서 실행 담당 검토가 필요했던 노드입니다. v2 assignee를 확인해 주세요.",
          },
        ]
      : [],
  );
}

function dedupeIssues(issues: MigrationIssue[]): MigrationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.nodeId}|${issue.fields.join(",")}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseCandidateGraph(candidate: Record<string, unknown>) {
  const nodes = Array.isArray(candidate.nodes)
    ? candidate.nodes.map((node) => {
        if (!node || typeof node !== "object") return node;
        const value = node as Record<string, unknown>;
        return {
          id: value.id,
          type: value.type,
          data: value.data,
          position: value.position,
        };
      })
    : candidate.nodes;
  const edges = Array.isArray(candidate.edges)
    ? candidate.edges.map((edge) => {
        if (!edge || typeof edge !== "object") return edge;
        const value = edge as Record<string, unknown>;
        return {
          id: value.id,
          source: value.source,
          target: value.target,
          type: value.type,
        };
      })
    : candidate.edges;
  const payload = {
    ...(candidate.schemaVersion === WORKFLOW_SCHEMA_VERSION
      ? { schemaVersion: WORKFLOW_SCHEMA_VERSION }
      : {}),
    nodes,
    edges,
  };
  return parseWorkflowGraph(JSON.stringify(payload));
}

export function migratePersistedState(
  persisted: unknown,
  version: number,
): unknown {
  if (!persisted || typeof persisted !== "object") return {};
  const candidate = persisted as Record<string, unknown>;
  const parsed = parseCandidateGraph(candidate);
  if (!parsed.success) return candidate;

  const validNodeIds = new Set(parsed.graph.nodes.map((node) => node.id));
  const currentIssues = sanitizeMigrationIssues(
    candidate.migrationIssues,
    validNodeIds,
  );
  const oldReviewIssues = legacyReviewIssues(
    candidate.legacyNodeIds,
    validNodeIds,
  );
  const migrationIssues = dedupeIssues([
    ...parsed.migrationIssues,
    ...currentIssues,
    ...oldReviewIssues,
  ]);
  const requiresMigrationReview =
    parsed.requiresMigrationReview ||
    candidate.requiresMigrationReview === true ||
    candidate.requiresExecutionReview === true ||
    migrationIssues.length > 0;
  const rest = { ...candidate };
  delete rest.requiresExecutionReview;
  delete rest.legacyNodeIds;

  return {
    ...rest,
    jsonDraft: version < 4 ? "" : rest.jsonDraft,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: parsed.graph.nodes,
    edges: parsed.graph.edges,
    layoutDirection: isLayoutDirection(candidate.layoutDirection)
      ? candidate.layoutDirection
      : "LR",
    requiresMigrationReview,
    migrationIssues,
  };
}

export function restorePersistedState(
  persisted: unknown,
  fallback: PersistedStudioState,
): PersistedStudioState {
  if (!persisted || typeof persisted !== "object") return fallback;
  const candidate = persisted as Record<string, unknown>;
  const parsed = parseCandidateGraph(candidate);
  if (!parsed.success) return fallback;

  const validNodeIds = new Set(parsed.graph.nodes.map((node) => node.id));
  const migrationIssues = dedupeIssues([
    ...parsed.migrationIssues,
    ...sanitizeMigrationIssues(candidate.migrationIssues, validNodeIds),
    ...legacyReviewIssues(candidate.legacyNodeIds, validNodeIds),
  ]);

  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    rawContent:
      typeof candidate.rawContent === "string"
        ? candidate.rawContent
        : fallback.rawContent,
    generatedPrompt:
      typeof candidate.generatedPrompt === "string"
        ? candidate.generatedPrompt
        : fallback.generatedPrompt,
    jsonDraft:
      typeof candidate.jsonDraft === "string"
        ? candidate.jsonDraft
        : fallback.jsonDraft,
    agentBudget:
      typeof candidate.agentBudget === "number" &&
      [2, 4, 8].includes(candidate.agentBudget)
        ? candidate.agentBudget
        : fallback.agentBudget,
    layoutDirection: isLayoutDirection(candidate.layoutDirection)
      ? candidate.layoutDirection
      : fallback.layoutDirection,
    nodes: parsed.graph.nodes,
    edges: parsed.graph.edges,
    requiresMigrationReview:
      parsed.requiresMigrationReview ||
      candidate.requiresMigrationReview === true ||
      candidate.requiresExecutionReview === true ||
      migrationIssues.length > 0,
    migrationIssues,
  };
}

function normalizeArray(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      rawContent: "",
      generatedPrompt: "",
      jsonDraft: initialJsonDraft,
      agentBudget: 4,
      layoutDirection: "LR",
      nodes: initialGraph.nodes,
      edges: initialGraph.edges,
      requiresMigrationReview: false,
      migrationIssues: [],
      selectedNodeId: null,
      past: [],
      future: [],
      dragStartSnapshot: null,
      setRawContent: (rawContent) => set({ rawContent }),
      setGeneratedPrompt: (generatedPrompt) => set({ generatedPrompt }),
      setJsonDraft: (jsonDraft) => set({ jsonDraft }),
      setAgentBudget: (agentBudget) => set({ agentBudget }),
      setLayoutDirection: (layoutDirection) =>
        set((state) => {
          if (layoutDirection === state.layoutDirection) return {};
          const laidOut = layoutForDirection(
            graphFrom(state.nodes, state.edges),
            layoutDirection,
          );
          return {
            layoutDirection,
            nodes: laidOut.nodes,
            edges: laidOut.edges,
            selectedNodeId: null,
            past: [],
            future: [],
            dragStartSnapshot: null,
          };
        }),
      selectNode: (selectedNodeId) => set({ selectedNodeId }),
      replaceGraph: (graph, options) =>
        set((state) => ({
          ...commitGraph(
            state,
            graph,
            options ?? {
              requiresMigrationReview: false,
              migrationIssues: [],
            },
          ),
          selectedNodeId: null,
        })),
      confirmMigrationReview: () =>
        set((state) => {
          if (!state.requiresMigrationReview && !state.migrationIssues.length) {
            return {};
          }
          return {
            requiresMigrationReview: false,
            migrationIssues: [],
            past: [...state.past.slice(-49), cloneSnapshot(state)],
            future: [],
            dragStartSnapshot: null,
          };
        }),
      applyNodeChanges: (changes) =>
        set((state) => {
          const nodes = applyNodeChanges(changes, state.nodes);
          if (changes.some((change) => change.type === "remove")) {
            return {
              ...commitGraph(state, graphFrom(nodes, state.edges)),
              selectedNodeId:
                state.selectedNodeId &&
                nodes.some((node) => node.id === state.selectedNodeId)
                  ? state.selectedNodeId
                  : null,
            };
          }
          return { nodes };
        }),
      applyEdgeChanges: (changes) =>
        set((state) => {
          const edges = applyEdgeChanges(changes, state.edges);
          if (changes.some((change) => change.type === "remove")) {
            return commitGraph(state, graphFrom(state.nodes, edges));
          }
          return { edges };
        }),
      beginNodeDrag: () =>
        set((state) => ({
          dragStartSnapshot: state.dragStartSnapshot
            ? state.dragStartSnapshot
            : cloneSnapshot(state),
        })),
      endNodeDrag: () =>
        set((state) => {
          const start = state.dragStartSnapshot;
          if (!start) return {};
          const current = cloneSnapshot(state);
          if (!snapshotPositionsDiffer(start, current)) {
            return { dragStartSnapshot: null };
          }
          return {
            past: [...state.past.slice(-49), start],
            future: [],
            dragStartSnapshot: null,
          };
        }),
      addNode: () =>
        set((state) => {
          const numericIds = state.nodes
            .map((node) => Number(node.id.replace(/\D/g, "")))
            .filter(Number.isFinite);
          const nextNumber = Math.max(0, ...numericIds) + 1;
          const node: WorkflowTaskNode = {
            id: `task-${nextNumber}`,
            type: "workflowTask",
            data: {
              title: `새 작업 ${nextNumber}`,
              executorRole: "Lead Orchestrator",
              instruction: "수행할 구체적인 작업을 입력하세요.",
              assignee: "main",
              inputs: [],
              outputs: [`새 작업 ${nextNumber} 결과물`],
              completionCriteria: [`새 작업 ${nextNumber} 완료`],
              allowedTools: [],
              fileScope: [],
            },
            position:
              state.layoutDirection === "LR"
                ? {
                    x:
                      Math.max(
                        40,
                        ...state.nodes.map((item) => item.position.x),
                      ) + 320,
                    y: 80 + (state.nodes.length % 4) * 240,
                  }
                : {
                    x: 80 + (state.nodes.length % 4) * 300,
                    y:
                      Math.max(
                        40,
                        ...state.nodes.map((item) => item.position.y),
                      ) + 260,
                  },
          };
          return {
            ...commitGraph(
              state,
              graphFrom([...state.nodes, node], state.edges),
            ),
            selectedNodeId: node.id,
          };
        }),
      duplicateSelected: () =>
        set((state) => {
          const source = state.nodes.find(
            (node) => node.id === state.selectedNodeId,
          );
          if (!source) return {};
          let index = 2;
          let id = `${source.id}-copy-${index}`;
          while (state.nodes.some((node) => node.id === id)) {
            index += 1;
            id = `${source.id}-copy-${index}`;
          }
          const node: WorkflowTaskNode = {
            ...structuredClone(source),
            id,
            selected: false,
            position:
              state.layoutDirection === "LR"
                ? {
                    x: source.position.x + 48,
                    y: source.position.y + 240,
                  }
                : {
                    x: source.position.x + 300,
                    y: source.position.y + 48,
                  },
            data: {
              ...source.data,
              title: `${source.data.title} 복사본`,
              parallelGroupId: undefined,
            },
          };
          return {
            ...commitGraph(
              state,
              graphFrom([...state.nodes, node], state.edges),
            ),
            selectedNodeId: node.id,
          };
        }),
      deleteSelected: () =>
        set((state) => {
          if (!state.selectedNodeId) return {};
          const nodes = state.nodes.filter(
            (node) => node.id !== state.selectedNodeId,
          );
          if (!nodes.length) return {};
          const edges = state.edges.filter(
            (edge) =>
              edge.source !== state.selectedNodeId &&
              edge.target !== state.selectedNodeId,
          );
          return {
            ...commitGraph(state, graphFrom(nodes, edges)),
            selectedNodeId: null,
          };
        }),
      updateSelectedData: (patch) =>
        set((state) => {
          if (!state.selectedNodeId) return {};
          const nodes = state.nodes.map((node) => {
            if (node.id !== state.selectedNodeId) return node;
            const data = { ...node.data, ...patch };
            const group =
              data.assignee === "delegated"
                ? data.parallelGroupId?.trim()
                : undefined;
            return {
              ...node,
              data: {
                ...data,
                parallelGroupId: group || undefined,
                inputs: normalizeArray(data.inputs),
                outputs: normalizeArray(data.outputs),
                completionCriteria: normalizeArray(
                  data.completionCriteria,
                ),
                allowedTools: normalizeArray(data.allowedTools),
                fileScope: normalizeArray(data.fileScope),
              },
            };
          });
          return commitGraph(state, graphFrom(nodes, state.edges));
        }),
      connect: (connection) => {
        const state = get();
        if (!connection.source || !connection.target) {
          return { ok: false, message: "연결할 두 노드를 선택해 주세요." };
        }
        if (
          !state.nodes.some((node) => node.id === connection.source) ||
          !state.nodes.some((node) => node.id === connection.target)
        ) {
          return { ok: false, message: "존재하지 않는 작업은 연결할 수 없습니다." };
        }
        if (
          state.edges.some(
            (edge) =>
              edge.source === connection.source &&
              edge.target === connection.target,
          )
        ) {
          return { ok: false, message: "이미 존재하는 연결입니다." };
        }
        if (
          wouldCreateCycle(connection.source, connection.target, state.edges)
        ) {
          return {
            ok: false,
            message: "작업 흐름에는 순환 연결을 만들 수 없습니다.",
          };
        }
        const edge: WorkflowEdge = {
          ...connection,
          id: `e-${connection.source}-${connection.target}-${Date.now()}`,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
        } as WorkflowEdge;
        set((current) =>
          commitGraph(
            current,
            graphFrom(
              current.nodes,
              addEdge(edge, current.edges) as WorkflowEdge[],
            ),
          ),
        );
        return { ok: true };
      },
      autoLayout: () =>
        set((state) =>
          commitGraph(
            state,
            layoutForDirection(
              graphFrom(state.nodes, state.edges),
              state.layoutDirection,
            ),
          ),
        ),
      undo: () =>
        set((state) => {
          const previous = state.past.at(-1);
          if (!previous) return {};
          const current = cloneSnapshot(state);
          return {
            ...cloneSnapshot(previous),
            past: state.past.slice(0, -1),
            future: [current, ...state.future].slice(0, 50),
            selectedNodeId: null,
            dragStartSnapshot: null,
          };
        }),
      redo: () =>
        set((state) => {
          const next = state.future[0];
          if (!next) return {};
          const current = cloneSnapshot(state);
          return {
            ...cloneSnapshot(next),
            past: [...state.past, current].slice(-50),
            future: state.future.slice(1),
            selectedNodeId: null,
            dragStartSnapshot: null,
          };
        }),
      restoreExample: () =>
        set((state) => ({
          ...commitGraph(
            state,
            layoutForDirection(sampleGraph, state.layoutDirection),
            {
              requiresMigrationReview: false,
              migrationIssues: [],
            },
          ),
          rawContent: "",
          generatedPrompt: "",
          jsonDraft: initialJsonDraft,
          selectedNodeId: null,
        })),
    }),
    {
      name: STUDIO_STORAGE_KEY,
      version: STUDIO_PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: migratePersistedState,
      partialize: (state) => {
        const canonicalGraph = JSON.parse(
          serializeGraph(graphFrom(state.nodes, state.edges)),
        ) as WorkflowGraph;
        return {
          schemaVersion: state.schemaVersion,
          rawContent: state.rawContent,
          generatedPrompt: state.generatedPrompt,
          jsonDraft: state.jsonDraft,
          agentBudget: state.agentBudget,
          layoutDirection: state.layoutDirection,
          nodes: canonicalGraph.nodes,
          edges: canonicalGraph.edges,
          requiresMigrationReview: state.requiresMigrationReview,
          migrationIssues: state.migrationIssues,
        };
      },
      merge: (persisted, current) => ({
        ...current,
        ...restorePersistedState(persisted, {
          schemaVersion: current.schemaVersion,
          rawContent: current.rawContent,
          generatedPrompt: current.generatedPrompt,
          jsonDraft: current.jsonDraft,
          agentBudget: current.agentBudget,
          layoutDirection: current.layoutDirection,
          nodes: current.nodes,
          edges: current.edges,
          requiresMigrationReview: current.requiresMigrationReview,
          migrationIssues: current.migrationIssues,
        }),
        selectedNodeId: null,
        past: [],
        future: [],
        dragStartSnapshot: null,
      }),
    },
  ),
);
