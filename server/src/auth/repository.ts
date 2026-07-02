import { and, desc, eq, exists, gt, gte, isNotNull, isNull, like, lte, or, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { AgentProvider, ApiErrorCode, DesktopPlatform, WorkspaceRole } from "@agent-light/shared";
import { DEVICE_ONLINE_THRESHOLD_MS } from "@agent-light/shared";
import * as schema from "../db/schema";
import { countStar, fetchRowById, newRowId, updateRowById } from "../db/query-helpers";
import { createOpaqueToken, hashOpaqueValue } from "./crypto";
import { resolveUsageRollupDate, toUsageDateObject } from "../time/shanghai-date";

type Db = MySql2Database<typeof schema>;

export type UserRecord = {
  id: string;
  email: string;
  phoneNumber: string | null;
  passwordHash: string;
  displayName: string;
  disabledAt: Date | null;
  createdAt: Date;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  createdAt: Date;
};

export type WorkspaceMembershipRecord = {
  workspace: WorkspaceRecord;
  membership: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    joinedAt: Date;
  };
};

export type RegisteredIdentity = {
  user: UserRecord;
  workspaces: WorkspaceMembershipRecord[];
  created: boolean;
};

export type RefreshTokenRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type DeviceRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  installationId: string;
  platform: DesktopPlatform;
  appVersion: string;
  deviceLabel: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export type HardwareDeviceRecord = {
  id: string;
  workspaceId: string;
  deviceId: string;
  hardwareDeviceId: string;
  firmwareVersion: string;
  protocolVersion: string;
  hardwareRevision: string;
  boundAt: Date;
};

export type CodexThreadUsageResult = {
  codexThreadId: string;
  tokensUsed: number;
  acceptedTokensUsed: number;
  ignoredStaleValue: boolean;
};

export type LeaderboardEntryRecord = {
  userId: string;
  displayName: string;
  tokensUsed: number;
  rank: number;
};

export type RegisterWithInviteInput = {
  inviteCodeHash: string;
  email: string;
  passwordHash: string;
  displayName: string;
};

export type CreatePhoneVerificationCodeInput = {
  phoneNumber: string;
  codeHash: string;
  purpose: "register";
  expiresAt: Date;
};

export type ConsumePhoneVerificationCodeInput = {
  phoneNumber: string;
  codeHash: string;
  purpose: "register";
  now: Date;
};

export type RegisterOrLoginWithPhoneInput = {
  phoneNumber: string;
  passwordHash: string;
  displayName: string;
};

export type CreateRefreshTokenInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type UpsertDeviceInput = {
  userId: string;
  workspaceId: string;
  installationId: string;
  platform: DesktopPlatform;
  appVersion: string;
  deviceLabel?: string;
};

export type BootstrapDeviceInput = {
  installationId: string;
  platform: DesktopPlatform;
  appVersion: string;
  deviceLabel?: string;
  passwordHash: string;
};

export type DeviceBootstrapResult = {
  identity: RegisteredIdentity;
  device: DeviceRecord;
  created: boolean;
};

export type BindHardwareDeviceInput = {
  userId: string;
  deviceId: string;
  hardwareDeviceId: string;
  firmwareVersion: string;
  protocolVersion: string;
  hardwareRevision: string;
};

export type RecordCodexThreadUsageInput = {
  userId: string;
  workspaceId: string;
  deviceId: string;
  agentProvider: AgentProvider;
  codexThreadId: string;
  model?: string;
  tokensUsed: number;
  threadUpdatedAtMs: number;
  sampledAtMs: number;
};

export type GetTokenLeaderboardInput = {
  agentProvider: AgentProvider;
  workspaceId?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
};

export type GetTokenRankInput = Omit<GetTokenLeaderboardInput, "limit"> & {
  userId: string;
};

export type ActivationCodeStatus = "active" | "used" | "revoked";

export type ActivationCodeRecord = {
  id: string;
  status: ActivationCodeStatus;
  label: string | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  userId: string | null;
  activatedInstallationId: string | null;
  activatedPlatform: DesktopPlatform | null;
  activatedAppVersion: string | null;
  createdAt: Date;
};

export type ActivateClientInput = {
  activationCodeHash: string;
  installationId: string;
  platform: DesktopPlatform;
  appVersion: string;
  passwordHash: string;
};

export type ActivateClientResult = {
  activationId: string;
  installationId: string;
  activatedAt: Date;
};

export type CreateActivationCodesInput = {
  count: number;
  expiresAt: Date | null;
  label: string | null;
};

export type CreateActivationCodesResult = {
  codes: Array<{ id: string; code: string }>;
};

export type ListActivationCodesInput = {
  status?: ActivationCodeStatus;
  limit: number;
  offset: number;
};

export type ListActivationCodesResult = {
  items: ActivationCodeRecord[];
  total: number;
};

export type AdminEndUserType = "email" | "phone" | "activation";
export type AdminEndUserStatus = "active" | "disabled";

export type ListUsersForAdminInput = {
  q?: string;
  type?: AdminEndUserType;
  status?: AdminEndUserStatus;
  limit: number;
  offset: number;
};

export type AdminEndUserListItem = {
  user: UserRecord;
  deviceCount: number;
  userType: AdminEndUserType;
};

export type ListUsersForAdminResult = {
  items: AdminEndUserListItem[];
  total: number;
};

