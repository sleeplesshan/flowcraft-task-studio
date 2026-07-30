import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FAILURE_POLICY, SYSTEM_HARNESS } from "../../lib/workflow";

const simpleModernGraph = {
  schemaVersion: 2,
  nodes: [
    {
      id: "one",
      type: "workflowTask",
      data: {
        title: "첫 작업",
        executorRole: "조정 담당",
        instruction: "첫 번째 작업을 완료한다.",
        assignee: "main",
        inputs: [],
        outputs: ["첫 결과"],
        completionCriteria: ["첫 결과가 작성됨"],
        allowedTools: [],
        fileScope: [],
      },
      position: { x: 0, y: 0 },
    },
    {
      id: "two",
      type: "workflowTask",
      data: {
        title: "둘째 작업",
        executorRole: "검토 담당",
        instruction: "첫 결과를 검토한다.",
        assignee: "delegated",
        inputs: ["첫 결과"],
        outputs: ["검토 결과"],
        completionCriteria: ["검토 결과가 작성됨"],
        allowedTools: [],
        fileScope: [],
      },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [
    { id: "one-two", source: "one", target: "two", type: "smoothstep" },
  ],
};

const legacyGraph = {
  nodes: [
    {
      id: "legacy-one",
      type: "subAgentTask",
      data: {
        agentName: "Legacy One",
        role: "레거시 작업",
        task: "이전 형식의 작업을 수행한다.",
        isParallel: false,
      },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};

async function openClean(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".brand-title")).toContainText(
    "FlowCraft Task Studio",
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(
    page.locator('.react-flow__node[data-id="task-1"]'),
  ).toBeVisible();
  await page.waitForTimeout(250);
}

test("generates and copies a provider-neutral prompt", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openClean(page);
  const recommendedBudget = page
    .locator(".budget-options button")
    .filter({ hasText: "균형" });
  await expect(recommendedBudget).toHaveAttribute("aria-pressed", "true");
  await expect(recommendedBudget).toContainText("4");
  await expect(recommendedBudget).toContainText("권장");
  await expect(
    page.getByRole("list", { name: "작업 흐름 만드는 순서" }),
  ).toContainText(
    "설계 프롬프트 복사GPT·Claude에서 JSON 생성아래 LLM 응답에 붙여넣기",
  );
  await expect(page.getByLabel("내용")).toHaveAttribute(
    "placeholder",
    "코덱스나 클로드코드에서 계획(Plan) 모드로 나온 메타프롬프트를 여기 붙여넣으세요.",
  );

  await page
    .locator(".budget-options button")
    .filter({ hasText: "광범위 조사" })
    .click();
  await expect(page.getByText(/서로 독립적인 광범위 조사 작업/)).toBeVisible();
  await recommendedBudget.click();

  await page.getByLabel("내용").fill("두 관점으로 제품 리스크를 분석한다.");
  await page
    .getByRole("button", { name: "LLM용 설계 프롬프트 복사" })
    .click();
  await expect(page.locator(".textarea--generated")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("두 관점으로 제품 리스크를 분석한다.");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('"schemaVersion": 2');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("[출력 전 내부 검수]");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("[정체 복구를 위한 작업 계약 규칙]");
});

test("copies the validated Markdown instruction without downloading a file", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openClean(page);

  await page.getByRole("button", { name: "작업 지시서 복사" }).click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.startsWith(`${SYSTEM_HARNESS}\n\n${FAILURE_POLICY}`)).toBe(
    true,
  );
  expect(copied).toContain("## [전체 작업 목표]");
  expect(copied).toContain("## [작업별 실행 계약]");
  expect(copied).toContain("오케스트레이션 상태 `stalled`");
  expect(copied).toContain("대체 서브 에이전트");
  expect(copied).toContain("품질 한계를 전달한 축소 범위");
  await expect(page.locator(".toast")).toContainText(
    "작업 지시서: 클립보드에 복사했습니다.",
  );
});

test("copies the complete workflow map as a PNG image", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openClean(page);

  await page
    .getByRole("button", { name: "작업 흐름 이미지 복사" })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "작업 흐름 이미지를 복사했습니다",
  );

  const image = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const pngItem = items.find((item) => item.types.includes("image/png"));
    if (!pngItem) return null;
    const blob = await pngItem.getType("image/png");
    const bitmap = await createImageBitmap(blob);
    const result = {
      type: blob.type,
      size: blob.size,
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close();
    return result;
  });

  expect(image).not.toBeNull();
  expect(image!.type).toBe("image/png");
  expect(image!.size).toBeGreaterThan(20_000);
  expect(image!.width).toBeGreaterThanOrEqual(1_600);
  expect(image!.height).toBeGreaterThanOrEqual(1_000);
});

