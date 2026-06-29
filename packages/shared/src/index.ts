import { z } from "zod";

export const agentStatusValues = ["standby", "working", "completed", "attention"] as const;
export const agentStatusSchema = z.enum(agentStatusValues);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const statusAliasMap = {
  idle: "standby",
  running: "working",
  success: "completed",
  error: "attention",
  needs_action: "attention",
} as const satisfies Record<string, AgentStatus>;

export const statusAliasSchema = z.enum(Object.keys(statusAliasMap) as [keyof typeof statusAliasMap, ...Array<keyof typeof statusAliasMap>]);
export type StatusAlias = z.infer<typeof statusAliasSchema>;

export function normalizeAgentStatus(value: string): AgentStatus | undefined {
  if (agentStatusValues.includes(value as AgentStatus)) {
    return value as AgentStatus;
  }

  return statusAliasMap[value as StatusAlias];
}

export function sanitizeDisplayMessage(value: string | null | undefined, maxLength = 180): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

export const uuidSchema = z.uuid();
export const isoDateStringSchema = z.iso.datetime({ offset: true });
export const emailSchema = z.email().max(254);
export const passwordSchema = z.string().min(12).max(128);
export const inviteCodeSchema = z.string().trim().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const phoneNumberSchema = z.string().trim().min(8).max(16).regex(/^\+?[1-9]\d{7,14}$/);
export const phoneVerificationCodeSchema = z.string().trim().regex(/^\d{6}$/);

export const workspaceRoleValues = ["owner", "admin", "member"] as const;
export const workspaceRoleSchema = z.enum(workspaceRoleValues);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const desktopPlatformValues = ["macos", "windows"] as const;
export const desktopPlatformSchema = z.enum(desktopPlatformValues);
export type DesktopPlatform = z.infer<typeof desktopPlatformSchema>;

export const agentProviderValues = [
  "codex",
  "cursor",
  "claude_code",
  "github_copilot",
  "trae",
  "trae_cn",
  "qoder",
  "qoder_cn",
  "codebuddy",
  "antigravity",
  "kiro",
  "devin",
] as const;
export const agentProviderSchema = z.enum(agentProviderValues);
export type AgentProvider = z.infer<typeof agentProviderSchema>;

export const userDtoSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  phone_number: phoneNumberSchema.nullable(),
  display_name: z.string().min(1).max(120),
  created_at: isoDateStringSchema,
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const workspaceDtoSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  created_at: isoDateStringSchema,
});
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export const workspaceMemberDtoSchema = z.object({
  workspace_id: uuidSchema,
  user_id: uuidSchema,
  role: workspaceRoleSchema,
  joined_at: isoDateStringSchema,
});
export type WorkspaceMemberDto = z.infer<typeof workspaceMemberDtoSchema>;

export const registerRequestSchema = z.object({
  invite_code: inviteCodeSchema,
  email: emailSchema,
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(120),
}).strict();
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const sendPhoneVerificationCodeRequestSchema = z.object({
  phone_number: phoneNumberSchema,
}).strict();
export type SendPhoneVerificationCodeRequest = z.infer<typeof sendPhoneVerificationCodeRequestSchema>;

export const sendPhoneVerificationCodeResponseSchema = z.object({
  phone_number: phoneNumberSchema,
  expires_in_seconds: z.number().int().positive(),
  delivery: z.enum(["dev"]),
  dev_code: phoneVerificationCodeSchema.optional(),
});
export type SendPhoneVerificationCodeResponse = z.infer<typeof sendPhoneVerificationCodeResponseSchema>;

export const verifyPhoneLoginRequestSchema = z.object({
  phone_number: phoneNumberSchema,
  verification_code: phoneVerificationCodeSchema,
  display_name: z.string().trim().min(1).max(120).optional(),
}).strict();
export type VerifyPhoneLoginRequest = z.infer<typeof verifyPhoneLoginRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refresh_token: z.string().min(32).max(512),
}).strict();
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const authTokenPairSchema = z.object({
  access_token: z.string().min(32),
  refresh_token: z.string().min(32),
  expires_in_seconds: z.number().int().positive(),
});
export type AuthTokenPair = z.infer<typeof authTokenPairSchema>;

