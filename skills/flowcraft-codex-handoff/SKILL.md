---
name: flowcraft-codex-handoff
description: Convert a Codex or Claude plan-mode meta-prompt into a validated FlowCraft v2 task DAG, then package the original plan, graph-derived Markdown execution prompt, and crisp SVG node map for handoff to Codex. Use when users ask to graph a plan with FlowCraft, prepare a multi-agent workflow handoff, send a plan plus Markdown plus node image to Codex, or dry-run validation without executing the planned work.
---

# FlowCraft Codex Handoff

Prepare a three-file handoff that lets Codex compare the original intent, the
authoritative execution contract, and the visual DAG. Do not execute the planned
work unless the user separately requests execution after reviewing the handoff.

## Workflow

1. Obtain the original plan-mode meta-prompt. Treat it as required.
2. Obtain a FlowCraft schema v2 JSON graph. If the user did not provide one,
   construct it from the plan by following
   [references/flowcraft-v2.md](references/flowcraft-v2.md).
3. Keep planning, integration, final verification, and deployment as `main`
   tasks. Delegate only independent, bounded work with distinct outputs.
4. Save the plan and graph JSON as temporary input files. Do not alter user
   source files.
5. Set `FLOWCRAFT_SKILL_DIR` to the directory containing this `SKILL.md`, then
   run:

   ```bash
   python3 "$FLOWCRAFT_SKILL_DIR/scripts/flowcraft_handoff.py" \
     --plan-file /absolute/path/to/plan.md \
     --graph-file /absolute/path/to/workflow.json \
     --output-dir /absolute/path/to/new-output-directory \
     --max-subagents 4
   ```

6. If validation fails, repair the graph contract instead of bypassing it.
7. Deliver all three generated files together:
   - `original-plan.md`: original intent and constraints.
   - `workflow-prompt.md`: authoritative Codex execution prompt.
   - `workflow-map.svg`: visual cross-check of nodes, edges, and parallel stages.
8. In the final response, link the two Markdown files and render the SVG inline
   with its absolute path. State that Markdown is authoritative and the image is
   supplemental.

## Handoff rules

- Preserve the original plan verbatim in `original-plan.md`.
- Never infer missing execution details from the image.
- If the original plan, Markdown contract, and image disagree, stop before
  execution and report the mismatch.
- Do not create more subagents than the graph's delegated task count or policy
  limit.
- Do not split one graph task into extra role-based subagents.
- Use SVG as the default image so node text stays sharp when zoomed.
- Do not claim the handoff was transmitted unless all three artifacts are
  present in the response or explicitly attached to the receiving Codex task.

## Validation-only testing

Run the built-in test without creating artifacts:

```bash
python3 "$FLOWCRAFT_SKILL_DIR/scripts/flowcraft_handoff.py" --self-test
```

To validate real inputs without writing output files:

```bash
python3 "$FLOWCRAFT_SKILL_DIR/scripts/flowcraft_handoff.py" \
  --plan-file /absolute/path/to/plan.md \
  --graph-file /absolute/path/to/workflow.json \
  --output-dir /absolute/path/that-must-not-be-created \
  --max-subagents 4 \
  --dry-run
```

Both modes must report `"written": []`. Never run the planned work during a
self-test or dry run.
