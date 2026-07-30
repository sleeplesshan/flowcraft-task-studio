import dagre from "@dagrejs/dagre";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import { z } from "zod";

export const WORKFLOW_SCHEMA_VERSION = 2 as const;

export type WorkflowTaskData = {
  title: string;
  executorRole: string;
  instruction: string;
  assignee: "main" | "delegated";
  parallelGroupId?: string;
  inputs: string[];
  outputs: string[];
  completionCriteria: string[];
  allowedTools: string[];
  fileScope: string[];
  [key: string]: unknown;
};

export type WorkflowTaskNode = Node<WorkflowTaskData, "workflowTask">;
export type WorkflowEdge = Edge<Record<string, never>, "smoothstep">;

export type WorkflowGraph = {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  nodes: WorkflowTaskNode[];
  edges: WorkflowEdge[];
};

export type ValidationResult = {
  errors: string[];
  warnings: string[];
};

export type WorkflowPolicy = {
  maxSubAgents: number;
  maxTotalNodes: number;
};

export type MigrationIssue = {
  nodeId: string;
  fields: string[];
  message: string;
};

export type WorkflowParseResult =
  | {
      success: true;
      graph: WorkflowGraph;
      warnings: string[];
      sourceVersion: 1 | 2;
      requiresMigrationReview: boolean;
      migrationIssues: MigrationIssue[];
    }
  | { success: false; errors: string[] };

export function createWorkflowPolicy(maxSubAgents = 4): WorkflowPolicy {
  return {
    maxSubAgents,
    maxTotalNodes: maxSubAgents + 4,
  };
}

const positionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

const normalizedStringArraySchema = z
  .array(z.string())
  .transform(normalizeStringArray);

const requiredNormalizedStringArraySchema = normalizedStringArraySchema.pipe(
  z.array(z.string().min(1)).min(1, "최소 한 개의 항목이 필요합니다."),
);

const parallelGroupSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const workflowTaskDataSchema = z
  .object({
    title: z.string().trim().min(1, "작업 제목이 비어 있습니다."),
    executorRole: z.string().trim().min(1, "실행 역할이 비어 있습니다."),
    instruction: z.string().trim().min(1, "작업 지시가 비어 있습니다."),
    assignee: z.enum(["main", "delegated"]),
    parallelGroupId: parallelGroupSchema,
    inputs: normalizedStringArraySchema,
    outputs: requiredNormalizedStringArraySchema,
    completionCriteria: requiredNormalizedStringArraySchema,
    allowedTools: normalizedStringArraySchema,
    fileScope: normalizedStringArraySchema,
  })
  .strict();

const workflowTaskNodeSchema = z
  .object({
    id: z.string().trim().min(1, "노드 ID가 비어 있습니다."),
    type: z.literal("workflowTask"),
    data: workflowTaskDataSchema,
    position: positionSchema,
  })
  .strict();

const edgeSchema = z
  .object({
    id: z.string().trim().min(1, "엣지 ID가 비어 있습니다."),
    source: z.string().trim().min(1),
    target: z.string().trim().min(1),
    type: z.literal("smoothstep").default("smoothstep"),
  })
  .strict();

const legacyEdgeSchema = z
  .object({
    id: z.string().trim().min(1, "엣지 ID가 비어 있습니다."),
    source: z.string().trim().min(1),
    target: z.string().trim().min(1),
    type: z.literal("smoothstep").default("smoothstep"),
  })
  .strip();

const workflowGraphV2Schema = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    nodes: z
      .array(workflowTaskNodeSchema)
      .min(1, "최소 한 개의 노드가 필요합니다."),
    edges: z.array(edgeSchema),
  })
  .strict();

const legacyNodeDataSchema = z
  .object({
    agentName: z.string().trim().min(1, "에이전트 이름이 비어 있습니다."),
    role: z.string().trim().min(1, "역할이 비어 있습니다."),
    task: z.string().trim().min(1, "작업 내용이 비어 있습니다."),
    executionTarget: z.enum(["mainAgent", "subAgent"]).optional(),
    isParallel: z.boolean().default(false),
    parallelGroupId: parallelGroupSchema,
  })
  .strip();

const legacyNodeSchema = z
  .object({
    id: z.string().trim().min(1, "노드 ID가 비어 있습니다."),
    type: z.literal("subAgentTask"),
    data: legacyNodeDataSchema,
    position: positionSchema,
  })
  .strip();

const workflowGraphV1Schema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    nodes: z
      .array(legacyNodeSchema)
      .min(1, "최소 한 개의 노드가 필요합니다."),
    edges: z.array(legacyEdgeSchema),
  })
  .strip();

const NODE_WIDTH = 270;
const NODE_HEIGHT = 210;
const PARALLEL_LEVEL_REQUIREMENT = "작업은 모두 같은 실행 단계에 있어야 합니다.";
const PARALLEL_DEPENDENCY_REQUIREMENT = "구성원 사이에 의존 경로가 있습니다";