export type AdminEndUserDeviceRecord = {
  id: string;
  installationId: string;
  platform: DesktopPlatform;
  appVersion: string;
  deviceLabel: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export type AdminEndUserActivationSummary = {
  id: string;
  status: ActivationCodeStatus;
  label: string | null;
  usedAt: Date | null;
};

export type AdminEndUserDetailResult = {
  user: UserRecord;
  deviceCount: number;
  userType: AdminEndUserType;
  devices: AdminEndUserDeviceRecord[];
  activationCode: AdminEndUserActivationSummary | null;
};

export function inferAdminEndUserType(email: string): AdminEndUserType {
  if (email.endsWith("@phone.agent-light.local") && email.startsWith("phone-")) {
    return "phone";
  }

  if (email.endsWith("@activation.agent-light.local") && email.startsWith("activation-")) {
    return "activation";
  }

  return "email";
}

export interface AuthRepository {
  registerWithInvite(input: RegisterWithInviteInput): Promise<RegisteredIdentity>;
  createPhoneVerificationCode(input: CreatePhoneVerificationCodeInput): Promise<void>;
  consumePhoneVerificationCode(input: ConsumePhoneVerificationCodeInput): Promise<void>;
  registerOrLoginWithPhone(input: RegisterOrLoginWithPhoneInput): Promise<RegisteredIdentity>;
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  findUserById(userId: string): Promise<UserRecord | undefined>;
  updateUserDisplayName(userId: string, displayName: string): Promise<UserRecord>;
  listMemberships(userId: string): Promise<WorkspaceMembershipRecord[]>;
  createRefreshToken(input: CreateRefreshTokenInput): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined>;
  revokeRefreshToken(id: string): Promise<void>;
  bootstrapDevice(input: BootstrapDeviceInput): Promise<DeviceBootstrapResult>;
  upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord>;
  bindHardwareDevice(input: BindHardwareDeviceInput): Promise<HardwareDeviceRecord>;
  recordCodexThreadUsage(input: RecordCodexThreadUsageInput): Promise<CodexThreadUsageResult>;
  getTokenLeaderboard(input: GetTokenLeaderboardInput): Promise<LeaderboardEntryRecord[]>;
  getTokenLeaderboardTotal(input: Omit<GetTokenLeaderboardInput, "limit">): Promise<number>;
  getTokenRank(input: GetTokenRankInput): Promise<number | null>;
  activateClient(input: ActivateClientInput): Promise<ActivateClientResult>;
  createActivationCodes(input: CreateActivationCodesInput): Promise<CreateActivationCodesResult>;
  listActivationCodes(input: ListActivationCodesInput): Promise<ListActivationCodesResult>;
  revokeActivationCode(id: string): Promise<void>;
  listUsersForAdmin(input: ListUsersForAdminInput): Promise<ListUsersForAdminResult>;
  getUserAdminDetail(userId: string): Promise<AdminEndUserDetailResult | undefined>;
  setUserDisabled(userId: string, disabled: boolean): Promise<UserRecord>;
}

export class AuthRepositoryError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: Db) {}

  async registerWithInvite(input: RegisterWithInviteInput): Promise<RegisteredIdentity> {
    return this.db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(schema.inviteCodes)
        .where(
          and(
            eq(schema.inviteCodes.codeHash, input.inviteCodeHash),
            eq(schema.inviteCodes.status, "active"),
            or(isNull(schema.inviteCodes.expiresAt), gt(schema.inviteCodes.expiresAt, new Date())),
          ),
        )
        .limit(1);

      if (!invite) {
        throw new AuthRepositoryError("invite_code_invalid", "Invite code is invalid or expired", 400);
      }

      const [existingUser] = await tx.select().from(schema.users).where(eq(schema.users.email, input.email)).limit(1);
      if (existingUser) {
        throw new AuthRepositoryError("conflict", "Email already registered", 409);
      }

      const userId = newRowId();
      await tx.insert(schema.users).values({
        id: userId,
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
      });
      const user = await fetchRowById<typeof schema.users.$inferSelect>(tx, schema.users, userId);
      if (!user) {
        throw new AuthRepositoryError("internal_error", "User insert failed", 500);
      }
      const workspaceName = `${input.displayName}'s Workspace`;
      const workspaceId = newRowId();
      await tx.insert(schema.workspaces).values({ id: workspaceId, name: workspaceName });
      const workspace = await fetchRowById<typeof schema.workspaces.$inferSelect>(tx, schema.workspaces, workspaceId);
      if (!workspace) {
        throw new AuthRepositoryError("internal_error", "Workspace insert failed", 500);
      }
      await tx.insert(schema.workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });
      const [membership] = await tx
        .select()
        .from(schema.workspaceMembers)
        .where(and(eq(schema.workspaceMembers.workspaceId, workspace.id), eq(schema.workspaceMembers.userId, user.id)))
        .limit(1);
      if (!membership) {
        throw new AuthRepositoryError("internal_error", "Membership insert failed", 500);
      }

      await tx
        .update(schema.inviteCodes)
        .set({
          status: "used",
          usedByUserId: user.id,
          usedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.inviteCodes.id, invite.id));

      return {
        user: mapUser(user),
        workspaces: [
          {
            workspace: mapWorkspace(workspace),
            membership: {
              workspaceId: membership.workspaceId,
              userId: membership.userId,
              role: membership.role,
              joinedAt: membership.joinedAt,
            },
          },
        ],
        created: true,
      };
    });
  }

  async createPhoneVerificationCode(input: CreatePhoneVerificationCodeInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.phoneVerificationCodes)
        .set({ consumedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.phoneVerificationCodes.phoneNumber, input.phoneNumber),
            eq(schema.phoneVerificationCodes.purpose, input.purpose),
            isNull(schema.phoneVerificationCodes.consumedAt),
          ),
        );

      await tx.insert(schema.phoneVerificationCodes).values({
        phoneNumber: input.phoneNumber,
        codeHash: input.codeHash,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
      });
    });
  }

  async consumePhoneVerificationCode(input: ConsumePhoneVerificationCodeInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(schema.phoneVerificationCodes)
        .where(
          and(
            eq(schema.phoneVerificationCodes.phoneNumber, input.phoneNumber),
            eq(schema.phoneVerificationCodes.purpose, input.purpose),
            isNull(schema.phoneVerificationCodes.consumedAt),
          ),
        )
        .orderBy(desc(schema.phoneVerificationCodes.createdAt))
        .limit(1)
        .for("update");

      if (!record) {
        throw new AuthRepositoryError("verification_code_invalid", "Verification code is invalid", 400);
      }
      if (record.expiresAt <= input.now) {
        throw new AuthRepositoryError("verification_code_expired", "Verification code has expired", 400);
      }
      if (record.attempts >= 5 || record.codeHash !== input.codeHash) {
        await tx
          .update(schema.phoneVerificationCodes)
          .set({
            attempts: sql`${schema.phoneVerificationCodes.attempts} + 1`,
            updatedAt: input.now,
          })
          .where(eq(schema.phoneVerificationCodes.id, record.id));
        throw new AuthRepositoryError("verification_code_invalid", "Verification code is invalid", 400);
      }

      await tx
        .update(schema.phoneVerificationCodes)
        .set({ consumedAt: input.now, updatedAt: input.now })
        .where(eq(schema.phoneVerificationCodes.id, record.id));
    });
  }

  async registerOrLoginWithPhone(input: RegisterOrLoginWithPhoneInput): Promise<RegisteredIdentity> {
    return this.db.transaction(async (tx) => {
      const [existingUser] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.phoneNumber, input.phoneNumber))
        .limit(1);

      if (existingUser) {
        return {
          user: mapUser(existingUser),
          workspaces: await listMemberships(tx, existingUser.id),
          created: false,
        };
      }

      const userId = newRowId();
      await tx.insert(schema.users).values({
        id: userId,
        email: syntheticPhoneEmail(input.phoneNumber),
        phoneNumber: input.phoneNumber,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
      });
      const user = await fetchRowById<typeof schema.users.$inferSelect>(tx, schema.users, userId);
      if (!user) {
        throw new AuthRepositoryError("internal_error", "User insert failed", 500);
      }
      const workspaceId = newRowId();
      await tx.insert(schema.workspaces).values({ id: workspaceId, name: `${input.displayName}'s Workspace` });
      const workspace = await fetchRowById<typeof schema.workspaces.$inferSelect>(tx, schema.workspaces, workspaceId);
      if (!workspace) {
        throw new AuthRepositoryError("internal_error", "Workspace insert failed", 500);
      }
      await tx.insert(schema.workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });
      const [membership] = await tx
        .select()
        .from(schema.workspaceMembers)
        .where(and(eq(schema.workspaceMembers.workspaceId, workspace.id), eq(schema.workspaceMembers.userId, user.id)))
        .limit(1);
      if (!membership) {
        throw new AuthRepositoryError("internal_error", "Membership insert failed", 500);
      }

      return {
        user: mapUser(user),
        workspaces: [
          {
            workspace: mapWorkspace(workspace),
            membership: {
              workspaceId: membership.workspaceId,
              userId: membership.userId,
              role: membership.role,
              joinedAt: membership.joinedAt,
            },
          },
        ],
        created: true,
      };
    });
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return user ? mapUser(user) : undefined;
  }

  async findUserById(userId: string): Promise<UserRecord | undefined> {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return user ? mapUser(user) : undefined;
  }

  async updateUserDisplayName(userId: string, displayName: string): Promise<UserRecord> {
    const user = await updateRowById<typeof schema.users.$inferSelect>(this.db, schema.users, userId, {
      displayName: displayName.trim(),
      updatedAt: new Date(),
    });

    return mapUser(user);
  }

  async listMemberships(userId: string): Promise<WorkspaceMembershipRecord[]> {
    const rows = await this.db
      .select({
        workspace: schema.workspaces,
        membership: schema.workspaceMembers,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .where(eq(schema.workspaceMembers.userId, userId));

    return rows.map((row) => ({
      workspace: mapWorkspace(row.workspace),
      membership: {
        workspaceId: row.membership.workspaceId,
        userId: row.membership.userId,
        role: row.membership.role,
        joinedAt: row.membership.joinedAt,
      },
    }));
  }

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<void> {
    await this.db.insert(schema.refreshTokens).values(input);
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const [token] = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);

    return token
      ? {
          id: token.id,
          userId: token.userId,
          expiresAt: token.expiresAt,
          revokedAt: token.revokedAt,
        }
      : undefined;
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, id));
  }

  async bootstrapDevice(input: BootstrapDeviceInput): Promise<DeviceBootstrapResult> {
    return this.db.transaction(async (tx) => {
      const existingDevice = await findDeviceByInstallationId(tx, input.installationId);
      if (existingDevice) {
        const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, existingDevice.userId)).limit(1);
        if (!user || user.disabledAt) {
          throw new AuthRepositoryError("unauthorized", "Device owner is unavailable", 401);
        }

        const device = await updateRowById<typeof schema.devices.$inferSelect>(tx, schema.devices, existingDevice.id, {
          platform: input.platform,
          appVersion: input.appVersion,
          deviceLabel: input.deviceLabel ?? existingDevice.deviceLabel,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        });

        return {
          identity: {
            user: mapUser(user),
            workspaces: await listMemberships(tx, user.id),
            created: false,
          },
          device: mapDevice(device),
          created: false,
        };
      }

      const activationUser = await findActivationUserForInstallation(tx, input.installationId);
      if (!activationUser) {
        throw new AuthRepositoryError(
          "activation_code_required",
          "Device must be activated before cloud bootstrap",
          403,
        );
      }

      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, activationUser.id)).limit(1);
      if (!user || user.disabledAt) {
        throw new AuthRepositoryError("unauthorized", "Activation account is unavailable", 401);
      }

      const memberships = await listMemberships(tx, user.id);
      let workspaceId = memberships[0]?.membership.workspaceId;
      if (!workspaceId) {
        const newWorkspaceId = newRowId();
        await tx.insert(schema.workspaces).values({ id: newWorkspaceId, name: `${user.displayName} 的工作空间` });
        const workspace = await fetchRowById<typeof schema.workspaces.$inferSelect>(tx, schema.workspaces, newWorkspaceId);
        if (!workspace) {
          throw new AuthRepositoryError("internal_error", "Workspace insert failed", 500);
        }
        await tx.insert(schema.workspaceMembers).values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "owner",
        });
        workspaceId = workspace.id;
      }

      const deviceId = newRowId();
      await tx.insert(schema.devices).values({
        id: deviceId,
        workspaceId,
        userId: user.id,
        installationId: input.installationId,
        platform: input.platform,
        appVersion: input.appVersion,
        deviceLabel: input.deviceLabel ?? user.displayName,
        lastSeenAt: new Date(),
      });
      const device = await fetchRowById<typeof schema.devices.$inferSelect>(tx, schema.devices, deviceId);
      if (!device) {
        throw new AuthRepositoryError("internal_error", "Device insert failed", 500);
      }

      return {
        identity: {
          user: mapUser(user),
          workspaces: await listMemberships(tx, user.id),
          created: false,
        },
        device: mapDevice(device),
        created: true,
      };
    });
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord> {
    const [existing] = await this.db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.installationId, input.installationId))
      .limit(1);

    if (existing && (existing.userId !== input.userId || existing.workspaceId !== input.workspaceId)) {
      throw new AuthRepositoryError("conflict", "Device installation is already registered", 409);
    }

    if (existing) {
      const device = await updateRowById<typeof schema.devices.$inferSelect>(this.db, schema.devices, existing.id, {
        platform: input.platform,
        appVersion: input.appVersion,
        deviceLabel: input.deviceLabel ?? existing.deviceLabel,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      });
      return mapDevice(device);
    }

    const deviceId = newRowId();
    await this.db.insert(schema.devices).values({
      id: deviceId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      installationId: input.installationId,
      platform: input.platform,
      appVersion: input.appVersion,
      deviceLabel: input.deviceLabel,
      lastSeenAt: new Date(),
    });
    const device = await fetchRowById<typeof schema.devices.$inferSelect>(this.db, schema.devices, deviceId);
    if (!device) {
      throw new AuthRepositoryError("internal_error", "Device insert failed", 500);
    }

    return mapDevice(device);
  }

  async bindHardwareDevice(input: BindHardwareDeviceInput): Promise<HardwareDeviceRecord> {
    return this.db.transaction(async (tx) => {
      const [device] = await tx
        .select()
        .from(schema.devices)
        .where(and(eq(schema.devices.id, input.deviceId), eq(schema.devices.userId, input.userId)))
        .limit(1);

      if (!device) {
        throw new AuthRepositoryError("forbidden", "Device access denied", 403);
      }

      const [existing] = await tx
        .select()
        .from(schema.hardwareDevices)
        .where(eq(schema.hardwareDevices.hardwareDeviceId, input.hardwareDeviceId))
        .limit(1);

      if (existing && (existing.workspaceId !== device.workspaceId || existing.deviceId !== device.id)) {
        throw new AuthRepositoryError("conflict", "Hardware device is already bound", 409);
      }

      if (existing) {
        const hardwareDevice = await updateRowById<typeof schema.hardwareDevices.$inferSelect>(
          tx,
          schema.hardwareDevices,
          existing.id,
          {
            firmwareVersion: input.firmwareVersion,
            protocolVersion: input.protocolVersion,
            hardwareRevision: input.hardwareRevision,
            updatedAt: new Date(),
          },
        );
        return mapHardwareDevice(hardwareDevice);
      }

      const hardwareId = newRowId();
      await tx.insert(schema.hardwareDevices).values({
        id: hardwareId,
        workspaceId: device.workspaceId,
        deviceId: device.id,
        hardwareDeviceId: input.hardwareDeviceId,
        firmwareVersion: input.firmwareVersion,
        protocolVersion: input.protocolVersion,
        hardwareRevision: input.hardwareRevision,
      });
      const hardwareDevice = await fetchRowById<typeof schema.hardwareDevices.$inferSelect>(
        tx,
        schema.hardwareDevices,
        hardwareId,
      );
      if (!hardwareDevice) {
        throw new AuthRepositoryError("internal_error", "Hardware device insert failed", 500);
      }

      return mapHardwareDevice(hardwareDevice);
    });
  }

  async recordCodexThreadUsage(input: RecordCodexThreadUsageInput): Promise<CodexThreadUsageResult> {
    return this.db.transaction(async (tx) => {
      const [device] = await tx
        .select({ id: schema.devices.id })
        .from(schema.devices)
        .where(
          and(
            eq(schema.devices.id, input.deviceId),
            eq(schema.devices.userId, input.userId),
            eq(schema.devices.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (!device) {
        throw new AuthRepositoryError("forbidden", "Device access denied", 403);
      }

      const now = new Date();
      let existingThread = await findCodexThreadForUpdate(tx, input);
      let insertedNewThread = false;
      let thread = existingThread;

      if (!thread) {
        const insertedThread = await insertCodexThread(tx, input, now);
        if (insertedThread) {
          thread = insertedThread;
          insertedNewThread = true;
        } else {
          existingThread = await findCodexThreadForUpdate(tx, input);
          if (!existingThread) {
            throw new AuthRepositoryError("internal_error", "Codex thread upsert failed", 500);
          }
          thread = existingThread;
        }
      }

      const previousTokensUsed = insertedNewThread ? 0 : thread.tokensUsed;
      const ignoredStaleValue = !insertedNewThread && input.tokensUsed < previousTokensUsed;
      const acceptedTokensUsed = ignoredStaleValue ? previousTokensUsed : Math.max(previousTokensUsed, input.tokensUsed);
      const deltaTokens = ignoredStaleValue ? 0 : acceptedTokensUsed - previousTokensUsed;

      if (!insertedNewThread) {
        thread = await updateCodexThread(tx, thread.id, input, acceptedTokensUsed, now);
      }

      await tx.insert(schema.usageEvents).values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        deviceId: input.deviceId,
        agentProvider: input.agentProvider,
        codexThreadId: thread.id,
        tokensUsed: input.tokensUsed,
        deltaTokens,
        ignoredStaleValue,
        sampledAtMs: input.sampledAtMs,
      });

      if (deltaTokens > 0 || insertedNewThread) {
        await upsertDailyRollup(tx, input, deltaTokens, insertedNewThread ? 1 : 0, now);
      }

      return {
        codexThreadId: input.codexThreadId,
        tokensUsed: input.tokensUsed,
        acceptedTokensUsed,
        ignoredStaleValue,
      };
    });
  }

  async getTokenLeaderboard(input: GetTokenLeaderboardInput): Promise<LeaderboardEntryRecord[]> {
    const rows = await selectLeaderboardRows(this.db, input, input.limit);

    return rows.map((row, index) => ({
      userId: row.userId,
      displayName: row.displayName,
      tokensUsed: Number(row.tokensUsed),
      rank: index + 1,
    }));
  }

  async getTokenLeaderboardTotal(input: Omit<GetTokenLeaderboardInput, "limit">): Promise<number> {
    const tokenSum = sql<number>`coalesce(sum(${schema.dailyUsageRollups.tokensUsed}), 0)`;
    const [row] = await this.db
      .select({ tokensUsed: tokenSum })
      .from(schema.dailyUsageRollups)
      .where(buildRollupWhere(this.db, input));

    return Number(row?.tokensUsed ?? 0);
  }

  async getTokenRank(input: GetTokenRankInput): Promise<number | null> {
    const rows = await selectLeaderboardRows(this.db, input);
    const index = rows.findIndex((row) => row.userId === input.userId);
    return index >= 0 ? index + 1 : null;
  }

  async activateClient(input: ActivateClientInput): Promise<ActivateClientResult> {
    return this.db.transaction(async (tx) => {
      const [existingByInstallation] = await tx
        .select()
        .from(schema.activationCodes)
        .where(
          and(
            eq(schema.activationCodes.activatedInstallationId, input.installationId),
            eq(schema.activationCodes.status, "used"),
          ),
        )
        .limit(1);

      if (existingByInstallation) {
        return {
          activationId: existingByInstallation.id,
          installationId: input.installationId,
          activatedAt: existingByInstallation.usedAt ?? new Date(),
        };
      }

      const [code] = await tx
        .select()
        .from(schema.activationCodes)
        .where(
          and(
            eq(schema.activationCodes.codeHash, input.activationCodeHash),
            eq(schema.activationCodes.status, "active"),
            or(isNull(schema.activationCodes.expiresAt), gt(schema.activationCodes.expiresAt, new Date())),
          ),
        )
        .limit(1);

      if (!code) {
        const [existing] = await tx
          .select()
          .from(schema.activationCodes)
          .where(eq(schema.activationCodes.codeHash, input.activationCodeHash))
          .limit(1);

        if (!existing) {
          throw new AuthRepositoryError("activation_code_invalid", "Activation code is invalid", 400);
        }
        if (existing.status === "revoked") {
          throw new AuthRepositoryError("activation_code_revoked", "Activation code has been revoked", 400);
        }
        if (existing.status === "used") {
          throw new AuthRepositoryError("activation_code_used", "Activation code has already been used", 400);
        }
        if (existing.expiresAt && existing.expiresAt <= new Date()) {
          throw new AuthRepositoryError("activation_code_expired", "Activation code has expired", 400);
        }
        throw new AuthRepositoryError("activation_code_invalid", "Activation code is invalid", 400);
      }

      const now = new Date();
      const displayName = generateRandomDisplayName();
      const userId = newRowId();
      await tx.insert(schema.users).values({
        id: userId,
        email: syntheticActivationEmail(code.id),
        passwordHash: input.passwordHash,
        displayName,
      });
      const user = await fetchRowById<typeof schema.users.$inferSelect>(tx, schema.users, userId);
      if (!user) {
        throw new AuthRepositoryError("internal_error", "User insert failed", 500);
      }
      const workspaceId = newRowId();
      await tx.insert(schema.workspaces).values({ id: workspaceId, name: `${displayName} 的工作空间` });
      const workspace = await fetchRowById<typeof schema.workspaces.$inferSelect>(tx, schema.workspaces, workspaceId);
      if (!workspace) {
        throw new AuthRepositoryError("internal_error", "Workspace insert failed", 500);
      }
      await tx.insert(schema.workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });

      await tx
        .update(schema.activationCodes)
        .set({
          status: "used",
          usedAt: now,
          userId: user.id,
          activatedInstallationId: input.installationId,
          activatedPlatform: input.platform,
          activatedAppVersion: input.appVersion,
          updatedAt: now,
        })
        .where(eq(schema.activationCodes.id, code.id));

      return {
        activationId: code.id,
        installationId: input.installationId,
        activatedAt: now,
      };
    });
  }

  async createActivationCodes(input: CreateActivationCodesInput): Promise<CreateActivationCodesResult> {
    const codes: Array<{ id: string; code: string }> = [];

    await this.db.transaction(async (tx) => {
      for (let index = 0; index < input.count; index += 1) {
        const plaintext = generateActivationCodePlaintext();
        const codeHash = hashOpaqueValue(plaintext);
        const codeId = newRowId();
        await tx.insert(schema.activationCodes).values({
          id: codeId,
          codeHash,
          status: "active",
          label: input.label,
          expiresAt: input.expiresAt,
        });

        codes.push({ id: codeId, code: plaintext });
      }
    });

    return { codes };
  }

  async listActivationCodes(input: ListActivationCodesInput): Promise<ListActivationCodesResult> {
    const filters = input.status ? eq(schema.activationCodes.status, input.status) : undefined;
    const whereClause = filters ? and(filters) : undefined;

    const [countRow] = await this.db
      .select({ total: countStar })
      .from(schema.activationCodes)
      .where(whereClause);

    const rows = await this.db
      .select()
      .from(schema.activationCodes)
      .where(whereClause)
      .orderBy(desc(schema.activationCodes.createdAt))
      .limit(input.limit)
      .offset(input.offset);

    return {
      items: rows.map(mapActivationCode),
      total: Number(countRow?.total ?? 0),
    };
  }

  async revokeActivationCode(id: string): Promise<void> {
    const [existing] = await this.db
      .select({ status: schema.activationCodes.status })
      .from(schema.activationCodes)
      .where(eq(schema.activationCodes.id, id))
      .limit(1);

    if (!existing) {
      throw new AuthRepositoryError("not_found", "Activation code not found", 404);
    }

    if (existing.status === "revoked") {
      return;
    }

    if (existing.status === "used") {
      throw new AuthRepositoryError(
        "activation_code_used",
        "Activation code has already been used and cannot be revoked",
        409,
      );
    }

    await this.db
      .update(schema.activationCodes)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(schema.activationCodes.id, id));
  }

  async listUsersForAdmin(input: ListUsersForAdminInput): Promise<ListUsersForAdminResult> {
    const whereClause = buildAdminUserWhere(input);
    const deviceCountSubquery = this.db
      .select({
        userId: schema.devices.userId,
        deviceCount: countStar.as("device_count"),
      })
      .from(schema.devices)
      .groupBy(schema.devices.userId)
      .as("device_counts");

    const [countRow] = await this.db.select({ total: countStar }).from(schema.users).where(whereClause);

    const rows = await this.db
      .select({
        user: schema.users,
        deviceCount: sql<number>`coalesce(${deviceCountSubquery.deviceCount}, 0)`,
      })
      .from(schema.users)
      .leftJoin(deviceCountSubquery, eq(schema.users.id, deviceCountSubquery.userId))
      .where(whereClause)
      .orderBy(desc(schema.users.createdAt))
      .limit(input.limit)
      .offset(input.offset);

    return {
      items: rows.map((row) => ({
        user: mapUser(row.user),
        deviceCount: Number(row.deviceCount ?? 0),
        userType: inferAdminEndUserType(row.user.email),
      })),
      total: Number(countRow?.total ?? 0),
    };
  }

  async getUserAdminDetail(userId: string): Promise<AdminEndUserDetailResult | undefined> {
    const [userRow] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!userRow) {
      return undefined;
    }

    const user = mapUser(userRow);
    const deviceRows = await this.db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.userId, userId))
      .orderBy(desc(schema.devices.lastSeenAt), desc(schema.devices.createdAt));

    const [activationRow] = await this.db
      .select({
        id: schema.activationCodes.id,
        status: schema.activationCodes.status,
        label: schema.activationCodes.label,
        usedAt: schema.activationCodes.usedAt,
      })
      .from(schema.activationCodes)
      .where(eq(schema.activationCodes.userId, userId))
      .orderBy(desc(schema.activationCodes.usedAt), desc(schema.activationCodes.createdAt))
      .limit(1);

    return {
      user,
      deviceCount: deviceRows.length,
      userType: inferAdminEndUserType(user.email),
      devices: deviceRows.map(mapAdminEndUserDevice),
      activationCode: activationRow
        ? {
            id: activationRow.id,
            status: activationRow.status,
            label: activationRow.label,
            usedAt: activationRow.usedAt,
          }
        : null,
    };
  }

  async setUserDisabled(userId: string, disabled: boolean): Promise<UserRecord> {
    const [existing] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!existing) {
      throw new AuthRepositoryError("not_found", "User not found", 404);
    }

    const disabledAt = disabled ? new Date() : null;
    const updated = await updateRowById<typeof schema.users.$inferSelect>(this.db, schema.users, userId, {
      disabledAt,
      updatedAt: new Date(),
    });

    if (disabled) {
      await this.db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
    }

    return mapUser(updated);
  }
}

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function listMemberships(tx: Transaction, userId: string): Promise<WorkspaceMembershipRecord[]> {
  const rows = await tx
    .select({
      workspace: schema.workspaces,
      membership: schema.workspaceMembers,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMembers.userId, userId));

  return rows.map((row) => ({
    workspace: mapWorkspace(row.workspace),
    membership: {
      workspaceId: row.membership.workspaceId,
      userId: row.membership.userId,
      role: row.membership.role,
      joinedAt: row.membership.joinedAt,
    },
  }));
}

