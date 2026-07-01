import { invoke } from "@tauri-apps/api/core";
import { USER_DISPLAY_NAME_MAX_LENGTH } from "@agent-light/shared";
import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  agentStates,
  type AgentState,
  type AgentStatusEvent,
  type LightSettings,
  createStatusEvent,
  hexToRgb,
} from "./domain/status";
import {
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_LEADERBOARD_SERVER_URL,
  buildTokenLeaderboardUrl,
  getApiErrorMessage,
  normalizeLeaderboardServerUrl,
  parseTokenLeaderboardResponse,
  resolveDefaultCloudServerUrl,
  type AgentProvider,
  type TokenLeaderboardRequest,
  type TokenLeaderboardResponse,
} from "./domain/leaderboard";
import type {
  AiToolId,
  AiToolInstallResult,
  AiToolStatus,
  AiToolSyncResult,
  AiToolTokenUsage,
} from "./domain/aiTools";

export {
  DEFAULT_LEADERBOARD_SERVER_URL,
  DEFAULT_CLOUD_SERVER_URL,
  DEFAULT_LOCAL_SERVER_URL,
  DEFAULT_LEADERBOARD_LIMIT,
  DEFAULT_AGENT_PROVIDER,
  resolveDefaultCloudServerUrl,
  agentProviderLabels,
  agentProviderOrder,
  leaderboardTimePeriodLabels,
  leaderboardTimePeriodOrder,
  type AgentProvider,
  type LeaderboardTimePeriod,
  type TokenLeaderboardEntry,
  type TokenLeaderboardRequest,
  type TokenLeaderboardResponse,
} from "./domain/leaderboard";

const TOP_DOCK_THRESHOLD = 36;
let cachedAppVersion: string | null = null;

async function resolveAppVersion(): Promise<string> {
  if (cachedAppVersion) {
    return cachedAppVersion;
  }
  if (!isTauriRuntime()) {
    cachedAppVersion = "0.1.0";
    return cachedAppVersion;
  }
  try {
    cachedAppVersion = await getVersion();
  } catch {
    cachedAppVersion = "0.1.0";
  }
  return cachedAppVersion;
}
export type SettingsPageTarget =
  | "overview"
  | "assistants"
  | "leaderboard"
  | "account"
  | "preferences"
  | "effect"
  | "hardware"
  | "device";

const SETTINGS_PAGE_TARGETS = new Set<SettingsPageTarget>([
  "overview",
  "assistants",
  "leaderboard",
  "account",
  "preferences",
  "effect",
  "hardware",
  "device",
]);

export function isSettingsPageTarget(value: string): value is SettingsPageTarget {
  return SETTINGS_PAGE_TARGETS.has(value as SettingsPageTarget);
}

interface TauriInternalsWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

export function isTauriRuntime(): boolean {
  return Boolean((window as TauriInternalsWindow).__TAURI_INTERNALS__);
}

export async function getWindowLabel(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return getCurrentWindow().label;
}

export async function getStatus(): Promise<AgentStatusEvent> {
  if (!isTauriRuntime()) {
    return createStatusEvent("standby", "浏览器预览模式", "fallback");
  }

  return invoke<AgentStatusEvent>("get_status");
}

export async function setAgentState(
  state: AgentState,
  message?: string | null,
): Promise<AgentStatusEvent> {
  if (!isTauriRuntime()) {
    return createStatusEvent(state, message, "fallback");
  }

  return invoke<AgentStatusEvent>("set_agent_state", {
    request: {
      state,
      message: message || undefined,
    },
  });
}

export async function listenForStatus(
  handler: (event: AgentStatusEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return listen<AgentStatusEvent>("agent-state", (event) => handler(event.payload));
}

export async function openSettingsWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    window.history.replaceState(null, "", "?view=settings");
    window.dispatchEvent(new CustomEvent("agent-light-preview-view", { detail: "settings" }));
    window.dispatchEvent(
      new CustomEvent<SettingsPageTarget>("agent-light-settings-page", { detail: "overview" }),
    );
    return;
  }

  await invoke("open_settings_window");
}

