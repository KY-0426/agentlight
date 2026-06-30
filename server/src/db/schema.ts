import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "admin", "member"]);
export const desktopPlatformEnum = pgEnum("desktop_platform", ["macos", "windows"]);
export const inviteCodeStatusEnum = pgEnum("invite_code_status", ["active", "used", "revoked"]);
export const agentProviderEnum = pgEnum("agent_provider", [
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

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 16 }),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
    phoneUnique: uniqueIndex("users_phone_number_unique").on(table.phoneNumber).where(sql`${table.phoneNumber} is not null`),
  }),
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  ...timestamps,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: workspaceRoleEnum("role").default("member").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
    userIdx: index("workspace_members_user_idx").on(table.userId),
  }),
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    installationId: varchar("installation_id", { length: 128 }).notNull(),
    platform: desktopPlatformEnum("platform").notNull(),
    appVersion: varchar("app_version", { length: 40 }).notNull(),
    deviceLabel: varchar("device_label", { length: 120 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    installationUnique: uniqueIndex("devices_installation_unique").on(table.installationId),
    workspaceUserIdx: index("devices_workspace_user_idx").on(table.workspaceId, table.userId),
  }),
);

export const hardwareDevices = pgTable(
  "hardware_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: uuid("device_id")
      .references(() => devices.id, { onDelete: "cascade" })
      .notNull(),
    hardwareDeviceId: varchar("hardware_device_id", { length: 128 }).notNull(),
    firmwareVersion: varchar("firmware_version", { length: 40 }).notNull(),
    protocolVersion: varchar("protocol_version", { length: 40 }).notNull(),
    hardwareRevision: varchar("hardware_revision", { length: 40 }).notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => ({
    hardwareUnique: uniqueIndex("hardware_devices_hardware_unique").on(table.hardwareDeviceId),
    deviceIdx: index("hardware_devices_device_idx").on(table.deviceId),
    workspaceIdx: index("hardware_devices_workspace_idx").on(table.workspaceId),
  }),
);

export const codexThreads = pgTable(
  "codex_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: uuid("device_id")
      .references(() => devices.id, { onDelete: "cascade" })
      .notNull(),
    agentProvider: agentProviderEnum("agent_provider").default("codex").notNull(),
    codexThreadId: varchar("codex_thread_id", { length: 128 }).notNull(),
    model: varchar("model", { length: 80 }),
    tokensUsed: bigint("tokens_used", { mode: "number" }).default(0).notNull(),
    threadUpdatedAtMs: bigint("thread_updated_at_ms", { mode: "number" }).notNull(),
    lastUploadedAt: timestamp("last_uploaded_at", { withTimezone: true }).defaultNow().notNull(),
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

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: uuid("device_id")
      .references(() => devices.id, { onDelete: "cascade" })
      .notNull(),
    agentProvider: agentProviderEnum("agent_provider").default("codex").notNull(),
    codexThreadId: uuid("codex_thread_id")
      .references(() => codexThreads.id, { onDelete: "cascade" })
      .notNull(),
    tokensUsed: bigint("tokens_used", { mode: "number" }).notNull(),
    deltaTokens: bigint("delta_tokens", { mode: "number" }).notNull(),
    ignoredStaleValue: boolean("ignored_stale_value").default(false).notNull(),
    sampledAtMs: bigint("sampled_at_ms", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceUserIdx: index("usage_events_workspace_user_idx").on(table.workspaceId, table.userId),
    threadIdx: index("usage_events_thread_idx").on(table.codexThreadId),
  }),
);

export const dailyUsageRollups = pgTable(
  "daily_usage_rollups",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    agentProvider: agentProviderEnum("agent_provider").default("codex").notNull(),
    usageDate: date("usage_date").notNull(),
    tokensUsed: bigint("tokens_used", { mode: "number" }).default(0).notNull(),
    threadCount: integer("thread_count").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId, table.usageDate, table.agentProvider] }),
    leaderboardIdx: index("daily_usage_rollups_leaderboard_idx").on(table.workspaceId, table.agentProvider, table.usageDate),
  }),
);

export const phoneVerificationCodes = pgTable(
  "phone_verification_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phoneNumber: varchar("phone_number", { length: 16 }).notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    ...timestamps,
  },
  (table) => ({
    phonePurposeIdx: index("phone_verification_codes_phone_purpose_idx").on(table.phoneNumber, table.purpose),
  }),
);

export const activationCodes = pgTable(
  "activation_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull(),
    status: inviteCodeStatusEnum("status").default("active").notNull(),
    label: varchar("label", { length: 200 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    activatedInstallationId: varchar("activated_installation_id", { length: 128 }),
    activatedPlatform: desktopPlatformEnum("activated_platform"),
    activatedAppVersion: varchar("activated_app_version", { length: 40 }),
    ...timestamps,
  },
  (table) => ({
    codeHashUnique: uniqueIndex("activation_codes_code_hash_unique").on(table.codeHash),
    statusIdx: index("activation_codes_status_idx").on(table.status),
    installationIdx: index("activation_codes_installation_idx").on(table.activatedInstallationId),
  }),
);

export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull(),
    status: inviteCodeStatusEnum("status").default("active").notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    usedByUserId: uuid("used_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    codeHashUnique: uniqueIndex("invite_codes_code_hash_unique").on(table.codeHash),
    statusIdx: index("invite_codes_status_idx").on(table.status),
  }),
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("refresh_tokens_token_hash_unique").on(table.tokenHash),
    userIdx: index("refresh_tokens_user_idx").on(table.userId),
  }),
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 64 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    usernameUnique: uniqueIndex("admin_users_username_unique").on(sql`lower(${table.username})`),
  }),
);
