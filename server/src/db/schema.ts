import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const workspaceRoleEnum = mysqlEnum("workspace_role", ["owner", "admin", "member"]);
export const desktopPlatformEnum = mysqlEnum("desktop_platform", ["macos", "windows"]);
export const inviteCodeStatusEnum = mysqlEnum("invite_code_status", ["active", "used", "revoked"]);
export const agentProviderEnum = mysqlEnum("agent_provider", [
  "codex",
  "claude_code",
  "cursor",
  "github_copilot",
  "trae",
  "trae_cn",
  "qoder",
  "qoder_cn",
  "codebuddy",
  "antigravity",
  "kiro",
  "devin",
]);

function rowId(name = "id") {
  return char(name, { length: 36 }).primaryKey().$defaultFn(() => randomUUID());
}

const timestamps = {
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
};

export const users = mysqlTable(
  "users",
  {
    id: rowId(),
    email: varchar("email", { length: 254 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 16 }),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 20 }).notNull(),
    disabledAt: datetime("disabled_at", { mode: "date", fsp: 3 }),
    ...timestamps,
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    phoneUnique: uniqueIndex("users_phone_number_unique").on(table.phoneNumber),
  }),
);

export const workspaces = mysqlTable("workspaces", {
  id: rowId(),
  name: varchar("name", { length: 120 }).notNull(),
  ...timestamps,
});