test("uses one continuous setup scroll and gives the inspector full height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openClean(page);
  const header = await page.locator(".app-header").boundingBox();
  expect(header).not.toBeNull();
  expect(header!.height).toBe(62);
  await expect(page.getByText("브라우저에 저장")).toHaveCount(0);
  await expect(
    page.getByText("복잡한 요청을 실행 가능한 작업 흐름으로 정리합니다."),
  ).toHaveCount(0);
  await page.locator('.react-flow__node[data-id="task-1"]').click();
  const setupPanel = page.locator(".workflow-setup-panel");
  const inputPanel = await page.locator(".input-panel").boundingBox();
  const jsonPanel = await page.locator(".json-panel").boundingBox();
  const canvasPanel = await page.locator(".canvas-panel").boundingBox();
  const inspectorPanel = await page.locator(".inspector-panel").boundingBox();
  await expect(setupPanel).toHaveCSS("overflow-y", "auto");
  await expect(page.locator(".input-panel")).toHaveCSS("overflow", "visible");
  await expect(page.locator(".json-panel")).toHaveCSS("overflow", "visible");
  expect(inputPanel).not.toBeNull();
  expect(jsonPanel).not.toBeNull();
  expect(canvasPanel).not.toBeNull();
  expect(inspectorPanel).not.toBeNull();
  expect(Math.abs(inputPanel!.x - jsonPanel!.x)).toBeLessThan(2);
  expect(jsonPanel!.y).toBeGreaterThan(inputPanel!.y);
  expect(Math.abs(canvasPanel!.y - inspectorPanel!.y)).toBeLessThan(2);
  expect(Math.abs(canvasPanel!.height - inspectorPanel!.height)).toBeLessThan(
    2,
  );
  expect(inspectorPanel!.width).toBeGreaterThanOrEqual(419);
});

