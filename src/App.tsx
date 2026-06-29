import { useEffect, useRef, useState } from "react";
import { AgentPet } from "./components/AgentPet";
import { HardwareDebugPanel } from "./components/HardwareDebugPanel";
import { PetSettingsPanel } from "./components/PetSettingsPanel";
import { useGuardedClick } from "./hooks/useGuardedClick";
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
  getHardwareStatus,
  probeHardware,
  getTokenLeaderboard,
  getSystemMetrics,
  getStatus,
  getWindowLabel,
  getMainWindowPlacement,
  isTauriRuntime,
  listenForStatus,
  listenForHardwareStatus,
  loadCloudSession,
  loginOrRegisterCloud,
  hideSettingsWindow,
  exitApp,
  openSettingsWindow,
  clearCloudSession,
  sendPhoneVerificationCodeCloud,
  setAgentState,
  setAlwaysOnTop,
  setHardwareLightSettings,
  snapMainWindowToTop,
  startWindowDrag,
  syncCodexAgentState,
  syncCursorAgentState,
  uploadCodexThreadUsage,
  type CloudPhoneLoginRequest,
  type CloudPhoneCodeRequest,
  type CloudPhoneCodeResponse,
  type CloudSession,
  type CodexStatusSnapshot,
  type HardwareStatusSnapshot,
  type SystemMetrics,
  type AgentProvider,
  type TokenLeaderboardResponse,
  type WindowPlacement,
} from "./tauriClient";

const STORAGE_KEY = "agent-light-config-v1";
const FIXED_MOTION_SPEED = 760;
const MANUAL_STATUS_HOLD_MS = 60_000;

interface StoredConfig {
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  lightSettings: LightSettings;
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
    };
  } catch {
    return defaultConfig;
  }
}

function isManualStatusHold(event: AgentStatusEvent) {
  if (event.source !== "ui" && event.source !== "local_api") {
    return false;
  }
  return Date.now() - event.timestamp_ms < MANUAL_STATUS_HOLD_MS;
}

