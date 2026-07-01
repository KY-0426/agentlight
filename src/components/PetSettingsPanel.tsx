import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { formatTokenCount, USER_DISPLAY_NAME_MAX_LENGTH } from "@agent-light/shared";
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
  AgentProvider,
  TokenLeaderboardResponse,
  LeaderboardTimePeriod,
} from "../tauriClient";
import { agentStates, defaultPalette, statusDefinitions } from "../domain/status";
import { pickActiveAiToolLabel, pickActiveAiToolName } from "../domain/agentMonitor";
import { aiToolAccent, isAiToolId } from "../domain/aiTools";
import {
  agentProviderLabels,
  agentProviderOrder,
  resolveDefaultCloudServerUrl,
  loadActivationRecord,
  getActivationStatus,
  openActivationWindow,
  resolveActivationServerUrl,
  isDeviceCloudAccount,
  leaderboardTimePeriodLabels,
  leaderboardTimePeriodOrder,
  listenForSettingsPage,
} from "../tauriClient";

type SettingsPage =
  | "overview"
  | "assistants"
  | "leaderboard"
  | "account"
  | "preferences"
  | "effect"
  | "hardware";

const DISPLAY_NAV: { page: SettingsPage; label: string; hint: string }[] = [
  { page: "overview", label: "概览", hint: "当前状态" },
  { page: "assistants", label: "AI 助手", hint: "连接与用量" },
  { page: "leaderboard", label: "排行榜", hint: "用量排名" },
];

const SETTINGS_NAV: { page: SettingsPage; label: string; hint: string }[] = [
  { page: "account", label: "账号", hint: "同步与绑定" },
  { page: "preferences", label: "偏好", hint: "窗口与启动" },
  { page: "effect", label: "灯效", hint: "颜色与亮度" },
  { page: "hardware", label: "硬件", hint: "灯盒连接" },
];

const DISPLAY_PAGES = new Set<SettingsPage>(["overview", "assistants", "leaderboard"]);

function normalizeSettingsPage(page: SettingsPageTarget): SettingsPage {
  if (page === "device") {
    return "preferences";
  }
  if (
    page === "overview" ||
    page === "assistants" ||
    page === "leaderboard" ||
    page === "account" ||
    page === "preferences" ||
    page === "effect" ||
    page === "hardware"
  ) {
    return page;
  }
  return "overview";
}

function isDisplayPage(page: SettingsPage): boolean {
  return DISPLAY_PAGES.has(page);
}

function findNavItem(page: SettingsPage) {
  return DISPLAY_NAV.find((item) => item.page === page) ?? SETTINGS_NAV.find((item) => item.page === page);
}

const IS_DEV_BUILD = import.meta.env.DEV;
type LeaderboardStatus = "idle" | "loading" | "ready" | "error";
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
  aiToolTokens: AiToolTokenUsage[];
  aiToolLoading: boolean;
  onRefreshAiTools: () => Promise<void>;
  hardwareStatus: HardwareStatusSnapshot | null;
  cloudSession: CloudSession | null;
  cloudSyncStatus: CloudSyncStatus;
  leaderboard: TokenLeaderboardResponse | null;
  leaderboardAgentProvider: AgentProvider;
  leaderboardTimePeriod: LeaderboardTimePeriod;
  leaderboardStatus: LeaderboardStatus;
  leaderboardError: string | null;
  onClose: () => void;
  onAlwaysOnTopChange: (enabled: boolean) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onLightSettingsChange: (settings: LightSettings) => void;
  onCloudLogin: (request: CloudPhoneLoginRequest) => Promise<void>;
  onCloudConnect: (serverUrl: string) => Promise<void>;
  onCloudSendPhoneCode: (request: CloudPhoneCodeRequest) => Promise<CloudPhoneCodeResponse>;
  onCloudRenameDisplayName: (displayName: string) => Promise<void>;
  onCloudLogout: () => Promise<void>;
  onRefreshLeaderboard: () => Promise<void>;
  onLeaderboardAgentChange: (agentProvider: AgentProvider) => Promise<void>;
  onLeaderboardTimePeriodChange: (timePeriod: LeaderboardTimePeriod) => Promise<void>;
  onProbeHardware: () => Promise<void>;
  onTrigger: (state: AgentState) => void;
  onExitApp: () => void;
}

