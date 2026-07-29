#!/usr/bin/env python3
"""Validate a FlowCraft v2 DAG and prepare a three-file Codex handoff."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import tempfile
import unicodedata
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Any


SYSTEM_HARNESS = """> ⚠️ **[System Harness: Strict Timeout & Interruption Policy]**
> 메인 에이전트는 서브 에이전트에게 작업을 할당한 후, 서브 에이전트의 처리가 늦어지더라도 **절대 개입하거나 재촉하지 마십시오.**
> "지금 나온 데까지 정리해!", "요약해서 가져와!"와 같이 응답을 강제로 중단시키거나 불완전한 상태에서 출력을 요구하는 행위는 엄격히 금지됩니다. 반드시 서브 에이전트의 전체 프로세스가 완료되어 최종 결과물을 반환할 때까지 대기(Wait) 상태를 유지해야 합니다."""

FAILURE_POLICY = """> 🛡️ **[Failure Policy: Bounded Retry & Dependency Isolation]**
> 각 작업의 terminal state는 `success | failed | cancelled` 중 하나로 기록합니다.
> 런타임 또는 제공자가 `failed`를 반환하면 동일한 작업 범위와 완료 조건으로 최대 1회만 재시도합니다.
> 두 번째 실패 또는 `cancelled` 이후에는 해당 결과에 의존하는 작업만 중단하고, 독립적인 분기는 계속 진행해 완료할 수 있습니다.
> 메인 에이전트는 중단이나 불완전한 요약을 요구하지 않으며, 최종 보고에 실패 원인과 차단된 의존 작업을 명시합니다."""

REQUIRED_DATA_FIELDS = {
    "title",
    "executorRole",
    "instruction",
    "assignee",
    "inputs",
    "outputs",
    "completionCriteria",
    "allowedTools",
    "fileScope",
}
OPTIONAL_DATA_FIELDS = {"parallelGroupId"}
ARRAY_FIELDS = {
    "inputs",
    "outputs",
    "completionCriteria",
    "allowedTools",
    "fileScope",
}


class GraphError(ValueError):
    """Raised when the graph cannot be used for a handoff."""


def normalized_strings(value: Any, path: str, required: bool = False) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise GraphError(f"{path}: 문자열 배열이어야 합니다.")
    result = list(dict.fromkeys(item.strip() for item in value if item.strip()))
    if required and not result:
        raise GraphError(f"{path}: 최소 한 개의 항목이 필요합니다.")
    return result


def extract_json(raw: str) -> str:
    value = raw.strip()
    if value.startswith("```") and value.endswith("```"):
        lines = value.splitlines()
        if len(lines) >= 3:
            return "\n".join(lines[1:-1])
    return value


def load_and_normalize_graph(raw: str, max_subagents: int) -> tuple[dict[str, Any], list[str]]:
    try:
        graph = json.loads(extract_json(raw))
    except json.JSONDecodeError as exc:
        raise GraphError(f"JSON 문법 오류: {exc.msg}") from exc

    if not isinstance(graph, dict):
        raise GraphError("root: JSON 루트는 객체여야 합니다.")
    if set(graph) != {"schemaVersion", "nodes", "edges"}:
        raise GraphError("root: schemaVersion, nodes, edges만 허용됩니다.")
    if graph["schemaVersion"] != 2:
        raise GraphError("schemaVersion은 2여야 합니다.")
    if not isinstance(graph["nodes"], list) or not graph["nodes"]:
        raise GraphError("nodes: 최소 한 개의 노드가 필요합니다.")
    if not isinstance(graph["edges"], list):
        raise GraphError("edges: 배열이어야 합니다.")
    if not isinstance(max_subagents, int) or max_subagents < 0:
        raise GraphError("maxSubAgents는 0 이상의 정수여야 합니다.")

    nodes: list[dict[str, Any]] = []
    node_ids: set[str] = set()
    for index, source in enumerate(graph["nodes"]):
        path = f"nodes.{index}"
        if not isinstance(source, dict) or set(source) != {"id", "type", "data", "position"}:
            raise GraphError(f"{path}: id, type, data, position만 허용됩니다.")
        node_id = source["id"].strip() if isinstance(source["id"], str) else ""
        if not node_id:
            raise GraphError(f"{path}.id: 비어 있지 않은 문자열이어야 합니다.")
        if node_id in node_ids:
            raise GraphError(f"중복된 노드 ID가 있습니다: {node_id}")
        node_ids.add(node_id)
        if source["type"] != "workflowTask":
            raise GraphError(f"{path}.type: workflowTask여야 합니다.")

        data = source["data"]
        if not isinstance(data, dict):
            raise GraphError(f"{path}.data: 객체여야 합니다.")
        keys = set(data)
        if not REQUIRED_DATA_FIELDS.issubset(keys) or not keys.issubset(
            REQUIRED_DATA_FIELDS | OPTIONAL_DATA_FIELDS
        ):
            raise GraphError(
                f"{path}.data: 필수 필드가 없거나 허용되지 않은 필드가 있습니다."
            )
        normalized_data: dict[str, Any] = {}
        for field in ("title", "executorRole", "instruction"):
            value = data[field].strip() if isinstance(data[field], str) else ""
            if not value:
                raise GraphError(f"{path}.data.{field}: 비어 있지 않은 문자열이어야 합니다.")
            normalized_data[field] = value
        if data["assignee"] not in {"main", "delegated"}:
            raise GraphError(f"{path}.data.assignee: main 또는 delegated여야 합니다.")
        normalized_data["assignee"] = data["assignee"]
        group = data.get("parallelGroupId")
        if group is not None and not isinstance(group, str):
            raise GraphError(f"{path}.data.parallelGroupId: 문자열이어야 합니다.")
        if isinstance(group, str) and group.strip():
            normalized_data["parallelGroupId"] = group.strip()
        for field in ARRAY_FIELDS:
            normalized_data[field] = normalized_strings(
                data[field],
                f"{path}.data.{field}",
                required=field in {"outputs", "completionCriteria"},
            )

        position = source["position"]
        if (
            not isinstance(position, dict)
            or set(position) != {"x", "y"}
            or isinstance(position["x"], bool)
            or isinstance(position["y"], bool)
            or not isinstance(position["x"], (int, float))
            or not isinstance(position["y"], (int, float))
        ):
            raise GraphError(f"{path}.position: 유한한 숫자 x, y가 필요합니다.")
        if not all(math.isfinite(float(position[key])) for key in ("x", "y")):
            raise GraphError(f"{path}.position: 유한한 숫자만 허용됩니다.")
        nodes.append(
            {
                "id": node_id,
                "type": "workflowTask",
                "data": normalized_data,
                "position": {"x": position["x"], "y": position["y"]},
            }
        )

    edges: list[dict[str, str]] = []
    edge_ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for index, source in enumerate(graph["edges"]):
        path = f"edges.{index}"
        if not isinstance(source, dict) or set(source) != {"id", "source", "target", "type"}:
            raise GraphError(f"{path}: id, source, target, type만 허용됩니다.")
        values = {}
        for field in ("id", "source", "target"):
            value = source[field].strip() if isinstance(source[field], str) else ""
            if not value:
                raise GraphError(f"{path}.{field}: 비어 있지 않은 문자열이어야 합니다.")
            values[field] = value
        if source["type"] != "smoothstep":
            raise GraphError(f"{path}.type: smoothstep이어야 합니다.")
        if values["id"] in edge_ids:
            raise GraphError(f"중복된 엣지 ID가 있습니다: {values['id']}")
        edge_ids.add(values["id"])
        pair = (values["source"], values["target"])
        if pair in pairs:
            raise GraphError(f"중복 연결이 있습니다: {pair[0]} → {pair[1]}")
        pairs.add(pair)
        if pair[0] not in node_ids or pair[1] not in node_ids:
            raise GraphError(f"{path}: 존재하지 않는 노드를 참조합니다.")
        if pair[0] == pair[1]:
            raise GraphError(f"{path}: 자기 자신에게 연결할 수 없습니다.")
        edges.append({**values, "type": "smoothstep"})

    normalized = {"schemaVersion": 2, "nodes": nodes, "edges": edges}
    levels = topological_levels(normalized)
    level_by_id = {
        node["id"]: level_index
        for level_index, level in enumerate(levels)
        for node in level
    }
    adjacency = adjacency_map(normalized)

    delegated = [node for node in nodes if node["data"]["assignee"] == "delegated"]
    if len(delegated) > max_subagents:
        raise GraphError(
            f"위임 작업 {len(delegated)}개가 설정 예산 {max_subagents}개를 초과했습니다."
        )
    if len(nodes) > max_subagents + 4:
        raise GraphError(
            f"전체 노드 {len(nodes)}개가 설정 상한 {max_subagents + 4}개를 초과했습니다."
        )

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for node in nodes:
        group = node["data"].get("parallelGroupId")
        if group:
            if node["data"]["assignee"] != "delegated":
                raise GraphError(f"{node['id']}: 메인 작업은 병렬 그룹에 포함할 수 없습니다.")
            groups[group].append(node)
    for group, members in groups.items():
        if len(members) < 2:
            raise GraphError(f'병렬 그룹 "{group}"에는 최소 2개의 노드가 필요합니다.')
        if len({level_by_id[node["id"]] for node in members}) != 1:
            raise GraphError(f'병렬 그룹 "{group}"은 같은 실행 단계에 있어야 합니다.')
        for left_index, left in enumerate(members):
            for right in members[left_index + 1 :]:
                if is_reachable(left["id"], right["id"], adjacency) or is_reachable(
                    right["id"], left["id"], adjacency
                ):
                    raise GraphError(f'병렬 그룹 "{group}" 구성원 사이에 의존 경로가 있습니다.')
                for field in ("outputs", "fileScope"):
                    overlap = set(left["data"][field]) & set(right["data"][field])
                    if overlap:
                        raise GraphError(
                            f'병렬 그룹 "{group}"의 {field}가 겹칩니다: '
                            + ", ".join(sorted(overlap))
                        )

    warnings = disconnected_warnings(normalized)
    return normalized, warnings


def adjacency_map(graph: dict[str, Any]) -> dict[str, list[str]]:
    result = {node["id"]: [] for node in graph["nodes"]}
    for edge in graph["edges"]:
        result[edge["source"]].append(edge["target"])
    return result


def is_reachable(source: str, target: str, adjacency: dict[str, list[str]]) -> bool:
    queue = deque([source])
    visited = {source}
    while queue:
        current = queue.popleft()
        for next_id in adjacency[current]:
            if next_id == target:
                return True
            if next_id not in visited:
                visited.add(next_id)
                queue.append(next_id)
    return False


def topological_levels(graph: dict[str, Any]) -> list[list[dict[str, Any]]]:
    order = {node["id"]: index for index, node in enumerate(graph["nodes"])}
    by_id = {node["id"]: node for node in graph["nodes"]}
    adjacency = adjacency_map(graph)
    indegree = {node_id: 0 for node_id in by_id}
    for edge in graph["edges"]:
        indegree[edge["target"]] += 1
    ready = sorted(
        (node_id for node_id, degree in indegree.items() if degree == 0),
        key=lambda node_id: (order[node_id], node_id),
    )
    levels: list[list[dict[str, Any]]] = []
    seen = 0
    while ready:
        level_ids = ready
        levels.append([by_id[node_id] for node_id in level_ids])
        next_ids: set[str] = set()
        for node_id in level_ids:
            seen += 1
            for target in adjacency[node_id]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    next_ids.add(target)
        ready = sorted(next_ids, key=lambda node_id: (order[node_id], node_id))
    if seen != len(by_id):
        raise GraphError("작업 흐름에는 순환 연결을 만들 수 없습니다.")
    return levels


def disconnected_warnings(graph: dict[str, Any]) -> list[str]:
    if len(graph["nodes"]) <= 1:
        return []
    connected = set()
    for edge in graph["edges"]:
        connected.add(edge["source"])
        connected.add(edge["target"])
    isolated = [node["id"] for node in graph["nodes"] if node["id"] not in connected]
    return [f"연결되지 않은 노드: {', '.join(isolated)}"] if isolated else []


def format_items(values: list[str], empty: str = "없음") -> str:
    return ", ".join(f"`{value}`" for value in values) if values else empty


def build_markdown(plan: str, graph: dict[str, Any], max_subagents: int) -> str:
    levels = topological_levels(graph)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for node in graph["nodes"]:
        if node["data"].get("parallelGroupId"):
            groups[node["data"]["parallelGroupId"]].append(node)

    sequence_parts = []
    for index, level in enumerate(levels, 1):
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        solo = []
        for node in level:
            group = node["data"].get("parallelGroupId")
            grouped[group].append(node) if group else solo.append(node)
        lines = [
            f"- **[{'메인 직접 수행' if node['data']['assignee'] == 'main' else '위임 작업'}] "
            f"{node['data']['title']}** — {node['data']['instruction']}"
            for node in solo
        ]
        lines.extend(
            f"- **병렬 그룹 `{group}`** — "
            + ", ".join(node["data"]["title"] for node in members)
            + "를 동시에 실행하고 모두 terminal state에 도달할 때까지 대기합니다."
            for group, members in grouped.items()
        )
        sequence_parts.append(f"### 단계 {index}\n" + "\n".join(lines))

    if groups:
        parallel_parts = []
        for group, members in groups.items():
            member_lines = "\n".join(
                f"- **{node['data']['title']}** ({node['data']['executorRole']}): "
                f"{node['data']['instruction']}"
                for node in members
            )
            parallel_parts.append(
                f"### {group}\n{member_lines}\n"
                "- 완료 조건: 그룹 내 모든 위임 작업이 terminal state에 도달한 후에만 "
                "다음 의존 작업을 시작합니다."
            )
        parallel = "\n\n".join(parallel_parts)
    else:
        parallel = "명시적으로 지정된 병렬 작업 그룹이 없습니다."

    contracts = []
    for node in graph["nodes"]:
        data = node["data"]
        if data["assignee"] == "main":
            execution = "메인 에이전트 직접 수행"
        elif data.get("parallelGroupId"):
            execution = f"위임 · 병렬 그룹 `{data['parallelGroupId']}`"
        else:
            execution = "서브 에이전트에게 위임"
        contracts.append(
            f"### {data['title']} (`{node['id']}`)\n"
            f"- **담당:** {execution}\n"
            f"- **실행 역할:** {data['executorRole']}\n"
            f"- **작업 지시:** {data['instruction']}\n"
            f"- **입력:** {format_items(data['inputs'])}\n"
            f"- **산출물:** {format_items(data['outputs'])}\n"
            f"- **완료 조건:** {format_items(data['completionCriteria'])}\n"
            f"- **허용 도구:** {format_items(data['allowedTools'], '지정 없음')}\n"
            f"- **파일 범위:** {format_items(data['fileScope'], '지정 없음')}"
        )

    by_id = {node["id"]: node for node in graph["nodes"]}
    dependencies = []
    for node in graph["nodes"]:
        predecessors = [
            by_id[edge["source"]]
            for edge in graph["edges"]
            if edge["target"] == node["id"]
        ]
        description = (
            ", ".join(item["data"]["title"] for item in predecessors)
            + "의 완료 결과를 입력으로 사용"
            if predecessors
            else "선행 의존성 없이 시작 가능"
        )
        dependencies.append(f"- **{node['data']['title']}**: {description}")

    delegated_count = sum(
        node["data"]["assignee"] == "delegated" for node in graph["nodes"]
    )
    return f"""{SYSTEM_HARNESS}

