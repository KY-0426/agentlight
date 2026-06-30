import { useEffect, useState } from "react";
import type { AiToolId, AiToolStatus } from "../domain/aiTools";
import { aiToolAccent, aiToolInitials } from "../domain/aiTools";
import { useGuardedClick } from "../hooks/useGuardedClick";
import { installAiTool, listAiTools } from "../tauriClient";

interface AiToolConnectModalProps {
  open: boolean;
  onClose: () => void;
  onToolsChanged?: () => void;
}

type InstallState = "idle" | "loading" | "success" | "error";

export function AiToolConnectModal({ open, onClose, onToolsChanged }: AiToolConnectModalProps) {
  const [tools, setTools] = useState<AiToolStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeToolId, setActiveToolId] = useState<AiToolId | null>(null);
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const closeClick = useGuardedClick(onClose, { lockWhileBusy: false });
  const installClick = useGuardedClick(async (tool: AiToolStatus) => {
    setActiveToolId(tool.id);
    setInstallState("loading");
    setFeedback(null);

    try {
      const result = await installAiTool(tool.id);
      setInstallState("success");
      setFeedback(result.message);
      const refreshed = await listAiTools();
      setTools(refreshed);
      onToolsChanged?.();
    } catch (error) {
      setInstallState("error");
      setFeedback(error instanceof Error ? error.message : "安装失败");
    } finally {
      setActiveToolId(null);
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFeedback(null);
    setInstallState("idle");

    void listAiTools()
      .then((items: AiToolStatus[]) => {
        if (!cancelled) {
          setTools(items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFeedback(error instanceof Error ? error.message : "无法读取 AI 工具状态");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="ai-tool-modal" role="presentation" onClick={closeClick.onClick}>
      <section
        className="ai-tool-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-tool-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-tool-modal__header">
          <h2 id="ai-tool-modal-title">接入 AI 工具</h2>
        </header>

        <div className="ai-tool-modal__body">
          {loading ? <p className="ai-tool-modal__hint">正在检测本机 AI 工具…</p> : null}

          <ul className="ai-tool-list">
            {tools.map((tool) => {
              const isConfigured = tool.configured;
              const isBusy = (activeToolId === tool.id && installState === "loading") || installClick.busy;
              const actionLabel = isConfigured ? "重新安装" : "安装";

              return (
                <li className="ai-tool-list__item" key={tool.id}>
                  <div
                    className="ai-tool-list__icon"
                    style={{ backgroundColor: aiToolAccent[tool.id] }}
                    aria-hidden="true"
                  >
                    {aiToolInitials[tool.id]}
                  </div>

                  <div className="ai-tool-list__meta">
                    <strong>{tool.name}</strong>
                    <small>{tool.detail}</small>
                  </div>

                  <div className="ai-tool-list__actions">
                    {isConfigured ? <span className="ai-tool-list__badge">已安装</span> : null}
                    <button
                      className="ai-tool-list__button"
                      type="button"
                      disabled={isBusy}
                      onClick={() => installClick.onClick(tool)}
                    >
                      {isBusy ? "处理中…" : actionLabel}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="ai-tool-modal__footnote">
            「已安装」表示 Agent Light 已写入接入配置；检测到本机已安装但配置缺失时会自动恢复。Cursor 接入后需新开一个对话 hooks 才会生效。再次安装只会更新或修复配置，本向导只装不卸。
          </p>

          {feedback ? (
            <p className={`ai-tool-modal__feedback ai-tool-modal__feedback--${installState}`}>
              {feedback}
            </p>
          ) : null}
        </div>

        <footer className="ai-tool-modal__footer">
          <button className="ai-tool-modal__close" type="button" onClick={closeClick.onClick}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
