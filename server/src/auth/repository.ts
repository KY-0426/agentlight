import { and, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AgentProvider, ApiErrorCode, DesktopPlatform, WorkspaceRole } from "@agent-light/shared";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

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

      const [user] = await tx
        .insert(schema.users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
        })
        .returning();
      const workspaceName = `${input.displayName}'s Workspace`;
      const [workspace] = await tx.insert(schema.workspaces).values({ name: workspaceName }).returning();
      const [membership] = await tx
        .insert(schema.workspaceMembers)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "owner",
        })
        .returning();

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

      const [user] = await tx
        .insert(schema.users)
        .values({
          email: syntheticPhoneEmail(input.phoneNumber),
          phoneNumber: input.phoneNumber,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
        })
        .returning();
      const [workspace] = await tx.insert(schema.workspaces).values({ name: `${input.displayName}'s Workspace` }).returning();
      const [membership] = await tx
        .insert(schema.workspaceMembers)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "owner",
        })
        .returning();

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
    const [user] = await this.db
      .update(schema.users)
      .set({
        displayName: displayName.trim(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

    if (!user) {
      throw new AuthRepositoryError("not_found", "User not found", 404);
    }

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

        const [device] = await tx
          .update(schema.devices)
          .set({
            platform: input.platform,
            appVersion: input.appVersion,
            deviceLabel: input.deviceLabel ?? existingDevice.deviceLabel,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.devices.id, existingDevice.id))
          .returning();

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

      const displayName = input.deviceLabel?.trim() || defaultDeviceDisplayName(input.installationId);
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: syntheticDeviceEmail(input.installationId),
          passwordHash: input.passwordHash,
          displayName,
        })
        .returning();
      const [workspace] = await tx
        .insert(schema.workspaces)
        .values({ name: `${displayName} Workspace` })
        .returning();
      const [membership] = await tx
        .insert(schema.workspaceMembers)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "owner",
        })
        .returning();
      const [device] = await tx
        .insert(schema.devices)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          installationId: input.installationId,
          platform: input.platform,
          appVersion: input.appVersion,
          deviceLabel: input.deviceLabel ?? displayName,
          lastSeenAt: new Date(),
        })
        .returning();

      return {
        identity: {
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
      const [device] = await this.db
        .update(schema.devices)
        .set({
          platform: input.platform,
          appVersion: input.appVersion,
          deviceLabel: input.deviceLabel ?? existing.deviceLabel,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.devices.id, existing.id))
        .returning();
      return mapDevice(device);
    }

    const [device] = await this.db
      .insert(schema.devices)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        installationId: input.installationId,
        platform: input.platform,
        appVersion: input.appVersion,
        deviceLabel: input.deviceLabel,
        lastSeenAt: new Date(),
      })
      .returning();

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
        const [hardwareDevice] = await tx
          .update(schema.hardwareDevices)
          .set({
            firmwareVersion: input.firmwareVersion,
            protocolVersion: input.protocolVersion,
            hardwareRevision: input.hardwareRevision,
            updatedAt: new Date(),
          })
          .where(eq(schema.hardwareDevices.id, existing.id))
          .returning();
        return mapHardwareDevice(hardwareDevice);
      }

      const [hardwareDevice] = await tx
        .insert(schema.hardwareDevices)
        .values({
          workspaceId: device.workspaceId,
          deviceId: device.id,
          hardwareDeviceId: input.hardwareDeviceId,
          firmwareVersion: input.firmwareVersion,
          protocolVersion: input.protocolVersion,
          hardwareRevision: input.hardwareRevision,
        })
        .returning();

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
      .where(buildRollupWhere(input));

    return Number(row?.tokensUsed ?? 0);
  }

  async getTokenRank(input: GetTokenRankInput): Promise<number | null> {
    const rows = await selectLeaderboardRows(this.db, input);
    const index = rows.findIndex((row) => row.userId === input.userId);
    return index >= 0 ? index + 1 : null;
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
    .where(buildRollupWhere(input))
    .groupBy(schema.dailyUsageRollups.userId, schema.users.displayName)
    .orderBy(desc(tokenSum), schema.users.displayName);

  return limit ? query.limit(limit) : query;
}

function buildRollupWhere(input: Omit<GetTokenLeaderboardInput, "limit">) {
  return and(
    eq(schema.dailyUsageRollups.agentProvider, input.agentProvider),
    input.workspaceId ? eq(schema.dailyUsageRollups.workspaceId, input.workspaceId) : undefined,
    input.fromDate ? gte(schema.dailyUsageRollups.usageDate, input.fromDate) : undefined,
    input.toDate ? lte(schema.dailyUsageRollups.usageDate, input.toDate) : undefined,
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
  const [thread] = await tx
    .insert(schema.codexThreads)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      deviceId: input.deviceId,
      agentProvider: input.agentProvider,
      codexThreadId: input.codexThreadId,
      model: input.model,
      tokensUsed: input.tokensUsed,
      threadUpdatedAtMs: input.threadUpdatedAtMs,
      lastUploadedAt: now,
    })
    .onConflictDoNothing({
      target: [
        schema.codexThreads.workspaceId,
        schema.codexThreads.userId,
        schema.codexThreads.deviceId,
        schema.codexThreads.agentProvider,
        schema.codexThreads.codexThreadId,
      ],
    })
    .returning();
  return thread;
}

async function updateCodexThread(
  tx: Transaction,
  threadId: string,
  input: RecordCodexThreadUsageInput,
  acceptedTokensUsed: number,
  now: Date,
) {
  const [thread] = await tx
    .update(schema.codexThreads)
    .set({
      model: input.model,
      tokensUsed: acceptedTokensUsed,
      threadUpdatedAtMs: sql`greatest(${schema.codexThreads.threadUpdatedAtMs}, ${input.threadUpdatedAtMs})`,
      lastUploadedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.codexThreads.id, threadId))
    .returning();
  return thread;
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
      usageDate: toUsageDate(input.sampledAtMs),
      tokensUsed: deltaTokens,
      threadCount: threadCountDelta,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.dailyUsageRollups.workspaceId,
        schema.dailyUsageRollups.userId,
        schema.dailyUsageRollups.usageDate,
        schema.dailyUsageRollups.agentProvider,
      ],
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
    createdAt: device.createdAt,
  };
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

function toUsageDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function syntheticPhoneEmail(phoneNumber: string): string {
  const normalized = phoneNumber.replace("+", "00");
  return `phone-${normalized}@phone.agent-light.local`;
}

function syntheticDeviceEmail(installationId: string): string {
  const normalized = installationId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);
  return `device-${normalized}@device.agent-light.local`;
}

function defaultDeviceDisplayName(installationId: string): string {
  return `设备 ${installationId.slice(-4)}`;
}
