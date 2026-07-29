"use client";

import {
  Check,
  Copy,
  Download,
  PanelLeftOpen,
  PanelRightOpen,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  createWorkflowPolicy,
  graphToMarkdown,
  validateGraph,
} from "../lib/workflow";
import { InputPanel } from "./InputPanel";
import { JsonPanel } from "./JsonPanel";
import { useStudioStore } from "./store";
import type { Notice } from "./studio-types";
import { TaskInspector } from "./TaskInspector";
import { WorkflowCanvas } from "./WorkflowCanvas";

export function WorkflowStudio() {
  const {
    rawContent,
    agentBudget,
    nodes,
    edges,
    requiresMigrationReview,
  } = useStudioStore();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const panelLayoutKey = `${leftCollapsed ? "left-closed" : "left-open"}:${
    rightCollapsed ? "right-closed" : "right-open"
  }`;
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
  const exportBlocked =
    validation.errors.length > 0 || requiresMigrationReview;
  const exportStatus: string | null = validation.errors.length
    ? "내보내기 차단 · 아래 작업 흐름 오류를 확인하세요."
    : requiresMigrationReview
      ? "내보내기 차단 · 이전 형식에서 변환된 작업을 검토해 주세요."
      : validation.warnings.length
        ? "주의 사항이 있지만 복사하거나 내려받을 수 있습니다."
        : null;
  const exportBlockedMessage = validation.errors.length
    ? `내보내기 차단: ${validation.errors[0]}`
    : "내보내기 차단: 이전 형식에서 변환된 작업을 검토해 주세요.";

  const showNotice = useCallback((next: Notice) => {
    setNotice(next);
    window.setTimeout(() => {
      setNotice((current) => (current === next ? null : current));
    }, 3600);
  }, []);

  const copyText = useCallback(
    async (text: string, label: string) => {
      if (!text.trim()) {
        showNotice({ type: "error", message: `${label}: 내용이 비어 있습니다.` });
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showNotice({
          type: "success",
          message: `${label}: 클립보드에 복사했습니다.`,
        });
      } catch {
        showNotice({
          type: "error",
          message:
            "클립보드 접근이 차단되었습니다. 권한을 허용한 뒤 다시 시도해 주세요.",
        });
      }
    },
    [showNotice],
  );

  const focusResponsiveSection = useCallback((targetId: string) => {
    if (!window.matchMedia("(max-width: 1240px)").matches) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        if (!target) return;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        target.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
        target.focus({ preventScroll: true });
      });
    });
  }, []);

  const createMarkdown = () => {
    if (exportBlocked) {
      showNotice({ type: "error", message: exportBlockedMessage });
      return null;
    }
    try {
      return graphToMarkdown(graph, rawContent, policy);
    } catch (error) {
      showNotice({
        type: "error",
        message:
          error instanceof Error ? error.message : "내보내기에 실패했습니다.",
      });
      return null;
    }
  };

  const copyMarkdown = async () => {
    const markdown = createMarkdown();
    if (!markdown) return;
    await copyText(markdown, "작업 지시서");
  };

  const exportMarkdown = () => {
    const markdown = createMarkdown();
    if (!markdown) return;
    try {
      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "multi-agent-workflow.md";
      anchor.click();
      URL.revokeObjectURL(url);
      showNotice({
        type: "success",
        message: "실행 정책과 작업 계약이 포함된 Markdown을 내려받았습니다.",
      });
    } catch (error) {
      showNotice({
        type: "error",
        message:
          error instanceof Error ? error.message : "내보내기에 실패했습니다.",
      });
    }
  };

  return (
    <main className="studio-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Workflow size={21} aria-hidden="true" />
          </span>
          <div>
            <div className="brand-title">
              FlowCraft <span>Task Studio</span>
            </div>
          </div>
        </div>
        <div className="header-status">
          <div
            className={`export-control ${
              exportBlocked ? "export-control--blocked" : ""
            }`}
          >
            <div className="export-actions">
              <button
                type="button"
                className="button button--header-secondary"
                onClick={copyMarkdown}
                disabled={exportBlocked}
                aria-describedby={exportStatus ? "export-status" : undefined}
                aria-label="작업 지시서 복사"
              >
                <Copy size={16} aria-hidden="true" />
                작업 지시서 복사
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={exportMarkdown}
                disabled={exportBlocked}
                aria-describedby={exportStatus ? "export-status" : undefined}
                aria-label="작업 지시서 내려받기"
              >
                <Download size={16} aria-hidden="true" />
                파일 내려받기
              </button>
            </div>
            {exportStatus ? (
              <span id="export-status" role="status">
                {exportStatus}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <section
        className={`workspace ${
          leftCollapsed ? "workspace--left-collapsed" : ""
        } ${rightCollapsed ? "workspace--right-collapsed" : ""}`}
      >
        <div
          id="workflow-setup-panel"
          className="workflow-setup-panel"
          aria-label="작업 흐름 설정"
        >
          {leftCollapsed ? (
            <button
              type="button"
              className="panel-rail panel-rail--left"
              onClick={() => setLeftCollapsed(false)}
              aria-label="왼쪽 설정 패널 펼치기"
              aria-expanded="false"
              aria-controls="workflow-setup-panel"
            >
              <PanelLeftOpen size={17} aria-hidden="true" />
              <span>설정</span>
            </button>
          ) : (
            <>
              <InputPanel
                copyText={copyText}
                showNotice={showNotice}
                onCollapse={() => setLeftCollapsed(true)}
              />
              <JsonPanel
                copyText={copyText}
                showNotice={showNotice}
                onGraphApplied={() => {
                  setLeftCollapsed(true);
                  focusResponsiveSection("canvas-title");
                }}
              />
            </>
          )}
        </div>
        <WorkflowCanvas
          showNotice={showNotice}
          panelLayoutKey={panelLayoutKey}
          isInspectorCollapsed={rightCollapsed}
          onTaskSelect={() => {
            setRightCollapsed(false);
            focusResponsiveSection("inspector-title");
          }}
        />
        <div
          id="task-inspector-shell"
          className="task-inspector-shell"
          aria-label="작업 속성 패널"
        >
          {rightCollapsed ? (
            <button
              type="button"
              className="panel-rail panel-rail--right"
              onClick={() => setRightCollapsed(false)}
              aria-label="오른쪽 작업 속성 패널 펼치기"
              aria-expanded="false"
              aria-controls="task-inspector-shell"
            >
              <PanelRightOpen size={17} aria-hidden="true" />
              <span>작업 속성</span>
            </button>
          ) : (
            <TaskInspector
              onCollapse={() => {
                setRightCollapsed(true);
                focusResponsiveSection("canvas-title");
              }}
            />
          )}
        </div>
      </section>

      {notice ? (
        <div
          className={`toast toast--${notice.type}`}
          role="status"
          aria-live="polite"
        >
          {notice.type === "success" ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <X size={16} aria-hidden="true" />
          )}
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="알림 닫기"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </main>
  );
}