export async function listenForSettingsPage(
  handler: (page: SettingsPageTarget) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    const listener = (event: Event) => {
      const page = (event as CustomEvent<SettingsPageTarget>).detail;
      if (isSettingsPageTarget(page)) {
        handler(page);
      }
    };
    window.addEventListener("agent-light-settings-page", listener);
    return () => window.removeEventListener("agent-light-settings-page", listener);
  }

  return listen<SettingsPageTarget>("agent-settings-page", (event) => {
    const page = event.payload;
    if (isSettingsPageTarget(page)) {
      handler(page);
    }
  });
}

export async function hideSettingsWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    window.history.replaceState(null, "", window.location.pathname);
    window.dispatchEvent(new CustomEvent("agent-light-preview-view", { detail: "main" }));
    return;
  }

  await invoke("hide_settings_window");
}

export async function exitApp(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("exit_app");
}

export interface WindowPlacement {
  x: number;
  y: number;
  near_top: boolean;
}

export interface SystemMetrics {
  cpu_usage_percent: number | null;
  logical_cpus: number | null;
  memory_used_bytes: number | null;
  memory_total_bytes: number | null;
  memory_used_percent: number | null;
  uptime_seconds: number | null;
  sampled_at_ms: number;
}

export interface CodexStatusSnapshot {
  available: boolean;
  logged_in: boolean;
  login_label: string;
  quota_label: string;
  quota_detail: string;
  state: AgentState;
  is_working: boolean;
  latest_thread_id?: string | null;
  latest_model?: string | null;
  latest_source?: string | null;
  latest_cwd?: string | null;
  tokens_used?: number | null;
  thread_updated_at_ms?: number | null;
  active_age_seconds?: number | null;
  sampled_at_ms: number;
}

export interface HardwareStatusSnapshot {
  enabled: boolean;
  connected: boolean;
  protocol: string;
  firmware_version?: string | null;
  protocol_version?: string | null;
  hardware_revision?: string | null;
  port?: string | null;
  baud: number;
  available_ports: string[];
  last_state?: AgentState | null;
  last_error?: string | null;
  updated_at_ms: number;
}

interface HardwareLightStateSettings {
  red: number;
  green: number;
  blue: number;
  brightness: number;
}

type HardwareLightSettingsRequest = Record<AgentState, HardwareLightStateSettings>;

export async function setHardwareLightSettings(
  settings: LightSettings,
): Promise<HardwareStatusSnapshot | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const request = agentStates.reduce((payload, state) => {
    const rgb = hexToRgb(settings[state].color);
    payload[state] = {
      ...rgb,
      brightness: settings[state].brightness,
    };
    return payload;
  }, {} as HardwareLightSettingsRequest);

  return invoke<HardwareStatusSnapshot>("set_light_settings", { request });
}

export interface CloudSession {
  server_url: string;
  access_token: string;
  refresh_token: string;
  expires_at_ms: number;
  user_id: string;
  user_email: string;
  user_phone_number?: string | null;
  display_name: string;
  workspace_id: string;
  device_id?: string | null;
  installation_id: string;
}

export interface CloudLoginRequest {
  serverUrl: string;
  email: string;
  password: string;
}

export interface CloudPhoneCodeRequest {
  serverUrl: string;
  phoneNumber: string;
}

export interface CloudPhoneCodeResponse {
  phone_number: string;
  expires_in_seconds: number;
  delivery: "dev";
  dev_code?: string;
}

export interface CloudPhoneLoginRequest {
  serverUrl: string;
  phoneNumber: string;
  verificationCode: string;
  displayName?: string;
}

export type CloudServerHealth = "healthy" | "unreachable" | "invalid_url";

export async function getMainWindowPlacement(): Promise<WindowPlacement> {
  if (!isTauriRuntime()) {
    return { x: 80, y: 72, near_top: false };
  }

  return invoke<WindowPlacement>("get_main_window_placement");
}

export async function moveMainWindow(x: number, y: number): Promise<WindowPlacement> {
  if (!isTauriRuntime()) {
    return { x, y, near_top: y <= TOP_DOCK_THRESHOLD };
  }

  return invoke<WindowPlacement>("move_main_window", {
    x: Math.round(x),
    y: Math.round(y),
  });
}