async function selectLeaderboardRows(
  db: Db,
  input: Omit<GetTokenLeaderboardInput, "limit">,
  limit?: number,
) {
  const tokenSum = sql<number>`coalesce(sum(${schema.dailyUsageRollups.tokensUsed}), 0)`;
  const query = db
    .select({
      userId: schema.dailyUsageRollups.userId,
      displayName: schema.users.displayName,
      tokensUsed: tokenSum,
    })
    .from(schema.dailyUsageRollups)
    .innerJoin(schema.users, eq(schema.dailyUsageRollups.userId, schema.users.id))
    .where(buildRollupWhere(db, input))
    .groupBy(schema.dailyUsageRollups.userId, schema.users.displayName)
    .orderBy(desc(tokenSum), schema.users.displayName);

  return limit ? query.limit(limit) : query;
}

function buildRollupWhere(db: Db, input: Omit<GetTokenLeaderboardInput, "limit">) {
  const onlineCutoff = new Date(Date.now() - DEVICE_ONLINE_THRESHOLD_MS);

  return and(
    eq(schema.dailyUsageRollups.agentProvider, input.agentProvider),
    input.workspaceId ? eq(schema.dailyUsageRollups.workspaceId, input.workspaceId) : undefined,
    input.fromDate ? gte(schema.dailyUsageRollups.usageDate, toUsageDateObject(input.fromDate)) : undefined,
    input.toDate ? lte(schema.dailyUsageRollups.usageDate, toUsageDateObject(input.toDate)) : undefined,
    exists(
      db
        .select({ id: schema.devices.id })
        .from(schema.devices)
        .where(
          and(
            eq(schema.devices.userId, schema.dailyUsageRollups.userId),
            isNotNull(schema.devices.lastSeenAt),
            gt(schema.devices.lastSeenAt, onlineCutoff),
            input.workspaceId ? eq(schema.devices.workspaceId, input.workspaceId) : undefined,
          ),
        ),
    ),
  );
}

