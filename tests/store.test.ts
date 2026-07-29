import { beforeEach, describe, expect, it } from "vitest";
import {
  migratePersistedState,
  restorePersistedState,
  STUDIO_PERSIST_VERSION,
  STUDIO_STORAGE_KEY,
  useStudioStore,
  type PersistedStudioState,
  type Snapshot,
} from "../app/store";
import {
  sampleGraph,
  serializeGraph,
  WORKFLOW_SCHEMA_VERSION,
} from "../lib/workflow";

const fallback: PersistedStudioState = {
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  rawContent: "",
  generatedPrompt: "",
  jsonDraft: "",
  agentBudget: 4,
  layoutDirection: "LR",
  nodes: sampleGraph.nodes,
  edges: sampleGraph.edges,
  requiresMigrationReview: false,
  migrationIssues: [],
};

function snapshot(): Snapshot {
  return {
    nodes: structuredClone(sampleGraph.nodes),
    edges: structuredClone(sampleGraph.edges),
    requiresMigrationReview: false,
    migrationIssues: [],
  };
}

describe("persist v4 restoration and migration", () => {
  it("keeps the storage key, uses persist version 4 and restores valid v2 state", () => {
    expect(STUDIO_STORAGE_KEY).toBe("multi-agent-workflow-studio-v1");
    expect(STUDIO_PERSIST_VERSION).toBe(4);

    const draft = "사용자가 아직 적용하지 않은 독립 JSON 초안";
    const nodesWithRuntimeState = structuredClone(fallback.nodes).map(
      (node, index) => ({ ...node, selected: index === 0 }),
    );
    const edgesWithRuntimeState = structuredClone(fallback.edges).map(
      (edge) => ({
        ...edge,
        markerEnd: { type: "arrowclosed" },
      }),
    );
    const restored = restorePersistedState(
      {
        ...fallback,
        nodes: nodesWithRuntimeState,
        edges: edgesWithRuntimeState,
        rawContent: "복원할 목표",
        generatedPrompt: "복원할 프롬프트",
        jsonDraft: draft,
        layoutDirection: "TB",
      },
      fallback,
    );

    expect(restored.schemaVersion).toBe(2);
    expect(restored.rawContent).toBe("복원할 목표");
    expect(restored.generatedPrompt).toBe("복원할 프롬프트");
    expect(restored.jsonDraft).toBe(draft);
    expect(restored.layoutDirection).toBe("TB");
    expect(
      serializeGraph({
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        nodes: restored.nodes,
        edges: restored.edges,
      }),
    ).toBe(serializeGraph(sampleGraph));
    expect(restored.requiresMigrationReview).toBe(false);
    expect(restored.migrationIssues).toEqual([]);
  });

  it("migrates a stored v1 graph to v4, clears its stale draft and preserves review metadata", () => {
    const persistedV1 = {
      rawContent: "레거시 목표",
      generatedPrompt: "레거시 프롬프트",
      jsonDraft: "편집 중인 레거시 초안",
      agentBudget: 4,
      nodes: [
        {
          id: "agent-1",
          type: "subAgentTask",
          data: {
            agentName: "Legacy Agent",
            role: "자료 조사",
            task: "공식 자료를 조사한다.",
            executionTarget: "subAgent",
            isParallel: false,
          },
          position: { x: 10, y: 20 },
        },
      ],
      edges: [],
      requiresExecutionReview: true,
      legacyNodeIds: ["agent-1"],
    };

    const migrated = migratePersistedState(
      persistedV1,
      2,
    ) as Record<string, unknown>;
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.layoutDirection).toBe("LR");
    expect(migrated).not.toHaveProperty("requiresExecutionReview");
    expect(migrated).not.toHaveProperty("legacyNodeIds");
    expect(migrated.requiresMigrationReview).toBe(true);
    expect(migrated.jsonDraft).toBe("");

    const restored = restorePersistedState(migrated, fallback);
    expect(restored.nodes[0].type).toBe("workflowTask");
    expect(restored.nodes[0].data.title).toBe("자료 조사");
    expect(restored.nodes[0].data.executorRole).toBe("Legacy Agent");
    expect(restored.nodes[0].data.assignee).toBe("delegated");
    expect(restored.requiresMigrationReview).toBe(true);
    expect(
      restored.migrationIssues.some(
        (issue) =>
          issue.nodeId === "agent-1" && issue.fields.includes("assignee"),
      ),
    ).toBe(true);
    expect(
      restored.migrationIssues.some((issue) =>
        issue.fields.includes("completionCriteria"),
      ),
    ).toBe(true);
  });

  it("falls back atomically when persisted graph data is corrupt", () => {
    const restored = restorePersistedState(
      {
        schemaVersion: 2,
        rawContent: "손상 상태",
        jsonDraft: "보존하면 안 되는 값",
        layoutDirection: "TB",
        nodes: [{ broken: true }],
        edges: [],
        requiresMigrationReview: true,
        migrationIssues: [{ broken: true }],
      },
      fallback,
    );
    expect(restored).toEqual(fallback);
  });

  it("filters malformed or unknown-node migration issues during restore", () => {
    const restored = restorePersistedState(
      {
        ...fallback,
        requiresMigrationReview: true,
        migrationIssues: [
          {
            nodeId: "task-1",
            fields: ["assignee", "assignee", ""],
            message: "검토 필요",
          },
          {
            nodeId: "missing",
            fields: ["assignee"],
            message: "제거 대상",
          },
          { broken: true },
        ],
      },
      fallback,
    );
    expect(restored.requiresMigrationReview).toBe(true);
    expect(restored.migrationIssues).toEqual([
      {
        nodeId: "task-1",
        fields: ["assignee"],
        message: "검토 필요",
      },
    ]);
  });
});