{FAILURE_POLICY}

# Multi-Agent 작업 지시서

## [첨부 자료 사용 규칙]

- 이 문서가 실행 계약의 기준입니다.
- `original-plan.md`는 원래 의도와 제약을 교차 확인하는 자료입니다.
- `workflow-map.svg`는 순서와 병렬 구조를 빠르게 확인하는 보조 이미지입니다.
- 세 자료가 충돌하면 실행하지 말고 차이를 먼저 보고합니다.

## [스키마 및 위임 정책]

- **Workflow schema:** v2
- **서브 에이전트 허용 예산:** 최대 {max_subagents}개
- **전체 노드 허용 상한:** 최대 {max_subagents + 4}개
- **현재 위임 작업:** {delegated_count}개
- `assignee: main` 작업은 메인 에이전트가 직접 수행합니다.
- `assignee: delegated` 작업마다 최대 한 개의 서브 에이전트만 생성합니다.
- 정의된 작업을 역할별로 다시 분해하여 추가 서브 에이전트를 만들지 않습니다.

## [전체 작업 목표]

{plan.strip()}

## [작업 순서]

{chr(10).join(sequence_parts)}

## [병렬 작업 그룹]

{parallel}

## [작업별 실행 계약]

{chr(10).join(contracts)}

## [의존성과 완료 조건]