export async function snapMainWindowToTop(): Promise<WindowPlacement> {
  if (!isTauriRuntime()) {
    return { x: 80, y: 0, near_top: true };
  }

  return invoke<WindowPlacement>("snap_main_window_to_top");
}

export async function startWindowDrag(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await getCurrentWindow().startDragging();
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("set_main_window_always_on_top", { enabled });
}

export async function syncCodexAgentState(
  state: AgentState,
  message?: string | null,
): Promise<AgentStatusEvent> {
  if (!isTauriRuntime()) {
    return createStatusEvent(state, message, "codex_monitor");
  }

  return invoke<AgentStatusEvent>("sync_codex_agent_state", {
    request: {
      state,
      message: message || undefined,
    },
  });
}

export async function syncCursorAgentState(
  state: AgentState,
  message?: string | null,
): Promise<AgentStatusEvent> {
  if (!isTauriRuntime()) {
    return createStatusEvent(state, message, "cursor_monitor");
  }

  return invoke<AgentStatusEvent>("sync_cursor_agent_state", {
    request: {
      state,
      message: message || undefined,
    },
  });
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  if (!isTauriRuntime()) {
    return {
      cpu_usage_percent: null,
      logical_cpus: navigator.hardwareConcurrency || null,
      memory_used_bytes: null,
      memory_total_bytes: null,
      memory_used_percent: null,
      uptime_seconds: null,
      sampled_at_ms: Date.now(),
    };
  }

  return invoke<SystemMetrics>("get_system_metrics");
}

export async function getCodexStatus(): Promise<CodexStatusSnapshot> {
  if (!isTauriRuntime()) {
    return {
      available: false,
      logged_in: false,
      login_label: "浏览器预览模式",
      quota_label: "未开放",
      quota_detail: "浏览器预览无法读取本机 Codex 状态",
      state: "standby",
      is_working: false,
      sampled_at_ms: Date.now(),
    };
  }

  return invoke<CodexStatusSnapshot>("get_codex_status");
}

export async function getCursorStatus(): Promise<CodexStatusSnapshot> {
  if (!isTauriRuntime()) {
    return {
      available: false,
      logged_in: false,
      login_label: "浏览器预览模式",
      quota_label: "未开放",
      quota_detail: "浏览器预览无法读取本机 Cursor 状态",
      state: "standby",
      is_working: false,
      sampled_at_ms: Date.now(),
    };
  }

  return invoke<CodexStatusSnapshot>("get_cursor_status");
}

export async function getHardwareStatus(): Promise<HardwareStatusSnapshot> {
  if (!isTauriRuntime()) {
    return {
      enabled: false,
      connected: false,
      protocol: "agent-light-rgb-v1",
      firmware_version: null,
      protocol_version: null,
      hardware_revision: null,
      port: null,
      baud: 115200,
      available_ports: [],
      last_state: null,
      last_error: "浏览器预览无法访问 ESP32 串口",
      updated_at_ms: Date.now(),
    };
  }

  return invoke<HardwareStatusSnapshot>("get_hardware_status");
}

export async function probeHardware(): Promise<HardwareStatusSnapshot | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return invoke<HardwareStatusSnapshot>("probe_hardware");
}

export async function listenForHardwareStatus(
  handler: (snapshot: HardwareStatusSnapshot) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return listen<HardwareStatusSnapshot>("hardware-state", (event) => handler(event.payload));
}

export async function getInstallationId(): Promise<string> {
  if (!isTauriRuntime()) {
    return "agent-light-browser-preview";
  }

  return invoke<string>("get_installation_id");
}

export interface ClientActivationRecord {
  activation_id: string;
  installation_id: string;
  activated_at: string;
  receipt: string;
  server_url: string;
}

export async function getActivationStatus(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return true;
  }

  return invoke<boolean>("get_activation_status");
}

export async function loadActivationRecord(): Promise<ClientActivationRecord | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return invoke<ClientActivationRecord | null>("get_activation_record");
}