test("collapses both side panels and opens the inspector when a task is clicked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openClean(page);
  const viewport = page.locator(".react-flow__viewport");
  const canvasBefore = await page.locator(".canvas-panel").boundingBox();
  const transformBefore = await viewport.getAttribute("style");

  await expect(page.locator(".inspector-panel")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "오른쪽 작업 속성 패널 펼치기" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "오른쪽 작업 속성 패널 펼치기" })
      .locator("span"),
  ).toHaveText("작업 속성");

  await page
    .getByRole("button", { name: "왼쪽 설정 패널 접기" })
    .click();
  await expect(page.locator(".input-panel")).toHaveCount(0);
  await expect(page.locator(".json-panel")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "왼쪽 설정 패널 펼치기" }),
  ).toBeVisible();
  const leftRailLabel = page
    .getByRole("button", { name: "왼쪽 설정 패널 펼치기" })
    .locator("span");
  await expect(leftRailLabel).toHaveText("설정");
  await expect(leftRailLabel).toHaveCSS("writing-mode", "vertical-rl");
  await expect(leftRailLabel).toHaveCSS("text-orientation", "upright");
  await expect(leftRailLabel).toHaveCSS("transform", "none");
  const canvasWithLeftCollapsed = await page
    .locator(".canvas-panel")
    .boundingBox();
  expect(canvasBefore).not.toBeNull();
  expect(canvasWithLeftCollapsed).not.toBeNull();
  expect(canvasWithLeftCollapsed!.width).toBeGreaterThan(canvasBefore!.width);
  await expect
    .poll(() => viewport.getAttribute("style"))
    .not.toBe(transformBefore);

  await page
    .getByRole("button", { name: "왼쪽 설정 패널 펼치기" })
    .click();
  await expect(page.locator(".input-panel")).toBeVisible();

  await page.getByRole("button", { name: "작업 흐름 전체 맞춤" }).click();
  await page.locator('.react-flow__node[data-id="task-4"]').click();
  await expect(page.locator(".inspector-panel")).toBeVisible();
  await expect(page.locator(".node-id-row")).toContainText("task-4");
  await expect
    .poll(async () => {
      const [canvas, node] = await Promise.all([
        page.locator(".canvas-wrap").boundingBox(),
        page.locator('.react-flow__node[data-id="task-4"]').boundingBox(),
      ]);
      if (!canvas || !node) return false;
      return (
        node.x >= canvas.x &&
        node.y >= canvas.y &&
        node.x + node.width <= canvas.x + canvas.width &&
        node.y + node.height <= canvas.y + canvas.height
      );
    })
    .toBe(true);

  await page
    .getByRole("button", { name: "오른쪽 작업 속성 패널 접기" })
    .click();
  await expect(page.locator(".inspector-panel")).toHaveCount(0);
  await page.locator('.react-flow__node[data-id="task-1"]').click();
  await expect(page.locator(".inspector-panel")).toBeVisible();
  await expect(page.locator(".node-id-row")).toContainText("task-1");
});

test("scrolls the shared setup panel all the way to its final content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 768 });
  await openClean(page);
  const setupPanel = page.locator(".workflow-setup-panel");
  const metrics = await setupPanel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(
    Math.abs(metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop),
  ).toBeLessThanOrEqual(1);

  const setupBox = await setupPanel.boundingBox();
  const jsonBox = await page.locator(".json-panel").boundingBox();
  expect(setupBox).not.toBeNull();
  expect(jsonBox).not.toBeNull();
  expect(jsonBox!.y + jsonBox!.height).toBeLessThanOrEqual(
    setupBox!.y + setupBox!.height + 1,
  );
});

test("avoids shell overflow in the former tablet breakpoint gap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openClean(page);
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

  const setupPanel = await page.locator(".workflow-setup-panel").boundingBox();
  const canvasPanel = await page.locator(".canvas-panel").boundingBox();
  const inspectorRail = await page
    .getByRole("button", { name: "오른쪽 작업 속성 패널 펼치기" })
    .boundingBox();
  expect(setupPanel).not.toBeNull();
  expect(canvasPanel).not.toBeNull();
  expect(inspectorRail).not.toBeNull();
  expect(setupPanel!.y).toBeLessThan(canvasPanel!.y);
  expect(canvasPanel!.y).toBeLessThan(inspectorRail!.y);
});

test("keeps task cards content-dense without unused space below badges", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openClean(page);
  const card = page.locator(".agent-node").filter({ hasText: "위임 작업" }).first();
  const title = card.locator("h3");
  const instruction = card.locator(".agent-node__task");
  const footer = card.locator(".agent-node__footer");
  const [cardBox, footerBox] = await Promise.all([
    card.boundingBox(),
    footer.boundingBox(),
  ]);
  expect(cardBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(cardBox!.y + cardBox!.height - (footerBox!.y + footerBox!.height)).toBeLessThan(
    16,
  );
  await expect(title).toHaveCSS("-webkit-line-clamp", "2");
  await expect(instruction).toHaveCSS("-webkit-line-clamp", "4");
  await expect(title).toHaveCSS("font-size", "13.5px");
  await expect(instruction).toHaveCSS("font-size", "10px");
  await expect(card.locator(".agent-node__contract span").first()).toHaveCSS(
    "font-size",
    "9px",
  );
});