async function findDeviceByInstallationId(tx: Transaction, installationId: string) {
  const [device] = await tx
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.installationId, installationId))
    .limit(1);
  return device ? mapDevice(device) : undefined;
}

async function findCodexThreadForUpdate(tx: Transaction, input: RecordCodexThreadUsageInput) {
  const [thread] = await tx
    .select()
    .from(schema.codexThreads)
    .where(
      and(
        eq(schema.codexThreads.workspaceId, input.workspaceId),
        eq(schema.codexThreads.userId, input.userId),
        eq(schema.codexThreads.deviceId, input.deviceId),
        eq(schema.codexThreads.agentProvider, input.agentProvider),
        eq(schema.codexThreads.codexThreadId, input.codexThreadId),
      ),
    )
    .limit(1)
    .for("update");
  return thread;
}

async function insertCodexThread(tx: Transaction, input: RecordCodexThreadUsageInput, now: Date) {
  const threadId = newRowId();
  try {
    await tx.insert(schema.codexThreads).values({
      id: threadId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      deviceId: input.deviceId,
      agentProvider: input.agentProvider,
      codexThreadId: input.codexThreadId,
      model: input.model,
      tokensUsed: input.tokensUsed,
      threadUpdatedAtMs: input.threadUpdatedAtMs,
      lastUploadedAt: now,
    });
  } catch {
    // Duplicate composite key: another worker inserted the same thread.
  }

  const [thread] = await tx
    .select()
    .from(schema.codexThreads)
    .where(
      and(
        eq(schema.codexThreads.workspaceId, input.workspaceId),
        eq(schema.codexThreads.userId, input.userId),
        eq(schema.codexThreads.deviceId, input.deviceId),
        eq(schema.codexThreads.agentProvider, input.agentProvider),
        eq(schema.codexThreads.codexThreadId, input.codexThreadId),
      ),
    )
    .limit(1);
  return thread;
}