export async function openActivationWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("请在 Win/Mac 桌面客户端中打开激活窗口");
  }

  await invoke("open_activation_window");
}

/** 激活码校验走线上服务；bootstrap 必须与激活时同一 server_url。 */
export async function resolveActivationServerUrl(fallback?: string): Promise<string> {
  const record = await loadActivationRecord();
  const fromActivation = record?.server_url?.trim();
  if (fromActivation) {
    return normalizeCloudServerUrl(fromActivation);
  }
  const next = fallback?.trim();
  if (next) {
    return normalizeCloudServerUrl(next);
  }
  return resolveDefaultCloudServerUrl();
}

export async function activateClient(
  serverUrl: string,
  activationCode: string,
): Promise<ClientActivationRecord> {
  if (!isTauriRuntime()) {
    throw new Error("请在 Win/Mac 桌面客户端中激活");
  }

  return invoke<ClientActivationRecord>("activate_client", {
    serverUrl,
    activationCode,
  });
}

export async function listAiTools(): Promise<AiToolStatus[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return invoke<AiToolStatus[]>("list_ai_tools");
}

export async function installAiTool(toolId: AiToolId): Promise<AiToolInstallResult> {
  if (!isTauriRuntime()) {
    return {
      id: toolId,
      configured: false,
      message: "浏览器预览模式无法安装 AI 工具",
    };
  }

  return invoke<AiToolInstallResult>("install_ai_tool", { toolId });
}

export async function syncAiToolConnectors(force = false): Promise<AiToolSyncResult> {
  if (!isTauriRuntime()) {
    return { restored: [], skipped_debounce: false };
  }

  return invoke<AiToolSyncResult>("sync_ai_tool_connectors", { force });
}

export async function listAiToolTokenUsages(): Promise<AiToolTokenUsage[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return invoke<AiToolTokenUsage[]>("list_ai_tool_token_usages");
}

const TOKEN_REFRESH_MARGIN_MS = 60_000;

export async function loadCloudSession(): Promise<CloudSession | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return invoke<CloudSession | null>("load_cloud_session");
}

export function isCloudAccessTokenExpiringSoon(session: CloudSession): boolean {
  return session.expires_at_ms - Date.now() <= TOKEN_REFRESH_MARGIN_MS;
}

export async function refreshCloudAccessToken(_session: CloudSession): Promise<CloudSession> {
  if (!isTauriRuntime()) {
    throw new Error("云端续期仅支持桌面客户端");
  }

  return invoke<CloudSession>("refresh_cloud_session", { force: true });
}

export async function ensureCloudAccessToken(session: CloudSession): Promise<CloudSession> {
  if (!isCloudAccessTokenExpiringSoon(session)) {
    return session;
  }
  if (!isTauriRuntime()) {
    return session;
  }

  return invoke<CloudSession>("refresh_cloud_session", { force: false });
}

export async function getCloudSyncEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return true;
  }

  return invoke<boolean>("get_cloud_sync_enabled");
}

export function isDeviceCloudAccount(session: CloudSession | null | undefined): boolean {
  return Boolean(
    session &&
      !session.user_phone_number &&
      (session.user_email.endsWith("@device.agent-light.local") ||
        session.user_email.endsWith("@activation.agent-light.local")),
  );
}

