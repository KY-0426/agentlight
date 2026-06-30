import { useEffect, useRef, useState } from "react";
import { AgentPet } from "./components/AgentPet";
import { ActivationScreen } from "./components/ActivationScreen";
import { HardwareDebugPanel } from "./components/HardwareDebugPanel";
import { PetSettingsPanel } from "./components/PetSettingsPanel";
import { useGuardedClick } from "./hooks/useGuardedClick";
import type { AiToolTokenUsage } from "./domain/aiTools";
import {
  type AgentState,
  type AgentStatusEvent,
  type LightSettings,
  createStatusEvent,
  defaultLightSettings,
  normalizeLightSettings,
  statusDefinitions,
} from "./domain/status";
import {
  getCodexStatus,
  getCursorStatus,
  listAiToolTokenUsages,
  getHardwareStatus,
  probeHardware,
  getTokenLeaderboard,
  getSystemMetrics,
  getStatus,
  getActivationStatus,
  getWindowLabel,
  getMainWindowPlacement,
  isTauriRuntime,
  listenForStatus,
  listenForHardwareStatus,
  loadCloudSession,
  ensureCloudSession,
  connectCloudDevice,
  loginOrRegisterCloud,
  hideSettingsWindow,
  exitApp,
  openSettingsWindow,
  clearCloudSession,
  sendPhoneVerificationCodeCloud,
  updateCloudDisplayName,
  setAgentState,
  setAlwaysOnTop,
  setHardwareLightSettings,
  snapMainWindowToTop,
  startWindowDrag,
  uploadCodexThreadUsage,
  type CloudPhoneLoginRequest,
  type CloudPhoneCodeRequest,
  type CloudPhoneCodeResponse,
  type CloudSession,
  type CodexStatusSnapshot,
  type HardwareStatusSnapshot,
  type SystemMetrics,
  type AgentProvider,
  type LeaderboardTimePeriod,
  type TokenLeaderboardResponse,
  type WindowPlacement,
} from "./tauriClient";

const STORAGE_KEY = "agent-light-config-v1";
const FIXED_MOTION_SPEED = 760;
const AGENT_STATUS_REFRESH_MS = 15_000;
const SYSTEM_METRICS_REFRESH_MS = 30_000;
const MAIN_PLACEMENT_REFRESH_MS = 10_000;
const HARDWARE_REFRESH_MS = 30_000;

interface StoredConfig {
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  lightSettings: LightSettings;
  cloudSyncEnabled: boolean;
}

type LeaderboardStatus = "idle" | "loading" | "ready" | "error";

interface CloudSyncStatus {
  state: "signed_out" | "ready" | "syncing" | "synced" | "error";
  message: string;
  lastSyncedAtMs?: number;
}

const defaultConfig: StoredConfig = {
  alwaysOnTop: true,
  launchAtLogin: false,
  lightSettings: defaultLightSettings,
  cloudSyncEnabled: true,
};

function loadConfig(): StoredConfig {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultConfig;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    return {
      alwaysOnTop: parsed.alwaysOnTop ?? defaultConfig.alwaysOnTop,
      launchAtLogin: parsed.launchAtLogin ?? defaultConfig.launchAtLogin,
      lightSettings: normalizeLightSettings(parsed.lightSettings),
      cloudSyncEnabled: parsed.cloudSyncEnabled ?? defaultConfig.cloudSyncEnabled,
    };
  } catch {
    return defaultConfig;
  }
}

function cloudSessionMessage(session: CloudSession): string {
  if (session.user_phone_number) {
    return "已绑定手机，用量会自动同步";
  }
  return "云端同步已开启";
}

