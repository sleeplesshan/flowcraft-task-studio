"use client";

import {
  ClipboardList,
  Copy,
  PanelRightClose,
  Trash2,
} from "lucide-react";
import type { WorkflowTaskData } from "../lib/workflow";
import { useStudioStore } from "./store";

type ListKey =
  | "inputs"
  | "outputs"
  | "completionCriteria"
  | "allowedTools"
  | "fileScope";

type StringListFieldProps = {
  id: string;
  label: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
};

function StringListField({
  id,
  label,
  hint = "한 줄에 한 항목",
  value,
  onChange,
}: StringListFieldProps) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
        <span>{hint}</span>
      </label>
      <textarea
        id={id}
        className="textarea textarea--list"
        value={value.join("\n")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
    </div>
  );
}

type TaskInspectorProps = {
  onCollapse: () => void;
};

export function TaskInspector({ onCollapse }: TaskInspectorProps) {
  const {
    nodes,
    selectedNodeId,
    updateSelectedData,
    duplicateSelected,
    deleteSelected,
  } = useStudioStore();
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  const updateList = (key: ListKey, value: string[]) => {
    updateSelectedData({ [key]: value } as Partial<WorkflowTaskData>);
  };

  return (
    <aside
      className="studio-panel inspector-panel"
      aria-labelledby="inspector-title"
    >
      <div className="panel-heading panel-heading--compact">
        <div>
          <span className="step-label">선택 작업</span>
          <h2 id="inspector-title" tabIndex={-1}>
            작업 편집
          </h2>
        </div>
        <div className="panel-heading__actions">
          <ClipboardList size={18} aria-hidden="true" />
          <button
            type="button"
            className="icon-button icon-button--subtle"
            onClick={onCollapse}
            aria-label="오른쪽 작업 속성 패널 접기"
            title="패널 접기"
            aria-expanded="true"
            aria-controls="task-inspector-shell"
          >
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {selectedNode ? (
        <div className="inspector-form">
          <div className="node-id-row">
            <span>작업 ID</span>
            <code>{selectedNode.id}</code>
          </div>

          <section className="inspector-section" aria-labelledby="basic-fields">
            <h3 id="basic-fields">기본 정보</h3>
            <label className="field-label" htmlFor="task-title">
              작업 제목
            </label>
            <input
              id="task-title"
              className="text-input"
              value={selectedNode.data.title}
              onChange={(event) =>
                updateSelectedData({ title: event.target.value })
              }
            />
            <label className="field-label" htmlFor="executor-role">
              실행 역할
            </label>
            <input
              id="executor-role"
              className="text-input"
              value={selectedNode.data.executorRole}
              onChange={(event) =>
                updateSelectedData({ executorRole: event.target.value })
              }
            />
            <label className="field-label" htmlFor="task-assignee">
              실행 담당
            </label>
            <select
              id="task-assignee"
              className="text-input"
              value={selectedNode.data.assignee}
              onChange={(event) =>
                updateSelectedData({
                  assignee: event.target.value as "main" | "delegated",
                })
              }
            >
              <option value="main">메인 에이전트 직접 수행</option>
              <option value="delegated">서브에이전트에게 위임</option>
            </select>
            <label className="field-label" htmlFor="task-instruction">
              작업 지시
            </label>
            <textarea
              id="task-instruction"
              className="textarea textarea--task"
              value={selectedNode.data.instruction}
              onChange={(event) =>
                updateSelectedData({ instruction: event.target.value })
              }
            />
            <label className="field-label" htmlFor="parallel-group">
              병렬 그룹 이름
              <span>선택 사항</span>
            </label>
            <input
              id="parallel-group"
              className="text-input"
              value={selectedNode.data.parallelGroupId ?? ""}
              onChange={(event) =>
                updateSelectedData({ parallelGroupId: event.target.value })
              }
              placeholder="예: research"
              disabled={selectedNode.data.assignee === "main"}
            />
            <p className="helper-text">
              같은 실행 단계에서 동시에 맡길 서브에이전트 작업에만 지정할 수
              있습니다.
            </p>
          </section>

          <section
            className="inspector-section"
            aria-labelledby="contract-fields"
          >
            <h3 id="contract-fields">작업 계약</h3>
            <StringListField
              id="task-inputs"
              label="입력"
              value={selectedNode.data.inputs}
              onChange={(value) => updateList("inputs", value)}
            />
            <StringListField
              id="task-outputs"
              label="산출물"
              value={selectedNode.data.outputs}
              onChange={(value) => updateList("outputs", value)}
            />
            <StringListField
              id="task-criteria"
              label="완료 조건"
              value={selectedNode.data.completionCriteria}
              onChange={(value) => updateList("completionCriteria", value)}
            />
          </section>

          <section
            className="inspector-section"
            aria-labelledby="boundary-fields"
          >
            <h3 id="boundary-fields">실행 제한</h3>
            <StringListField
              id="task-tools"
              label="허용 도구"
              value={selectedNode.data.allowedTools}
              onChange={(value) => updateList("allowedTools", value)}
            />
            <StringListField
              id="task-files"
              label="파일 범위"
              hint="경로 또는 glob, 한 줄에 하나"
              value={selectedNode.data.fileScope}
              onChange={(value) => updateList("fileScope", value)}
            />
          </section>

          <div className="inspector-actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={duplicateSelected}
            >
              <Copy size={15} aria-hidden="true" />
              작업 복제
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={deleteSelected}
              disabled={nodes.length === 1}
            >
              <Trash2 size={15} aria-hidden="true" />
              작업 삭제
            </button>
          </div>
        </div>
      ) : (
        <div className="empty-inspector">
          <span>
            <ClipboardList size={24} aria-hidden="true" />
          </span>
          <h3>작업을 선택하세요</h3>
          <p>
            캔버스의 작업 노드를 선택하면 지시, 입출력 계약과 실행 제한을
            편집할 수 있습니다.
          </p>
        </div>
      )}
    </aside>
  );
}