export async function probeCloudServerHealth(serverUrl: string): Promise<CloudServerHealth> {
  try {
    const normalizedServerUrl = normalizeCloudServerUrl(serverUrl);
    const response = await fetch(buildApiUrl(normalizedServerUrl, "/api/health"), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return response.ok ? "healthy" : "unreachable";
  } catch (error) {
    if (error instanceof Error && /服务端|格式/.test(error.message)) {
      return "invalid_url";
    }
    return "unreachable";
  }
}

export async function connectCloudDevice(serverUrl: string): Promise<CloudSession> {
  const bootstrapServerUrl = await resolveActivationServerUrl(serverUrl);
  const health = await probeCloudServerHealth(bootstrapServerUrl);
  if (health === "invalid_url") {
    throw new Error("服务端地址格式不正确");
  }
  if (health === "unreachable") {
    throw new Error("无法连接云端，请检查网络后重试");
  }
  return bootstrapCloudDevice(bootstrapServerUrl);
}

export async function bootstrapCloudDevice(
  serverUrl = DEFAULT_LEADERBOARD_SERVER_URL,
): Promise<CloudSession> {
  const normalizedServerUrl = normalizeCloudServerUrl(serverUrl);
  const installationId = await getInstallationId();
  const appVersion = await resolveAppVersion();
  const response = await fetch(buildApiUrl(normalizedServerUrl, "/api/devices/bootstrap"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installation_id: installationId,
      platform: detectDesktopPlatform(),
      app_version: appVersion,
    }),
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `设备注册接口返回 ${response.status}`);
  }
  if (!isSuccessRecord(payload) || !isDeviceBootstrapPayload(payload.data)) {
    throw new Error("设备注册响应格式不正确");
  }

  const data = payload.data;
  const workspaceId = data.workspaces[0]?.workspace.id;
  if (!workspaceId) {
    throw new Error("设备注册响应缺少 workspace");
  }

  return saveCloudSession({
    server_url: normalizedServerUrl,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at_ms: Date.now() + data.expires_in_seconds * 1000,
    user_id: data.user.id,
    user_email: data.user.email,
    user_phone_number: data.user.phone_number,
    display_name: data.user.display_name,
    workspace_id: workspaceId,
    device_id: data.device.id,
    installation_id: installationId,
  });
}

export async function ensureCloudSession(
  serverUrl = DEFAULT_LEADERBOARD_SERVER_URL,
): Promise<CloudSession | null> {
  if (isTauriRuntime()) {
    const enabled = await getCloudSyncEnabled();
    if (!enabled) {
      return loadCloudSession();
    }
  }

  const existing = await loadCloudSession();
  if (existing?.access_token && existing.device_id) {
    try {
      const refreshed = await ensureCloudAccessToken(existing);
      return await syncCloudProfileFromServer(refreshed);
    } catch {
      return existing;
    }
  }
  if (!isTauriRuntime()) {
    return existing;
  }

  try {
    const bootstrapServerUrl = await resolveActivationServerUrl(serverUrl);
    return await connectCloudDevice(bootstrapServerUrl);
  } catch {
    return existing;
  }
}

export async function saveCloudSession(session: CloudSession): Promise<CloudSession> {
  if (!isTauriRuntime()) {
    return session;
  }

  return invoke<CloudSession>("save_cloud_session", { request: session });
}

export async function clearCloudSession(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("clear_cloud_session");
}

export async function loginCloud(request: CloudLoginRequest): Promise<CloudSession> {
  const auth = await requestCloudSession(request.serverUrl, "/api/auth/login", {
    email: request.email,
    password: request.password,
  });
  return saveSessionWithRegisteredDevice(request.serverUrl, auth);
}

export async function sendPhoneVerificationCodeCloud(
  request: CloudPhoneCodeRequest,
): Promise<CloudPhoneCodeResponse> {
  const response = await fetch(buildApiUrl(request.serverUrl, "/api/auth/phone/send-code"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone_number: request.phoneNumber,
    }),
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `验证码接口返回 ${response.status}`);
  }
  if (!isSuccessRecord(payload) || !isPhoneCodePayload(payload.data)) {
    throw new Error("验证码响应格式不正确");
  }
  return payload.data;
}

export async function loginOrRegisterCloud(request: CloudPhoneLoginRequest): Promise<CloudSession> {
  const auth = await requestCloudSession(request.serverUrl, "/api/auth/phone/verify", {
    phone_number: request.phoneNumber,
    verification_code: request.verificationCode,
    display_name: request.displayName,
  });
  return saveSessionWithRegisteredDevice(request.serverUrl, auth);
}

