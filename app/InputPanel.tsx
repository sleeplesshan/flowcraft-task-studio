"use client";

import {
  HardDrive,
  PanelLeftClose,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { generateMetaPrompt } from "../lib/workflow";
import { useStudioStore } from "./store";
import type { CopyText, ShowNotice } from "./studio-types";

type InputPanelProps = {
  copyText: CopyText;
  showNotice: ShowNotice;
  onCollapse: () => void;
};

export function InputPanel({
  copyText,
  showNotice,
  onCollapse,
}: InputPanelProps) {
  const {
    rawContent,
    agentBudget,
    setRawContent,
    setGeneratedPrompt,
    setAgentBudget,
  } = useStudioStore();

  const generatePrompt = async () => {
    try {
      const prompt = generateMetaPrompt(rawContent, agentBudget);
      setGeneratedPrompt(prompt);
      await copyText(prompt, "LLM용 설계 프롬프트");
    } catch (error) {
      showNotice({
        type: "error",
        message:
          error instanceof Error ? error.message : "프롬프트 생성에 실패했습니다.",
      });
    }
  };

  return (
    <aside className="studio-panel input-panel" aria-labelledby="input-title">
      <div className="panel-heading">
        <div>
          <span className="step-label">1단계</span>
          <h2 id="input-title">작업 요청</h2>
        </div>
        <div className="panel-heading__actions">
          <Sparkles size={18} aria-hidden="true" />
          <button
            type="button"
            className="icon-button icon-button--subtle"
            onClick={onCollapse}
            aria-label="왼쪽 설정 패널 접기"
            title="패널 접기"
            aria-expanded="true"
            aria-controls="workflow-setup-panel"
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <label className="field-label" htmlFor="source-content">
        내용
        <span>{rawContent.length.toLocaleString()}자</span>
      </label>
      <textarea
        id="source-content"
        className="textarea textarea--source"
        value={rawContent}
        onChange={(event) => setRawContent(event.target.value)}
        placeholder="코덱스나 클로드코드에서 계획(Plan) 모드로 나온 메타프롬프트를 여기 붙여넣으세요."
      />

      <div className="budget-control">
        <div className="budget-control__label">
          <span>서브에이전트 작업 한도</span>
          <strong>최대 {agentBudget}개</strong>
        </div>
        <div className="budget-options" aria-label="서브에이전트 작업 한도">
          {[
            { value: 2, label: "간결" },
            { value: 4, label: "균형", recommended: true },
            { value: 8, label: "광범위 조사" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={agentBudget === option.value ? "is-active" : ""}
              onClick={() => setAgentBudget(option.value)}
              aria-pressed={agentBudget === option.value}
            >
              <span>{option.label}</span>
              <small>{option.value}</small>
              {option.recommended ? <em>권장</em> : null}
            </button>
          ))}
        </div>
        <p>
          이 값은 동시 실행 수가 아니라, 전체 흐름에서 서브에이전트에게
          맡길 수 있는 작업 수입니다. 긴밀히 연결된 코딩 작업은 메인 작업으로
          유지하세요.
        </p>
        {agentBudget === 8 ? (
          <p className="budget-scope-warning">
            서로 독립적인 광범위 조사 작업이 필요한 경우에만 사용하세요.
            공유 코드·파일 작업은 늘리지 마세요.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className="button button--generate"
        onClick={generatePrompt}
      >
        <Sparkles size={17} aria-hidden="true" />
        LLM용 설계 프롬프트 복사
      </button>
      <ol className="roundtrip-guide" aria-label="작업 흐름 만드는 순서">
        <li>설계 프롬프트 복사</li>
        <li>GPT·Claude에서 JSON 생성</li>
        <li>아래 LLM 응답에 붙여넣기</li>
      </ol>
      <div className="privacy-boundaries">
        <div className="privacy-note privacy-note--local">
          <HardDrive size={14} aria-hidden="true" />
          <span>입력 내용은 이 브라우저에만 저장됩니다.</span>
        </div>
        <div className="privacy-note privacy-note--external">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>
            외부 LLM에 붙여넣으면 해당 서비스로 내용이 전송됩니다.
          </span>
        </div>
      </div>
    </aside>
  );
}