async function updateCodexThread(
  tx: Transaction,
  threadId: string,
  input: RecordCodexThreadUsageInput,
  acceptedTokensUsed: number,
  now: Date,
) {
  return updateRowById<typeof schema.codexThreads.$inferSelect>(tx, schema.codexThreads, threadId, {
    model: input.model,
    tokensUsed: acceptedTokensUsed,
    threadUpdatedAtMs: sql`greatest(${schema.codexThreads.threadUpdatedAtMs}, ${input.threadUpdatedAtMs})`,
    lastUploadedAt: now,
    updatedAt: now,
  });
}

async function upsertDailyRollup(
  tx: Transaction,
  input: RecordCodexThreadUsageInput,
  deltaTokens: number,
  threadCountDelta: number,
  now: Date,
): Promise<void> {
  await tx
    .insert(schema.dailyUsageRollups)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentProvider: input.agentProvider,
      usageDate: toUsageDateObject(resolveUsageRollupDate(now)),
      tokensUsed: deltaTokens,
      threadCount: threadCountDelta,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        tokensUsed: sql`${schema.dailyUsageRollups.tokensUsed} + ${deltaTokens}`,
        threadCount: sql`${schema.dailyUsageRollups.threadCount} + ${threadCountDelta}`,
        updatedAt: now,
      },
    });
}