export const SYSTEM_HARNESS = `> ⚠️ **[System Harness: Patient Wait & Evidence-Based Stall Recovery]**
> 메인 에이전트는 서브 에이전트에게 유의미한 진행 신호가 있는 동안, 단지 오래 걸린다는 이유로 재촉하거나 중단하지 않고 완료까지 기다립니다.
> 시간 경과만으로 정체를 판단하지 않습니다. 런타임의 \`failed | cancelled\` 반환, 세션·도구의 명시적 timeout 또는 연결 소실, 같은 오류나 같은 동작이 새 결과 없이 3회 이상 반복되는 경우를 객관적 정체 신호로 봅니다.
> 객관적 신호가 불충분하면 상태 확인을 최대 1회 수행한 뒤 제공자 환경에 맞는 한 번의 관찰 구간을 더 기다립니다. 새 메시지, 도구 성공, 파일 변경 등 진행 신호가 확인되면 기존 에이전트를 계속 기다립니다.`;

export const FAILURE_POLICY = `> 🛡️ **[Failure Policy: Checkpoint Recovery & Bounded Replacement]**
> 각 작업의 provider terminal state는 \`success | failed | cancelled\`로 기록하고, 위 객관적 정체 조건을 충족한 비종료 작업은 오케스트레이션 상태 \`stalled\`로 기록합니다.
> \`failed | cancelled | stalled\`이면 해당 에이전트만 중단하고, 확보 가능한 메시지·변경 파일·로그·부분 산출물을 체크포인트로 1회 회수합니다. 불완전한 체크포인트를 \`success\`로 간주하지 않습니다.
> 체크포인트가 완료 조건을 충족하면 그 결과로 다음 의존 작업을 진행합니다. 일부만 유효하면 완료·미완료 범위를 기록하고 후속 작업의 입력과 목표를 안전하게 충족할 수 있는지 검증합니다. 가능하면 누락 범위와 품질 한계를 전달한 축소 범위로 계속하고, 불가능하면 독립 작업만 계속합니다.
> 남은 작업이 필요하면 원래 작업 계약, 검증된 체크포인트, 미완료 범위, 실패 원인을 새 대체 서브 에이전트에게 전달하여 최대 1회만 이어서 수행합니다. 기존 에이전트와 대체 에이전트를 동시에 실행하지 않고 완료된 범위를 다시 수행하지 않습니다.
> 대체 시도도 실패·취소·정체되면 해당 결과에 의존하는 작업만 중단하고 독립 분기는 계속합니다. 최종 보고에는 정체 근거, 회수한 결과, 대체 여부, 남은 공백과 차단된 의존 작업을 명시합니다.`;

