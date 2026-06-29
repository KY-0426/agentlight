import type { AgentState, AgentStatusEvent } from "../domain/status";
import { agentStates, defaultPalette, statusDefinitions } from "../domain/status";
import { useGuardedClick } from "../hooks/useGuardedClick";
import type { HardwareStatusSnapshot } from "../tauriClient";

interface HardwareDebugPanelProps {
  event: AgentStatusEvent;
  hardwareStatus: HardwareStatusSnapshot | null;
  onRefresh: () => void;
  onTrigger: (state: AgentState, message?: string) => void;
}

const diagnosticLabels: Record<AgentState, string> = {
  standby: "蓝色呼吸",
  working: "黄色常亮",
  completed: "绿色闪烁",
  attention: "红色闪烁",
};

export function HardwareDebugPanel({
  event,
  hardwareStatus,
  onRefresh,
  onTrigger,
}: HardwareDebugPanelProps) {
  const refreshClick = useGuardedClick(onRefresh);
  const triggerClick = useGuardedClick((state: AgentState, message?: string) => onTrigger(state, message));

  return (
    <main className={`settings-shell settings-shell--${event.state}`}>
      <section className="settings-panel hardware-debug" aria-label="硬件开发者调试">
        <header className="settings-header" data-tauri-drag-region>
          <div className="settings-header__mark hardware-debug__mark" aria-hidden="true">
            HW
          </div>
          <div>
            <p>Developer Only</p>
            <h1>ESP32 硬件调试</h1>
          </div>
          <button
            className="settings-close"
            type="button"
            onClick={refreshClick.onClick}
            disabled={refreshClick.busy}
          >
            刷新
          </button>
        </header>

        <section className="settings-hero" aria-label="硬件状态">
          <div className="settings-status">
            <span
              className="settings-status__dot"
              style={{ backgroundColor: statusColor(hardwareStatus), color: statusColor(hardwareStatus) }}
              aria-hidden="true"
            />
            <div>
              <span>ESP32 RGB</span>
              <strong>{hardwareStateLabel(hardwareStatus)}</strong>
              <small>{hardwareDetail(hardwareStatus)}</small>
            </div>
          </div>
          <div className="settings-hero__summary" aria-label="硬件摘要">
            <span>
              <strong>{hardwareStatus?.port || "--"}</strong>
              <small>端口</small>
            </span>
            <span>
              <strong>{hardwareStatus?.baud ?? "--"}</strong>
              <small>波特率</small>
            </span>
            <span>
              <strong>{hardwareStatus?.firmware_version || "--"}</strong>
              <small>固件版本</small>
            </span>
          </div>
        </section>

        <div className="settings-body">
          <section className="settings-section" aria-labelledby="channel-test-heading">
            <div className="settings-section__title">
              <h2 id="channel-test-heading">通道诊断</h2>
              <span className="settings-badge">纯色优先</span>
            </div>
            <div className="settings-state-grid">
              {agentStates.map((state) => (
                <button
                  className={`settings-state ${event.state === state ? "is-active" : ""}`}
                  key={state}
                  type="button"
                  disabled={triggerClick.busy}
                  onClick={() => triggerClick.onClick(state, `RGB 通道诊断：${diagnosticLabels[state]}`)}
                >
                  <span
                    className="settings-state__swatch"
                    style={{ backgroundColor: defaultPalette[state], color: defaultPalette[state] }}
                    aria-hidden="true"
                  />
                  <span>{diagnosticLabels[state]}</span>
                  <small>{statusDefinitions[state].label} / {statusDefinitions[state].mode}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="hardware-raw-heading">
            <div className="settings-section__title">
              <h2 id="hardware-raw-heading">运行快照</h2>
              <span className="settings-badge">{formatUpdatedAt(hardwareStatus)}</span>
            </div>
            <dl className="hardware-debug__grid">
              <SnapshotField label="enabled" value={formatBool(hardwareStatus?.enabled)} />
              <SnapshotField label="connected" value={formatBool(hardwareStatus?.connected)} />
              <SnapshotField label="protocol" value={hardwareStatus?.protocol ?? "--"} />
              <SnapshotField label="firmware_version" value={hardwareStatus?.firmware_version ?? "--"} />
              <SnapshotField label="protocol_version" value={hardwareStatus?.protocol_version ?? "--"} />
              <SnapshotField label="hardware_revision" value={hardwareStatus?.hardware_revision ?? "--"} />
              <SnapshotField label="last_state" value={formatLastState(hardwareStatus)} />
              <SnapshotField
                label="available_ports"
                value={
                  hardwareStatus?.available_ports?.length
                    ? hardwareStatus.available_ports.join(", ")
                    : "--"
                }
              />
              <SnapshotField label="last_error" value={hardwareStatus?.last_error ?? "无"} />
            </dl>
          </section>
        </div>
      </section>
    </main>
  );
}

function SnapshotField({ label, value }: { label: string; value: string }) {
  return (
    <div className="hardware-debug__field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function hardwareStateLabel(snapshot: HardwareStatusSnapshot | null): string {
  if (!snapshot) {
    return "检查中";
  }
  if (!snapshot.enabled) {
    return "已关闭";
  }
  return snapshot.connected ? "已连接" : "未连接";
}

function hardwareDetail(snapshot: HardwareStatusSnapshot | null): string {
  if (!snapshot) {
    return "正在读取本机硬件状态";
  }
  if (snapshot.last_error) {
    return snapshot.last_error;
  }
  return snapshot.connected ? "串口写入正常" : "等待连接或首次写入";
}

function statusColor(snapshot: HardwareStatusSnapshot | null): string {
  if (!snapshot?.enabled) {
    return "#94a3b8";
  }
  return snapshot.connected ? "#38d66b" : "#ff4b55";
}

function formatBool(value: boolean | undefined): string {
  return typeof value === "boolean" ? String(value) : "--";
}

function formatLastState(snapshot: HardwareStatusSnapshot | null): string {
  return snapshot?.last_state ? statusDefinitions[snapshot.last_state].label : "--";
}

function formatUpdatedAt(snapshot: HardwareStatusSnapshot | null): string {
  if (!snapshot) {
    return "未刷新";
  }
  return new Date(snapshot.updated_at_ms).toLocaleTimeString();
}
