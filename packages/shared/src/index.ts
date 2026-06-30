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
export const activationCodeSchema = inviteCodeSchema;
export type ActivationCode = z.infer<typeof activationCodeSchema>;

export const activationCodeStatusValues = ["active", "used", "revoked"] as const;
export const activationCodeStatusSchema = z.enum(activationCodeStatusValues);
export type ActivationCodeStatus = z.infer<typeof activationCodeStatusSchema>;
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

export const adminUsernameSchema = z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9_.-]+$/);

export const adminLoginRequestSchema = z.object({
  username: adminUsernameSchema,
  password: z.string().min(1).max(128),
}).strict();
export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminLoginResponseSchema = z.object({
  access_token: z.string().min(32),
  expires_in_seconds: z.number().int().positive(),
  username: adminUsernameSchema,
  display_name: z.string().min(1).max(120),
});
export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;

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

export const activateClientRequestSchema = z.object({
  activation_code: activationCodeSchema,
  installation_id: z.string().trim().min(12).max(128),
  platform: desktopPlatformSchema,
  app_version: z.string().trim().min(1).max(40),
}).strict();
export type ActivateClientRequest = z.infer<typeof activateClientRequestSchema>;

export const activateClientResponseSchema = z.object({
  activation_id: uuidSchema,
  installation_id: z.string().min(12).max(128),
  activated_at: isoDateStringSchema,
  receipt: z.string().min(16).max(512),
});
export type ActivateClientResponse = z.infer<typeof activateClientResponseSchema>;

export const createActivationCodesRequestSchema = z.object({
  count: z.number().int().min(1).max(100).default(1),
  expires_in_days: z.number().int().min(1).max(3650).optional(),
  label: z.string().trim().min(1).max(200).optional(),
}).strict();
export type CreateActivationCodesRequest = z.infer<typeof createActivationCodesRequestSchema>;

export const activationCodeDtoSchema = z.object({
  id: uuidSchema,
  status: activationCodeStatusSchema,
  label: z.string().max(200).nullable(),
  expires_at: isoDateStringSchema.nullable(),
  used_at: isoDateStringSchema.nullable(),
  user_id: uuidSchema.nullable(),
  activated_installation_id: z.string().min(12).max(128).nullable(),
  activated_platform: desktopPlatformSchema.nullable(),
  activated_app_version: z.string().min(1).max(40).nullable(),
  created_at: isoDateStringSchema,
});
export type ActivationCodeDto = z.infer<typeof activationCodeDtoSchema>;

export const adminEndUserTypeValues = ["email", "phone", "activation"] as const;
export const adminEndUserTypeSchema = z.enum(adminEndUserTypeValues);
export type AdminEndUserType = z.infer<typeof adminEndUserTypeSchema>;

export const adminEndUserStatusValues = ["active", "disabled"] as const;
export const adminEndUserStatusSchema = z.enum(adminEndUserStatusValues);
export type AdminEndUserStatus = z.infer<typeof adminEndUserStatusSchema>;

export const adminEndUserDtoSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  phone_number: phoneNumberSchema.nullable(),
  display_name: z.string().min(1).max(120),
  user_type: adminEndUserTypeSchema,
  disabled_at: isoDateStringSchema.nullable(),
  device_count: z.number().int().nonnegative(),
  created_at: isoDateStringSchema,
});
export type AdminEndUserDto = z.infer<typeof adminEndUserDtoSchema>;

export const listAdminEndUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  type: adminEndUserTypeSchema.optional(),
  status: adminEndUserStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListAdminEndUsersQuery = z.infer<typeof listAdminEndUsersQuerySchema>;

export const listAdminEndUsersResponseSchema = z.object({
  items: z.array(adminEndUserDtoSchema),
  total: z.number().int().nonnegative(),
});
export type ListAdminEndUsersResponse = z.infer<typeof listAdminEndUsersResponseSchema>;

export const adminEndUserDeviceDtoSchema = z.object({
  id: uuidSchema,
  installation_id: z.string().min(12).max(128),
  platform: desktopPlatformSchema,
  app_version: z.string().min(1).max(40),
  device_label: z.string().min(1).max(120).nullable(),
  last_seen_at: isoDateStringSchema.nullable(),
  created_at: isoDateStringSchema,
});
export type AdminEndUserDeviceDto = z.infer<typeof adminEndUserDeviceDtoSchema>;

export const adminEndUserActivationSummarySchema = z.object({
  id: uuidSchema,
  status: activationCodeStatusSchema,
  label: z.string().max(200).nullable(),
  used_at: isoDateStringSchema.nullable(),
});
export type AdminEndUserActivationSummary = z.infer<typeof adminEndUserActivationSummarySchema>;

export const adminEndUserDetailSchema = z.object({
  user: adminEndUserDtoSchema,
  devices: z.array(adminEndUserDeviceDtoSchema),
  activation_code: adminEndUserActivationSummarySchema.nullable(),
});
export type AdminEndUserDetail = z.infer<typeof adminEndUserDetailSchema>;

export const adminAccountDtoSchema = z.object({
  id: uuidSchema,
  username: adminUsernameSchema,
  display_name: z.string().min(1).max(120),
  disabled_at: isoDateStringSchema.nullable(),
  created_at: isoDateStringSchema,
});
export type AdminAccountDto = z.infer<typeof adminAccountDtoSchema>;

export const listAdminAccountsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListAdminAccountsQuery = z.infer<typeof listAdminAccountsQuerySchema>;

export const listAdminAccountsResponseSchema = z.object({
  items: z.array(adminAccountDtoSchema),
  total: z.number().int().nonnegative(),
});
export type ListAdminAccountsResponse = z.infer<typeof listAdminAccountsResponseSchema>;

export const createAdminAccountRequestSchema = z.object({
  username: adminUsernameSchema,
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(120),
}).strict();
export type CreateAdminAccountRequest = z.infer<typeof createAdminAccountRequestSchema>;

export const updateAdminAccountRequestSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema.optional(),
}).strict();
export type UpdateAdminAccountRequest = z.infer<typeof updateAdminAccountRequestSchema>;

export const createActivationCodeItemSchema = z.object({
  id: uuidSchema,
  code: activationCodeSchema,
});
export type CreateActivationCodeItem = z.infer<typeof createActivationCodeItemSchema>;

export const createActivationCodesResponseSchema = z.object({
  codes: z.array(createActivationCodeItemSchema).min(1).max(100),
});
export type CreateActivationCodesResponse = z.infer<typeof createActivationCodesResponseSchema>;

export const listActivationCodesQuerySchema = z.object({
  status: activationCodeStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListActivationCodesQuery = z.infer<typeof listActivationCodesQuerySchema>;

export const listActivationCodesResponseSchema = z.object({
  items: z.array(activationCodeDtoSchema),
  total: z.number().int().nonnegative(),
});
export type ListActivationCodesResponse = z.infer<typeof listActivationCodesResponseSchema>;

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
  "activation_code_invalid",
  "activation_code_used",
  "activation_code_revoked",
  "activation_code_expired",
  "activation_code_required",
  "admin_unauthorized",
  "admin_self_disable_forbidden",
  "admin_last_account",
  "client_not_activated",
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