{chr(10).join(dependencies)}

- 각 작업은 명시된 입력, 산출물, 완료 조건, 허용 도구, 파일 범위를 준수합니다.
- 메인 작업을 서브 에이전트에게 재위임하지 않습니다.
- 모든 선행 의존성과 병렬 그룹 완료 여부를 확인한 후 다음 단계로 이동합니다.
- 불완전한 중간 결과를 완료된 산출물로 간주하지 않습니다.
"""


def display_width(char: str) -> int:
    return 2 if unicodedata.east_asian_width(char) in {"W", "F", "A"} else 1


def wrap_visual(text: str, limit: int, max_lines: int) -> list[str]:
    lines: list[str] = []
    current = ""
    current_width = 0
    consumed = 0
    for index, char in enumerate(text):
        width = display_width(char)
        if current and current_width + width > limit:
            lines.append(current.rstrip())
            if len(lines) == max_lines:
                consumed = index
                break
            current = ""
            current_width = 0
        current += char
        current_width += width
        consumed = index + 1
    else:
        if current:
            lines.append(current.rstrip())
        consumed = len(text)
    if consumed < len(text) and lines:
        lines[-1] = lines[-1].rstrip(" .") + "…"
    return lines[:max_lines]


def svg_text(lines: list[str], x: int, y: int, css_class: str, line_height: int) -> str:
    spans = "".join(
        f'<tspan x="{x}" dy="{0 if index == 0 else line_height}">{html.escape(line)}</tspan>'
        for index, line in enumerate(lines)
    )
    return f'<text x="{x}" y="{y}" class="{css_class}">{spans}</text>'


def build_svg(graph: dict[str, Any]) -> str:
    levels = topological_levels(graph)
    node_width, node_height = 320, 220
    x_gap, y_gap = 120, 48
    margin_x, header_height, margin_bottom = 56, 100, 56
    max_level_size = max(len(level) for level in levels)
    width = margin_x * 2 + len(levels) * node_width + (len(levels) - 1) * x_gap
    height = (
        header_height
        + max_level_size * node_height
        + max(0, max_level_size - 1) * y_gap
        + margin_bottom
    )
    coordinates: dict[str, tuple[int, int]] = {}
    for level_index, level in enumerate(levels):
        column_height = len(level) * node_height + max(0, len(level) - 1) * y_gap
        y_offset = header_height + (height - header_height - margin_bottom - column_height) // 2
        x = margin_x + level_index * (node_width + x_gap)
        for row_index, node in enumerate(level):
            coordinates[node["id"]] = (x, y_offset + row_index * (node_height + y_gap))

    edge_parts = []
    for edge in graph["edges"]:
        source_x, source_y = coordinates[edge["source"]]
        target_x, target_y = coordinates[edge["target"]]
        start_x, start_y = source_x + node_width, source_y + node_height // 2
        end_x, end_y = target_x, target_y + node_height // 2
        middle_x = (start_x + end_x) // 2
        points = f"{start_x},{start_y} {middle_x},{start_y} {middle_x},{end_y} {end_x},{end_y}"
        edge_parts.append(
            f'<polyline class="edge" points="{points}" marker-end="url(#arrow)" />'
        )

    node_parts = []
    for node in graph["nodes"]:
        x, y = coordinates[node["id"]]
        data = node["data"]
        delegated = data["assignee"] == "delegated"
        kind = "DELEGATED TASK" if delegated else "MAIN TASK"
        card_class = "card delegated" if delegated else "card main"
        group = data.get("parallelGroupId")
        node_parts.extend(
            [
                f'<g aria-label="{html.escape(data["title"])}">',
                f'<rect x="{x}" y="{y}" width="{node_width}" height="{node_height}" rx="18" class="{card_class}" />',
                f'<text x="{x + 22}" y="{y + 30}" class="kind">{kind}</text>',
                f'<text x="{x + node_width - 22}" y="{y + 30}" text-anchor="end" class="id">{html.escape(node["id"])}</text>',
                svg_text(wrap_visual(data["title"], 28, 2), x + 22, y + 62, "title", 24),
                svg_text(wrap_visual(data["executorRole"], 38, 1), x + 22, y + 112, "role", 20),
                svg_text(wrap_visual(data["instruction"], 42, 3), x + 22, y + 143, "instruction", 19),
            ]
        )
        if group:
            node_parts.append(
                f'<rect x="{x + 18}" y="{y + node_height - 34}" width="{node_width - 36}" height="22" rx="11" class="group-pill" />'
            )
            node_parts.append(
                f'<text x="{x + node_width // 2}" y="{y + node_height - 19}" text-anchor="middle" class="group-text">병렬 · {html.escape(group)}</text>'
            )
        node_parts.append("</g>")

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
  <title id="title">FlowCraft workflow map</title>
  <desc id="desc">{len(graph['nodes'])} tasks connected by {len(graph['edges'])} dependency arrows.</desc>
  <defs>
    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 12 6 L 0 12 z" fill="#64748b" />
    </marker>
    <style>
      .background {{ fill: #f8fafc; }}
      .edge {{ fill: none; stroke: #64748b; stroke-width: 3; stroke-linejoin: round; }}
      .card {{ fill: #ffffff; stroke-width: 3; filter: drop-shadow(0 5px 8px rgba(15,23,42,.10)); }}
      .card.main {{ stroke: #1e3a5f; }}
      .card.delegated {{ stroke: #d99a2b; }}
      text {{ font-family: -apple-system, BlinkMacSystemFont, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif; fill: #172033; }}
      .kind {{ font-size: 13px; font-weight: 800; letter-spacing: 1px; }}
      .id {{ font-size: 12px; fill: #64748b; }}
      .title {{ font-size: 19px; font-weight: 800; }}
      .role {{ font-size: 14px; font-weight: 700; fill: #526078; }}
      .instruction {{ font-size: 13px; fill: #46546c; }}
      .group-pill {{ fill: #fff4dc; }}
      .group-text {{ font-size: 12px; font-weight: 700; fill: #98640c; }}
      .legend {{ font-size: 14px; font-weight: 700; fill: #475569; }}
    </style>
  </defs>
  <rect class="background" width="100%" height="100%" />
  <text x="{margin_x}" y="42" class="title">FlowCraft Task DAG</text>
  <circle cx="{margin_x + 8}" cy="70" r="7" fill="#1e3a5f" />
  <text x="{margin_x + 22}" y="75" class="legend">메인 직접 수행</text>
  <circle cx="{margin_x + 150}" cy="70" r="7" fill="#d99a2b" />
  <text x="{margin_x + 164}" y="75" class="legend">위임 작업</text>
  {''.join(edge_parts)}
  {''.join(node_parts)}
</svg>
"""