test("shows directional arrows in the native interactive MiniMap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openClean(page);

  const minimap = page.locator(".workflow-minimap");
  const edgeLayer = minimap.locator(".workflow-minimap__edges");
  const miniMapEdges = edgeLayer.locator(".workflow-minimap__edge");

  await expect(minimap).toBeVisible();
  await expect(minimap.locator(".react-flow__minimap-node")).toHaveCount(4);
  await expect(miniMapEdges).toHaveCount(4);
  await expect(edgeLayer).toHaveCSS("pointer-events", "none");

  for (let index = 0; index < 4; index += 1) {
    await expect(miniMapEdges.nth(index)).toHaveAttribute(
      "marker-end",
      /url\(#workflow-minimap-arrow-/,
    );
  }

  const edgesRenderBeforeNodes = await minimap
    .locator(".react-flow__minimap-svg")
    .evaluate((svg) => {
      const edge = svg.querySelector(".workflow-minimap__edges");
      const node = svg.querySelector(".react-flow__minimap-node");
      return Boolean(
        edge &&
          node &&
          edge.compareDocumentPosition(node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  expect(edgesRenderBeforeNodes).toBe(true);
  await expect(minimap).not.toHaveClass(/workflow-minimap--dense/);
});

test("softens dense MiniMap dependencies without hiding their direction", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openClean(page);
  const nodes = Array.from({ length: 10 }, (_, index) => ({
    ...simpleModernGraph.nodes[0],
    id: `dense-${index + 1}`,
    data: {
      ...simpleModernGraph.nodes[0].data,
      title: `고밀도 작업 ${index + 1}`,
      outputs: [`고밀도 결과 ${index + 1}`],
    },
    position: { x: index * 320, y: (index % 3) * 230 },
  }));
  const edges = nodes.flatMap((source, sourceIndex) =>
    nodes.slice(sourceIndex + 1).map((target) => ({
      id: `${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      type: "smoothstep",
    })),
  );

  await page
    .locator(".budget-options button")
    .filter({ hasText: "광범위 조사" })
    .click();
  await page
    .getByLabel("LLM 작업 흐름 JSON 응답")
    .fill(JSON.stringify({ schemaVersion: 2, nodes, edges }));
  await page
    .getByRole("button", { name: "작업 흐름 만들기" })
    .click();

  const minimap = page.locator(".workflow-minimap");
  await expect(minimap).toHaveClass(/workflow-minimap--dense/);
  await expect(minimap.locator(".workflow-minimap__edge")).toHaveCount(45);
  await expect(minimap.locator(".workflow-minimap__edge").first()).toHaveCSS(
    "opacity",
    "0.24",
  );
  await expect(
    minimap.locator(".workflow-minimap__edge").first(),
  ).toHaveAttribute("marker-end", /url\(#workflow-minimap-arrow-/);
});

test("moves between the canvas and inspector on stacked layouts", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1180, height: 820 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openClean(page);
    const task = page.locator('.react-flow__node[data-id="task-2"]');
    await task.scrollIntoViewIfNeeded();
    const canvasScroll = await page.evaluate(() => window.scrollY);
    await task.click();

    const inspectorTitle = page.locator("#inspector-title");
    await expect(inspectorTitle).toBeFocused();
    await expect(inspectorTitle).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(canvasScroll);

    await page
      .getByRole("button", { name: "오른쪽 작업 속성 패널 접기" })
      .click();
    await expect(page.locator("#canvas-title")).toBeFocused();
    await expect(page.locator("#canvas-title")).toBeInViewport();
  }
});

test("keeps normal export state only in the canvas status bar", async ({
  page,
}) => {
  await openClean(page);
  await expect(page.locator("#export-status")).toHaveCount(0);
  await expect(page.locator(".validation-bar")).toHaveText(
    /그래프 오류 없음/,
  );
  await expect(page.locator(".validation-bar")).not.toContainText(
    "내려받을 수 있습니다",
  );
});

test("asks before replacing current work with the example", async ({ page }) => {
  await openClean(page);
  const source = page.getByLabel("내용");
  await source.fill("보존해야 할 현재 요청");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "예제로 초기화" }).click();
  await expect(source).toHaveValue("보존해야 할 현재 요청");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "예제로 초기화" }).click();
  await expect(source).not.toHaveValue("보존해야 할 현재 요청");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});

test("clears an applied draft while keeping current graph JSON independent", async ({
  page,
}) => {
  await openClean(page);
  const draft = JSON.stringify(simpleModernGraph, null, 2);
  const draftArea = page.getByLabel("LLM 작업 흐름 JSON 응답");
  await expect(draftArea).toHaveValue("");
  await draftArea.fill(draft);
  await page
    .getByRole("button", { name: "작업 흐름 만들기" })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "왼쪽 설정 패널 펼치기" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "왼쪽 설정 패널 펼치기" })
    .click();

  await page.getByRole("tab", { name: "현재 작업 흐름" }).click();
  const current = page.getByLabel("현재 작업 흐름 JSON");
  await expect(current).toHaveAttribute("readonly", "");
  await expect(current).toHaveValue(/"assignee": "main"/);
  await expect(current).toHaveValue(/"schemaVersion": 2/);
  const addNodeButton = page.getByRole("button", { name: "노드 추가" });
  await expect(addNodeButton).toHaveCSS("height", "32px");
  await expect(addNodeButton).toHaveCSS("display", "flex");
  await expect(addNodeButton).toHaveCSS("flex-direction", "row");
  await expect(addNodeButton).toHaveCSS("flex-wrap", "nowrap");
  await expect(addNodeButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const addNodeButtonMetrics = await addNodeButton.evaluate((button) => ({
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth,
  }));
  expect(addNodeButtonMetrics.clientWidth).toBeGreaterThanOrEqual(80);
  expect(addNodeButtonMetrics.scrollWidth).toBeLessThanOrEqual(
    addNodeButtonMetrics.clientWidth,
  );
  const [addIconBox, addLabelBox] = await Promise.all([
    addNodeButton.locator("svg").boundingBox(),
    addNodeButton.locator("span").boundingBox(),
  ]);
  expect(addIconBox).not.toBeNull();
  expect(addLabelBox).not.toBeNull();
  expect(addIconBox!.x + addIconBox!.width).toBeLessThan(addLabelBox!.x);
  expect(
    Math.abs(
      addIconBox!.y +
        addIconBox!.height / 2 -
        (addLabelBox!.y + addLabelBox!.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  await addNodeButton.click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  await page.getByRole("tab", { name: "LLM 응답" }).click();
  await expect(draftArea).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("LLM 작업 흐름 JSON 응답")).toHaveValue("");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
});

test("blocks legacy export until the migrated task contract is confirmed", async ({
  page,
}) => {
  await openClean(page);
  await page
    .getByLabel("LLM 작업 흐름 JSON 응답")
    .fill(JSON.stringify(legacyGraph));
  await page
    .getByRole("button", { name: "작업 흐름 만들기" })
    .click();
  await expect(
    page.getByRole("button", { name: "왼쪽 설정 패널 펼치기" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "왼쪽 설정 패널 펼치기" })
    .click();
  await expect(
    page.getByText("이전 형식에서 변환된 작업 검토 필요"),
  ).toBeVisible();
  await expect(page.getByText(/실행 담당 정보가 없어/)).toBeVisible();

  const exportButton = page.getByRole("button", {
    name: "작업 지시서 내려받기",
  });
  const copyButton = page.getByRole("button", {
    name: "작업 지시서 복사",
  });
  await expect(exportButton).toBeDisabled();
  await expect(copyButton).toBeDisabled();
  await expect(page.locator("#export-status")).toContainText(
    "이전 형식에서 변환된 작업을 검토",
  );

  await page.getByRole("button", { name: "검토 완료로 표시" }).click();
  await expect(exportButton).toBeEnabled();
  await expect(copyButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const markdown = Buffer.concat(chunks).toString("utf8");
  expect(markdown.startsWith(`${SYSTEM_HARNESS}\n\n${FAILURE_POLICY}`)).toBe(
    true,
  );
  expect(markdown).toContain("success | failed | cancelled");
  expect(markdown).toContain("체크포인트로 1회 회수");
  expect(markdown).toContain("완료된 범위를 다시 수행하지 않습니다");
  expect(markdown).toContain("## [작업별 실행 계약]");
  expect(markdown).toContain("### 레거시 작업");
});

test("shows export blockers for parallel contradictions and total-node overflow", async ({
  page,
}) => {
  await openClean(page);
  const conflict = {
    schemaVersion: 2,
    nodes: [
      {
        ...simpleModernGraph.nodes[0],
        id: "parallel-a",
        data: {
          ...simpleModernGraph.nodes[0].data,
          title: "병렬 A",
          assignee: "delegated",
          parallelGroupId: "conflict",
          outputs: ["A 결과"],
        },
      },
      {
        ...simpleModernGraph.nodes[1],
        id: "parallel-b",
        data: {
          ...simpleModernGraph.nodes[1].data,
          title: "병렬 B",
          assignee: "delegated",
          parallelGroupId: "conflict",
          outputs: ["B 결과"],
        },
      },
    ],
    edges: [
      {
        id: "parallel-edge",
        source: "parallel-a",
        target: "parallel-b",
        type: "smoothstep",
      },
    ],
  };
  const area = page.getByLabel("LLM 작업 흐름 JSON 응답");
  await area.fill(JSON.stringify(conflict));
  await page
    .getByRole("button", { name: "작업 흐름 만들기" })
    .click();
  await expect(page.locator(".validation-bar")).toContainText(
    "같은 실행 단계",
  );
  await expect(
    page.getByRole("button", { name: "작업 지시서 내려받기" }),
  ).toBeDisabled();

  await page
    .getByRole("button", { name: "왼쪽 설정 패널 펼치기" })
    .click();
  const oversized = {
    schemaVersion: 2,
    nodes: Array.from({ length: 9 }, (_, index) => ({
      ...simpleModernGraph.nodes[0],
      id: `main-${index + 1}`,
      data: {
        ...simpleModernGraph.nodes[0].data,
        title: `Main ${index + 1}`,
        outputs: [`Main ${index + 1} 결과`],
      },
    })),
    edges: [],
  };
  await page.getByRole("tab", { name: "LLM 응답" }).click();
  await area.fill(JSON.stringify(oversized));
  await page
    .getByRole("button", { name: "작업 흐름 만들기" })
    .click();
  await expect(page.locator(".validation-bar")).toContainText("전체 노드");
});

test("keeps invalid JSON open and collapses the setup panel after a successful apply", async ({
  page,
}) => {
  await openClean(page);
  const draft = page.getByLabel("LLM 작업 흐름 JSON 응답");

  await expect(draft).toHaveValue("");
  await draft.fill("{");
  await page
    .getByRole("button", { name: "작업 흐름 만들기" })
    .click();
  await expect(draft).toBeVisible();
  await expect(draft).toHaveValue("{");
  await expect(
    page.getByRole("button", { name: "왼쪽 설정 패널 펼치기" }),
  ).toHaveCount(0);

  await draft.fill(JSON.stringify(simpleModernGraph));
  await page
    .getByRole("button", { name: "작업 흐름 만들기" })
    .click();
  await expect(
    page.getByRole("button", { name: "왼쪽 설정 패널 펼치기" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page
    .getByRole("button", { name: "왼쪽 설정 패널 펼치기" })
    .click();
  await expect(page.getByLabel("LLM 작업 흐름 JSON 응답")).toHaveValue("");
});

test("supports keyboard deletion, one-step drag undo and mobile panel order", async ({
  page,
}) => {
  await openClean(page);
  const firstNode = page.locator('.react-flow__node[data-id="task-1"]');
  const positionStyle = () =>
    firstNode.evaluate(
      (element) =>
        element
          .getAttribute("style")
          ?.match(/transform:\s*translate\([^)]+\)/)?.[0] ?? "",
    );
  const before = await positionStyle();
  const box = await firstNode.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + 70, {
    steps: 5,
  });
  await page.mouse.up();
  await expect.poll(positionStyle).not.toBe(before);
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect.poll(positionStyle).toBe(before);
  await page.getByRole("button", { name: "다시 실행" }).click();
  await expect.poll(positionStyle).not.toBe(before);

  await firstNode.click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  await page.setViewportSize({ width: 390, height: 844 });
  const inputPanel = await page.locator(".input-panel").boundingBox();
  const jsonPanel = await page.locator(".json-panel").boundingBox();
  const canvasPanel = await page.locator(".canvas-panel").boundingBox();
  const inspectorPanel = await page.locator(".inspector-panel").boundingBox();
  expect(inputPanel).not.toBeNull();
  expect(jsonPanel).not.toBeNull();
  expect(canvasPanel).not.toBeNull();
  expect(inspectorPanel).not.toBeNull();
  expect(inputPanel!.y).toBeLessThan(jsonPanel!.y);
  expect(jsonPanel!.y).toBeLessThan(canvasPanel!.y);
  expect(canvasPanel!.y).toBeLessThan(inspectorPanel!.y);
  await expect(page.locator(".workflow-minimap")).toBeHidden();
});

test("rejects a canvas connection that would create a cycle", async ({
  page,
}) => {
  await openClean(page);
  const source = page.locator(
    '.react-flow__node[data-id="task-4"] .react-flow__handle.source',
  );
  const target = page.locator(
    '.react-flow__node[data-id="task-1"] .react-flow__handle.target',
  );
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
});

test("selects a connection from a forgiving click target", async ({ page }) => {
  await openClean(page);
  const edge = page.locator(".react-flow__edge").first();
  const interaction = edge.locator(".react-flow__edge-interaction");
  await expect(interaction).toHaveCSS("stroke-width", "36px");
  await expect(interaction).toHaveCSS("cursor", "pointer");

  const clickPoint = await interaction.evaluate((path) => {
    const edgePath = path as SVGPathElement;
    const length = edgePath.getTotalLength();
    const middle = edgePath.getPointAtLength(length / 2);
    const next = edgePath.getPointAtLength(Math.min(length, length / 2 + 1));
    const dx = next.x - middle.x;
    const dy = next.y - middle.y;
    const magnitude = Math.hypot(dx, dy) || 1;
    const offsetPoint = new DOMPoint(
      middle.x + (-dy / magnitude) * 12,
      middle.y + (dx / magnitude) * 12,
    ).matrixTransform(edgePath.getScreenCTM() ?? new DOMMatrix());
    return { x: offsetPoint.x, y: offsetPoint.y };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);

  await expect(edge).toHaveClass(/selected/);
  await expect(edge.locator(".react-flow__edge-path")).toHaveCSS(
    "stroke-width",
    "2.5px",
  );
});

test("has no serious or critical automated accessibility violations", async ({
  page,
}) => {
  await openClean(page);
  const seriousViolations = (results: Awaited<
    ReturnType<AxeBuilder["analyze"]>
  >) =>
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );

  const defaultResults = await new AxeBuilder({ page }).analyze();
  expect(seriousViolations(defaultResults)).toEqual([]);

  await page.locator('.react-flow__node[data-id="task-1"]').click();
  await expect(page.locator(".inspector-panel")).toBeVisible();
  const editorResults = await new AxeBuilder({ page }).analyze();
  expect(seriousViolations(editorResults)).toEqual([]);
});
