import { describe, expect, it } from "vitest";
import {
  countSubAgents,
  createWorkflowPolicy,
  FAILURE_POLICY,
  generateMetaPrompt,
  generateOptimizationPrompt,
  graphToMarkdown,
  parseWorkflowGraph,
  sampleGraph,
  serializeGraph,
  SYSTEM_HARNESS,
  validateGraph,
  wouldCreateCycle,
  WORKFLOW_SCHEMA_VERSION,
  type WorkflowGraph,
  type WorkflowTaskNode,
} from "../lib/workflow";

const policy = createWorkflowPolicy(4);

function taskNode(
  id: string,
  options: {
    assignee?: "main" | "delegated";
    group?: string;
    outputs?: string[];
    fileScope?: string[];
  } = {},
): WorkflowTaskNode {
  return {
    id,
    type: "workflowTask",
    data: {
      title: `${id} 제목`,
      executorRole: `${id} 실행자`,
      instruction: `${id} 작업을 수행합니다.`,
      assignee: options.assignee ?? "delegated",
      parallelGroupId: options.group,
      inputs: [],
      outputs: options.outputs ?? [`${id} 결과물`],
      completionCriteria: [`${id} 작업 완료`],
      allowedTools: [],
      fileScope: options.fileScope ?? [],
    },
    position: { x: 0, y: 0 },
  };
}

function graph(
  nodes: WorkflowTaskNode[],
  edges: WorkflowGraph["edges"] = [],
): WorkflowGraph {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes,
    edges,
  };
}

describe("v2 meta prompt generation", () => {
  it("requests only the task-first v2 contract and bounded DAG policy", () => {
    const result = generateMetaPrompt("시장 조사 후 보고서를 작성한다.", 4);
    expect(result).toContain("시장 조사 후 보고서를 작성한다.");
    expect(result).toContain('"schemaVersion": 2');
    expect(result).toContain('"type": "workflowTask"');
    expect(result).toContain('"assignee": "main"');
    expect(result).toContain('"completionCriteria"');
    expect(result).toContain('"fileScope"');
    expect(result).toContain("isParallel은 v2에서 금지");
    expect(result).toContain("최대 4개");
    expect(result).toContain("전체 노드는 최대 8개");
    expect(result).toContain("방향성 비순환 그래프(DAG)");
    expect(result).toContain("이미지 150개");
    expect(result).toContain("비중복 배치");
    expect(result).toContain("병렬화해도 처리량이 늘지 않는 제약");
    expect(result).toContain("[출력 전 내부 검수]");
    expect(result).toContain("예상 작업량과 병목");
    expect(result).toContain("검수가 반영된 최종 JSON만 출력");
    expect(result).not.toContain('"type": "subAgentTask"');
    expect(result).not.toContain('"executionTarget"');
  });

  it("rejects empty input", () => {
    expect(() => generateMetaPrompt("  ")).toThrow(
      "변환할 작업 내용을 입력해 주세요.",
    );
  });
});

describe("v2 parsing, normalization and serialization", () => {
  it("accepts fenced v2 JSON and normalizes every string array", () => {
    const source = structuredClone(sampleGraph);
    source.nodes[0].position = { x: 0, y: 0 };
    source.nodes[0].data.inputs = [" 사용자 요청 ", "", "사용자 요청"];
    source.nodes[0].data.outputs = [" 계획 ", "계획", "  "];
    source.nodes[0].data.completionCriteria = [
      " 완료 ",
      "완료",
      "",
    ];
    source.nodes[0].data.allowedTools = [" 검색 ", "검색", ""];
    source.nodes[0].data.fileScope = [" app/a.ts ", "app/a.ts", ""];

    const parsed = parseWorkflowGraph(
      `\`\`\`json\n${JSON.stringify(source)}\n\`\`\``,
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.sourceVersion).toBe(2);
      expect(parsed.requiresMigrationReview).toBe(false);
      expect(parsed.migrationIssues).toEqual([]);
      expect(parsed.graph.nodes[0].data.inputs).toEqual(["사용자 요청"]);
      expect(parsed.graph.nodes[0].data.outputs).toEqual(["계획"]);
      expect(parsed.graph.nodes[0].data.completionCriteria).toEqual(["완료"]);
      expect(parsed.graph.nodes[0].data.allowedTools).toEqual(["검색"]);
      expect(parsed.graph.nodes[0].data.fileScope).toEqual(["app/a.ts"]);
    }
  });

  it("rejects isParallel and requires non-empty outputs and completion criteria", () => {
    const invalid = JSON.parse(serializeGraph(sampleGraph));
    invalid.nodes[0].data.isParallel = false;
    invalid.nodes[0].data.outputs = ["", "  "];
    invalid.nodes[0].data.completionCriteria = [];
    const parsed = parseWorkflowGraph(JSON.stringify(invalid));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = parsed.errors.join(" ");
      expect(errors).toContain("nodes.0.data");
      expect(errors).toContain("outputs");
      expect(errors).toContain("completionCriteria");
    }
  });

  it("serializes only the canonical v2 shape", () => {
    const serialized = serializeGraph(sampleGraph);
    const value = JSON.parse(serialized);
    expect(value.schemaVersion).toBe(2);
    expect(value.nodes[0].type).toBe("workflowTask");
    expect(value.nodes[0].data.title).toBeTruthy();
    expect(value.nodes[0].data.assignee).toBe("main");
    expect(value.nodes[0].data).not.toHaveProperty("isParallel");
    expect(value.nodes[0].data).not.toHaveProperty("agentName");
    expect(value.nodes[0].data).not.toHaveProperty("executionTarget");
  });

  it("rejects unsupported schema versions", () => {
    const invalid = JSON.parse(serializeGraph(sampleGraph));
    invalid.schemaVersion = 3;
    const parsed = parseWorkflowGraph(JSON.stringify(invalid));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.join(" ")).toContain("지원하지 않는 버전");
    }
  });
});