export async function updateCloudDisplayName(
  session: CloudSession,
  displayName: string,
): Promise<CloudSession> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new Error("用户名不能为空");
  }
  if (trimmed.length > USER_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`用户名不能超过 ${USER_DISPLAY_NAME_MAX_LENGTH} 个字符`);
  }

  const response = await fetch(buildApiUrl(session.server_url, "/api/me"), {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ display_name: trimmed }),
  }).catch(() => {
    throw new Error("无法连接云端，请检查网络或服务端地址");
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `用户名更新接口返回 ${response.status}`);
  }
  if (!isSuccessRecord(payload) || !isUpdateProfilePayload(payload.data)) {
    throw new Error("用户名更新响应格式不正确");
  }

  return saveCloudSession({
    ...session,
    display_name: payload.data.user.display_name,
  });
}

export async function syncCloudProfileFromServer(session: CloudSession): Promise<CloudSession> {
  let activeSession = await ensureCloudAccessToken(session);
  let response = await fetch(buildApiUrl(activeSession.server_url, "/api/me"), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${activeSession.access_token}`,
    },
  }).catch(() => {
    throw new Error("无法连接云端，请检查网络或服务端地址");
  });

  if (response.status === 401) {
    activeSession = await refreshCloudAccessToken(activeSession);
    response = await fetch(buildApiUrl(activeSession.server_url, "/api/me"), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${activeSession.access_token}`,
      },
    }).catch(() => {
      throw new Error("无法连接云端，请检查网络或服务端地址");
    });
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `账号信息接口返回 ${response.status}`);
  }
  if (!isSuccessRecord(payload) || !isMeResponsePayload(payload.data)) {
    throw new Error("账号信息响应格式不正确");
  }

  const workspaceId = payload.data.workspaces[0]?.workspace.id ?? activeSession.workspace_id;
  return saveCloudSession({
    ...activeSession,
    user_id: payload.data.user.id,
    user_email: payload.data.user.email,
    user_phone_number: payload.data.user.phone_number,
    display_name: payload.data.user.display_name,
    workspace_id: workspaceId,
  });
}

