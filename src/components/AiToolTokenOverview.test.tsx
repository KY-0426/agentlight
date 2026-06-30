import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiToolTokenUsage } from "../domain/aiTools";
import { AiToolTokenOverview } from "./AiToolTokenOverview";

const sampleTool: AiToolTokenUsage = {
  id: "codex",
  name: "Codex",
  installed: true,
  configured: true,
  installable: true,
  available: true,
  state: "working",
  state_label: "工作中",
  tokens_used: 12_500,
  token_kind: "official",
  activity_detail: "2 分钟前活跃",
  detail: "读取 ~/.codex/state_5.sqlite",
};

describe("AiToolTokenOverview", () => {
  it("renders tool rows and aggregate token summary", () => {
    const html = renderToStaticMarkup(
      <AiToolTokenOverview tools={[sampleTool]} onManageTools={() => undefined} />,
    );

    expect(html).toContain("AI 助手");
    expect(html).toContain("Codex");
    expect(html).toContain("工作中");
    expect(html).toContain("1.3万");
    expect(html).toContain("接入 AI 工具");
  });

  it("marks loading state on the table container", () => {
    const html = renderToStaticMarkup(<AiToolTokenOverview tools={[]} loading />);
    expect(html).toContain("ai-tool-token-table--loading");
  });
});