describe("v1 import-only migration", () => {
  it("maps legacy fields, generates task contracts and marks all v1 imports for review", () => {
    const legacy = {
      nodes: [
        {
          id: "agent-1",
          type: "subAgentTask",
          data: {
            agentName: "Research Agent",
            role: "자료 조사",
            task: "공식 문서를 조사한다.",
            executionTarget: "mainAgent",
            isParallel: false,
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const parsed = parseWorkflowGraph(JSON.stringify(legacy));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.graph.nodes[0].data;
      expect(parsed.sourceVersion).toBe(1);
      expect(parsed.requiresMigrationReview).toBe(true);
      expect(parsed.migrationIssues).toHaveLength(1);
      expect(data.title).toBe("자료 조사");
      expect(data.executorRole).toBe("Research Agent");
      expect(data.instruction).toBe("공식 문서를 조사한다.");
      expect(data.assignee).toBe("main");
      expect(data.inputs).toEqual([]);
      expect(data.outputs).toEqual(["자료 조사 결과물"]);
      expect(data.completionCriteria).toEqual([
        "공식 문서를 조사한다. 완료 및 결과 반환",
      ]);
      expect(data.allowedTools).toEqual([]);
      expect(data.fileScope).toEqual([]);
      expect(parsed.graph.schemaVersion).toBe(2);
      expect(parsed.graph.nodes[0].type).toBe("workflowTask");
    }
  });

  it("defaults a missing executionTarget to delegated and adds a separate issue", () => {
    const legacy = {
      schemaVersion: 1,
      nodes: [
        {
          id: "agent-1",
          type: "subAgentTask",
          data: {
            agentName: "Legacy Agent",
            role: "레거시 작업",
            task: "레거시 작업을 수행한다.",
            isParallel: false,
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const parsed = parseWorkflowGraph(JSON.stringify(legacy));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.graph.nodes[0].data.assignee).toBe("delegated");
      expect(parsed.migrationIssues).toHaveLength(2);
      expect(
        parsed.migrationIssues.some(
          (issue) =>
            issue.nodeId === "agent-1" && issue.fields.includes("assignee"),
        ),
      ).toBe(true);
    }
  });

  it("never emits v1 when a migrated graph is serialized", () => {
    const legacy = {
      nodes: [
        {
          id: "agent-1",
          type: "subAgentTask",
          data: {
            agentName: "Legacy Agent",
            role: "레거시 역할",
            task: "작업한다.",
            isParallel: false,
          },
          position: { x: 1, y: 1 },
        },
      ],
      edges: [],
    };
    const parsed = parseWorkflowGraph(JSON.stringify(legacy));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const serialized = serializeGraph(parsed.graph);
      expect(serialized).toContain('"schemaVersion": 2');
      expect(serialized).toContain('"type": "workflowTask"');
      expect(serialized).not.toContain("subAgentTask");
      expect(serialized).not.toContain("isParallel");
    }
  });
});

describe("DAG, policy and parallel contract validation", () => {
  it("rejects cycles, unknown endpoints and duplicate ids", () => {
    const cycleGraph = structuredClone(sampleGraph);
    cycleGraph.edges.push({
      id: "cycle",
      source: "task-4",
      target: "task-1",
      type: "smoothstep",
    });
    expect(validateGraph(cycleGraph).errors.join(" ")).toContain("순환");
    expect(wouldCreateCycle("task-4", "task-1", sampleGraph.edges)).toBe(true);

    const unknownGraph = structuredClone(sampleGraph);
    unknownGraph.edges.push({
      id: "unknown",
      source: "missing",
      target: "task-1",
      type: "smoothstep",
    });
    expect(validateGraph(unknownGraph).errors.join(" ")).toContain(
      "존재하지 않는 노드",
    );

    const duplicate = structuredClone(sampleGraph);
    duplicate.nodes[1].id = duplicate.nodes[0].id;
    expect(validateGraph(duplicate).errors.join(" ")).toContain(
      "중복된 노드 ID",
    );
  });

  it("accepts independent delegated members in one topological level", () => {
    expect(validateGraph(sampleGraph, policy).errors).toEqual([]);
    expect(countSubAgents(sampleGraph)).toBe(2);
  });

  it("flags direct and indirect dependency paths inside a parallel group", () => {
    const direct = graph(
      [
        taskNode("a", { group: "g" }),
        taskNode("b", { group: "g" }),
      ],
      [{ id: "ab", source: "a", target: "b", type: "smoothstep" }],
    );
    const directErrors = validateGraph(direct, policy).errors.join(" ");
    expect(directErrors).toContain("같은 실행 단계");
    expect(directErrors).toContain("의존 경로");

    const indirect = graph(
      [
        taskNode("a", { group: "g" }),
        taskNode("middle"),
        taskNode("b", { group: "g" }),
      ],
      [
        { id: "am", source: "a", target: "middle", type: "smoothstep" },
        { id: "mb", source: "middle", target: "b", type: "smoothstep" },
      ],
    );
    expect(validateGraph(indirect, policy).errors.join(" ")).toContain(
      "의존 경로",
    );
  });

  it("rejects duplicate outputs and explicit file-scope conflicts in parallel groups", () => {
    const conflict = graph([
      taskNode("a", {
        group: "g",
        outputs: ["공통 산출물"],
        fileScope: ["app/shared.ts"],
      }),
      taskNode("b", {
        group: "g",
        outputs: ["공통 산출물"],
        fileScope: ["app/shared.ts"],
      }),
    ]);
    const errors = validateGraph(conflict, policy).errors.join(" ");
    expect(errors).toContain("outputs를 중복 정의");
    expect(errors).toContain("fileScope에서 충돌");
    expect(errors).toContain("공통 산출물");
    expect(errors).toContain("app/shared.ts");
  });

  it("rejects main tasks in parallel groups and groups with one member", () => {
    const invalid = graph([
      taskNode("main", { assignee: "main", group: "g" }),
    ]);
    const errors = validateGraph(invalid, policy).errors.join(" ");
    expect(errors).toContain("메인 작업은 병렬 그룹");
    expect(errors).toContain("최소 2개의 노드");
  });

  it("enforces delegated-task and total-node limits from one policy", () => {
    const expanded = structuredClone(sampleGraph);
    expanded.nodes[0].data.assignee = "delegated";
    expanded.nodes[3].data.assignee = "delegated";
    expect(
      validateGraph(expanded, createWorkflowPolicy(2)).errors.join(" "),
    ).toContain("설정 예산 2개를 초과");

    const tooMany = structuredClone(sampleGraph);
    tooMany.nodes.push(
      taskNode("extra-1", { assignee: "main" }),
      taskNode("extra-2", { assignee: "main" }),
      taskNode("extra-3", { assignee: "main" }),
    );
    expect(
      validateGraph(tooMany, createWorkflowPolicy(2)).errors.join(" "),
    ).toContain("전체 노드가 7개로 설정 상한 6개를 초과");
  });
});

describe("v2 Markdown export", () => {
  it("preserves harness/failure-policy order and emits the full task contract", () => {
    const markdown = graphToMarkdown(
      sampleGraph,
      "신제품 시장을 분석한다.",
      policy,
    );
    expect(markdown.startsWith(`${SYSTEM_HARNESS}\n\n${FAILURE_POLICY}`)).toBe(
      true,
    );
    expect(markdown).toContain("**Workflow schema:** v2");
    expect(markdown).toContain("## [작업별 실행 계약]");
    expect(markdown).toContain("**실행 역할:**");
    expect(markdown).toContain("**작업 지시:**");
    expect(markdown).toContain("**입력:**");
    expect(markdown).toContain("**산출물:**");
    expect(markdown).toContain("**완료 조건:**");
    expect(markdown).toContain("**허용 도구:**");
    expect(markdown).toContain("**파일 범위:**");
    expect(markdown).toContain("병렬 그룹 `research`");
    expect(markdown.indexOf("작업 범위 확정")).toBeLessThan(
      markdown.indexOf("결과 통합 및 검수"),
    );
  });

  it("blocks export when parallel outputs or file scopes conflict", () => {
    const conflict = graph([
      taskNode("a", {
        group: "g",
        outputs: ["same"],
        fileScope: ["same.ts"],
      }),
      taskNode("b", {
        group: "g",
        outputs: ["same"],
        fileScope: ["same.ts"],
      }),
    ]);
    expect(() => graphToMarkdown(conflict, "", policy)).toThrow(
      "outputs를 중복 정의",
    );
  });

  it("creates a v2-only compaction prompt", () => {
    const prompt = generateOptimizationPrompt(sampleGraph, 2);
    expect(prompt).toContain("최대 2개");
    expect(prompt).toContain("최대 6개");
    expect(prompt).toContain("schemaVersion 2");
    expect(prompt).toContain('type "workflowTask"');
    expect(prompt).toContain('"schemaVersion": 2');
    expect(prompt).not.toContain('"type": "subAgentTask"');
  });

});