export const sampleGraph: WorkflowGraph = layoutGraph({
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  nodes: [
    {
      id: "task-1",
      type: "workflowTask",
      data: {
        title: "작업 범위 확정",
        executorRole: "Lead Orchestrator",
        instruction: "요구사항을 분석하고 조사 범위와 완료 조건을 확정합니다.",
        assignee: "main",
        inputs: ["사용자 요청"],
        outputs: ["확정된 조사 범위"],
        completionCriteria: ["조사 범위와 완료 조건이 명시됨"],
        allowedTools: [],
        fileScope: [],
      },
      position: { x: 0, y: 0 },
    },
    {
      id: "task-2",
      type: "workflowTask",
      data: {
        title: "근거 자료 조사",
        executorRole: "Research Specialist",
        instruction: "신뢰할 수 있는 자료를 수집하고 핵심 근거를 정리합니다.",
        assignee: "delegated",
        parallelGroupId: "research",
        inputs: ["확정된 조사 범위"],
        outputs: ["근거 자료 요약"],
        completionCriteria: ["핵심 주장마다 출처와 근거가 연결됨"],
        allowedTools: ["웹 검색"],
        fileScope: [],
      },
      position: { x: 0, y: 0 },
    },
    {
      id: "task-3",
      type: "workflowTask",
      data: {
        title: "쟁점 및 리스크 분석",
        executorRole: "Analysis Specialist",
        instruction: "요구사항의 제약, 리스크, 대안을 독립적으로 분석합니다.",
        assignee: "delegated",
        parallelGroupId: "research",
        inputs: ["확정된 조사 범위"],
        outputs: ["쟁점 및 리스크 분석서"],
        completionCriteria: ["주요 제약, 리스크, 대안이 구분되어 정리됨"],
        allowedTools: [],
        fileScope: [],
      },
      position: { x: 0, y: 0 },
    },
    {
      id: "task-4",
      type: "workflowTask",
      data: {
        title: "결과 통합 및 검수",
        executorRole: "Lead Orchestrator",
        instruction: "병렬 결과를 교차 검증하고 최종 결과물로 통합합니다.",
        assignee: "main",
        inputs: ["근거 자료 요약", "쟁점 및 리스크 분석서"],
        outputs: ["최종 검수 보고서"],
        completionCriteria: ["모든 선행 결과가 반영되고 모순이 해소됨"],
        allowedTools: [],
        fileScope: [],
      },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [
    {
      id: "e1-2",
      source: "task-1",
      target: "task-2",
      type: "smoothstep",
    },
    {
      id: "e1-3",
      source: "task-1",
      target: "task-3",
      type: "smoothstep",
    },
    {
      id: "e2-4",
      source: "task-2",
      target: "task-4",
      type: "smoothstep",
    },
    {
      id: "e3-4",
      source: "task-3",
      target: "task-4",
      type: "smoothstep",
    },
  ],
});

export function generateMetaPrompt(
  content: string,
  maxSubAgents = 4,
): string {
  const trimmed = content.trim();
  const policy = createWorkflowPolicy(maxSubAgents);
  if (!trimmed) {
    throw new Error("변환할 작업 내용을 입력해 주세요.");
  }

  return `당신은 비용과 조정 복잡성을 최소화하는 멀티 에이전트 워크플로 설계자입니다.
아래 원문 요청을 메인 에이전트의 직접 작업과 꼭 필요한 위임 작업으로 분리한 방향성 비순환 그래프(DAG)로 변환하세요.

[원문 요청]
${trimmed}

[작업 예산]
- assignee가 "delegated"인 작업은 최대 ${maxSubAgents}개입니다. 이 수는 절대 상한입니다.
- 단순한 작업은 위임 작업 0개도 올바른 결과입니다.
- 전체 노드는 최대 ${policy.maxTotalNodes}개입니다.

[위임 및 병렬화 규칙]
1. 독립적으로 수행 가능하고 별도 전문성·도구가 필요하며 산출물과 완료 조건이 명확할 때만 assignee를 "delegated"로 지정하세요.
2. 계획, 스캐폴딩, 상태 연결, 통합, 테스트 실행, 릴리스 검증, 배포는 원칙적으로 assignee를 "main"으로 지정하세요.
3. 같은 산출물·컨텍스트를 공유하는 역할은 하나의 작업으로 합치세요.
4. 단, 이미지·파일·레코드처럼 서로 독립적인 반복 산출물이 수십·수백 개이고 한 작업에 몰면 병목이 되는 경우에는 작업 예산 안에서 크기가 비슷한 비중복 배치로 나누세요. 항목마다 노드를 만들지는 마세요.
5. 예를 들어 이미지 150개는 150개 노드가 아니라 최대 4개 안팎의 범위로 균등 분할하고, 각 instruction·outputs·completionCriteria에 담당 범위와 개수를 명시하세요.
6. 공용 API 호출 제한, 동일 파일 쓰기, 순차 입력처럼 병렬화해도 처리량이 늘지 않는 제약이 있으면 억지로 분할하지 마세요.
7. parallelGroupId는 같은 위상 단계에서 동시에 실행 가능한 delegated 작업에만 지정하세요.
8. 같은 병렬 그룹의 작업들은 outputs 항목과 fileScope 항목이 서로 겹치면 안 됩니다.

[정체 복구를 위한 작업 계약 규칙]
1. delegated 작업의 instruction, outputs, completionCriteria는 완료된 범위와 미완료 범위를 구분할 수 있게 작성하세요.
2. 오래 걸리는 반복 작업은 담당 범위와 체크포인트 단위를 명시해, 대체 에이전트가 검증된 결과를 보존하고 남은 범위만 이어받을 수 있게 하세요.
3. 실패 대비용 백업 노드를 미리 추가하지 마세요. 대체 에이전트는 실행 시 같은 작업 계약을 이어받는 최대 1회의 복구 시도입니다.

[출력 전 내부 검수]
1. JSON을 출력하기 전에 각 작업의 예상 작업량과 병목을 스스로 검수하세요.
2. 지나치게 작은 위임은 인접 작업이나 main 작업에 병합하고, 한 서브에이전트에 몰린 과도한 작업은 독립 산출물 기준으로만 재분배하세요.
3. 대량 반복 작업은 담당 범위와 개수가 명확한 비중복 배치인지 확인하세요.
4. delegated 작업 수와 전체 노드 수가 예산을 넘지 않는지 확인하세요.
5. inputs, outputs, completionCriteria, fileScope와 edges가 실제 의존성과 일치하는지 확인하세요.
6. 검수 과정이나 평가 내용은 출력하지 말고 검수가 반영된 최종 JSON만 출력하세요.

[v2 출력 계약]
1. 반드시 유효한 JSON 하나만 출력하세요. 설명과 Markdown 코드 펜스는 출력하지 마세요.
2. 루트에는 schemaVersion, nodes, edges만 사용하고 schemaVersion은 반드시 2로 지정하세요.
3. 모든 노드 type은 "workflowTask", 모든 엣지 type은 "smoothstep"이어야 합니다.
4. data에는 title, executorRole, instruction, assignee, inputs, outputs, completionCriteria, allowedTools, fileScope를 반드시 포함하세요.
5. outputs와 completionCriteria는 각각 최소 1개가 필요합니다. 나머지 배열은 값이 없으면 []를 사용하세요.
6. isParallel은 v2에서 금지됩니다. 병렬 여부는 parallelGroupId 유무로만 표현하세요.
7. 배열 값은 공백을 제거하고 빈 문자열과 중복 항목을 넣지 마세요.
8. 자기 연결, 중복 연결, 순환 연결을 만들지 말고 실제 의존성이 있을 때만 엣지를 연결하세요.
9. position은 모든 노드에 {"x": 0, "y": 0}을 사용하세요.
10. 모든 ID는 문서 안에서 고유해야 합니다.

[정확한 JSON 형식]
{
  "schemaVersion": 2,
  "nodes": [
    {
      "id": "task-1",
      "type": "workflowTask",
      "data": {
        "title": "범위 확정 및 통합",
        "executorRole": "Lead Orchestrator",
        "instruction": "요구사항을 분석하고 작업을 배분한 뒤 결과를 통합합니다.",
        "assignee": "main",
        "inputs": ["사용자 요청"],
        "outputs": ["확정된 작업 계획"],
        "completionCriteria": ["범위, 의존성, 완료 조건이 명시됨"],
        "allowedTools": [],
        "fileScope": []
      },
      "position": { "x": 0, "y": 0 }
    },
    {
      "id": "task-2",
      "type": "workflowTask",
      "data": {
        "title": "근거 조사",
        "executorRole": "Research Specialist",
        "instruction": "관련 문서를 검색하고 근거와 함께 요약합니다.",
        "assignee": "delegated",
        "parallelGroupId": "research",
        "inputs": ["확정된 작업 계획"],
        "outputs": ["근거 자료 요약"],
        "completionCriteria": ["핵심 주장마다 신뢰 가능한 출처가 연결됨"],
        "allowedTools": ["웹 검색"],
        "fileScope": []
      },
      "position": { "x": 0, "y": 0 }
    }
  ],
  "edges": []
}`;
}

export function generateOptimizationPrompt(
  graph: WorkflowGraph,
  maxSubAgents = 4,
): string {
  const policy = createWorkflowPolicy(maxSubAgents);
  return `당신은 멀티 에이전트 워크플로 최적화 전문가입니다.
아래 v2 JSON의 기능과 의존성은 보존하되 조정 비용과 충돌 가능성을 줄이세요.

[최적화 목표]
- assignee가 "delegated"인 작업은 최대 ${maxSubAgents}개로 제한합니다.
- 전체 노드는 최대 ${policy.maxTotalNodes}개로 제한합니다.
- 계획, 통합, 테스트 실행, 검증, 배포는 가능한 한 "main" 작업으로 합칩니다.
- 같은 산출물이나 컨텍스트를 공유하는 역할은 하나의 노드로 병합합니다.
- 단, 수십·수백 개의 독립적인 반복 산출물이 한 작업의 병목이 되면 예산 안에서 비슷한 크기의 비중복 배치로 유지하거나 재분할합니다.
- 배치 작업은 담당 범위·수량·산출물·fileScope를 겹치지 않게 명시하고 항목마다 노드를 만들지 않습니다.
- delegated 작업은 완료·미완료 범위와 체크포인트를 판별할 수 있게 작성하고, 대체 에이전트가 완료된 범위를 반복하지 않도록 이어받기 경계를 명시합니다.
- 실패 대비용 백업 노드는 추가하지 않습니다. 대체 에이전트는 같은 작업 계약에 대한 최대 1회의 순차 복구 시도입니다.
- 병렬 그룹의 outputs와 fileScope는 서로 겹치지 않게 분리합니다.
- 모든 outputs와 completionCriteria는 최소 1개를 유지합니다.
- schemaVersion 2와 type "workflowTask"를 유지하고 isParallel은 출력하지 않습니다.
- 반드시 유효한 JSON 하나만 출력하세요.

[최적화할 JSON]
${serializeGraph(graph)}`;
}

function extractJson(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export function parseWorkflowGraph(input: string): WorkflowParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(input));
  } catch {
    return {
      success: false,
      errors: [
        "JSON 문법을 확인해 주세요. 쉼표, 따옴표 또는 괄호가 올바르지 않습니다.",
      ],
    };
  }

  if (!isRecord(parsed)) {
    return { success: false, errors: ["root: JSON 루트는 객체여야 합니다."] };
  }

  const declaredVersion = parsed.schemaVersion;
  if (
    declaredVersion !== undefined &&
    declaredVersion !== 1 &&
    declaredVersion !== WORKFLOW_SCHEMA_VERSION
  ) {
    return {
      success: false,
      errors: [`schemaVersion: 지원하지 않는 버전입니다: ${String(declaredVersion)}`],
    };
  }

  if (declaredVersion === WORKFLOW_SCHEMA_VERSION) {
    return parseV2Graph(parsed);
  }
  return parseV1Graph(parsed);
}

