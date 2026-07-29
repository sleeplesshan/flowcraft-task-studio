"use client";

import { Bot, CheckCircle2, FileOutput, GitFork, UserRoundCog } from "lucide-react";
import {
  Handle,
  Position,
  type NodeProps,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { useEffect } from "react";
import type { WorkflowTaskNode } from "../lib/workflow";
import { useStudioStore } from "./store";

export function TaskNode({ id, data, selected }: NodeProps<WorkflowTaskNode>) {
  const layoutDirection = useStudioStore((state) => state.layoutDirection);
  const updateNodeInternals = useUpdateNodeInternals();
  const isMain = data.assignee === "main";
  const targetPosition =
    layoutDirection === "TB" ? Position.Top : Position.Left;
  const sourcePosition =
    layoutDirection === "TB" ? Position.Bottom : Position.Right;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, layoutDirection, updateNodeInternals]);

  return (
    <article
      className={`agent-node ${isMain ? "agent-node--main" : ""} ${
        selected ? "agent-node--selected" : ""
      }`}
      aria-label={`${data.title} 작업 노드, ${
        isMain ? "메인 담당" : "서브에이전트 담당"
      }. 실행 역할 ${data.executorRole}. ${data.instruction}`}
    >
      <Handle
        type="target"
        position={targetPosition}
        className="agent-handle"
      />
      <div className="agent-node__header">
        <span className="agent-node__icon">
          {isMain ? (
            <UserRoundCog size={16} />
          ) : (
            <Bot size={16} />
          )}
        </span>
        <div>
          <p className="agent-node__eyebrow">
            {isMain ? "메인 작업" : "위임 작업"}
          </p>
          <h3 title={data.title}>{data.title}</h3>
        </div>
      </div>
      <p className="agent-node__role">{data.executorRole}</p>
      <p className="agent-node__task" title={data.instruction}>
        {data.instruction}
      </p>
      <div className="agent-node__contract">
        <span title={data.outputs.join(", ")}>
          <FileOutput size={11} />
          산출물 {data.outputs.length}
        </span>
        <span title={data.completionCriteria.join(", ")}>
          <CheckCircle2 size={11} />
          완료 조건 {data.completionCriteria.length}
        </span>
      </div>
      {!isMain ? (
        <div className="agent-node__footer">
          {data.parallelGroupId ? (
            <span className="parallel-badge">
              <GitFork size={12} />
              {String(data.parallelGroupId)}
            </span>
          ) : (
            <span className="sequence-badge">개별 위임</span>
          )}
        </div>
      ) : null}
      <Handle
        type="source"
        position={sourcePosition}
        className="agent-handle"
      />
    </article>
  );
}