function mapUser(user: typeof schema.users.$inferSelect): UserRecord {
  return {
    id: user.id,
    email: user.email,
    phoneNumber: user.phoneNumber,
    passwordHash: user.passwordHash,
    displayName: user.displayName,
    disabledAt: user.disabledAt,
    createdAt: user.createdAt,
  };
}

function mapWorkspace(workspace: typeof schema.workspaces.$inferSelect): WorkspaceRecord {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
  };
}

function mapDevice(device: typeof schema.devices.$inferSelect): DeviceRecord {
  return {
    id: device.id,
    workspaceId: device.workspaceId,
    userId: device.userId,
    installationId: device.installationId,
    platform: device.platform,
    appVersion: device.appVersion,
    deviceLabel: device.deviceLabel,
    lastSeenAt: device.lastSeenAt,
    createdAt: device.createdAt,
  };
}

function mapAdminEndUserDevice(device: typeof schema.devices.$inferSelect): AdminEndUserDeviceRecord {
  return {
    id: device.id,
    installationId: device.installationId,
    platform: device.platform,
    appVersion: device.appVersion,
    deviceLabel: device.deviceLabel,
    lastSeenAt: device.lastSeenAt,
    createdAt: device.createdAt,
  };
}

function buildAdminUserWhere(input: ListUsersForAdminInput) {
  const filters = [];

  if (input.q) {
    const pattern = `%${input.q}%`;
    filters.push(
      or(
        like(schema.users.email, pattern),
        like(schema.users.displayName, pattern),
        like(schema.users.phoneNumber, pattern),
      ),
    );
  }

  if (input.type === "phone") {
    filters.push(and(like(schema.users.email, "phone-%@phone.agent-light.local")));
  } else if (input.type === "activation") {
    filters.push(and(like(schema.users.email, "activation-%@activation.agent-light.local")));
  } else if (input.type === "email") {
    filters.push(
      and(
        sql`${schema.users.email} not like 'phone-%@phone.agent-light.local'`,
        sql`${schema.users.email} not like 'activation-%@activation.agent-light.local'`,
      ),
    );
  }

  if (input.status === "active") {
    filters.push(isNull(schema.users.disabledAt));
  } else if (input.status === "disabled") {
    filters.push(isNotNull(schema.users.disabledAt));
  }

  return filters.length > 0 ? and(...filters) : undefined;
}