function parseV2Graph(parsed: unknown): WorkflowParseResult {
  const result = workflowGraphV2Schema.safeParse(parsed);
  if (!result.success) {
    return { success: false, errors: formatZodErrors(result.error) };
  }

  const graph = toWorkflowGraph(result.data);
  const validation = validateGraph(graph);
  const { blockingErrors, reviewWarnings } =
    partitionImportValidation(validation.errors);
  if (blockingErrors.length) {
    return { success: false, errors: blockingErrors };
  }

  return {
    success: true,
    graph: allPositionsAreZero(graph.nodes) ? layoutGraph(graph) : graph,
    warnings: [...validation.warnings, ...reviewWarnings],
    sourceVersion: 2,
    requiresMigrationReview: false,
    migrationIssues: [],
  };
}

function parseV1Graph(parsed: unknown): WorkflowParseResult {
  const result = workflowGraphV1Schema.safeParse(parsed);
  if (!result.success) {
    return { success: false, errors: formatZodErrors(result.error) };
  }

  const migrationIssues: MigrationIssue[] = [];
  const nodes = result.data.nodes.map((legacyNode): WorkflowTaskNode => {
    const { data } = legacyNode;
    const assignee =
      data.executionTarget === "mainAgent" ? "main" : "delegated";
    migrationIssues.push({
      nodeId: legacyNode.id,
      fields: [
        "inputs",
        "outputs",
        "completionCriteria",
        "allowedTools",
        "fileScope",
      ],
      message:
        "이전 형식의 작업을 현재 작업 계약으로 변환했습니다. 자동 생성된 산출물과 완료 조건을 검토해 주세요.",
    });
    if (data.executionTarget === undefined) {
      migrationIssues.push({
        nodeId: legacyNode.id,
        fields: ["assignee"],
        message:
          "이전 형식에 실행 담당 정보가 없어 서브에이전트 위임으로 설정했습니다. 실행 담당을 검토해 주세요.",
      });
    }
    return {
      id: legacyNode.id,
      type: "workflowTask",
      data: {
        title: data.role,
        executorRole: data.agentName,
        instruction: data.task,
        assignee,
        parallelGroupId: data.parallelGroupId,
        inputs: [],
        outputs: [`${data.role} 결과물`],
        completionCriteria: [`${data.task} 완료 및 결과 반환`],
        allowedTools: [],
        fileScope: [],
      },
      position: legacyNode.position,
    };
  });
  const graph: WorkflowGraph = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes,
    edges: result.data.edges.map(
      (edge) => ({ ...edge, type: "smoothstep" }) as WorkflowEdge,
    ),
  };

  const validation = validateGraph(graph);
  const { blockingErrors, reviewWarnings } =
    partitionImportValidation(validation.errors);
  if (blockingErrors.length) {
    return { success: false, errors: blockingErrors };
  }

  return {
    success: true,
    graph: allPositionsAreZero(graph.nodes) ? layoutGraph(graph) : graph,
    warnings: [
      ...validation.warnings,
      ...reviewWarnings,
      "v1 JSON을 v2 작업 계약으로 변환했습니다. 마이그레이션 항목을 검토해 주세요.",
    ],
    sourceVersion: 1,
    requiresMigrationReview: true,
    migrationIssues,
  };
}

