import { invoke } from "@tauri-apps/api/core";
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
  buildTokenLeaderboardUrl,
  getApiErrorMessage,
  normalizeLeaderboardServerUrl,
  parseTokenLeaderboardResponse,
  type AgentProvider,
  type TokenLeaderboardRequest,
  type TokenLeaderboardResponse,
} from "./domain/leaderboard";
import type {
  AiToolId,
  AiToolInstallResult,
  AiToolStatus,
  AiToolTokenUsage,
} from "./domain/aiTools";

export {
  DEFAULT_LEADERBOARD_SERVER_URL,
  DEFAULT_LEADERBOARD_LIMIT,
  DEFAULT_AGENT_PROVIDER,
  agentProviderLabels,
  type AgentProvider,
  type TokenLeaderboardEntry,
  type TokenLeaderboardRequest,
  type TokenLeaderboardResponse,
} from "./domain/leaderboard";

const TOP_DOCK_THRESHOLD = 36;
export type SettingsPageTarget = "account" | "leaderboard" | "device" | "effect" | "hardware";

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
      new CustomEvent<SettingsPageTarget>("agent-light-settings-page", { detail: "account" }),
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
      if (page === "account" || page === "leaderboard" || page === "device" || page === "effect" || page === "hardware") {
        handler(page);
      }
    };
    window.addEventListener("agent-light-settings-page", listener);
    return () => window.removeEventListener("agent-light-settings-page", listener);
  }

  return listen<SettingsPageTarget>("agent-settings-page", (event) => {
    const page = event.payload;
    if (page === "account" || page === "leaderboard" || page === "device" || page === "effect" || page === "hardware") {
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

export interface CodexUsageUploadResult {
  codex_thread_id: string;
  tokens_used: number;
  accepted_tokens_used: number;
  ignored_stale_value: boolean;
}

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

export async function listAiToolTokenUsages(): Promise<AiToolTokenUsage[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return invoke<AiToolTokenUsage[]>("list_ai_tool_token_usages");
}

export async function loadCloudSession(): Promise<CloudSession | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return invoke<CloudSession | null>("load_cloud_session");
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

export async function getTokenLeaderboard(
  request: TokenLeaderboardRequest,
): Promise<TokenLeaderboardResponse> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const accessToken = request.accessToken?.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(buildTokenLeaderboardUrl(request), {
    method: "GET",
    headers,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep payload null; the status-specific error below is clearer for users.
  }

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `排行榜接口返回 ${response.status}`);
  }

  return parseTokenLeaderboardResponse(payload);
}

export async function uploadCodexThreadUsage(
  session: CloudSession,
  snapshot: CodexStatusSnapshot,
  agentProvider: AgentProvider = DEFAULT_AGENT_PROVIDER,
): Promise<CodexUsageUploadResult | null> {
  if (!session.device_id || !snapshot.latest_thread_id || typeof snapshot.tokens_used !== "number") {
    return null;
  }

  const response = await fetch(buildApiUrl(session.server_url, "/api/usage/codex-thread"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspace_id: session.workspace_id,
      device_id: session.device_id,
      agent_provider: agentProvider,
      codex_thread_id: snapshot.latest_thread_id,
      model: snapshot.latest_model || undefined,
      tokens_used: Math.max(0, Math.trunc(snapshot.tokens_used)),
      thread_updated_at_ms: Math.max(0, Math.trunc(snapshot.thread_updated_at_ms ?? snapshot.sampled_at_ms)),
      sampled_at_ms: Math.max(0, Math.trunc(snapshot.sampled_at_ms)),
    }),
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) ?? `用量上报接口返回 ${response.status}`);
  }
  if (!isSuccessRecord(payload) || !isRecord(payload.data)) {
    throw new Error("用量上报响应格式不正确");
  }

  return payload.data as unknown as CodexUsageUploadResult;
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
      device_label: navigator.platform || "Desktop",
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

function isPhoneCodePayload(value: unknown): value is CloudPhoneCodeResponse {
  return (
    isRecord(value) &&
    typeof value.phone_number === "string" &&
    typeof value.expires_in_seconds === "number" &&
    value.delivery === "dev" &&
    (value.dev_code === undefined || typeof value.dev_code === "string")
  );
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