export default function App() {
  const [clientActivated, setClientActivated] = useState<boolean | null>(() =>
    isTauriRuntime() ? null : true,
  );
  const [view, setView] = useState<"main" | "settings" | "hardware-dev">(() => getInitialView());
  const [config, setConfig] = useState<StoredConfig>(() => loadConfig());
  const [event, setEvent] = useState<AgentStatusEvent>(() =>
    createStatusEvent("standby", "待命中", "boot"),
  );
  const [logs, setLogs] = useState<AgentStatusEvent[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexStatusSnapshot | null>(null);
  const [cursorStatus, setCursorStatus] = useState<CodexStatusSnapshot | null>(null);
  const [aiToolTokens, setAiToolTokens] = useState<AiToolTokenUsage[]>([]);
  const [aiToolLoading, setAiToolLoading] = useState(false);
  const [hardwareStatus, setHardwareStatus] = useState<HardwareStatusSnapshot | null>(null);
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    state: "syncing",
    message: "正在连接云端…",
  });
  const [leaderboard, setLeaderboard] = useState<TokenLeaderboardResponse | null>(null);
  const [leaderboardAgentProvider, setLeaderboardAgentProvider] = useState<AgentProvider>("codex");
  const [leaderboardTimePeriod, setLeaderboardTimePeriod] = useState<LeaderboardTimePeriod>("total");
  const [leaderboardStatus, setLeaderboardStatus] = useState<LeaderboardStatus>("idle");
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<WindowPlacement>({
    x: 80,
    y: 72,
    near_top: false,
  });
  const eventRef = useRef(event);
  const cloudSessionRef = useRef<CloudSession | null>(null);
  const cloudSyncEnabledRef = useRef(config.cloudSyncEnabled);
  const leaderboardAgentProviderRef = useRef<AgentProvider>("codex");
  const leaderboardTimePeriodRef = useRef<LeaderboardTimePeriod>("total");
  const lastUsageUploadKeyRef = useRef<Partial<Record<AgentProvider, string>>>({});
  const windowLabelRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setClientActivated(true);
      return;
    }

    getActivationStatus()
      .then(setClientActivated)
      .catch(() => setClientActivated(false));
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    getWindowLabel()
      .then((label) => {
        if (label === "main") {
          void setAlwaysOnTop(config.alwaysOnTop);
        }
      })
      .catch(() => undefined);
  }, [config.alwaysOnTop]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    cloudSyncEnabledRef.current = config.cloudSyncEnabled;
  }, [config.cloudSyncEnabled]);

  useEffect(() => {
    void syncHardwareLightSettings(config.lightSettings);
  }, [config.lightSettings]);

  useEffect(() => {
    cloudSessionRef.current = cloudSession;
  }, [cloudSession]);

  useEffect(() => {
    leaderboardAgentProviderRef.current = leaderboardAgentProvider;
  }, [leaderboardAgentProvider]);

  useEffect(() => {
    leaderboardTimePeriodRef.current = leaderboardTimePeriod;
  }, [leaderboardTimePeriod]);

  useEffect(() => {
    let cancelled = false;
    let placementTimer: number | undefined;
    let metricsTimer: number | undefined;
    let agentStatusTimer: number | undefined;
    let hardwareTimer: number | undefined;
    let leaderboardTimer: number | undefined;

    const clearTimers = () => {
      if (placementTimer !== undefined) {
        window.clearInterval(placementTimer);
      }
      if (metricsTimer !== undefined) {
        window.clearInterval(metricsTimer);
      }
      if (agentStatusTimer !== undefined) {
        window.clearInterval(agentStatusTimer);
      }
      if (hardwareTimer !== undefined) {
        window.clearInterval(hardwareTimer);
      }
      if (leaderboardTimer !== undefined) {
        window.clearInterval(leaderboardTimer);
      }
    };

    const startSettingsTimers = () => {
      void refreshSystemMetrics();
      metricsTimer = window.setInterval(() => {
        void refreshSystemMetrics();
      }, SYSTEM_METRICS_REFRESH_MS);
      void refreshAgentStatuses();
      agentStatusTimer = window.setInterval(() => {
        void refreshAgentStatuses();
      }, AGENT_STATUS_REFRESH_MS);
      void refreshHardwareStatus();
      hardwareTimer = window.setInterval(() => {
        void refreshHardwareStatus();
      }, HARDWARE_REFRESH_MS);
      void refreshCloudSession();
      void refreshTokenLeaderboard();
      leaderboardTimer = window.setInterval(() => {
        void refreshTokenLeaderboard();
      }, 60_000);
    };

    const bootstrap = async () => {
      const label = await getWindowLabel().catch(() => null);
      if (cancelled) {
        return;
      }

      windowLabelRef.current = label;
      const isSettingsWindow = label === "settings";

      if (isSettingsWindow && getInitialView() !== "hardware-dev") {
        setView("settings");
      }

      getStatus()
        .then((snapshot) => pushEvent(snapshot))
        .catch(() => pushEvent(createStatusEvent("standby", "预览模式", "fallback")));

      let unlisten: (() => void) | null = null;
      listenForStatus((snapshot) => {
        pushEvent(snapshot);
      })
        .then((unsubscribe) => {
          unlisten = unsubscribe;
        })
        .catch(() => undefined);

      let hardwareUnlisten: (() => void) | null = null;
      if (isSettingsWindow) {
        listenForHardwareStatus((snapshot) => setHardwareStatus(snapshot))
          .then((unsubscribe) => {
            hardwareUnlisten = unsubscribe;
          })
          .catch(() => undefined);
      }

      const previewListener = (event: Event) => {
        const custom = event as CustomEvent<"main" | "settings" | "hardware-dev">;
        setView(custom.detail);
      };
      window.addEventListener("agent-light-preview-view", previewListener);

      if (!isSettingsWindow) {
        void refreshPlacement();
        placementTimer = window.setInterval(() => {
          void refreshPlacement();
        }, MAIN_PLACEMENT_REFRESH_MS);
      } else {
        startSettingsTimers();
        const onVisibilityChange = () => {
          clearTimers();
          metricsTimer = undefined;
          agentStatusTimer = undefined;
          hardwareTimer = undefined;
          leaderboardTimer = undefined;
          if (!document.hidden) {
            startSettingsTimers();
          }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          unlisten?.();
          hardwareUnlisten?.();
          window.removeEventListener("agent-light-preview-view", previewListener);
          clearTimers();
        };
      }

      return () => {
        unlisten?.();
        hardwareUnlisten?.();
        window.removeEventListener("agent-light-preview-view", previewListener);
        clearTimers();
      };
    };

    let cleanup: (() => void) | undefined;
    void bootstrap().then((dispose) => {
      cleanup = dispose;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  function pushEvent(snapshot: AgentStatusEvent) {
    eventRef.current = snapshot;
    setEvent(snapshot);
    setLogs((currentLogs) => [snapshot, ...currentLogs].slice(0, 5));
  }

  async function triggerState(state: AgentState, message = `${statusDefinitions[state].label}测试`) {
    try {
      const snapshot = await setAgentState(state, message);
      pushEvent(snapshot);
    } catch {
      pushEvent(createStatusEvent(state, message, "fallback"));
    }
  }

  async function acknowledgeCompleted() {
    if (event.state !== "completed") {
      return;
    }

    try {
      const snapshot = await setAgentState("standby", "已查看完成结果");
      pushEvent(snapshot);
    } catch {
      pushEvent(createStatusEvent("standby", "已查看完成结果", "fallback"));
    }
  }

  async function openPetSettings() {
    try {
      await openSettingsWindow();
    } catch {
      setView("settings");
    }
  }

  async function closePetSettings() {
    try {
      await hideSettingsWindow();
    } catch {
      setView("main");
    }
  }

  async function quitApp() {
    try {
      await exitApp();
    } catch {
      // ignore preview/runtime errors
    }
  }

  async function refreshPlacement() {
    try {
      const snapshot = await getMainWindowPlacement();
      setPlacement(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }

  async function settlePlacementAfterDrag() {
    try {
      const snapshot = await snapMainWindowToTop();
      setPlacement(snapshot);
      return snapshot;
    } catch {
      return refreshPlacement();
    }
  }

  async function dragMainWindow() {
    try {
      await startWindowDrag();
      window.setTimeout(() => void settlePlacementAfterDrag(), 400);
      window.setTimeout(() => void settlePlacementAfterDrag(), 1200);
    } catch {
      // Browser preview and unsupported platforms simply keep the click behavior.
    } finally {
      void refreshPlacement();
    }
  }

  async function refreshSystemMetrics() {
    try {
      setSystemMetrics(await getSystemMetrics());
    } catch {
      setSystemMetrics(null);
    }
  }

  async function refreshAgentStatuses(options?: { showLoading?: boolean }) {
    if (options?.showLoading) {
      setAiToolLoading(true);
    }
    try {
      const [codexSnapshot, cursorSnapshot, aiToolsSnapshot] = await Promise.all([
        getCodexStatus().catch(() => null),
        getCursorStatus().catch(() => null),
        listAiToolTokenUsages().catch(() => [] as AiToolTokenUsage[]),
      ]);
      setCodexStatus(codexSnapshot);
      setCursorStatus(cursorSnapshot);
      setAiToolTokens(aiToolsSnapshot);
      if (codexSnapshot) {
        void syncAgentUsage(codexSnapshot, "codex");
      }
      if (cursorSnapshot) {
        void syncAgentUsage(cursorSnapshot, "cursor");
      }
    } finally {
      if (options?.showLoading) {
        setAiToolLoading(false);
      }
    }
  }

  async function refreshHardwareStatus(options?: { probe?: boolean }) {
    try {
      const snapshot =
        options?.probe === true
          ? (await probeHardware()) ?? (await getHardwareStatus())
          : await getHardwareStatus();
      setHardwareStatus(snapshot);
    } catch {
      setHardwareStatus(null);
    }
  }

  async function syncHardwareLightSettings(lightSettings: LightSettings) {
    try {
      const snapshot = await setHardwareLightSettings(lightSettings);
      if (snapshot) {
        setHardwareStatus(snapshot);
        window.setTimeout(() => void refreshHardwareStatus(), 160);
      }
    } catch {
      window.setTimeout(() => void refreshHardwareStatus(), 160);
    }
  }

  async function refreshCloudSession() {
    try {
      let session = await loadCloudSession();
      if (!session?.access_token || !session.device_id) {
        if (cloudSyncEnabledRef.current) {
          session = await ensureCloudSession();
        } else {
          session = null;
        }
      }
      setCloudSession(session);
      cloudSessionRef.current = session;
      setCloudSyncStatus(
        session
          ? { state: "ready", message: cloudSessionMessage(session) }
          : { state: "signed_out", message: "云端未连接，本地功能正常可用" },
      );
    } catch {
      setCloudSession(null);
      cloudSessionRef.current = null;
      setCloudSyncStatus({ state: "error", message: "本地云会话读取失败" });
    }
  }

  async function refreshTokenLeaderboard(
    sessionOverride?: CloudSession | null,
    agentProviderOverride?: AgentProvider,
    timePeriodOverride?: LeaderboardTimePeriod,
  ) {
    const session = sessionOverride === undefined ? cloudSessionRef.current : sessionOverride;
    const agentProvider = agentProviderOverride ?? leaderboardAgentProviderRef.current;
    const timePeriod = timePeriodOverride ?? leaderboardTimePeriodRef.current;
    setLeaderboardStatus("loading");
    setLeaderboardError(null);

    try {
      const snapshot = await getTokenLeaderboard({
        serverUrl: session?.server_url ?? "http://127.0.0.1:8787",
        accessToken: session?.access_token,
        agentProvider,
        timePeriod,
        limit: 20,
      });
      setLeaderboard(snapshot);
      setLeaderboardStatus("ready");
    } catch (error) {
      setLeaderboardStatus("error");
      setLeaderboardError(error instanceof Error ? error.message : "排行榜读取失败");
    }
  }

  async function selectLeaderboardAgentProvider(agentProvider: AgentProvider) {
    setLeaderboardAgentProvider(agentProvider);
    leaderboardAgentProviderRef.current = agentProvider;
    await refreshTokenLeaderboard(undefined, agentProvider);
  }

  async function selectLeaderboardTimePeriod(timePeriod: LeaderboardTimePeriod) {
    setLeaderboardTimePeriod(timePeriod);
    leaderboardTimePeriodRef.current = timePeriod;
    await refreshTokenLeaderboard(undefined, undefined, timePeriod);
  }

  async function connectCloud(serverUrl: string) {
    cloudSyncEnabledRef.current = true;
    updateConfig({ cloudSyncEnabled: true });
    setCloudSyncStatus({ state: "syncing", message: "正在开启云端同步…" });
    const session = await connectCloudDevice(serverUrl);
    setCloudSession(session);
    cloudSessionRef.current = session;
    setCloudSyncStatus({ state: "ready", message: cloudSessionMessage(session) });
    await refreshTokenLeaderboard(session);
  }

  async function signInCloud(request: CloudPhoneLoginRequest) {
    cloudSyncEnabledRef.current = true;
    updateConfig({ cloudSyncEnabled: true });
    setCloudSyncStatus({ state: "syncing", message: "正在登录并绑定本机设备" });
    const session = await loginOrRegisterCloud(request);
    setCloudSession(session);
    cloudSessionRef.current = session;
    setCloudSyncStatus({ state: "ready", message: cloudSessionMessage(session) });
    await refreshTokenLeaderboard(session);
    if (codexStatus) {
      void syncAgentUsage(codexStatus, "codex", session);
    }
    if (cursorStatus) {
      void syncAgentUsage(cursorStatus, "cursor", session);
    }
  }

  async function sendCloudPhoneCode(request: CloudPhoneCodeRequest): Promise<CloudPhoneCodeResponse> {
    return sendPhoneVerificationCodeCloud(request);
  }

  async function renameCloudDisplayName(displayName: string) {
    const session = cloudSessionRef.current;
    if (!session) {
      throw new Error("尚未连接云服");
    }

    const updated = await updateCloudDisplayName(session, displayName);
    setCloudSession(updated);
    cloudSessionRef.current = updated;
    setCloudSyncStatus({ state: "ready", message: cloudSessionMessage(updated) });
    await refreshTokenLeaderboard(updated);
  }

  async function signOutCloud() {
    cloudSyncEnabledRef.current = false;
    updateConfig({ cloudSyncEnabled: false });
    await clearCloudSession();
    setCloudSession(null);
    cloudSessionRef.current = null;
    lastUsageUploadKeyRef.current = {};
    setCloudSyncStatus({ state: "signed_out", message: "已断开云端同步" });
    await refreshTokenLeaderboard(null);
  }

  async function syncAgentUsage(
    snapshot: CodexStatusSnapshot,
    agentProvider: AgentProvider,
    sessionOverride?: CloudSession | null,
  ) {
    const session = sessionOverride === undefined ? cloudSessionRef.current : sessionOverride;
    if (!session) {
      return;
    }
    if (!session.device_id) {
      setCloudSyncStatus({ state: "error", message: "云会话缺少设备 ID，请重新登录" });
      return;
    }
    if (!snapshot.latest_thread_id || typeof snapshot.tokens_used !== "number") {
      return;
    }

    const threadUpdatedAt = snapshot.thread_updated_at_ms ?? snapshot.sampled_at_ms;
    const uploadKey = `${agentProvider}:${session.device_id}:${snapshot.latest_thread_id}:${snapshot.tokens_used}:${threadUpdatedAt}`;
    if (lastUsageUploadKeyRef.current[agentProvider] === uploadKey) {
      return;
    }
    lastUsageUploadKeyRef.current[agentProvider] = uploadKey;
    setCloudSyncStatus({ state: "syncing", message: `正在上报 ${agentProvider} token 消耗` });

    try {
      const result = await uploadCodexThreadUsage(session, snapshot, agentProvider);
      if (!result) {
        setCloudSyncStatus({ state: "ready", message: "等待可上报的 agent 线程" });
        return;
      }
      setCloudSyncStatus({
        state: "synced",
        message: result.ignored_stale_value ? "旧 token 快照已忽略" : "token 消耗已同步到排行榜",
        lastSyncedAtMs: Date.now(),
      });
      void refreshTokenLeaderboard(session);
    } catch (error) {
      delete lastUsageUploadKeyRef.current[agentProvider];
      setCloudSyncStatus({
        state: "error",
        message: error instanceof Error ? error.message : "token 消耗上报失败",
      });
    }
  }

  function updateConfig(update: Partial<StoredConfig>) {
    setConfig((currentConfig) => ({ ...currentConfig, ...update }));
  }

  const openSettingsClick = useGuardedClick(openPetSettings);
  const acknowledgeClick = useGuardedClick(acknowledgeCompleted);

  if (clientActivated === null) {
    return <main className="activation-screen activation-screen--loading" aria-busy="true" />;
  }

  if (!clientActivated) {
    return <ActivationScreen onActivated={() => setClientActivated(true)} />;
  }

  if (view === "settings") {
    return (
      <PetSettingsPanel
        event={event}
        alwaysOnTop={config.alwaysOnTop}
        launchAtLogin={config.launchAtLogin}
        lightSettings={config.lightSettings}
        aiToolTokens={aiToolTokens}
        aiToolLoading={aiToolLoading}
        onRefreshAiTools={() => refreshAgentStatuses({ showLoading: true })}
        hardwareStatus={hardwareStatus}
        cloudSession={cloudSession}
        cloudSyncStatus={cloudSyncStatus}
        leaderboard={leaderboard}
        leaderboardAgentProvider={leaderboardAgentProvider}
        leaderboardTimePeriod={leaderboardTimePeriod}
        leaderboardStatus={leaderboardStatus}
        leaderboardError={leaderboardError}
        onClose={() => void closePetSettings()}
        onAlwaysOnTopChange={(enabled) => {
          updateConfig({ alwaysOnTop: enabled });
          void setAlwaysOnTop(enabled);
        }}
        onLaunchAtLoginChange={(enabled) => updateConfig({ launchAtLogin: enabled })}
        onLightSettingsChange={(lightSettings) => updateConfig({ lightSettings })}
        onCloudLogin={signInCloud}
        onCloudConnect={connectCloud}
        onCloudSendPhoneCode={sendCloudPhoneCode}
        onCloudRenameDisplayName={renameCloudDisplayName}
        onCloudLogout={signOutCloud}
        onRefreshLeaderboard={() => refreshTokenLeaderboard()}
        onLeaderboardAgentChange={selectLeaderboardAgentProvider}
        onLeaderboardTimePeriodChange={selectLeaderboardTimePeriod}
        onProbeHardware={() => refreshHardwareStatus({ probe: true })}
        onTrigger={(state) => void triggerState(state)}
        onExitApp={() => void quitApp()}
      />
    );
  }

  if (view === "hardware-dev") {
    return (
      <HardwareDebugPanel
        event={event}
        hardwareStatus={hardwareStatus}
        onRefresh={() => void refreshHardwareStatus()}
        onTrigger={(state, message) => void triggerState(state, message)}
      />
    );
  }

  return (
    <main
      className={`desktop-shell desktop-shell--${event.state}`}
      onDoubleClick={() => void dragMainWindow()}
    >
      <section className="pet-strip" aria-label="桌面桌宠移动区">
        <AgentPet
          state={event.state}
          speed={FIXED_MOTION_SPEED}
          onOpenSettings={() => openSettingsClick.onClick()}
          onAcknowledge={() => acknowledgeClick.onClick()}
          onStartWindowDrag={() => void dragMainWindow()}
          onWindowMoveEnd={() => void settlePlacementAfterDrag()}
          showHardwareBlock={!placement.near_top}
        />
      </section>
    </main>
  );
}

function getInitialView(): "main" | "settings" | "hardware-dev" {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "hardware-dev" && params.get("dev") === "hardware") {
    return "hardware-dev";
  }
  return params.get("view") === "settings" ? "settings" : "main";
}