function partitionImportValidation(errors: string[]): {
  blockingErrors: string[];
  reviewWarnings: string[];
} {
  const reviewable = errors.filter(
    (error) =>
      error.includes(PARALLEL_LEVEL_REQUIREMENT) ||
      error.includes(PARALLEL_DEPENDENCY_REQUIREMENT),
  );
  return {
    blockingErrors: errors.filter((error) => !reviewable.includes(error)),
    reviewWarnings: reviewable.map(
      (error) => `병렬 실행 검토 필요: ${error}`,
    ),
  };
}

function toWorkflowGraph(
  graph: z.output<typeof workflowGraphV2Schema>,
): WorkflowGraph {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: graph.nodes.map(
      (node) =>
        ({
          ...node,
          type: "workflowTask",
          data: {
            ...node.data,
            parallelGroupId: node.data.parallelGroupId || undefined,
          },
        }) as WorkflowTaskNode,
    ),
    edges: graph.edges.map(
      (edge) => ({ ...edge, type: "smoothstep" }) as WorkflowEdge,
    ),
  };
}

export function serializeGraph(graph: WorkflowGraph): string {
  return JSON.stringify(
    {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      nodes: graph.nodes.map(({ id, data, position }) => ({
        id,
        type: "workflowTask",
        data: {
          title: data.title.trim(),
          executorRole: data.executorRole.trim(),
          instruction: data.instruction.trim(),
          assignee: data.assignee,
          ...(data.parallelGroupId?.trim()
            ? { parallelGroupId: data.parallelGroupId.trim() }
            : {}),
          inputs: normalizeStringArray(data.inputs),
          outputs: normalizeStringArray(data.outputs),
          completionCriteria: normalizeStringArray(data.completionCriteria),
          allowedTools: normalizeStringArray(data.allowedTools),
          fileScope: normalizeStringArray(data.fileScope),
        },
        position: {
          x: Math.round(position.x),
          y: Math.round(position.y),
        },
      })),
      edges: graph.edges.map(({ id, source, target }) => ({
        id,
        source,
        target,
        type: "smoothstep",
      })),
    },
    null,
    2,
  );
}