def original_plan_markdown(plan: str) -> str:
    return (
        "# Original Plan Meta-Prompt\n\n"
        "> 이 문서는 FlowCraft 변환 전의 원본 의도와 제약을 보존합니다.\n\n"
        + plan.strip()
        + "\n"
    )


def build_payload(
    plan: str, graph_raw: str, max_subagents: int
) -> tuple[dict[str, str], dict[str, Any]]:
    if not plan.strip():
        raise GraphError("원본 계획이 비어 있습니다.")
    graph, warnings = load_and_normalize_graph(graph_raw, max_subagents)
    payload = {
        "original-plan.md": original_plan_markdown(plan),
        "workflow-prompt.md": build_markdown(plan, graph, max_subagents),
        "workflow-map.svg": build_svg(graph),
    }
    metadata = {
        "ok": True,
        "nodeCount": len(graph["nodes"]),
        "edgeCount": len(graph["edges"]),
        "delegatedCount": sum(
            node["data"]["assignee"] == "delegated" for node in graph["nodes"]
        ),
        "levelCount": len(topological_levels(graph)),
        "warnings": warnings,
        "sha256": {
            name: hashlib.sha256(content.encode("utf-8")).hexdigest()
            for name, content in payload.items()
        },
    }
    return payload, metadata


def write_payload(
    payload: dict[str, str], output_dir: Path, dry_run: bool
) -> list[str]:
    if dry_run:
        return []
    if output_dir.exists() and any(output_dir.iterdir()):
        raise GraphError(f"출력 폴더가 비어 있지 않습니다: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, content in payload.items():
        path = output_dir / name
        path.write_text(content, encoding="utf-8")
        written.append(str(path.resolve()))
    return written


def sample_graph() -> dict[str, Any]:
    def node(
        node_id: str,
        title: str,
        assignee: str,
        output: str,
        group: str | None = None,
    ) -> dict[str, Any]:
        data: dict[str, Any] = {
            "title": title,
            "executorRole": "Lead Orchestrator" if assignee == "main" else "Specialist",
            "instruction": f"{title} 작업을 완료합니다.",
            "assignee": assignee,
            "inputs": ["사용자 요청"],
            "outputs": [output],
            "completionCriteria": [f"{title} 완료"],
            "allowedTools": [],
            "fileScope": [],
        }
        if group:
            data["parallelGroupId"] = group
        return {
            "id": node_id,
            "type": "workflowTask",
            "data": data,
            "position": {"x": 0, "y": 0},
        }

    return {
        "schemaVersion": 2,
        "nodes": [
            node("task-1", "범위 확정", "main", "범위"),
            node("task-2", "자료 조사", "delegated", "조사 결과", "research"),
            node("task-3", "리스크 분석", "delegated", "리스크 분석", "research"),
            node("task-4", "통합 검수", "main", "최종 결과"),
        ],
        "edges": [
            {"id": "e1-2", "source": "task-1", "target": "task-2", "type": "smoothstep"},
            {"id": "e1-3", "source": "task-1", "target": "task-3", "type": "smoothstep"},
            {"id": "e2-4", "source": "task-2", "target": "task-4", "type": "smoothstep"},
            {"id": "e3-4", "source": "task-3", "target": "task-4", "type": "smoothstep"},
        ],
    }


def run_self_test() -> dict[str, Any]:
    plan = "테스트 목적의 계획입니다. 실제 작업은 실행하지 않습니다."
    graph = sample_graph()
    payload, metadata = build_payload(plan, json.dumps(graph, ensure_ascii=False), 4)
    assert set(payload) == {
        "original-plan.md",
        "workflow-prompt.md",
        "workflow-map.svg",
    }
    assert payload["workflow-prompt.md"].startswith(
        f"{SYSTEM_HARNESS}\n\n{FAILURE_POLICY}"
    )
    assert plan in payload["original-plan.md"]
    assert 'marker-end="url(#arrow)"' in payload["workflow-map.svg"]
    assert "자료 조사" in payload["workflow-map.svg"]

    impossible_target = (
        Path(tempfile.gettempdir()) / f"flowcraft-self-test-{uuid.uuid4().hex}"
    )
    written = write_payload(payload, impossible_target, dry_run=True)
    assert written == [] and not impossible_target.exists()

    cyclic = json.loads(json.dumps(graph))
    cyclic["edges"].append(
        {"id": "e4-1", "source": "task-4", "target": "task-1", "type": "smoothstep"}
    )
    try:
        build_payload(plan, json.dumps(cyclic), 4)
    except GraphError as exc:
        assert "순환" in str(exc)
    else:
        raise AssertionError("순환 그래프가 거부되지 않았습니다.")

    return {
        **metadata,
        "mode": "self-test",
        "checks": [
            "valid-v2-dag",
            "harness-order",
            "three-artifact-contract",
            "svg-arrow-marker",
            "cycle-rejection",
            "zero-file-write",
        ],
        "written": written,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare an original plan, FlowCraft Markdown, and SVG map."
    )
    parser.add_argument("--plan-file", type=Path)
    parser.add_argument("--graph-file", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--max-subagents", type=int, default=4)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.self_test:
            result = run_self_test()
        else:
            if not args.plan_file or not args.graph_file or not args.output_dir:
                raise GraphError(
                    "--plan-file, --graph-file, --output-dir가 모두 필요합니다."
                )
            plan = args.plan_file.read_text(encoding="utf-8")
            graph_raw = args.graph_file.read_text(encoding="utf-8")
            payload, metadata = build_payload(plan, graph_raw, args.max_subagents)
            written = write_payload(payload, args.output_dir, args.dry_run)
            result = {
                **metadata,
                "mode": "dry-run" if args.dry_run else "write",
                "written": written,
            }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (GraphError, OSError) as exc:
        print(
            json.dumps(
                {"ok": False, "error": str(exc), "written": []},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