export const workspaceMembers = mysqlTable(
  "workspace_members",
  {
    workspaceId: char("workspace_id", { length: 36 })
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: char("user_id", { length: 36 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: workspaceRoleEnum.notNull().default("member"),
    joinedAt: datetime("joined_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
    userIdx: index("workspace_members_user_idx").on(table.userId),
  }),
);

export const devices = mysqlTable(
  "devices",
  {
    id: rowId(),
    workspaceId: char("workspace_id", { length: 36 })
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: char("user_id", { length: 36 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    installationId: varchar("installation_id", { length: 128 }).notNull(),
    platform: desktopPlatformEnum.notNull(),
    appVersion: varchar("app_version", { length: 40 }).notNull(),
    deviceLabel: varchar("device_label", { length: 120 }),
    lastSeenAt: datetime("last_seen_at", { mode: "date", fsp: 3 }),
    ...timestamps,
  },
  (table) => ({
    installationUnique: uniqueIndex("devices_installation_unique").on(table.installationId),
    workspaceUserIdx: index("devices_workspace_user_idx").on(table.workspaceId, table.userId),
  }),
);

export const hardwareDevices = mysqlTable(
  "hardware_devices",
  {
    id: rowId(),
    workspaceId: char("workspace_id", { length: 36 })
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: char("device_id", { length: 36 })
      .references(() => devices.id, { onDelete: "cascade" })
      .notNull(),
    hardwareDeviceId: varchar("hardware_device_id", { length: 128 }).notNull(),
    firmwareVersion: varchar("firmware_version", { length: 40 }).notNull(),
    protocolVersion: varchar("protocol_version", { length: 40 }).notNull(),
    hardwareRevision: varchar("hardware_revision", { length: 40 }).notNull(),
    boundAt: datetime("bound_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    ...timestamps,
  },
  (table) => ({
    hardwareUnique: uniqueIndex("hardware_devices_hardware_unique").on(table.hardwareDeviceId),
    deviceIdx: index("hardware_devices_device_idx").on(table.deviceId),
    workspaceIdx: index("hardware_devices_workspace_idx").on(table.workspaceId),
  }),
);

export const codexThreads = mysqlTable(
  "codex_threads",
  {
    id: rowId(),
    workspaceId: char("workspace_id", { length: 36 })
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: char("user_id", { length: 36 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: char("device_id", { length: 36 })
      .references(() => devices.id, { onDelete: "cascade" })
      .notNull(),
    agentProvider: agentProviderEnum.notNull().default("codex"),
    codexThreadId: varchar("codex_thread_id", { length: 128 }).notNull(),
    model: varchar("model", { length: 80 }),
    tokensUsed: bigint("tokens_used", { mode: "number" }).default(0).notNull(),
    threadUpdatedAtMs: bigint("thread_updated_at_ms", { mode: "number" }).notNull(),
    lastUploadedAt: datetime("last_uploaded_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    ...timestamps,
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("codex_threads_idempotency_unique").on(
      table.workspaceId,
      table.userId,
      table.deviceId,
      table.agentProvider,
      table.codexThreadId,
    ),
    workspaceUserIdx: index("codex_threads_workspace_user_idx").on(table.workspaceId, table.userId),
    deviceIdx: index("codex_threads_device_idx").on(table.deviceId),
  }),
);

export const usageEvents = mysqlTable(
  "usage_events",
  {
    id: rowId(),
    workspaceId: char("workspace_id", { length: 36 })
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: char("user_id", { length: 36 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: char("device_id", { length: 36 })
      .references(() => devices.id, { onDelete: "cascade" })
      .notNull(),
    agentProvider: agentProviderEnum.notNull().default("codex"),
    codexThreadId: char("codex_thread_id", { length: 36 })
      .references(() => codexThreads.id, { onDelete: "cascade" })
      .notNull(),
    tokensUsed: bigint("tokens_used", { mode: "number" }).notNull(),
    deltaTokens: bigint("delta_tokens", { mode: "number" }).notNull(),
    ignoredStaleValue: boolean("ignored_stale_value").default(false).notNull(),
    sampledAtMs: bigint("sampled_at_ms", { mode: "number" }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    workspaceUserIdx: index("usage_events_workspace_user_idx").on(table.workspaceId, table.userId),
    threadIdx: index("usage_events_thread_idx").on(table.codexThreadId),
  }),
);

export const dailyUsageRollups = mysqlTable(
  "daily_usage_rollups",
  {
    workspaceId: char("workspace_id", { length: 36 })
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: char("user_id", { length: 36 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    agentProvider: agentProviderEnum.notNull().default("codex"),
    usageDate: date("usage_date").notNull(),
    tokensUsed: bigint("tokens_used", { mode: "number" }).default(0).notNull(),
    threadCount: int("thread_count").default(0).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.userId, table.usageDate, table.agentProvider],
    }),
    leaderboardIdx: index("daily_usage_rollups_leaderboard_idx").on(
      table.workspaceId,
      table.agentProvider,
      table.usageDate,
    ),
  }),
);

export const phoneVerificationCodes = mysqlTable(
  "phone_verification_codes",
  {
    id: rowId(),
    phoneNumber: varchar("phone_number", { length: 16 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    consumedAt: datetime("consumed_at", { mode: "date", fsp: 3 }),
    attempts: int("attempts").default(0).notNull(),
    ...timestamps,
  },
  (table) => ({
    phonePurposeIdx: index("phone_verification_codes_phone_purpose_idx").on(table.phoneNumber, table.purpose),
  }),
);

export const activationCodes = mysqlTable(
  "activation_codes",
  {
    id: rowId(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    status: inviteCodeStatusEnum.notNull().default("active"),
    label: varchar("label", { length: 200 }),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }),
    usedAt: datetime("used_at", { mode: "date", fsp: 3 }),
    userId: char("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    activatedInstallationId: varchar("activated_installation_id", { length: 128 }),
    activatedPlatform: desktopPlatformEnum,
    activatedAppVersion: varchar("activated_app_version", { length: 40 }),
    ...timestamps,
  },
  (table) => ({
    codeHashUnique: uniqueIndex("activation_codes_code_hash_unique").on(table.codeHash),
    statusIdx: index("activation_codes_status_idx").on(table.status),
    installationIdx: index("activation_codes_installation_idx").on(table.activatedInstallationId),
    userIdx: index("activation_codes_user_idx").on(table.userId),
  }),
);

export const inviteCodes = mysqlTable(
  "invite_codes",
  {
    id: rowId(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    status: inviteCodeStatusEnum.notNull().default("active"),
    workspaceId: char("workspace_id", { length: 36 }).references(() => workspaces.id, { onDelete: "set null" }),
    createdByUserId: char("created_by_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    usedByUserId: char("used_by_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }),
    usedAt: datetime("used_at", { mode: "date", fsp: 3 }),
    ...timestamps,
  },
  (table) => ({
    codeHashUnique: uniqueIndex("invite_codes_code_hash_unique").on(table.codeHash),
    statusIdx: index("invite_codes_status_idx").on(table.status),
  }),
);

export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: rowId(),
    userId: char("user_id", { length: 36 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    revokedAt: datetime("revoked_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("refresh_tokens_token_hash_unique").on(table.tokenHash),
    userIdx: index("refresh_tokens_user_idx").on(table.userId),
  }),
);

export const adminUsers = mysqlTable(
  "admin_users",
  {
    id: rowId(),
    username: varchar("username", { length: 64 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    disabledAt: datetime("disabled_at", { mode: "date", fsp: 3 }),
    ...timestamps,
  },
  (table) => ({
    usernameUnique: uniqueIndex("admin_users_username_unique").on(table.username),
  }),
);