export function validateGraph(
  graph: WorkflowGraph,
  policy?: WorkflowPolicy,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!graph.nodes.length) {
    errors.push("최소 한 개의 노드가 필요합니다.");
  }

  const subAgentCount = countSubAgents(graph);
  if (policy && subAgentCount > policy.maxSubAgents) {
    errors.push(
      `위임 작업이 ${subAgentCount}개로 설정 예산 ${policy.maxSubAgents}개를 초과했습니다.`,
    );
  }
  if (policy && graph.nodes.length > policy.maxTotalNodes) {
    errors.push(
      `전체 노드가 ${graph.nodes.length}개로 설정 상한 ${policy.maxTotalNodes}개를 초과했습니다.`,
    );
  }

  const nodeIds = graph.nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);
  const edgeIds = graph.edges.map((edge) => edge.id);
  const duplicateNodeIds = findDuplicates(nodeIds);
  const duplicateEdgeIds = findDuplicates(edgeIds);
  duplicateNodeIds.forEach((id) =>
    errors.push(`중복된 노드 ID가 있습니다: ${id}`),
  );
  duplicateEdgeIds.forEach((id) =>
    errors.push(`중복된 엣지 ID가 있습니다: ${id}`),
  );

  const pairs = new Set<string>();
  let hasDuplicatePair = false;
  for (const edge of graph.edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      errors.push(
        `${edge.id}: 존재하지 않는 노드를 참조합니다 (${edge.source} → ${edge.target}).`,
      );
    }
    if (edge.source === edge.target) {
      errors.push(`${edge.id}: 자기 자신에게 연결할 수 없습니다.`);
    }
    const pair = `${edge.source}→${edge.target}`;
    if (pairs.has(pair)) {
      hasDuplicatePair = true;
      errors.push(`중복 연결이 있습니다: ${pair}`);
    }
    pairs.add(pair);
  }

  const cyclic = hasCycle(graph.nodes, graph.edges);
  if (cyclic) {
    errors.push("작업 흐름에는 순환 연결을 만들 수 없습니다.");
  }

  const groups = new Map<string, WorkflowTaskNode[]>();
  for (const node of graph.nodes) {
    const group = node.data.parallelGroupId?.trim();
    if (group && node.data.assignee !== "delegated") {
      errors.push(
        `${node.data.title}: 메인 작업은 병렬 그룹에 포함할 수 없습니다.`,
      );
    }
    if (group) {
      groups.set(group, [...(groups.get(group) ?? []), node]);
    }
  }

  for (const [group, members] of groups) {
    if (members.length < 2) {
      errors.push(`병렬 그룹 "${group}"에는 최소 2개의 노드가 필요합니다.`);
    }
    for (let index = 0; index < members.length; index += 1) {
      for (let next = index + 1; next < members.length; next += 1) {
        const left = members[index];
        const right = members[next];
        const sharedOutputs = intersectNormalized(
          left.data.outputs,
          right.data.outputs,
        );
        if (sharedOutputs.length) {
          errors.push(
            `병렬 그룹 "${group}"의 작업 "${left.data.title}"과 "${right.data.title}"이 outputs를 중복 정의합니다: ${sharedOutputs.join(", ")}.`,
          );
        }
        const sharedFiles = intersectNormalized(
          left.data.fileScope,
          right.data.fileScope,
        );
        if (sharedFiles.length) {
          errors.push(
            `병렬 그룹 "${group}"의 작업 "${left.data.title}"과 "${right.data.title}"이 fileScope에서 충돌합니다: ${sharedFiles.join(", ")}.`,
          );
        }
      }
    }
  }

  const structureIsValid =
    !cyclic &&
    duplicateNodeIds.length === 0 &&
    duplicateEdgeIds.length === 0 &&
    !hasDuplicatePair &&
    graph.edges.every(
      (edge) =>
        nodeIdSet.has(edge.source) &&
        nodeIdSet.has(edge.target) &&
        edge.source !== edge.target,
    );

  if (structureIsValid) {
    const levelByNode = new Map<string, number>();
    topologicalLevels(graph).forEach((level, index) => {
      level.forEach((node) => levelByNode.set(node.id, index));
    });
    const adjacency = createAdjacency(graph.edges);
    for (const [group, members] of groups) {
      const levels = new Set(
        members.map((node) => levelByNode.get(node.id)),
      );
      if (levels.size > 1) {
        errors.push(
          `병렬 그룹 "${group}"의 ${PARALLEL_LEVEL_REQUIREMENT}`,
        );
      }
      let dependencyPair: [WorkflowTaskNode, WorkflowTaskNode] | undefined;
      for (
        let index = 0;
        index < members.length && !dependencyPair;
        index += 1
      ) {
        for (let next = index + 1; next < members.length; next += 1) {
          if (
            isReachable(members[index].id, members[next].id, adjacency) ||
            isReachable(members[next].id, members[index].id, adjacency)
          ) {
            dependencyPair = [members[index], members[next]];
            break;
          }
        }
      }
      if (dependencyPair) {
        errors.push(
          `병렬 그룹 "${group}"의 ${PARALLEL_DEPENDENCY_REQUIREMENT}: ${dependencyPair[0].data.title} ↔ ${dependencyPair[1].data.title}.`,
        );
      }
    }
  }

  const connected = new Set(
    graph.edges.flatMap((edge) => [edge.source, edge.target]),
  );
  const isolated = graph.nodes.filter((node) => !connected.has(node.id));
  if (graph.nodes.length > 1 && isolated.length) {
    warnings.push(
      `연결되지 않은 노드 ${isolated.length}개: ${isolated
        .map((node) => node.data.title)
        .join(", ")}`,
    );
  }

  return { errors, warnings };
}