describe("v2 graph state and history", () => {
  beforeEach(() => {
    useStudioStore.setState({
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      rawContent: "",
      generatedPrompt: "",
      jsonDraft: "독립 초안",
      agentBudget: 4,
      layoutDirection: "LR",
      nodes: structuredClone(sampleGraph.nodes),
      edges: structuredClone(sampleGraph.edges),
      requiresMigrationReview: false,
      migrationIssues: [],
      selectedNodeId: null,
      past: [],
      future: [],
      dragStartSnapshot: null,
    });
  });

  it("changes direction, relayouts the graph and clears all history transactions", () => {
    useStudioStore.setState({
      past: [snapshot()],
      future: [snapshot()],
      dragStartSnapshot: snapshot(),
    });
    const before = structuredClone(useStudioStore.getState().nodes);
    const beforeXRange =
      Math.max(...before.map((node) => node.position.x)) -
      Math.min(...before.map((node) => node.position.x));

    useStudioStore.getState().setLayoutDirection("TB");
    const state = useStudioStore.getState();
    const afterYRange =
      Math.max(...state.nodes.map((node) => node.position.y)) -
      Math.min(...state.nodes.map((node) => node.position.y));

    expect(state.layoutDirection).toBe("TB");
    expect(afterYRange).toBeGreaterThan(beforeXRange * 0.8);
    expect(state.nodes[0].position).not.toEqual(before[0].position);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.dragStartSnapshot).toBeNull();
    expect(state.jsonDraft).toBe("독립 초안");
  });

  it("records exactly one undo entry for an entire drag transaction", () => {
    const before = structuredClone(useStudioStore.getState().nodes[0].position);
    useStudioStore.getState().beginNodeDrag();
    useStudioStore.getState().beginNodeDrag();
    useStudioStore.getState().applyNodeChanges([
      {
        id: "task-1",
        type: "position",
        position: { x: before.x + 20, y: before.y + 10 },
        dragging: true,
      },
    ]);
    useStudioStore.getState().applyNodeChanges([
      {
        id: "task-1",
        type: "position",
        position: { x: before.x + 60, y: before.y + 30 },
        dragging: true,
      },
    ]);
    useStudioStore.getState().endNodeDrag();

    expect(useStudioStore.getState().past).toHaveLength(1);
    expect(useStudioStore.getState().jsonDraft).toBe("독립 초안");
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().nodes[0].position).toEqual(before);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().nodes[0].position).toEqual({
      x: before.x + 60,
      y: before.y + 30,
    });
  });

  it("keeps migration review metadata in replace, confirm, undo, redo and restore", () => {
    useStudioStore.getState().replaceGraph(structuredClone(sampleGraph), {
      requiresMigrationReview: true,
      migrationIssues: [
        {
          nodeId: "task-1",
          fields: ["assignee"],
          message: "실행 담당 검토",
        },
      ],
    });
    expect(useStudioStore.getState().requiresMigrationReview).toBe(true);
    useStudioStore.getState().confirmMigrationReview();
    expect(useStudioStore.getState().requiresMigrationReview).toBe(false);
    expect(useStudioStore.getState().migrationIssues).toEqual([]);

    useStudioStore.getState().undo();
    expect(useStudioStore.getState().requiresMigrationReview).toBe(true);
    expect(useStudioStore.getState().migrationIssues[0].nodeId).toBe("task-1");
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().requiresMigrationReview).toBe(false);

    useStudioStore.getState().restoreExample();
    expect(useStudioStore.getState().requiresMigrationReview).toBe(false);
    expect(useStudioStore.getState().migrationIssues).toEqual([]);
    expect(useStudioStore.getState().jsonDraft).toBe("");
  });

  it("adds, duplicates and edits valid task-first nodes without touching the JSON draft", () => {
    useStudioStore.getState().addNode();
    const added = useStudioStore
      .getState()
      .nodes.find((node) => node.id === useStudioStore.getState().selectedNodeId);
    expect(added?.type).toBe("workflowTask");
    expect(added?.data.assignee).toBe("main");
    expect(added?.data.outputs.length).toBeGreaterThan(0);
    expect(added?.data.completionCriteria.length).toBeGreaterThan(0);

    useStudioStore.getState().updateSelectedData({
      assignee: "delegated",
      parallelGroupId: " group ",
      outputs: [" 결과 ", "결과", ""],
      fileScope: [" app/a.ts ", "app/a.ts"],
    });
    const updated = useStudioStore
      .getState()
      .nodes.find((node) => node.id === useStudioStore.getState().selectedNodeId);
    expect(updated?.data.parallelGroupId).toBe("group");
    expect(updated?.data.outputs).toEqual(["결과"]);
    expect(updated?.data.fileScope).toEqual(["app/a.ts"]);

    useStudioStore.getState().duplicateSelected();
    const duplicate = useStudioStore
      .getState()
      .nodes.find((node) => node.id === useStudioStore.getState().selectedNodeId);
    expect(duplicate?.type).toBe("workflowTask");
    expect(duplicate?.data.parallelGroupId).toBeUndefined();
    expect(useStudioStore.getState().jsonDraft).toBe("독립 초안");
  });
});
