import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useGuardedClick } from "../hooks/useGuardedClick";
import type { AgentState, AgentStatusEvent } from "../domain/status";
import type { LightSettings } from "../domain/status";
import type { AiToolTokenUsage } from "../domain/aiTools";
import { AiToolConnectModal } from "./AiToolConnectModal";
import { AiToolTokenOverview } from "./AiToolTokenOverview";
import type {
  CloudPhoneLoginRequest,
  CloudPhoneCodeRequest,
  CloudPhoneCodeResponse,
  CloudSession,
  HardwareStatusSnapshot,
  SettingsPageTarget,
  SystemMetrics,
  AgentProvider,
  TokenLeaderboardResponse,
} from "../tauriClient";
import { agentStates, defaultPalette, statusDefinitions } from "../domain/status";
import { pickActiveAiToolLabel } from "../domain/agentMonitor";
import { agentProviderLabels, DEFAULT_LEADERBOARD_SERVER_URL, listenForSettingsPage } from "../tauriClient";

type SettingsPage = SettingsPageTarget;
type LeaderboardStatus = "idle" | "loading" | "ready" | "error";

const NAV_ITEMS: { page: SettingsPage; label: string; hint: string }[] = [
  { page: "account", label: "账号", hint: "登录与云同步" },
  { page: "leaderboard", label: "排行榜", hint: "Token 消耗" },
  { page: "device", label: "设备", hint: "运行与窗口" },
  { page: "effect", label: "灯效", hint: "状态与 RGB" },
  { page: "hardware", label: "硬件", hint: "ESP32 连接" },
];
type CloudSyncStatus = {
  state: "signed_out" | "ready" | "syncing" | "synced" | "error";
  message: string;
  lastSyncedAtMs?: number;
};

interface PetSettingsPanelProps {
  event: AgentStatusEvent;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  lightSettings: LightSettings;
  systemMetrics: SystemMetrics | null;
  aiToolTokens: AiToolTokenUsage[];
  aiToolLoading: boolean;
  onRefreshAiTools: () => Promise<void>;
  hardwareStatus: HardwareStatusSnapshot | null;
  cloudSession: CloudSession | null;
  cloudSyncStatus: CloudSyncStatus;
  leaderboard: TokenLeaderboardResponse | null;
  leaderboardAgentProvider: AgentProvider;
  leaderboardStatus: LeaderboardStatus;
  leaderboardError: string | null;
  logs: AgentStatusEvent[];
  onClose: () => void;
  onTrigger: (state: AgentState) => void;
  onAlwaysOnTopChange: (enabled: boolean) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onLightSettingsChange: (settings: LightSettings) => void;
  onCloudLogin: (request: CloudPhoneLoginRequest) => Promise<void>;
  onCloudSendPhoneCode: (request: CloudPhoneCodeRequest) => Promise<CloudPhoneCodeResponse>;
  onCloudLogout: () => Promise<void>;
  onRefreshLeaderboard: () => Promise<void>;
  onLeaderboardAgentChange: (agentProvider: AgentProvider) => Promise<void>;
  onProbeHardware: () => Promise<void>;
  onExitApp: () => void;
}