export function wouldCreateCycle(
  source: string,
  target: string,
  edges: WorkflowEdge[],
): boolean {
  if (source === target) return true;
  const adjacency = createAdjacency(edges);
  const stack = [target];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function hasCycle(
  nodes: WorkflowTaskNode[],
  edges: WorkflowEdge[],
): boolean {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      edge.target,
    ]);
  }
  const queue = [...indegree]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of adjacency.get(current) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  return visited !== nodes.length;
}

export function layoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 48,
    ranksep: 96,
    marginx: 32,
    marginy: 32,
  });
  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: graph.nodes.map((node) => {
      const placed = g.node(node.id) as XYPosition & {
        width: number;
        height: number;
      };
      return {
        ...node,
        position: {
          x: placed.x - NODE_WIDTH / 2,
          y: placed.y - NODE_HEIGHT / 2,
        },
      };
    }),
    edges: graph.edges,
  };
}

export function topologicalLevels(
  graph: WorkflowGraph,
): WorkflowTaskNode[][] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      edge.target,
    ]);
  }

  let ready = [...graph.nodes]
    .filter((node) => indegree.get(node.id) === 0)
    .sort(stableNodeOrder);
  const levels: WorkflowTaskNode[][] = [];
  const seen = new Set<string>();
  while (ready.length) {
    const level = ready;
    levels.push(level);
    const nextIds = new Set<string>();
    for (const node of level) {
      seen.add(node.id);
      for (const next of adjacency.get(node.id) ?? []) {
        const degree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, degree);
        if (degree === 0) nextIds.add(next);
      }
    }
    ready = [...nextIds]
      .map((id) => nodeById.get(id)!)
      .sort(stableNodeOrder);
  }

  const remaining = graph.nodes
    .filter((node) => !seen.has(node.id))
    .sort(stableNodeOrder);
  if (remaining.length) levels.push(remaining);
  return levels;
}