export function PetSettingsPanel({
  event,
  alwaysOnTop,
  launchAtLogin,
  lightSettings,
  aiToolTokens,
  aiToolLoading,
  onRefreshAiTools,
  hardwareStatus,
  cloudSession,
  cloudSyncStatus,
  leaderboard,
  leaderboardAgentProvider,
  leaderboardTimePeriod,
  leaderboardStatus,
  leaderboardError,
  onClose,
  onAlwaysOnTopChange,
  onLaunchAtLoginChange,
  onLightSettingsChange,
  onCloudLogin,
  onCloudConnect,
  onCloudSendPhoneCode,
  onCloudRenameDisplayName,
  onCloudLogout,
  onRefreshLeaderboard,
  onLeaderboardAgentChange,
  onLeaderboardTimePeriodChange,
  onProbeHardware,
  onTrigger,
  onExitApp,
}: PetSettingsPanelProps) {
  const [activePage, setActivePage] = useState<SettingsPage>("overview");
  const [selectedLightState, setSelectedLightState] = useState<AgentState>(event.state);
  const currentDefinition = statusDefinitions[event.state];
  const currentMessage = event.message || currentDefinition.description;

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;

    listenForSettingsPage((page) => setActivePage(normalizeSettingsPage(page)))
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

  const activeNav = findNavItem(activePage) ?? DISPLAY_NAV[0];
  const activeAiToolName = pickActiveAiToolName(aiToolTokens);
  const showingDisplay = isDisplayPage(activePage);

  return (
    <main className={`settings-shell settings-shell--${event.state}`}>
      <div className="settings-app" aria-label="Agent Light 控制台">
        <aside className="settings-sidebar">
          <div className="settings-sidebar__brand" data-tauri-drag-region>
            <img className="settings-sidebar__logo" src="/assets/app-logo.png" alt="" aria-hidden="true" />
            <div className="settings-sidebar__brand-copy">
              <strong>Agent Light</strong>
              <span>桌宠</span>
            </div>
          </div>

          <nav className="settings-sidebar__nav" aria-label="页面导航">
            <p className="settings-sidebar__group-label">展示</p>
            {DISPLAY_NAV.map((item) => (
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
            <p className="settings-sidebar__group-label">设置</p>
            {SETTINGS_NAV.map((item) => (
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
          <header
            className={`settings-main__top ${showingDisplay ? "settings-main__top--display" : "settings-main__top--config"}`}
            data-tauri-drag-region
          >
            <div className="settings-main__heading">
              <p>{showingDisplay ? "展示" : "设置"} · {activeNav.hint}</p>
              <h1>{activeNav.label}</h1>
            </div>
            {showingDisplay ? (
              <StatusStrip
                state={event.state}
                stateLabel={currentDefinition.label}
                message={currentMessage}
                aiToolLabel={activeAiToolName}
                hardwareLabel={formatHardwareState(hardwareStatus)}
              />
            ) : null}
          </header>

          <div className="settings-main__body">
            {activePage === "overview" ? (
              <OverviewPanel
                aiToolTokens={aiToolTokens}
                hardwareStatus={hardwareStatus}
                cloudSession={cloudSession}
                cloudSyncStatus={cloudSyncStatus}
                onNavigate={(page) => tabClick.onClick(page)}
              />
            ) : activePage === "assistants" ? (
              <AssistantsPanel
                aiToolTokens={aiToolTokens}
                aiToolLoading={aiToolLoading}
                onRefreshAiTools={onRefreshAiTools}
                onOpenPreferences={() => tabClick.onClick("preferences")}
              />
            ) : activePage === "account" ? (
              <AccountPanel
                cloudSession={cloudSession}
                cloudSyncStatus={cloudSyncStatus}
                onConnectCloud={onCloudConnect}
                onBindPhone={onCloudLogin}
                onLogout={onCloudLogout}
                onSendPhoneCode={onCloudSendPhoneCode}
                onRenameDisplayName={onCloudRenameDisplayName}
              />
            ) : activePage === "leaderboard" ? (
              <LeaderboardPanel
                status={leaderboardStatus}
                error={leaderboardError}
                agentProvider={leaderboardAgentProvider}
                timePeriod={leaderboardTimePeriod}
                data={leaderboard}
                cloudSession={cloudSession}
                onRefresh={onRefreshLeaderboard}
                onAgentProviderChange={onLeaderboardAgentChange}
                onTimePeriodChange={onLeaderboardTimePeriodChange}
              />
            ) : activePage === "preferences" ? (
              <PreferencesPanel
                alwaysOnTop={alwaysOnTop}
                launchAtLogin={launchAtLogin}
                onAlwaysOnTopChange={onAlwaysOnTopChange}
                onLaunchAtLoginChange={onLaunchAtLoginChange}
                onExitApp={onExitApp}
              />
            ) : activePage === "effect" ? (
              <EffectPanel
                lightSettings={lightSettings}
                selectedLightState={selectedLightState}
                onPreviewLightState={previewLightState}
                onUpdateLightState={updateLightState}
              />
            ) : (
              <HardwarePanel
                hardwareStatus={hardwareStatus}
                onProbeHardware={async () => {
                  probeClick.onClick();
                }}
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
  hardwareLabel,
}: {
  state: AgentState;
  stateLabel: string;
  message: string;
  aiToolLabel: string;
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
          <span>AI 助手</span>
          <strong>{aiToolLabel}</strong>
        </article>
        <article>
          <span>灯盒</span>
          <strong>{hardwareLabel}</strong>
        </article>
      </div>
    </div>
  );
}

function OverviewPanel({
  aiToolTokens,
  hardwareStatus,
  cloudSession,
  cloudSyncStatus,
  onNavigate,
}: {
  aiToolTokens: AiToolTokenUsage[];
  hardwareStatus: HardwareStatusSnapshot | null;
  cloudSession: CloudSession | null;
  cloudSyncStatus: CloudSyncStatus;
  onNavigate: (page: SettingsPage) => void;
}) {
  const activeTool = pickActiveAiToolLabel(aiToolTokens);
  const configuredTools = aiToolTokens.filter((tool) => tool.configured).length;

  return (
    <div className="settings-body settings-body--overview">
      <div className="overview-cards">
        <article className="overview-card">
          <span>AI 助手</span>
          <strong>{activeTool}</strong>
          <small>{configuredTools > 0 ? `已连接 ${configuredTools} 个` : "尚未连接 AI 编程助手"}</small>
          <button className="overview-card__link" type="button" onClick={() => onNavigate("assistants")}>
            查看详情
          </button>
        </article>
        <article className="overview-card">
          <span>RGB 灯盒</span>
          <strong>{formatHardwareState(hardwareStatus)}</strong>
          <small>{formatHardwareDetail(hardwareStatus)}</small>
          <button className="overview-card__link" type="button" onClick={() => onNavigate("hardware")}>
            硬件设置
          </button>
        </article>
        <article className="overview-card">
          <span>云端同步</span>
          <strong>{cloudSession ? (cloudSyncStatus.state === "error" ? "异常" : "已开启") : "未开启"}</strong>
          <small>
            {cloudSession
              ? formatSyncDetail(cloudSession, cloudSyncStatus)
              : "开启后可同步用量并参与排行榜"}
          </small>
          <button className="overview-card__link" type="button" onClick={() => onNavigate("account")}>
            账号设置
          </button>
        </article>
      </div>

      {cloudSession ? (
        <SyncStatusBar cloudSession={cloudSession} cloudSyncStatus={cloudSyncStatus} />
      ) : null}
    </div>
  );
}

function AssistantsPanel({
  aiToolTokens,
  aiToolLoading,
  onRefreshAiTools,
  onOpenPreferences,
}: {
  aiToolTokens: AiToolTokenUsage[];
  aiToolLoading: boolean;
  onRefreshAiTools: () => Promise<void>;
  onOpenPreferences: () => void;
}) {
  const [aiToolModalOpen, setAiToolModalOpen] = useState(false);
  const manageToolsClick = useGuardedClick(() => setAiToolModalOpen(true), { lockWhileBusy: false });

  return (
    <div className="settings-body settings-body--assistants">
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
      <p className="leaderboard-note">
        需要调整窗口置顶或开机启动？
        <button className="overview-card__link overview-card__link--inline" type="button" onClick={onOpenPreferences}>
          前往偏好设置
        </button>
      </p>
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
  cloudSyncStatus: CloudSyncStatus;
  onConnectCloud: (serverUrl: string) => Promise<void>;
  onBindPhone: (request: CloudPhoneLoginRequest) => Promise<void>;
  onLogout: () => Promise<void>;
  onSendPhoneCode: (request: CloudPhoneCodeRequest) => Promise<CloudPhoneCodeResponse>;
  onRenameDisplayName: (displayName: string) => Promise<void>;
}

function AccountPanel({
  cloudSession,
  cloudSyncStatus,
  onConnectCloud,
  onBindPhone,
  onLogout,
  onSendPhoneCode,
  onRenameDisplayName,
}: AccountPanelProps) {
  const logoutClick = useGuardedClick(onLogout);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingName) {
      setDraftName(cloudSession?.display_name ?? "");
      setNameError(null);
    }
  }, [cloudSession?.display_name, editingName]);

  if (!cloudSession) {
    return <CloudConnectPanel onConnectCloud={onConnectCloud} />;
  }

  async function saveDisplayName() {
    if (!cloudSession) {
      return;
    }

    const nextName = draftName.trim();
    if (!nextName) {
      setNameError("用户名不能为空");
      return;
    }
    if (nextName.length > USER_DISPLAY_NAME_MAX_LENGTH) {
      setNameError(`用户名不能超过 ${USER_DISPLAY_NAME_MAX_LENGTH} 个字符`);
      return;
    }
    if (nextName === cloudSession.display_name) {
      setEditingName(false);
      setNameError(null);
      return;
    }

    setSavingName(true);
    setNameError(null);
    try {
      await onRenameDisplayName(nextName);
      setEditingName(false);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "用户名更新失败");
    } finally {
      setSavingName(false);
    }
  }

  const deviceAccount = isDeviceCloudAccount(cloudSession);
  return (
    <div className="settings-body settings-body--account">
      <section className="settings-section" aria-labelledby="account-session-heading">
        <div className="settings-section__title">
          <h2 id="account-session-heading">{deviceAccount ? "我的账户" : "已登录"}</h2>
          <span className="settings-badge">{deviceAccount ? "激活账户" : "已绑定手机"}</span>
        </div>
        <div className="account-session-grid">
          <div className="account-session-grid__row">
            <article className="account-card">
              <span>用户名</span>
              {editingName ? (
                <form
                  className="account-name-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveDisplayName();
                  }}
                >
                  <input
                    type="text"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    autoComplete="nickname"
                    maxLength={USER_DISPLAY_NAME_MAX_LENGTH}
                    disabled={savingName}
                    autoFocus
                  />
                  <div className="account-name-form__actions">
                    <button type="submit" disabled={savingName}>
                      {savingName ? "保存中" : "保存"}
                    </button>
                    <button type="button" disabled={savingName} onClick={() => setEditingName(false)}>
                      取消
                    </button>
                  </div>
                  {nameError ? <p className="leaderboard-error">{nameError}</p> : null}
                </form>
              ) : (
                <>
                  <strong>{formatFriendlyDisplayName(cloudSession.display_name)}</strong>
                  <button className="overview-card__link overview-card__link--inline" type="button" onClick={() => setEditingName(true)}>
                    修改用户名
                  </button>
                </>
              )}
              <small>
                {cloudSession.user_phone_number ??
                  (deviceAccount ? "一码一账户，用户名可在云端持久保存" : cloudSession.user_email)}
              </small>
            </article>
            <article className="account-card">
              <span>云端同步</span>
              <strong>{cloudSyncStatus.state === "error" ? "异常" : "已开启"}</strong>
              <small>{formatSyncDetail(cloudSession, cloudSyncStatus)}</small>
            </article>
          </div>
          <article className="account-card account-card--server">
            <span>服务端</span>
            <strong className="account-card__url">{formatServerUrl(cloudSession.server_url)}</strong>
            <small>更换地址请先断开云端同步，再重新连接</small>
          </article>
          {IS_DEV_BUILD ? (
            <article className="account-card">
              <span>工作空间</span>
              <strong>{formatWorkspaceId(cloudSession.workspace_id)}</strong>
              <small>仅开发模式可见</small>
            </article>
          ) : null}
          <div className="account-session-grid__actions">
            <button
              className="leaderboard-refresh"
              type="button"
              onClick={() => logoutClick.onClick()}
              disabled={logoutClick.busy}
            >
              {deviceAccount ? "断开云端同步" : "退出登录"}
            </button>
          </div>
        </div>
      </section>

      {deviceAccount ? (
        <PhoneBindPanel
          serverUrl={cloudSession.server_url}
          onBindPhone={onBindPhone}
          onSendPhoneCode={onSendPhoneCode}
        />
      ) : null}
    </div>
  );
}

function CloudConnectPanel({
  onConnectCloud,
}: {
  onConnectCloud: (serverUrl: string) => Promise<void>;
}) {
  const [serverUrl, setServerUrl] = useState(resolveDefaultCloudServerUrl);
  const [showDevOptions, setShowDevOptions] = useState(false);
  const [connectStatus, setConnectStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isActivatedLocally, setIsActivatedLocally] = useState<boolean | null>(null);
  const [hasActivationRecord, setHasActivationRecord] = useState(false);

  useEffect(() => {
    void (async () => {
      const [activated, record] = await Promise.all([getActivationStatus(), loadActivationRecord()]);
      setIsActivatedLocally(activated);
      setHasActivationRecord(Boolean(record?.receipt));
      const fromActivation = record?.server_url?.trim();
      if (fromActivation) {
        setServerUrl(fromActivation);
      }
    })();
  }, []);

  const openActivationClick = useGuardedClick(async () => {
    setConnectError(null);
    try {
      await openActivationWindow();
    } catch (error) {
      setConnectStatus("error");
      setConnectError(error instanceof Error ? error.message : "无法打开激活窗口");
    }
  });

  const connectClick = useGuardedClick(async () => {
    setConnectStatus("submitting");
    setConnectError(null);
    try {
      const activated = await getActivationStatus();
      const record = await loadActivationRecord();
      setHasActivationRecord(Boolean(record?.receipt));
      if (!record?.receipt) {
        setConnectStatus("error");
        setConnectError(
          activated
            ? "开发模式已跳过本地激活检查，云端同步仍需输入激活码完成联网校验"
            : "请先完成激活，再开启云端同步",
        );
        return;
      }
      const resolvedUrl = await resolveActivationServerUrl(serverUrl);
      await onConnectCloud(resolvedUrl);
      setConnectStatus("idle");
    } catch (error) {
      setConnectStatus("error");
      const record = await loadActivationRecord();
      setHasActivationRecord(Boolean(record?.receipt));
      setConnectError(formatCloudConnectError(error, Boolean(record?.receipt)));
    }
  });

  const isConnecting = connectStatus === "submitting" || connectClick.busy;
  const showReactivate =
    isActivatedLocally === false ||
    !hasActivationRecord ||
    (connectStatus === "error" && connectError !== null && isActivationRecoveryHint(connectError));

  return (
    <div className="settings-body settings-body--connect">
      <section className="settings-section cloud-connect-panel" aria-labelledby="cloud-connect-heading">
        <div className="settings-section__title">
          <h2 id="cloud-connect-heading">云端同步</h2>
        </div>
        <p className="cloud-connect-panel__intro">
          开启后 AI 用量会自动同步，并参与排行榜。将自动连接你激活时使用的线上服务；桌宠本地功能无需联网。
        </p>
        <div className="leaderboard-form">
          <button
            className="leaderboard-refresh"
            type="button"
            disabled={isConnecting}
            onClick={() => connectClick.onClick()}
          >
            {isConnecting ? "连接中…" : "开启云端同步"}
          </button>
          {connectStatus === "error" && connectError ? (
            <p className="leaderboard-error">{connectError}</p>
          ) : null}
          {showReactivate ? (
            <button
              className="leaderboard-refresh leaderboard-refresh--secondary"
              type="button"
              disabled={openActivationClick.busy}
              onClick={() => openActivationClick.onClick()}
            >
              {openActivationClick.busy ? "打开中…" : "重新激活"}
            </button>
          ) : null}
          {IS_DEV_BUILD ? (
            <div className="cloud-connect-panel__help">
              <button
                className="leaderboard-refresh leaderboard-refresh--secondary"
                type="button"
                onClick={() => setShowDevOptions((current) => !current)}
              >
                {showDevOptions ? "收起开发者选项" : "开发者选项"}
              </button>
              {showDevOptions ? (
                <>
                  <label className="leaderboard-field">
                    <span>服务端地址（仅本地调试）</span>
                    <input
                      type="url"
                      value={serverUrl}
                      onChange={(event) => setServerUrl(event.target.value)}
                      placeholder={resolveDefaultCloudServerUrl()}
                      autoComplete="url"
                      spellCheck={false}
                    />
                  </label>
                  <p className="leaderboard-note">已激活用户会优先使用激活记录中的地址，此处仅作无激活记录时的兜底。</p>
                  <p className="leaderboard-note">本地开发请先启动服务：</p>
                  <pre className="cloud-connect-panel__commands">npm run server:dev</pre>
                  <p className="leaderboard-note">若使用 PostgreSQL，还需：</p>
                  <pre className="cloud-connect-panel__commands">docker compose up -d postgres</pre>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PhoneBindPanel({
  serverUrl,
  onBindPhone,
  onSendPhoneCode,
}: {
  serverUrl: string;
  onBindPhone: (request: CloudPhoneLoginRequest) => Promise<void>;
  onSendPhoneCode: (request: CloudPhoneCodeRequest) => Promise<CloudPhoneCodeResponse>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bindStatus, setBindStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [codeStatus, setCodeStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [bindError, setBindError] = useState<string | null>(null);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);

  const sendCodeClick = useGuardedClick(async () => {
    setCodeStatus("submitting");
    setBindError(null);
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

  async function submitBind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBindStatus("submitting");
    setBindError(null);
    try {
      await onBindPhone({ serverUrl, phoneNumber, verificationCode, displayName });
      setVerificationCode("");
      setBindStatus("idle");
    } catch (error) {
      setBindStatus("error");
      setBindError(error instanceof Error ? error.message : "手机号绑定失败");
    }
  }

  return (
    <section className="settings-section phone-bind-panel" aria-labelledby="phone-bind-heading">
      <div className="settings-section__title">
        <h2 id="phone-bind-heading">绑定手机号</h2>
        <span className="settings-badge">可选</span>
      </div>
      <p className="leaderboard-note">绑定手机号后，可在多台设备间合并账户与用量数据。</p>
      <button
        className="leaderboard-refresh leaderboard-refresh--secondary"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "收起" : "展开绑定表单"}
      </button>
      {expanded ? (
        <form className="leaderboard-form" onSubmit={(event) => void submitBind(event)}>
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
              placeholder="可选"
              maxLength={USER_DISPLAY_NAME_MAX_LENGTH}
            />
          </label>
          <button className="leaderboard-refresh" type="submit" disabled={bindStatus === "submitting"}>
            {bindStatus === "submitting" ? "绑定中" : "绑定手机号"}
          </button>
          {codeMessage ? <p className={codeStatus === "error" ? "leaderboard-error" : "leaderboard-note"}>{codeMessage}</p> : null}
          {bindStatus === "error" ? <p className="leaderboard-error">{bindError}</p> : null}
        </form>
      ) : null}
    </section>
  );
}

interface LeaderboardPanelProps {
  status: LeaderboardStatus;
  error: string | null;
  agentProvider: AgentProvider;
  timePeriod: LeaderboardTimePeriod;
  data: TokenLeaderboardResponse | null;
  cloudSession: CloudSession | null;
  onRefresh: () => Promise<void>;
  onAgentProviderChange: (agentProvider: AgentProvider) => Promise<void>;
  onTimePeriodChange: (timePeriod: LeaderboardTimePeriod) => Promise<void>;
}

function LeaderboardPanel({
  status,
  error,
  agentProvider,
  timePeriod,
  data,
  cloudSession,
  onRefresh,
  onAgentProviderChange,
  onTimePeriodChange,
}: LeaderboardPanelProps) {
  const activeProvider = data?.agent_provider ?? agentProvider;
  const agentLabel = agentProviderLabels[activeProvider];
  const periodLabel = leaderboardTimePeriodLabels[timePeriod];
  const refreshClick = useGuardedClick(onRefresh);
  const agentSwitchClick = useGuardedClick(onAgentProviderChange);
  const periodSwitchClick = useGuardedClick(onTimePeriodChange);
  const isLoading = status === "loading" || refreshClick.busy;
  const selfUserId = cloudSession?.user_id ?? null;
  const selfEntry = data?.entries.find((entry) => entry.user_id === selfUserId) ?? null;
  const maxTokens = data?.entries.reduce((peak, entry) => Math.max(peak, entry.tokens_used), 0) ?? 0;
  const accent = resolveLeaderboardAccent(activeProvider);

  return (
    <div className="settings-body settings-body--leaderboard">
      <section className="settings-section leaderboard-panel" aria-labelledby="leaderboard-heading">
        <div className="settings-section__title">
          <div>
            <h2 id="leaderboard-heading">用量排行榜</h2>
            <p className="settings-section__hint">
              {agentLabel} · {periodLabel} · 全员 Token 排名
            </p>
          </div>
          <div className="settings-section__actions">
            <button
              className="settings-inline-button"
              type="button"
              disabled={isLoading || agentSwitchClick.busy || periodSwitchClick.busy}
              onClick={() => refreshClick.onClick()}
            >
              {isLoading ? "读取中…" : "刷新"}
            </button>
          </div>
        </div>

        <div
          className="leaderboard-hero"
          style={{ "--leaderboard-accent": accent } as CSSProperties}
          aria-label="我的排名摘要"
        >
          <div className="leaderboard-hero__rank">
            <span>我的排名</span>
            <strong>{data?.current_user_rank ? `#${data.current_user_rank}` : "—"}</strong>
            <small>{selfEntry ? `用量 ${formatTokenCount(selfEntry.tokens_used)}` : "登录并同步后可显示个人排名"}</small>
          </div>
          <div className="leaderboard-hero__stats">
            <article>
              <span>{timePeriod === "total" ? "榜单累计" : "区间累计"}</span>
              <strong>{data ? formatTokenCount(data.total_tokens) : "—"}</strong>
            </article>
            <article>
              <span>上榜人数</span>
              <strong>{data ? `${data.entries.length}` : "—"}</strong>
            </article>
            <article className="leaderboard-hero__stats-highlight">
              <span>当前工具</span>
              <strong>{agentLabel}</strong>
            </article>
          </div>
        </div>

        <div className="leaderboard-toolbar">
          <div className="leaderboard-agent-switch" role="tablist" aria-label="AI 工具">
            {agentProviderOrder.map((provider) => (
              <button
                className={agentProvider === provider ? "is-active" : ""}
                type="button"
                key={provider}
                disabled={agentSwitchClick.busy || periodSwitchClick.busy}
                onClick={() => agentSwitchClick.onClick(provider)}
              >
                {agentProviderLabels[provider]}
              </button>
            ))}
          </div>

          <div className="leaderboard-period-switch" role="tablist" aria-label="时间范围">
            {leaderboardTimePeriodOrder.map((period) => (
              <button
                className={timePeriod === period ? "is-active" : ""}
                type="button"
                key={period}
                disabled={agentSwitchClick.busy || periodSwitchClick.busy}
                onClick={() => periodSwitchClick.onClick(period)}
              >
                {leaderboardTimePeriodLabels[period]}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`leaderboard-table ${isLoading ? "leaderboard-table--loading" : ""}`}
          role="table"
          aria-label="用量排行榜"
          aria-busy={isLoading}
        >
          <div className="leaderboard-table__head" role="row">
            <span role="columnheader">排名</span>
            <span role="columnheader">成员</span>
            <span role="columnheader">用量</span>
          </div>
          <div className="leaderboard-table__body">
            {isLoading && !data ? (
              Array.from({ length: 5 }, (_, index) => (
                <div className="leaderboard-row leaderboard-row--skeleton" role="row" key={`skeleton-${index}`}>
                  <span className="leaderboard-row__rank" role="cell" />
                  <div className="leaderboard-row__member" role="cell">
                    <span className="leaderboard-row__avatar" aria-hidden="true" />
                    <span className="leaderboard-row__name" />
                  </div>
                  <div className="leaderboard-row__usage" role="cell">
                    <span className="leaderboard-row__tokens" />
                    <span className="leaderboard-row__bar" />
                  </div>
                </div>
              ))
            ) : data && data.entries.length > 0 ? (
              data.entries.map((entry) => {
                const isSelf = entry.user_id === selfUserId;
                const usageRatio = maxTokens > 0 ? Math.max(8, (entry.tokens_used / maxTokens) * 100) : 0;

                return (
                  <div
                    className={[
                      "leaderboard-row",
                      isSelf ? "leaderboard-row--self" : "",
                      entry.rank <= 3 ? `leaderboard-row--top leaderboard-row--top${entry.rank}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="row"
                    key={entry.user_id}
                  >
                    <span className="leaderboard-row__rank" role="cell">
                      {formatLeaderboardRank(entry.rank)}
                    </span>
                    <div className="leaderboard-row__member" role="cell">
                      <span
                        className="leaderboard-row__avatar"
                        style={{ backgroundColor: accent }}
                        aria-hidden="true"
                      >
                        {formatLeaderboardInitials(entry.display_name)}
                      </span>
                      <span className="leaderboard-row__name">
                        <strong>{formatFriendlyDisplayName(entry.display_name)}</strong>
                        {isSelf ? <span className="leaderboard-row__badge">我</span> : null}
                      </span>
                    </div>
                    <div className="leaderboard-row__usage" role="cell">
                      <strong>{formatTokenCount(entry.tokens_used)}</strong>
                      <div className="leaderboard-row__bar" aria-hidden="true">
                        <span style={{ width: `${usageRatio}%`, backgroundColor: accent }} />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="leaderboard-empty" role="row">
                <strong>{status === "error" ? "读取失败" : "暂无排行榜数据"}</strong>
                <span>{status === "error" ? error : "开启云端同步并上报用量后，这里会显示排名。"}</span>
              </div>
            )}
          </div>
        </div>

        {status === "error" && data ? <p className="leaderboard-error">{error}</p> : null}
      </section>
    </div>
  );
}

interface PreferencesPanelProps {
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  onAlwaysOnTopChange: (enabled: boolean) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onExitApp: () => void;
}

function PreferencesPanel({
  alwaysOnTop,
  launchAtLogin,
  onAlwaysOnTopChange,
  onLaunchAtLoginChange,
  onExitApp,
}: PreferencesPanelProps) {
  const exitClick = useGuardedClick(onExitApp);

  return (
    <div className="settings-body settings-body--preferences">
      <section className="settings-section" aria-labelledby="window-heading">
        <div className="settings-section__title">
          <h2 id="window-heading">窗口与启动</h2>
        </div>
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
    </div>
  );
}

interface EffectPanelProps {
  lightSettings: LightSettings;
  selectedLightState: AgentState;
  onPreviewLightState: (state: AgentState) => void;
  onUpdateLightState: (state: AgentState, update: Partial<LightSettings[AgentState]>) => void;
}

function EffectPanel({
  lightSettings,
  selectedLightState,
  onPreviewLightState,
  onUpdateLightState,
}: EffectPanelProps) {
  const previewClick = useGuardedClick(onPreviewLightState, { lockWhileBusy: false });
  const selectedLight = lightSettings[selectedLightState];
  return (
    <div className="settings-body settings-body--effect">
      <section className="settings-section settings-section--light" aria-labelledby="light-settings-heading">
        <div className="settings-section__title">
          <h2 id="light-settings-heading">灯光</h2>
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
  onProbeHardware: () => Promise<void>;
  probeBusy?: boolean;
}

function HardwarePanel({
  hardwareStatus,
  onProbeHardware,
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
            <h2 id="hardware-status-heading">RGB 灯盒</h2>
            <span className="hardware-connect__badge">{hardwareStateLabel}</span>
          </div>
          <p className="hardware-connect__detail">{formatHardwareDetail(hardwareStatus)}</p>
        </div>
        {IS_DEV_BUILD ? (
          <div className="hardware-connect__meta">
            <span>串口</span>
            <strong>{hardwareStatus?.port ?? (availablePorts[0] ?? "--")}</strong>
          </div>
        ) : null}
      </section>

      {!isOnline ? (
        <section className="settings-section" aria-labelledby="hardware-troubleshoot-heading">
          <div className="settings-section__title">
            <h2 id="hardware-troubleshoot-heading">连接帮助</h2>
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
          {IS_DEV_BUILD ? (
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
          ) : null}
          <ul className="hardware-connect__detail" style={{ margin: "10px 0 0", paddingLeft: "18px" }}>
            {troubleshooting.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>
      ) : IS_DEV_BUILD ? (
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
      ) : null}
    </div>
  );
}

function resolveLeaderboardAccent(provider: AgentProvider): string {
  return isAiToolId(provider) ? aiToolAccent[provider] : "#64748b";
}

function formatLeaderboardInitials(name: string): string {
  const trimmed = formatFriendlyDisplayName(name).trim();
  if (!trimmed) {
    return "?";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function formatLeaderboardRank(rank: number): string {
  if (rank === 1) {
    return "1";
  }
  if (rank === 2) {
    return "2";
  }
  if (rank === 3) {
    return "3";
  }
  return `#${rank}`;
}

function formatWorkspaceId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatFriendlyDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "Win32" || trimmed === "Win64") {
    return "本机";
  }
  if (trimmed === "MacIntel") {
    return "Mac 电脑";
  }
  if (/^Linux/i.test(trimmed)) {
    return "Linux 电脑";
  }
  return trimmed;
}

function formatServerUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      return "本地服务";
    }
    return parsed.host;
  } catch {
    return url;
  }
}

function formatSyncDetail(_session: CloudSession, status: CloudSyncStatus): string {
  if (status.lastSyncedAtMs) {
    const seconds = Math.max(0, Math.floor((Date.now() - status.lastSyncedAtMs) / 1000));
    return seconds < 60 ? `${seconds} 秒前同步` : `${Math.floor(seconds / 60)} 分钟前同步`;
  }
  if (status.state === "syncing") {
    return "正在同步…";
  }
  if (status.state === "error") {
    return "同步异常，请稍后重试";
  }
  return "用量会自动上报";
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
    return "正在检测灯盒连接";
  }
  if (!snapshot.enabled) {
    return "硬件灯效未启用";
  }
  if (snapshot.connected) {
    const state = snapshot.last_state ? statusDefinitions[snapshot.last_state].label : "待命中";
    return `灯盒已连接，当前 ${state}`;
  }
  if (snapshot.last_error) {
    return snapshot.last_error;
  }
  if (snapshot.available_ports.length > 0) {
    return "已检测到设备，正在建立连接…";
  }
  return "请用 USB 数据线连接灯盒控制器";
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
      ? "已检测到 USB 设备，但尚未与灯盒建立连接。"
      : "未检测到灯盒，请检查连接与驱动。");

  const userSteps =
    ports.length > 0
      ? [
          "确认灯盒控制器已通过 USB 连接到电脑",
          "关闭可能占用端口的其他程序（如串口监视器）",
          "重新插拔 USB 线后点击「重新检测」",
        ]
      : [
          "检查 USB 数据线是否支持数据传输（有些线只能充电）",
          "打开设备管理器，查看是否出现新的 USB 串口设备",
          "若显示未知设备，请安装 CP210x 或 CH340 驱动后重插",
          "连接成功后点击「重新检测」",
        ];

  const devSteps =
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

  return {
    summary,
    portsLabel,
    envHint,
    steps: IS_DEV_BUILD ? devSteps : userSteps,
  };
}

function isActivationRecoveryHint(message: string): boolean {
  return (
    message.includes("activation_code_required") ||
    message.includes("Device must be activated") ||
    message.includes("云端找不到本机") ||
    message.includes("请先完成激活") ||
    message.includes("联网校验")
  );
}

function formatCloudConnectError(error: unknown, hasActivationRecord: boolean): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.includes("activation_code_required") || message.includes("Device must be activated")) {
      if (hasActivationRecord) {
        return "云端找不到本机激活记录，请点击下方「重新激活」恢复同步";
      }
      return "请先完成激活，再开启云端同步";
    }
    return message || "云端连接失败，请稍后重试";
  }
  return "云端连接失败，请稍后重试";
}
