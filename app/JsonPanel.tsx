"use client";

import {
  Check,
  Clipboard,
  FileText,
  RotateCcw,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  countSubAgents,
  createWorkflowPolicy,
  generateOptimizationPrompt,
  parseWorkflowGraph,
  serializeGraph,
} from "../lib/workflow";
import { useStudioStore } from "./store";
import type { CopyText, ShowNotice } from "./studio-types";

type JsonPanelProps = {
  copyText: CopyText;
  showNotice: ShowNotice;
  onGraphApplied: () => void;
};

export function JsonPanel({
  copyText,
  showNotice,
  onGraphApplied,
}: JsonPanelProps) {
  const {
    jsonDraft,
    agentBudget,
    nodes,
    edges,
    requiresMigrationReview,
    migrationIssues,
    setJsonDraft,
    replaceGraph,
    confirmMigrationReview,
    restoreExample,
  } = useStudioStore();
  const [jsonTab, setJsonTab] = useState<"draft" | "current">("draft");
  const graph = useMemo(
    () => ({ schemaVersion: 2 as const, nodes, edges }),
    [nodes, edges],
  );
  const policy = useMemo(
    () => createWorkflowPolicy(agentBudget),
    [agentBudget],
  );
  const currentGraphJson = useMemo(() => serializeGraph(graph), [graph]);
  const delegatedCount = countSubAgents(graph);

  const applyJson = () => {
    const parsed = parseWorkflowGraph(jsonDraft);
    if (!parsed.success) {
      showNotice({ type: "error", message: parsed.errors.join(" · ") });
      return;
    }

    replaceGraph(parsed.graph, {
      requiresMigrationReview: parsed.requiresMigrationReview,
      migrationIssues: parsed.migrationIssues,
    });
    setJsonDraft("");
    setJsonTab("draft");
    const importedDelegated = countSubAgents(parsed.graph);
    const overBudget =
      importedDelegated > policy.maxSubAgents ||
      parsed.graph.nodes.length > policy.maxTotalNodes;
    showNotice({
      type:
        overBudget ||
        parsed.requiresMigrationReview ||
        parsed.warnings.length > 0
          ? "warning"
          : "success",
      message: parsed.requiresMigrationReview
        ? "v1 JSON을 변환했습니다. 자동 보완된 작업 계약을 검토해 주세요."
        : overBudget
          ? "작업 수 한도를 초과했습니다. 작업 수를 줄인 뒤 내보낼 수 있습니다."
          : parsed.warnings[0] ?? "작업 흐름을 만들었습니다.",
    });
    onGraphApplied();
  };

  return (
    <aside className="studio-panel json-panel" aria-labelledby="json-title">
      <div className="panel-heading panel-heading--compact">
        <div>
          <span className="step-label">2단계</span>
          <h2 id="json-title">작업 흐름 JSON</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() =>
            copyText(
              jsonTab === "draft" ? jsonDraft : currentGraphJson,
              "JSON",
            )
          }
          aria-label="현재 탭 JSON 복사"
          title="JSON 복사"
        >
          <Clipboard size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="json-tabs" role="tablist" aria-label="JSON 보기">
        <button
          type="button"
          className={jsonTab === "draft" ? "is-active" : ""}
          onClick={() => setJsonTab("draft")}
          role="tab"
          aria-selected={jsonTab === "draft"}
        >
          LLM 응답
        </button>
        <button
          type="button"
          className={jsonTab === "current" ? "is-active" : ""}
          onClick={() => setJsonTab("current")}
          role="tab"
          aria-selected={jsonTab === "current"}
        >
          현재 작업 흐름
        </button>
      </div>
      <p className="helper-text">
        {jsonTab === "draft"
          ? "LLM 응답을 붙여넣으세요. Markdown 코드 블록도 인식하며, 적용에 실패해도 현재 작업 흐름은 유지됩니다."
          : "캔버스의 현재 상태를 보여주는 읽기 전용 JSON입니다."}
      </p>
      <textarea
        className={`textarea textarea--json ${
          jsonTab === "current" ? "textarea--readonly" : ""
        }`}
        value={jsonTab === "draft" ? jsonDraft : currentGraphJson}
        onChange={(event) => {
          if (jsonTab === "draft") setJsonDraft(event.target.value);
        }}
        readOnly={jsonTab === "current"}
        spellCheck={false}
        aria-label={
          jsonTab === "draft"
            ? "LLM 작업 흐름 JSON 응답"
            : "현재 작업 흐름 JSON"
        }
      />
      {jsonTab === "draft" ? (
        <button
          type="button"
          className="button button--apply"
          onClick={applyJson}
        >
          <Workflow size={16} aria-hidden="true" />
          작업 흐름 만들기
        </button>
      ) : null}

      {requiresMigrationReview ? (
        <div className="review-callout" role="alert">
          <strong>이전 형식에서 변환된 작업 검토 필요</strong>
          <p>
            {migrationIssues.length}개 자동 변환 항목의 담당, 입출력, 완료
            조건을 속성 패널에서 확인하세요.
          </p>
          <ul>
            {migrationIssues.slice(0, 4).map((issue, index) => (
              <li key={`${issue.nodeId}-${index}`}>
                <code>{issue.nodeId}</code> · {issue.message}
              </li>
            ))}
          </ul>
          {migrationIssues.length > 4 ? (
            <p>외 {migrationIssues.length - 4}개 항목</p>
          ) : null}
          <button
            type="button"
            className="button button--review"
            onClick={() => {
              confirmMigrationReview();
              showNotice({
                type: "success",
                message: "변환 항목 검토를 완료했습니다.",
              });
            }}
          >
            <Check size={15} aria-hidden="true" />
            검토 완료로 표시
          </button>
        </div>
      ) : null}

      {delegatedCount > policy.maxSubAgents ||
      nodes.length > policy.maxTotalNodes ? (
        <div className="optimization-callout">
          <div>
            <strong>작업 수 한도 초과</strong>
            <span>
              위임 {delegatedCount}/{policy.maxSubAgents} · 전체 {nodes.length}/
              {policy.maxTotalNodes}
            </span>
          </div>
          <p>
            같은 맥락과 산출물을 공유하는 작업을 합치도록 LLM에 요청하는
            프롬프트를 만듭니다.
          </p>
          <button
            type="button"
            className="button button--optimize"
            onClick={() =>
              copyText(
                generateOptimizationPrompt(graph, agentBudget),
                "작업 수 줄이기 프롬프트",
              )
            }
          >
            <Sparkles size={15} aria-hidden="true" />
            작업 수 줄이기 프롬프트 복사
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="button button--ghost"
        onClick={() => {
          if (
            !window.confirm(
              "현재 입력 내용과 작업 흐름을 예제로 바꿉니다. 계속할까요?",
            )
          ) {
            return;
          }
          restoreExample();
          setJsonTab("current");
          showNotice({
            type: "success",
            message: "예제 작업 흐름으로 초기화했습니다.",
          });
        }}
      >
        <RotateCcw size={15} aria-hidden="true" />
        예제로 초기화
      </button>
      <div className="schema-note">
        <FileText size={15} aria-hidden="true" />
        <div>
          <strong>작업 형식 v2</strong>
          <span>
            위임 최대 {policy.maxSubAgents}개 · 전체 최대{" "}
            {policy.maxTotalNodes}개 · 순환 연결 차단
          </span>
        </div>
      </div>
    </aside>
  );
}
