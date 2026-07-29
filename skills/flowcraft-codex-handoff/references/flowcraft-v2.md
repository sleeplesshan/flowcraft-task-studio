# FlowCraft schema v2 contract

Use this contract when creating or repairing the graph before packaging.

## JSON shape

```json
{
  "schemaVersion": 2,
  "nodes": [
    {
      "id": "task-1",
      "type": "workflowTask",
      "data": {
        "title": "범위 확정",
        "executorRole": "Lead Orchestrator",
        "instruction": "요구사항과 완료 조건을 확정합니다.",
        "assignee": "main",
        "inputs": ["사용자 요청"],
        "outputs": ["확정된 작업 범위"],
        "completionCriteria": ["범위와 완료 조건이 명시됨"],
        "allowedTools": [],
        "fileScope": []
      },
      "position": { "x": 0, "y": 0 }
    }
  ],
  "edges": [
    {
      "id": "e1-2",
      "source": "task-1",
      "target": "task-2",
      "type": "smoothstep"
    }
  ]
}
```

`parallelGroupId` is the only optional data field. Add it only to two or more
`delegated` tasks that can run in the same topological stage.

## Design rules

- Keep the graph acyclic. Every edge means the target requires the source result.
- Use no more than the selected delegated-task budget. Total nodes are limited
  to delegated budget plus four.
- Keep planning, shared scaffolding, integration, final verification, and
  deployment as `main`.
- Delegate only work that has an independent input, output, completion condition,
  and non-overlapping ownership boundary.
- Do not create one node per repeated item. Split large independent batches into
  a few balanced, non-overlapping ranges only when this removes a real bottleneck.
- Tasks in the same parallel group must have the same topological level and no
  direct or indirect dependency path between them.
- Parallel tasks must not repeat normalized `outputs` or `fileScope` values.
- `outputs` and `completionCriteria` require at least one non-empty value.
- Use empty arrays for unspecified `inputs`, `allowedTools`, and `fileScope`.
- Use `position: {"x": 0, "y": 0}` when no saved canvas position exists.

## Artifact authority

The generated `workflow-prompt.md` is the execution authority.
`original-plan.md` is used to verify intent, and `workflow-map.svg` is a visual
overview. The image never overrides the text contract.