export async function getTokenLeaderboard(
  request: TokenLeaderboardRequest,
  session?: CloudSession | null,
): Promise<{ response: TokenLeaderboardResponse; session: CloudSession | null }> {
  let activeSession = session ?? null;
  let accessToken = request.accessToken?.trim();
  if (activeSession?.refresh_token) {
    try {
      activeSession = await ensureCloudAccessToken(activeSession);
      accessToken = activeSession.access_token;
    } catch {
      activeSession = null;
      accessToken = undefined;
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response = await fetch(buildTokenLeaderboardUrl(request), {
    method: "GET",
    headers,
  });

  if (response.status === 401 && activeSession?.refresh_token) {
    try {
      activeSession = await refreshCloudAccessToken(activeSession);
      response = await fetch(buildTokenLeaderboardUrl(request), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${activeSession.access_token}`,
        },
      });
    } catch {
      activeSession = null;
      response = await fetch(buildTokenLeaderboardUrl(request), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
    }
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep payload null; the status-specific error below is clearer for users.
  }

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `排行榜接口返回 ${response.status}`);
  }

  return {
    response: parseTokenLeaderboardResponse(payload),
    session: activeSession,
  };
}

type AuthSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in_seconds: number;
  user: {
    id: string;
    email: string;
    phone_number: string | null;
    display_name: string;
  };
  workspaces: Array<{
    workspace: {
      id: string;
      name: string;
    };
  }>;
};

async function requestCloudSession(
  serverUrl: string,
  path: string,
  payload: Record<string, string | undefined>,
): Promise<AuthSessionPayload> {
  const response = await fetch(buildApiUrl(serverUrl, path), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(body) ?? `账号接口返回 ${response.status}`);
  }
  if (!isSuccessRecord(body) || !isAuthSessionPayload(body.data)) {
    throw new Error("账号响应格式不正确");
  }
  return body.data;
}

async function saveSessionWithRegisteredDevice(
  serverUrl: string,
  auth: AuthSessionPayload,
): Promise<CloudSession> {
  const installationId = await getInstallationId();
  const workspaceId = auth.workspaces[0]?.workspace.id;
  if (!workspaceId) {
    throw new Error("账号没有可用 workspace");
  }

  const device = await registerCloudDevice(serverUrl, auth.access_token, workspaceId, installationId);
  return saveCloudSession({
    server_url: normalizeCloudServerUrl(serverUrl),
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at_ms: Date.now() + auth.expires_in_seconds * 1000,
    user_id: auth.user.id,
    user_email: auth.user.email,
    user_phone_number: auth.user.phone_number,
    display_name: auth.user.display_name,
    workspace_id: workspaceId,
    device_id: device.id,
    installation_id: installationId,
  });
}

async function registerCloudDevice(
  serverUrl: string,
  accessToken: string,
  workspaceId: string,
  installationId: string,
): Promise<{ id: string }> {
  const response = await fetch(buildApiUrl(serverUrl, "/api/devices/register"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      installation_id: installationId,
      platform: detectDesktopPlatform(),
      app_version: "0.1.0",
      device_label: detectFriendlyDeviceLabel(),
    }),
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `设备注册接口返回 ${response.status}`);
  }
  if (!isSuccessRecord(payload) || !isRecord(payload.data) || typeof payload.data.id !== "string") {
    throw new Error("设备注册响应格式不正确");
  }
  return { id: payload.data.id };
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildApiUrl(serverUrl: string, path: string): string {
  return new URL(path, normalizeCloudServerUrl(serverUrl)).toString();
}

function normalizeCloudServerUrl(serverUrl: string): string {
  return normalizeLeaderboardServerUrl(serverUrl);
}

function isSuccessRecord(value: unknown): value is { ok: true; data: unknown } {
  return isRecord(value) && value.ok === true && "data" in value;
}

function isMeResponsePayload(value: unknown): value is {
  user: AuthSessionPayload["user"];
  workspaces: AuthSessionPayload["workspaces"];
} {
  if (!isRecord(value) || !isRecord(value.user) || !Array.isArray(value.workspaces)) {
    return false;
  }

  return (
    typeof value.user.id === "string" &&
    typeof value.user.email === "string" &&
    (value.user.phone_number === null || typeof value.user.phone_number === "string") &&
    typeof value.user.display_name === "string" &&
    value.workspaces.some((item) => isRecord(item) && isRecord(item.workspace) && typeof item.workspace.id === "string")
  );
}

function isAuthSessionPayload(value: unknown): value is AuthSessionPayload {
  if (!isRecord(value) || !isRecord(value.user) || !Array.isArray(value.workspaces)) {
    return false;
  }

  return (
    typeof value.access_token === "string" &&
    typeof value.refresh_token === "string" &&
    typeof value.expires_in_seconds === "number" &&
    typeof value.user.id === "string" &&
    typeof value.user.email === "string" &&
    (value.user.phone_number === null || typeof value.user.phone_number === "string") &&
    typeof value.user.display_name === "string" &&
    value.workspaces.some((item) => isRecord(item) && isRecord(item.workspace) && typeof item.workspace.id === "string")
  );
}

function isDeviceBootstrapPayload(
  value: unknown,
): value is AuthSessionPayload & { device: { id: string }; created: boolean } {
  if (!isAuthSessionPayload(value) || !isRecord(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isRecord(record.device) && typeof record.device.id === "string";
}

function isPhoneCodePayload(value: unknown): value is CloudPhoneCodeResponse {
  return (
    isRecord(value) &&
    typeof value.phone_number === "string" &&
    typeof value.expires_in_seconds === "number" &&
    value.delivery === "dev" &&
    (value.dev_code === undefined || typeof value.dev_code === "string")
  );
}

function isUpdateProfilePayload(value: unknown): value is { user: { display_name: string } } {
  return isRecord(value) && isRecord(value.user) && typeof value.user.display_name === "string";
}

function detectFriendlyDeviceLabel(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) {
    return "Windows 电脑";
  }
  if (platform.includes("mac")) {
    return "Mac 电脑";
  }
  return "Linux 电脑";
}

function detectDesktopPlatform(): "macos" | "windows" | "linux" {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) {
    return "windows";
  }
  if (platform.includes("mac")) {
    return "macos";
  }
  return "linux";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