function mapHardwareDevice(hardwareDevice: typeof schema.hardwareDevices.$inferSelect): HardwareDeviceRecord {
  return {
    id: hardwareDevice.id,
    workspaceId: hardwareDevice.workspaceId,
    deviceId: hardwareDevice.deviceId,
    hardwareDeviceId: hardwareDevice.hardwareDeviceId,
    firmwareVersion: hardwareDevice.firmwareVersion,
    protocolVersion: hardwareDevice.protocolVersion,
    hardwareRevision: hardwareDevice.hardwareRevision,
    boundAt: hardwareDevice.boundAt,
  };
}

function syntheticPhoneEmail(phoneNumber: string): string {
  const normalized = phoneNumber.replace("+", "00");
  return `phone-${normalized}@phone.agent-light.local`;
}

function syntheticActivationEmail(activationCodeId: string): string {
  const normalized = activationCodeId.replace(/-/g, "").slice(0, 32);
  return `activation-${normalized}@activation.agent-light.local`;
}

function generateRandomDisplayName(): string {
  const token = createOpaqueToken(6).replace(/_/g, "").slice(0, 6).toLowerCase();
  return `玩家_${token}`;
}

async function findActivationUserForInstallation(
  tx: Transaction,
  installationId: string,
): Promise<{ id: string } | undefined> {
  const [activation] = await tx
    .select({ userId: schema.activationCodes.userId })
    .from(schema.activationCodes)
    .where(
      and(
        eq(schema.activationCodes.activatedInstallationId, installationId),
        eq(schema.activationCodes.status, "used"),
      ),
    )
    .limit(1);

  if (!activation?.userId) {
    return undefined;
  }

  return { id: activation.userId };
}

function generateActivationCodePlaintext(): string {
  const token = createOpaqueToken(12).replace(/_/g, "").toUpperCase();
  return `AL-${token.slice(0, 16)}`;
}

function mapActivationCode(row: typeof schema.activationCodes.$inferSelect): ActivationCodeRecord {
  return {
    id: row.id,
    status: row.status,
    label: row.label,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    userId: row.userId,
    activatedInstallationId: row.activatedInstallationId,
    activatedPlatform: row.activatedPlatform,
    activatedAppVersion: row.activatedAppVersion,
    createdAt: row.createdAt,
  };
}