export default function App() {
  const [view, setView] = useState<"main" | "settings" | "hardware-dev">(() => getInitialView());
  const [config, setConfig] = useState<StoredConfig>(() => loadConfig());
  const [event, setEvent] = useState<AgentStatusEvent>(() =>
    createStatusEvent("standby", "待命中", "boot"),
  );
  const [logs, setLogs] = useState<AgentStatusEvent[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexStatusSnapshot | null>(null);
  const [cursorStatus, setCursorStatus] = useState<CodexStatusSnapshot | null>(null);
  const [hardwareStatus, setHardwareStatus] = useState<HardwareStatusSnapshot | null>(null);
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    state: "signed_out",
    message: "登录后自动上报 token 消耗",
  });
  const [leaderboard, setLeaderboard] = useState<TokenLeaderboardResponse | null>(null);
  const [leaderboardAgentProvider, setLeaderboardAgentProvider] = useState<AgentProvider>("codex");
  const [leaderboardStatus, setLeaderboardStatus] = useState<LeaderboardStatus>("idle");
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<WindowPlacement>({
    x: 80,
    y: 72,
    near_top: false,
  });
  const eventRef = useRef(event);
  const cloudSessionRef = useRef<CloudSession | null>(null);
  const leaderboardAgentProviderRef = useRef<AgentProvider>("codex");
  const lastUsageUploadKeyRef = useRef<Partial<Record<AgentProvider, string>>>({});
  const windowLabelRef = useRef<string | null>(null);

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
    void syncHardwareLightSettings(config.lightSettings);
  }, [config.lightSettings]);

  useEffect(() => {
    cloudSessionRef.current = cloudSession;
  }, [cloudSession]);

  useEffect(() => {
    leaderboardAgentProviderRef.current = leaderboardAgentProvider;
  }, [leaderboardAgentProvider]);

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
      }, 10_000);
      void refreshAgentStatuses();
      agentStatusTimer = window.setInterval(() => {
        void refreshAgentStatuses();
      }, 10_000);
      void refreshHardwareStatus();
      hardwareTimer = window.setInterval(() => {
        void refreshHardwareStatus();
      }, 10_000);
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
        .then((snapshot) => pushEvent(snapshot, label))
        .catch(() => pushEvent(createStatusEvent("standby", "预览模式", "fallback"), label));

      let unlisten: (() => void) | null = null;
      listenForStatus((snapshot) => pushEvent(snapshot, label))
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
        }, 2_000);
        void refreshAgentStatuses();
        agentStatusTimer = window.setInterval(() => {
          void refreshAgentStatuses();
        }, 8_000);
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

  function pushEvent(snapshot: AgentStatusEvent, windowLabel: string | null = windowLabelRef.current) {
    eventRef.current = snapshot;
    setEvent(snapshot);
    setLogs((currentLogs) => [snapshot, ...currentLogs].slice(0, 5));
    if (windowLabel !== "settings") {
      window.setTimeout(() => void refreshHardwareStatus(), 120);
    }
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

  async function refreshAgentStatuses() {
    const [codexSnapshot, cursorSnapshot] = await Promise.all([
      getCodexStatus().catch(() => null),
      getCursorStatus().catch(() => null),
    ]);
    setCodexStatus(codexSnapshot);
    setCursorStatus(cursorSnapshot);
    if (codexSnapshot) {
      void syncAgentUsage(codexSnapshot, "codex");
    }
    if (cursorSnapshot) {
      void syncAgentUsage(cursorSnapshot, "cursor");
    }
    void syncFromAgentStatuses(cursorSnapshot, codexSnapshot);
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
      const session = await loadCloudSession();
      setCloudSession(session);
      cloudSessionRef.current = session;
      setCloudSyncStatus(
        session
          ? { state: "ready", message: "已登录，token 消耗会自动上报" }
          : { state: "signed_out", message: "登录后自动上报 token 消耗" },
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
  ) {
    const session = sessionOverride === undefined ? cloudSessionRef.current : sessionOverride;
    const agentProvider = agentProviderOverride ?? leaderboardAgentProviderRef.current;
    setLeaderboardStatus("loading");
    setLeaderboardError(null);

    try {
      const snapshot = await getTokenLeaderboard({
        serverUrl: session?.server_url ?? "http://127.0.0.1:8787",
        accessToken: session?.access_token,
        agentProvider,
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

  async function signInCloud(request: CloudPhoneLoginRequest) {
    setCloudSyncStatus({ state: "syncing", message: "正在登录并绑定本机设备" });
    const session = await loginOrRegisterCloud(request);
    setCloudSession(session);
    cloudSessionRef.current = session;
    setCloudSyncStatus({ state: "ready", message: "已登录，token 消耗会自动上报" });
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

  async function signOutCloud() {
    await clearCloudSession();
    setCloudSession(null);
    cloudSessionRef.current = null;
    lastUsageUploadKeyRef.current = {};
    setCloudSyncStatus({ state: "signed_out", message: "登录后自动上报 token 消耗" });
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

  async function syncFromAgentStatuses(
    cursorSnapshot: CodexStatusSnapshot | null,
    codexSnapshot: CodexStatusSnapshot | null,
  ) {
    const current = eventRef.current;
    if (isManualStatusHold(current)) {
      return;
    }

    const primary = cursorSnapshot?.available
      ? { snapshot: cursorSnapshot, label: "Cursor", source: "cursor_monitor" as const }
      : codexSnapshot?.available
        ? { snapshot: codexSnapshot, label: "Codex", source: "codex_monitor" as const }
        : null;

    if (!primary) {
      await syncAgentState("attention", "Cursor / Codex 均不可用", "cursor_monitor");
      return;
    }

    const { snapshot, label, source } = primary;
    if (snapshot.state === "working") {
      await syncAgentState("working", `${label} 正在工作`, source);
      return;
    }
    if (snapshot.state === "completed") {
      await syncAgentState("completed", `${label} 本轮已完成`, source);
      return;
    }
    if (current.state === "completed") {
      return;
    }
    if (
      current.source === source ||
      current.source === "codex_monitor" ||
      current.source === "cursor_monitor" ||
      current.source === "boot" ||
      current.source === "fallback"
    ) {
      await syncAgentState("standby", `${label} 待命中`, source);
    }
  }

  async function syncAgentState(
    state: AgentState,
    message: string,
    source: "codex_monitor" | "cursor_monitor",
  ) {
    const current = eventRef.current;
    if (
      (current.source === "codex_monitor" || current.source === "cursor_monitor") &&
      current.state === state &&
      current.message === message
    ) {
      return;
    }

    try {
      const snapshot =
        source === "cursor_monitor"
          ? await syncCursorAgentState(state, message)
          : await syncCodexAgentState(state, message);
      pushEvent(snapshot);
    } catch {
      pushEvent(createStatusEvent(state, message, source));
    }
  }

  function updateConfig(update: Partial<StoredConfig>) {
    setConfig((currentConfig) => ({ ...currentConfig, ...update }));
  }

  const openSettingsClick = useGuardedClick(openPetSettings);
  const acknowledgeClick = useGuardedClick(acknowledgeCompleted);

  if (view === "settings") {
    return (
      <PetSettingsPanel
        event={event}
        alwaysOnTop={config.alwaysOnTop}
        launchAtLogin={config.launchAtLogin}
        lightSettings={config.lightSettings}
        systemMetrics={systemMetrics}
        codexStatus={codexStatus}
        cursorStatus={cursorStatus}
        hardwareStatus={hardwareStatus}
        cloudSession={cloudSession}
        cloudSyncStatus={cloudSyncStatus}
        leaderboard={leaderboard}
        leaderboardAgentProvider={leaderboardAgentProvider}
        leaderboardStatus={leaderboardStatus}
        leaderboardError={leaderboardError}
        logs={logs}
        onClose={() => void closePetSettings()}
        onTrigger={(state) => void triggerState(state)}
        onAlwaysOnTopChange={(enabled) => {
          updateConfig({ alwaysOnTop: enabled });
          void setAlwaysOnTop(enabled);
        }}
        onLaunchAtLoginChange={(enabled) => updateConfig({ launchAtLogin: enabled })}
        onLightSettingsChange={(lightSettings) => updateConfig({ lightSettings })}
        onCloudLogin={signInCloud}
        onCloudSendPhoneCode={sendCloudPhoneCode}
        onCloudLogout={signOutCloud}
        onRefreshLeaderboard={() => refreshTokenLeaderboard()}
        onLeaderboardAgentChange={selectLeaderboardAgentProvider}
        onProbeHardware={() => refreshHardwareStatus({ probe: true })}
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