export function graphToMarkdown(
  graph: WorkflowGraph,
  originalContent: string,
  policy = createWorkflowPolicy(),
): string {
  const validation = validateGraph(graph, policy);
  if (validation.errors.length) {
    throw new Error(validation.errors.join("\n"));
  }

  const levels = topologicalLevels(graph);
  const groupMap = new Map<string, WorkflowTaskNode[]>();
  for (const node of graph.nodes) {
    const group = node.data.parallelGroupId;
    if (group) {
      groupMap.set(group, [...(groupMap.get(group) ?? []), node]);
    }
  }

  const objective =
    originalContent.trim() ||
    graph.nodes
      .map((node) => `- ${node.data.title}: ${node.data.instruction}`)
      .join("\n");

  const sequence = levels
    .map((level, index) => {
      const grouped = new Map<string, WorkflowTaskNode[]>();
      const solo: WorkflowTaskNode[] = [];
      for (const node of level) {
        if (node.data.parallelGroupId) {
          grouped.set(node.data.parallelGroupId, [
            ...(grouped.get(node.data.parallelGroupId) ?? []),
            node,
          ]);
        } else {
          solo.push(node);
        }
      }
      const lines = [
        ...solo.map(
          (node) =>
            `- **[${node.data.assignee === "main" ? "메인 직접 수행" : "위임 작업"}] ${node.data.title}** — ${node.data.instruction}`,
        ),
        ...[...grouped].map(
          ([group, nodes]) =>
            `- **병렬 그룹 \`${group}\`** — ${nodes
              .map((node) => node.data.title)
              .join(", ")}를 동시에 실행하고 모두 terminal state에 도달할 때까지 대기합니다.`,
        ),
      ];
      return `### 단계 ${index + 1}\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const parallel = groupMap.size
    ? [...groupMap]
        .map(
          ([group, nodes]) =>
            `### ${group}\n${nodes
              .map(
                (node) =>
                  `- **${node.data.title}** (${node.data.executorRole}): ${node.data.instruction}`,
              )
              .join(
                "\n",
              )}\n- 완료 조건: 그룹 내 모든 위임 작업이 terminal state에 도달한 후에만 다음 의존 작업을 시작합니다.`,
        )
        .join("\n\n")
    : "명시적으로 지정된 병렬 작업 그룹이 없습니다.";

  const contracts = graph.nodes
    .map((node) => {
      const execution =
        node.data.assignee === "main"
          ? "메인 에이전트 직접 수행"
          : node.data.parallelGroupId
            ? `위임 · 병렬 그룹 \`${node.data.parallelGroupId}\``
            : "서브 에이전트에게 위임";
      return `### ${node.data.title} (\`${node.id}\`)
- **담당:** ${execution}
- **실행 역할:** ${node.data.executorRole}
- **작업 지시:** ${node.data.instruction}
- **입력:** ${formatContractList(node.data.inputs, "없음")}
- **산출물:** ${formatContractList(node.data.outputs)}
- **완료 조건:** ${formatContractList(node.data.completionCriteria)}
- **허용 도구:** ${formatContractList(node.data.allowedTools, "지정 없음")}
- **파일 범위:** ${formatContractList(node.data.fileScope, "지정 없음")}`;
    })
    .join("\n\n");

  const dependencies = graph.nodes
    .map((node) => {
      const predecessors = graph.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) =>
          graph.nodes.find((candidate) => candidate.id === edge.source),
        )
        .filter(Boolean) as WorkflowTaskNode[];
      return `- **${node.data.title}**: ${
        predecessors.length
          ? `${predecessors
              .map((candidate) => candidate.data.title)
              .join(", ")}의 완료 결과를 입력으로 사용`
          : "선행 의존성 없이 시작 가능"
      }`;
    })
    .join("\n");

  return `${SYSTEM_HARNESS}

${FAILURE_POLICY}

# Multi-Agent 작업 지시서

## [스키마 및 위임 정책]

- **Workflow schema:** v${WORKFLOW_SCHEMA_VERSION}
- **서브 에이전트 허용 예산:** 최대 ${policy.maxSubAgents}개
- **전체 노드 허용 상한:** 최대 ${policy.maxTotalNodes}개
- **현재 위임 작업:** ${countSubAgents(graph)}개
- \`assignee: main\` 작업은 메인 에이전트가 직접 수행합니다.
- \`assignee: delegated\` 작업마다 기본 서브 에이전트 한 개를 실행하며, 객관적 정체·실패가 확인된 경우에만 같은 계약을 이어받는 대체 에이전트를 최대 한 번 순차 실행합니다.
- 기존 에이전트와 대체 에이전트를 동시에 실행하지 않으며, 대체 시도는 새 작업 노드를 추가하지 않습니다.
- 정의된 작업을 역할별로 다시 분해하여 추가 서브 에이전트를 만들지 않습니다.

## [전체 작업 목표]

${objective}

## [작업 순서]

${sequence}

## [병렬 작업 그룹]

${parallel}

## [작업별 실행 계약]

${contracts}

## [의존성과 완료 조건]

${dependencies}

- 각 작업은 명시된 입력, 산출물, 완료 조건, 허용 도구, 파일 범위를 준수합니다.
- 메인 작업을 서브 에이전트에게 재위임하지 않습니다.
- 메인 에이전트는 모든 선행 의존성과 병렬 그룹 완료 여부를 확인한 후 다음 단계로 이동합니다.
- 불완전한 중간 결과를 완료된 산출물로 간주하지 않습니다.
`;
}

export function countSubAgents(graph: WorkflowGraph): number {
  return graph.nodes.filter((node) => node.data.assignee === "delegated")
    .length;
}

function normalizeStringArray(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function intersectNormalized(left: string[], right: string[]): string[] {
  const rightSet = new Set(normalizeStringArray(right));
  return normalizeStringArray(left).filter((item) => rightSet.has(item));
}

function formatContractList(values: string[], empty = "없음"): string {
  return values.length ? values.map((value) => `\`${value}\``).join(", ") : empty;
}

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function allPositionsAreZero(nodes: WorkflowTaskNode[]): boolean {
  return nodes.every(
    (node) => node.position.x === 0 && node.position.y === 0,
  );
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function createAdjacency(edges: WorkflowEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      edge.target,
    ]);
  }
  return adjacency;
}

function isReachable(
  source: string,
  target: string,
  adjacency: Map<string, string[]>,
): boolean {
  const stack = [...(adjacency.get(source) ?? [])];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function stableNodeOrder(
  a: WorkflowTaskNode,
  b: WorkflowTaskNode,
): number {
  return (
    a.position.x - b.position.x ||
    a.position.y - b.position.y ||
    a.id.localeCompare(b.id)
  );
}