export function PetSettingsPanel({
  event,
  alwaysOnTop,
  launchAtLogin,
  lightSettings,
  systemMetrics,
  aiToolTokens,
  aiToolLoading,
  onRefreshAiTools,
  hardwareStatus,
  cloudSession,
  cloudSyncStatus,
  leaderboard,
  leaderboardAgentProvider,
  leaderboardStatus,
  leaderboardError,
  logs,
  onClose,
  onTrigger,
  onAlwaysOnTopChange,
  onLaunchAtLoginChange,
  onLightSettingsChange,
  onCloudLogin,
  onCloudSendPhoneCode,
  onCloudLogout,
  onRefreshLeaderboard,
  onLeaderboardAgentChange,
  onProbeHardware,
  onExitApp,
}: PetSettingsPanelProps) {
  const [activePage, setActivePage] = useState<SettingsPage>("account");
  const [selectedLightState, setSelectedLightState] = useState<AgentState>(event.state);
  const currentDefinition = statusDefinitions[event.state];
  const currentMessage = event.message || currentDefinition.description;

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;

    listenForSettingsPage((page) => setActivePage(page))
      .then((cleanup) => {
        if (!isMounted) {
          cleanup?.();
          return;
        }
        unlisten = cleanup;
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setSelectedLightState(event.state);
  }, [event.state]);

  const closeClick = useGuardedClick(onClose);
  const tabClick = useGuardedClick((page: SettingsPage) => setActivePage(page), { lockWhileBusy: false });
  const triggerClick = useGuardedClick(onTrigger);
  const probeClick = useGuardedClick(onProbeHardware);

  function previewLightState(state: AgentState) {
    setSelectedLightState(state);
    if (event.state !== state) {
      onTrigger(state);
    }
  }

  function updateLightState(state: AgentState, update: Partial<LightSettings[AgentState]>) {
    onLightSettingsChange({
      ...lightSettings,
      [state]: {
        ...lightSettings[state],
        ...update,
      },
    });
    if (event.state !== state) {
      onTrigger(state);
    }
  }

  const activeNav = NAV_ITEMS.find((item) => item.page === activePage) ?? NAV_ITEMS[0];
  const activeAiToolLabel = pickActiveAiToolLabel(aiToolTokens);

  return (
    <main className={`settings-shell settings-shell--${event.state}`}>
      <div className="settings-app" aria-label="桌宠设置">
        <aside className="settings-sidebar">
          <div className="settings-sidebar__brand" data-tauri-drag-region>
            <img className="settings-sidebar__logo" src="/assets/app-logo.png" alt="" aria-hidden="true" />
            <div className="settings-sidebar__brand-copy">
              <strong>Agent Light</strong>
              <span>桌宠控制台</span>
            </div>
          </div>

          <nav className="settings-sidebar__nav" aria-label="设置页面">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.page}
                className={`settings-sidebar__nav-item ${activePage === item.page ? "is-active" : ""}`}
                type="button"
                aria-current={activePage === item.page ? "page" : undefined}
                onClick={() => tabClick.onClick(item.page)}
              >
                <span className="settings-sidebar__nav-label">{item.label}</span>
                <span className="settings-sidebar__nav-hint">{item.hint}</span>
              </button>
            ))}
          </nav>

          <footer className="settings-sidebar__footer">
            <SyncStatusBar cloudSession={cloudSession} cloudSyncStatus={cloudSyncStatus} compact />
            <button
              className="settings-sidebar__close"
              type="button"
              onClick={closeClick.onClick}
              disabled={closeClick.busy}
            >
              关闭窗口
            </button>
          </footer>
        </aside>

        <div className="settings-main">
          <header className="settings-main__top" data-tauri-drag-region>
            <div className="settings-main__heading">
              <p>{activeNav.hint}</p>
              <h1>{activeNav.label}</h1>
            </div>
            <StatusStrip
              state={event.state}
              stateLabel={currentDefinition.label}
              message={currentMessage}
              aiToolLabel={activeAiToolLabel}
              cpuLabel={formatPercent(systemMetrics?.cpu_usage_percent)}
              hardwareLabel={formatHardwareState(hardwareStatus)}
            />
          </header>

          <div className="settings-main__body">
            {activePage === "account" ? (
              <AccountPanel
                cloudSession={cloudSession}
                onLogin={onCloudLogin}
                onLogout={onCloudLogout}
                onSendPhoneCode={onCloudSendPhoneCode}
              />
            ) : activePage === "leaderboard" ? (
              <LeaderboardPanel
                status={leaderboardStatus}
                error={leaderboardError}
                agentProvider={leaderboardAgentProvider}
                data={leaderboard}
                onRefresh={onRefreshLeaderboard}
                onAgentProviderChange={onLeaderboardAgentChange}
              />
            ) : activePage === "device" ? (
              <DevicePanel
                alwaysOnTop={alwaysOnTop}
                launchAtLogin={launchAtLogin}
                systemMetrics={systemMetrics}
                aiToolTokens={aiToolTokens}
                aiToolLoading={aiToolLoading}
                onRefreshAiTools={onRefreshAiTools}
                logs={logs}
                onAlwaysOnTopChange={onAlwaysOnTopChange}
                onLaunchAtLoginChange={onLaunchAtLoginChange}
                onExitApp={onExitApp}
              />
            ) : activePage === "effect" ? (
              <EffectPanel
                event={event}
                lightSettings={lightSettings}
                selectedLightState={selectedLightState}
                onTrigger={(state) => triggerClick.onClick(state)}
                onPreviewLightState={previewLightState}
                onUpdateLightState={updateLightState}
                triggerBusy={triggerClick.busy}
              />
            ) : (
              <HardwarePanel
                hardwareStatus={hardwareStatus}
                event={event}
                onTrigger={(state) => triggerClick.onClick(state)}
                onProbeHardware={async () => {
                  probeClick.onClick();
                }}
                triggerBusy={triggerClick.busy}
                probeBusy={probeClick.busy}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function StatusStrip({
  state,
  stateLabel,
  message,
  aiToolLabel,
  cpuLabel,
  hardwareLabel,
}: {
  state: AgentState;
  stateLabel: string;
  message: string;
  aiToolLabel: string;
  cpuLabel: string;
  hardwareLabel: string;
}) {
  return (
    <div className="settings-status-strip" aria-label="运行摘要">
      <article className="settings-status-strip__primary">
        <span
          className="settings-status-strip__dot"
          style={{ backgroundColor: defaultPalette[state], color: defaultPalette[state] }}
          aria-hidden="true"
        />
        <div>
          <span>当前状态</span>
          <strong>{stateLabel}</strong>
          <small>{message}</small>
        </div>
      </article>
      <div className="settings-status-strip__metrics">
        <article>
          <span>AI 工具</span>
          <strong>{aiToolLabel}</strong>
        </article>
        <article>
          <span>CPU</span>
          <strong>{cpuLabel}</strong>
        </article>
        <article>
          <span>ESP32</span>
          <strong>{hardwareLabel}</strong>
        </article>
      </div>
    </div>
  );
}

function SyncStatusBar({
  cloudSession,
  cloudSyncStatus,
  compact = false,
}: {
  cloudSession: CloudSession | null;
  cloudSyncStatus: CloudSyncStatus;
  compact?: boolean;
}) {
  const stateClass = `sync-bar sync-bar--${cloudSyncStatus.state}${compact ? " sync-bar--compact" : ""}`;
  return (
    <div className={stateClass} role="status" aria-live="polite">
      <span className="sync-bar__dot" aria-hidden="true" />
      <div className="sync-bar__copy">
        <span className="sync-bar__message">{cloudSyncStatus.message}</span>
        {cloudSession ? (
          <small className="sync-bar__detail">{formatSyncDetail(cloudSession, cloudSyncStatus)}</small>
        ) : null}
      </div>
    </div>
  );
}

interface AccountPanelProps {
  cloudSession: CloudSession | null;
  onLogin: (request: CloudPhoneLoginRequest) => Promise<void>;
  onLogout: () => Promise<void>;
  onSendPhoneCode: (request: CloudPhoneCodeRequest) => Promise<CloudPhoneCodeResponse>;
}

function AccountPanel({ cloudSession, onLogin, onLogout, onSendPhoneCode }: AccountPanelProps) {
  const logoutClick = useGuardedClick(onLogout);

  if (cloudSession) {
    return (
      <div className="settings-body settings-body--account">
        <section className="settings-section" aria-labelledby="account-session-heading">
          <div className="settings-section__title">
            <h2 id="account-session-heading">已登录账号</h2>
            <span className="settings-badge">已登录</span>
          </div>
          <div className="leaderboard-session">
            <article>
              <span>当前用户</span>
              <strong>{cloudSession.display_name}</strong>
              <small>{cloudSession.user_phone_number ?? cloudSession.user_email}</small>
            </article>
            <article>
              <span>工作空间</span>
              <strong>{formatWorkspaceId(cloudSession.workspace_id)}</strong>
              <small>workspace</small>
            </article>
            <article>
              <span>本机设备</span>
              <strong>{cloudSession.device_id ? "已绑定" : "未绑定"}</strong>
              <small>{formatWorkspaceId(cloudSession.installation_id)}</small>
            </article>
            <button
              className="leaderboard-refresh"
              type="button"
              onClick={() => logoutClick.onClick()}
              disabled={logoutClick.busy}
            >
              退出登录
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <LoginForm onLogin={onLogin} onSendPhoneCode={onSendPhoneCode} />
  );
}

function LoginForm({
  onLogin,
  onSendPhoneCode,
}: {
  onLogin: (request: CloudPhoneLoginRequest) => Promise<void>;
  onSendPhoneCode: (request: CloudPhoneCodeRequest) => Promise<CloudPhoneCodeResponse>;
}) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_LEADERBOARD_SERVER_URL);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [codeStatus, setCodeStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const sendCodeClick = useGuardedClick(async () => {
    setCodeStatus("submitting");
    setAuthError(null);
    setCodeMessage(null);

    try {
      const response = await onSendPhoneCode({ serverUrl, phoneNumber });
      setCodeStatus("sent");
      setCodeMessage(
        response.dev_code
          ? `验证码 ${response.dev_code}，${Math.floor(response.expires_in_seconds / 60)} 分钟内有效`
          : "验证码已发送",
      );
    } catch (error) {
      setCodeStatus("error");
      setCodeMessage(error instanceof Error ? error.message : "验证码发送失败");
    }
  });

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthStatus("submitting");
    setAuthError(null);

    try {
      await onLogin({ serverUrl, phoneNumber, verificationCode, displayName });
      setVerificationCode("");
      setAuthStatus("idle");
    } catch (error) {
      setAuthStatus("error");
      setAuthError(error instanceof Error ? error.message : "账号操作失败");
    }
  }

  return (
    <div className="settings-body settings-body--login">
      <section className="settings-section login-panel" aria-labelledby="login-heading">
        <div className="settings-section__title">
          <h2 id="login-heading">登录账号</h2>
          <span className="settings-badge">手机验证码</span>
        </div>
        <form className="leaderboard-form" onSubmit={(event) => void submitAuth(event)}>
          <label className="leaderboard-field">
            <span>服务端</span>
            <input
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder={DEFAULT_LEADERBOARD_SERVER_URL}
              required
            />
          </label>
          <label className="leaderboard-field">
            <span>手机号</span>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              autoComplete="tel"
              required
            />
          </label>
          <label className="leaderboard-field">
            <span>验证码</span>
            <input
              type="text"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <button
            className="leaderboard-refresh leaderboard-refresh--secondary"
            type="button"
            disabled={codeStatus === "submitting" || sendCodeClick.busy || !phoneNumber.trim()}
            onClick={() => sendCodeClick.onClick()}
          >
            {codeStatus === "submitting" || sendCodeClick.busy ? "发送中" : "获取验证码"}
          </button>
          <label className="leaderboard-field">
            <span>昵称</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              placeholder="首次登录可填写"
            />
          </label>
          <button className="leaderboard-refresh" type="submit" disabled={authStatus === "submitting"}>
            {authStatus === "submitting" ? "提交中" : "登录并同步"}
          </button>
          {codeMessage ? <p className={codeStatus === "error" ? "leaderboard-error" : "leaderboard-note"}>{codeMessage}</p> : null}
          {authStatus === "error" ? <p className="leaderboard-error">{authError}</p> : null}
        </form>
      </section>
    </div>
  );
}

interface LeaderboardPanelProps {
  status: LeaderboardStatus;
  error: string | null;
  agentProvider: AgentProvider;
  data: TokenLeaderboardResponse | null;
  onRefresh: () => Promise<void>;
  onAgentProviderChange: (agentProvider: AgentProvider) => Promise<void>;
}

function LeaderboardPanel({
  status,
  error,
  agentProvider,
  data,
  onRefresh,
  onAgentProviderChange,
}: LeaderboardPanelProps) {
  const agentLabel = agentProviderLabels[data?.agent_provider ?? agentProvider];
  const refreshClick = useGuardedClick(onRefresh);
  const agentSwitchClick = useGuardedClick(onAgentProviderChange);

  return (
    <div className="settings-body settings-body--leaderboard">
      <section className="settings-section leaderboard-panel" aria-labelledby="leaderboard-heading">
        <div className="settings-section__title">
          <h2 id="leaderboard-heading">Token 排行榜</h2>
          <div className="leaderboard-agent-switch" role="tablist" aria-label="Agent 类型">
            {(["codex", "cursor", "claude_code"] as const).map((provider) => (
              <button
                className={agentProvider === provider ? "is-active" : ""}
                type="button"
                key={provider}
                disabled={agentSwitchClick.busy}
                onClick={() => agentSwitchClick.onClick(provider)}
              >
                {agentProviderLabels[provider]}
              </button>
            ))}
          </div>
        </div>

        <div className="leaderboard-sync">
          <button
            className="leaderboard-refresh"
            type="button"
            disabled={status === "loading" || refreshClick.busy}
            onClick={() => refreshClick.onClick()}
          >
            {status === "loading" || refreshClick.busy ? "读取中" : "刷新"}
          </button>
        </div>

        <div className="leaderboard-summary" aria-label="排行榜摘要">
          <article>
            <span>Agent</span>
            <strong>{agentLabel}</strong>
          </article>
          <article>
            <span>当前排名</span>
            <strong>{data?.current_user_rank ? `#${data.current_user_rank}` : "--"}</strong>
          </article>
          <article>
            <span>合计 Token</span>
            <strong>{data ? formatTokens(data.total_tokens) : "--"}</strong>
          </article>
        </div>

        <div className="leaderboard-table" role="table" aria-label="Token 排行榜">
          <div className="leaderboard-table__head" role="row">
            <span role="columnheader">排名</span>
            <span role="columnheader">成员</span>
            <span role="columnheader">Token</span>
          </div>
          {data && data.entries.length > 0 ? (
            data.entries.map((entry) => (
              <div className="leaderboard-row" role="row" key={entry.user_id}>
                <span role="cell">#{entry.rank}</span>
                <strong role="cell">{entry.display_name}</strong>
                <span role="cell">{formatTokens(entry.tokens_used)}</span>
              </div>
            ))
          ) : (
            <div className="leaderboard-empty" role="row">
              <span>{status === "error" ? error : "暂无排行榜数据"}</span>
            </div>
          )}
        </div>

        {status === "error" ? <p className="leaderboard-error">{error}</p> : null}
      </section>
    </div>
  );
}

interface DevicePanelProps {
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  systemMetrics: SystemMetrics | null;
  aiToolTokens: AiToolTokenUsage[];
  aiToolLoading: boolean;
  onRefreshAiTools: () => Promise<void>;
  logs: AgentStatusEvent[];
  onAlwaysOnTopChange: (enabled: boolean) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onExitApp: () => void;
}

function DevicePanel({
  alwaysOnTop,
  launchAtLogin,
  systemMetrics,
  aiToolTokens,
  aiToolLoading,
  onRefreshAiTools,
  logs,
  onAlwaysOnTopChange,
  onLaunchAtLoginChange,
  onExitApp,
}: DevicePanelProps) {
  const [aiToolModalOpen, setAiToolModalOpen] = useState(false);
  const exitClick = useGuardedClick(onExitApp);
  const manageToolsClick = useGuardedClick(() => setAiToolModalOpen(true), { lockWhileBusy: false });

  const cpuLabel = formatPercent(systemMetrics?.cpu_usage_percent);
  const uptimeLabel = formatUptime(systemMetrics?.uptime_seconds);

  return (
    <div className="settings-body settings-body--device">
      <section className="settings-section" aria-labelledby="metrics-heading">
        <div className="settings-section__title">
          <h2 id="metrics-heading">系统资源</h2>
          <span className="settings-badge">10 秒刷新</span>
        </div>
        <div className="settings-metric-grid">
          <article className="settings-metric">
            <span>CPU</span>
            <strong>{cpuLabel}</strong>
            <small>{formatCpuCores(systemMetrics)}</small>
          </article>
          <article className="settings-metric">
            <span>内存</span>
            <strong>{formatPercent(systemMetrics?.memory_used_percent)}</strong>
            <small>{formatMemory(systemMetrics)}</small>
          </article>
          <article className="settings-metric">
            <span>开机时长</span>
            <strong>{uptimeLabel}</strong>
            <small>{systemMetrics ? "每 10 秒刷新" : "等待系统数据"}</small>
          </article>
        </div>
      </section>

      <AiToolTokenOverview
        tools={aiToolTokens}
        loading={aiToolLoading}
        refreshIntervalSec={5}
        onManageTools={() => manageToolsClick.onClick()}
        manageToolsBusy={manageToolsClick.busy}
      />

      <AiToolConnectModal
        open={aiToolModalOpen}
        onClose={() => setAiToolModalOpen(false)}
        onToolsChanged={() => void onRefreshAiTools()}
      />

      <div className="settings-split">
        <section className="settings-section" aria-labelledby="window-heading">
          <h2 id="window-heading">窗口</h2>
          <div className="settings-toggle-grid">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={alwaysOnTop}
                onChange={(event) => onAlwaysOnTopChange(event.target.checked)}
              />
              <span>窗口置顶</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={launchAtLogin}
                onChange={(event) => onLaunchAtLoginChange(event.target.checked)}
              />
              <span>开机启动</span>
            </label>
          </div>
          <button className="settings-exit" type="button" onClick={exitClick.onClick} disabled={exitClick.busy}>
            退出 Agent Light
          </button>
        </section>

        <section className="settings-section settings-section--log" aria-labelledby="log-heading">
          <h2 id="log-heading">最近事件</h2>
          <div className="settings-log">
            {logs.length === 0 ? (
              <p>暂无事件</p>
            ) : (
              logs.map((log) => (
                <div className="settings-log__row" key={`${log.sequence}-${log.timestamp_ms}`}>
                  <span>{statusDefinitions[log.state].label}</span>
                  <span>{log.message || log.source}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

interface EffectPanelProps {
  event: AgentStatusEvent;
  lightSettings: LightSettings;
  selectedLightState: AgentState;
  onTrigger: (state: AgentState) => void;
  onPreviewLightState: (state: AgentState) => void;
  onUpdateLightState: (state: AgentState, update: Partial<LightSettings[AgentState]>) => void;
  triggerBusy?: boolean;
}

function EffectPanel({
  event,
  lightSettings,
  selectedLightState,
  onTrigger,
  onPreviewLightState,
  onUpdateLightState,
  triggerBusy = false,
}: EffectPanelProps) {
  const previewClick = useGuardedClick(onPreviewLightState, { lockWhileBusy: false });
  const selectedLight = lightSettings[selectedLightState];
  return (
    <div className="settings-body settings-body--effect">
      <section className="settings-section settings-section--states" aria-labelledby="state-test-heading">
        <div className="settings-section__title">
          <h2 id="state-test-heading">状态测试</h2>
          <span className="settings-badge">本地调试</span>
        </div>
        <div className="settings-state-grid">
          {agentStates.map((state) => (
            <button
              className={`settings-state ${event.state === state ? "is-active" : ""}`}
              key={state}
              type="button"
              disabled={triggerBusy}
              onClick={() => onTrigger(state)}
            >
              <span
                className="settings-state__swatch"
                style={{ backgroundColor: lightSettings[state].color, color: lightSettings[state].color }}
                aria-hidden="true"
              />
              <span>{statusDefinitions[state].label}</span>
              <small>{statusDefinitions[state].description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section settings-section--light" aria-labelledby="light-settings-heading">
        <div className="settings-section__title">
          <h2 id="light-settings-heading">灯光</h2>
          <span className="settings-badge">ESP32 RGB</span>
        </div>
        <div className="settings-light-layout">
          <div className="settings-light-states" role="tablist" aria-label="灯光状态">
            {agentStates.map((state) => (
              <button
                className={selectedLightState === state ? "is-active" : ""}
                key={state}
                type="button"
                disabled={previewClick.busy}
                onClick={() => previewClick.onClick(state)}
              >
                <span
                  className="settings-light-states__swatch"
                  style={{ backgroundColor: lightSettings[state].color, color: lightSettings[state].color }}
                  aria-hidden="true"
                />
                {statusDefinitions[state].label}
              </button>
            ))}
          </div>
          <div className="settings-light-controls">
            <label className="settings-color-field">
              <span>颜色</span>
              <input
                type="color"
                value={selectedLight.color}
                onChange={(event) => onUpdateLightState(selectedLightState, { color: event.target.value })}
              />
              <strong>{selectedLight.color.toUpperCase()}</strong>
            </label>
            <label className="settings-range-field">
              <span>亮度</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={selectedLight.brightness}
                onChange={(event) =>
                  onUpdateLightState(selectedLightState, { brightness: Number(event.target.value) })
                }
              />
              <strong>{selectedLight.brightness}%</strong>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

interface HardwarePanelProps {
  hardwareStatus: HardwareStatusSnapshot | null;
  event: AgentStatusEvent;
  onTrigger: (state: AgentState, message?: string) => void;
  onProbeHardware: () => Promise<void>;
  triggerBusy?: boolean;
  probeBusy?: boolean;
}

function HardwarePanel({
  hardwareStatus,
  event,
  onTrigger,
  onProbeHardware,
  triggerBusy = false,
  probeBusy = false,
}: HardwarePanelProps) {
  const hardwareStateLabel = formatHardwareState(hardwareStatus);
  const isOnline = Boolean(hardwareStatus?.enabled && hardwareStatus.connected);
  const availablePorts = hardwareStatus?.available_ports ?? [];
  const troubleshooting = formatHardwareTroubleshooting(hardwareStatus);

  return (
    <div className="settings-body settings-body--hardware">
      <section
        className={`hardware-connect ${isOnline ? "hardware-connect--online" : "hardware-connect--offline"}`}
        aria-labelledby="hardware-status-heading"
      >
        <div className="hardware-connect__pulse-wrap" aria-hidden="true">
          <span className="hardware-connect__pulse" />
          <span className="hardware-connect__core" />
        </div>
        <div className="hardware-connect__main">
          <div className="hardware-connect__title">
            <h2 id="hardware-status-heading">ESP32 RGB</h2>
            <span className="hardware-connect__badge">{hardwareStateLabel}</span>
          </div>
          <p className="hardware-connect__detail">{formatHardwareDetail(hardwareStatus)}</p>
        </div>
        <div className="hardware-connect__meta">
          <span>串口</span>
          <strong>{hardwareStatus?.port ?? (availablePorts[0] ?? "--")}</strong>
        </div>
      </section>

      {!isOnline ? (
        <section className="settings-section" aria-labelledby="hardware-troubleshoot-heading">
          <div className="settings-section__title">
            <h2 id="hardware-troubleshoot-heading">连接排查</h2>
            <button
              className="settings-badge"
              type="button"
              disabled={probeBusy}
              onClick={() => void onProbeHardware()}
            >
              {probeBusy ? "检测中" : "重新检测"}
            </button>
          </div>
          <p className="hardware-connect__detail">{troubleshooting.summary}</p>
          <dl className="hardware-specs">
            <div className="hardware-specs__item">
              <dt>系统可见串口</dt>
              <dd>{troubleshooting.portsLabel}</dd>
            </div>
            <div className="hardware-specs__item">
              <dt>指定端口</dt>
              <dd>{troubleshooting.envHint}</dd>
            </div>
          </dl>
          <ul className="hardware-connect__detail" style={{ margin: "10px 0 0", paddingLeft: "18px" }}>
            {troubleshooting.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>
      ) : (
        <dl className="hardware-specs" aria-label="硬件参数">
          <div className="hardware-specs__item">
            <dt>协议</dt>
            <dd>{hardwareStatus?.protocol ?? "--"}</dd>
          </div>
          <div className="hardware-specs__item">
            <dt>固件</dt>
            <dd>{hardwareStatus?.firmware_version ? `fw ${hardwareStatus.firmware_version}` : "等待握手"}</dd>
          </div>
          <div className="hardware-specs__item">
            <dt>波特率</dt>
            <dd>{hardwareStatus?.baud ? `${hardwareStatus.baud}` : "115200"}</dd>
          </div>
          <div className="hardware-specs__item">
            <dt>最后状态</dt>
            <dd>
              {hardwareStatus?.last_state ? statusDefinitions[hardwareStatus.last_state].label : "--"}
            </dd>
          </div>
        </dl>
      )}

      <section className="settings-section settings-section--rgb-lane" aria-labelledby="hardware-test-heading">
        <div className="settings-section__title">
          <h2 id="hardware-test-heading">RGB 纯色测试</h2>
          <span className="settings-badge">出厂检验</span>
        </div>
        <div className="hardware-rgb-lane">
          {agentStates.map((state) => (
            <button
              className={`hardware-rgb-lane__chip ${event.state === state ? "is-active" : ""}`}
              key={state}
              type="button"
              disabled={triggerBusy}
              style={{ "--state-color": defaultPalette[state] } as CSSProperties}
              onClick={() => onTrigger(state)}
            >
              <span
                className="hardware-rgb-lane__orb"
                style={{ backgroundColor: defaultPalette[state], color: defaultPalette[state] }}
                aria-hidden="true"
              />
              <span className="hardware-rgb-lane__label">{statusDefinitions[state].label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "--";
}

function formatCpuCores(metrics: SystemMetrics | null): string {
  return metrics?.logical_cpus ? `${metrics.logical_cpus} 逻辑核心` : "等待 CPU 数据";
}

function formatMemory(metrics: SystemMetrics | null): string {
  if (!metrics?.memory_used_bytes || !metrics.memory_total_bytes) {
    return "等待内存数据";
  }

  return `${formatBytes(metrics.memory_used_bytes)} / ${formatBytes(metrics.memory_total_bytes)}`;
}

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024;
  return `${gib.toFixed(1)} GB`;
}

function formatUptime(seconds: number | null | undefined): string {
  if (!seconds) {
    return "--";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) {
    return `${days}天 ${hours}小时`;
  }
  return `${hours}小时`;
}

function formatTokens(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "--";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return `${value}`;
}

function formatWorkspaceId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatSyncDetail(session: CloudSession, status: CloudSyncStatus): string {
  if (status.lastSyncedAtMs) {
    const seconds = Math.max(0, Math.floor((Date.now() - status.lastSyncedAtMs) / 1000));
    return seconds < 60 ? `${seconds} 秒前同步` : `${Math.floor(seconds / 60)} 分钟前同步`;
  }
  return `${session.server_url} / ${formatWorkspaceId(session.workspace_id)}`;
}

function formatHardwareState(snapshot: HardwareStatusSnapshot | null): string {
  if (!snapshot) {
    return "检查中";
  }
  if (!snapshot.enabled) {
    return "已关闭";
  }
  return snapshot.connected ? "已连接" : "未连接";
}

function formatHardwareDetail(snapshot: HardwareStatusSnapshot | null): string {
  if (!snapshot) {
    return "正在读取硬件状态";
  }
  if (!snapshot.enabled) {
    return "AGENT_LIGHT_HARDWARE 已关闭";
  }
  if (snapshot.connected) {
    const port = snapshot.port || snapshot.available_ports[0] || "自动发现串口";
    const state = snapshot.last_state ? statusDefinitions[snapshot.last_state].label : "等待状态写入";
    const firmware = snapshot.firmware_version ? ` / fw ${snapshot.firmware_version}` : "";
    return `${port} / ${snapshot.baud} baud / ${state}${firmware}`;
  }
  if (snapshot.last_error) {
    return snapshot.last_error;
  }
  if (snapshot.available_ports.length > 0) {
    return `发现串口 ${snapshot.available_ports.join("、")}，等待握手`;
  }
  return "等待 ESP32 插入或驱动就绪";
}

function formatHardwareTroubleshooting(snapshot: HardwareStatusSnapshot | null) {
  const ports = snapshot?.available_ports ?? [];
  const portsLabel = ports.length > 0 ? ports.join("、") : "无（系统未枚举到任何 COM 口）";
  const envHint =
    ports.length > 0
      ? `$env:AGENT_LIGHT_SERIAL_PORT="${ports[0]}"`
      : `$env:AGENT_LIGHT_SERIAL_PORT="COM5"`;

  const summary =
    snapshot?.last_error ??
    (ports.length > 0
      ? `已发现 ${ports.length} 个串口，但尚未与 ESP32 握手成功。`
      : "未检测到 USB 串口，请先确认硬件与驱动。");

  const steps =
    ports.length > 0
      ? [
          "在设备管理器确认 ESP32 对应哪一个 COM 号",
          `若自动连接失败，在 PowerShell 执行：${envHint}`,
          "设置环境变量后重启 Agent Light",
          "确认没有 Arduino 串口监视器等程序占用端口",
        ]
      : [
          "检查 USB 数据线是否支持数据传输（有些线只能充电）",
          "打开设备管理器，查看「端口 (COM 和 LPT)」是否出现新设备",
          "若显示未知设备或黄色叹号，安装 CP210x 或 CH340 驱动后重插",
          `驱动就绪后，可用 PowerShell 指定端口：${envHint}`,
        ];

  return { summary, portsLabel, envHint, steps };
}