export const meResponseSchema = z.object({
  user: userDtoSchema,
  workspaces: z.array(
    z.object({
      workspace: workspaceDtoSchema,
      membership: workspaceMemberDtoSchema,
    }),
  ),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateProfileRequestSchema = z.object({
  display_name: z.string().trim().min(1).max(120),
}).strict();
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const updateProfileResponseSchema = z.object({
  user: userDtoSchema,
});
export type UpdateProfileResponse = z.infer<typeof updateProfileResponseSchema>;

export const authSessionResponseSchema = authTokenPairSchema.extend({
  user: userDtoSchema,
  workspaces: meResponseSchema.shape.workspaces,
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const deviceRegisterRequestSchema = z.object({
  workspace_id: uuidSchema.optional(),
  installation_id: z.string().trim().min(12).max(128),
  platform: desktopPlatformSchema,
  app_version: z.string().trim().min(1).max(40),
  device_label: z.string().trim().min(1).max(120).optional(),
}).strict();
export type DeviceRegisterRequest = z.infer<typeof deviceRegisterRequestSchema>;

export const deviceDtoSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  user_id: uuidSchema,
  installation_id: z.string().min(12).max(128),
  platform: desktopPlatformSchema,
  app_version: z.string().min(1).max(40),
  device_label: z.string().min(1).max(120).nullable(),
  created_at: isoDateStringSchema,
});
export type DeviceDto = z.infer<typeof deviceDtoSchema>;

export const deviceBootstrapRequestSchema = z.object({
  installation_id: z.string().trim().min(12).max(128),
  platform: desktopPlatformSchema,
  app_version: z.string().trim().min(1).max(40),
  device_label: z.string().trim().min(1).max(120).optional(),
}).strict();
export type DeviceBootstrapRequest = z.infer<typeof deviceBootstrapRequestSchema>;

export const deviceBootstrapResponseSchema = authSessionResponseSchema.extend({
  device: deviceDtoSchema,
  created: z.boolean(),
});
export type DeviceBootstrapResponse = z.infer<typeof deviceBootstrapResponseSchema>;

export const hardwareHelloSchema = z.object({
  hardware_device_id: z.string().trim().min(8).max(128),
  firmware_version: z.string().trim().min(1).max(40),
  protocol_version: z.string().trim().min(1).max(40),
  hardware_revision: z.string().trim().min(1).max(40),
});
export type HardwareHello = z.infer<typeof hardwareHelloSchema>;

export const hardwareBindRequestSchema = hardwareHelloSchema.extend({
  device_id: uuidSchema,
}).strict();
export type HardwareBindRequest = z.infer<typeof hardwareBindRequestSchema>;

export const hardwareDeviceDtoSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  device_id: uuidSchema,
  hardware_device_id: z.string().min(8).max(128),
  firmware_version: z.string().min(1).max(40),
  protocol_version: z.string().min(1).max(40),
  hardware_revision: z.string().min(1).max(40),
  bound_at: isoDateStringSchema,
});
export type HardwareDeviceDto = z.infer<typeof hardwareDeviceDtoSchema>;

export const codexThreadUsageRequestSchema = z.object({
  agent_provider: agentProviderSchema.default("codex"),
  workspace_id: uuidSchema,
  device_id: uuidSchema,
  codex_thread_id: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(80).optional(),
  tokens_used: z.number().int().nonnegative(),
  thread_updated_at_ms: z.number().int().nonnegative(),
  sampled_at_ms: z.number().int().nonnegative(),
}).strict();
export type CodexThreadUsageRequest = z.infer<typeof codexThreadUsageRequestSchema>;

export const codexThreadUsageResponseSchema = z.object({
  codex_thread_id: z.string().min(1).max(128),
  tokens_used: z.number().int().nonnegative(),
  accepted_tokens_used: z.number().int().nonnegative(),
  ignored_stale_value: z.boolean(),
});
export type CodexThreadUsageResponse = z.infer<typeof codexThreadUsageResponseSchema>;

export const leaderboardTokensQuerySchema = z.object({
  agent_provider: agentProviderSchema.default("codex"),
  workspace_id: uuidSchema.optional(),
  from: isoDateStringSchema.optional(),
  to: isoDateStringSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type LeaderboardTokensQuery = z.infer<typeof leaderboardTokensQuerySchema>;

export const leaderboardTokensEntrySchema = z.object({
  user_id: uuidSchema,
  display_name: z.string().min(1).max(120),
  tokens_used: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
});
export type LeaderboardTokensEntry = z.infer<typeof leaderboardTokensEntrySchema>;

export const leaderboardTokensResponseSchema = z.object({
  scope: z.enum(["global", "workspace"]),
  workspace_id: uuidSchema.nullable(),
  agent_provider: agentProviderSchema,
  total_tokens: z.number().int().nonnegative(),
  current_user_rank: z.number().int().positive().nullable(),
  entries: z.array(leaderboardTokensEntrySchema),
});
export type LeaderboardTokensResponse = z.infer<typeof leaderboardTokensResponseSchema>;

export const apiErrorCodeValues = [
  "bad_request",
  "invalid_json",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "invite_code_invalid",
  "invite_code_used",
  "verification_code_invalid",
  "verification_code_expired",
  "stale_usage_ignored",
  "validation_failed",
  "rate_limited",
  "internal_error",
] as const;
export const apiErrorCodeSchema = z.enum(apiErrorCodeValues);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(240),
    request_id: z.string().min(1).max(80).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const apiSuccessResponseSchema = <Schema extends z.ZodType>(schema: Schema) =>
  z.object({
    ok: z.literal(true),
    data: schema,
  });

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export const redactedHeaders = ["authorization", "cookie", "set-cookie", "x-api-key"] as const;
export const forbiddenUsagePayloadKeys = ["cwd", "rollout_path", "api_key", "cookie", "token", "private_key"] as const;
