import { randomUUID } from "node:crypto";
import { hashOpaqueValue } from "./crypto";
import {
  AuthRepositoryError,
  type AuthRepository,
  type BindHardwareDeviceInput,
  type CodexThreadUsageResult,
  type ConsumePhoneVerificationCodeInput,
  type CreatePhoneVerificationCodeInput,
  type CreateRefreshTokenInput,
  type DeviceRecord,
  type GetTokenLeaderboardInput,
  type GetTokenRankInput,
  type HardwareDeviceRecord,
  type LeaderboardEntryRecord,
  type RecordCodexThreadUsageInput,
  type RefreshTokenRecord,
  type RegisteredIdentity,
  type RegisterOrLoginWithPhoneInput,
  type RegisterWithInviteInput,
  type UpsertDeviceInput,
  type UserRecord,
  type WorkspaceMembershipRecord,
  type WorkspaceRecord,
} from "./repository";

type InviteRecord = {
  codeHash: string;
  status: "active" | "used" | "revoked";
  expiresAt: Date | null;
  usedByUserId: string | null;
};

type PhoneVerificationRecord = {
  id: string;
  phoneNumber: string;
  codeHash: string;
  purpose: "register";
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

export class InMemoryAuthRepository implements AuthRepository {
  private readonly invites = new Map<string, InviteRecord>();
  private readonly users = new Map<string, UserRecord>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly usersByPhone = new Map<string, string>();
  private readonly phoneVerificationCodes = new Map<string, PhoneVerificationRecord>();
  private readonly memberships = new Map<string, WorkspaceMembershipRecord[]>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord & { tokenHash: string }>();
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly devicesByInstallation = new Map<string, string>();
  private readonly hardwareDevices = new Map<string, HardwareDeviceRecord>();
  private readonly hardwareDevicesByHardwareId = new Map<string, string>();
  private readonly codexThreads = new Map<string, { id: string; input: RecordCodexThreadUsageInput; tokensUsed: number }>();
  private readonly rollups = new Map<
    string,
    { workspaceId: string; userId: string; agentProvider: string; usageDate: string; tokensUsed: number }
  >();

  addInviteCode(code: string, expiresAt: Date | null = null): void {
    const codeHash = hashOpaqueValue(code);
    this.invites.set(codeHash, {
      codeHash,
      status: "active",
      expiresAt,
      usedByUserId: null,
    });
  }

  async registerWithInvite(input: RegisterWithInviteInput): Promise<RegisteredIdentity> {
    const invite = this.invites.get(input.inviteCodeHash);
    if (!invite || invite.status !== "active" || (invite.expiresAt && invite.expiresAt <= new Date())) {
      throw new AuthRepositoryError("invite_code_invalid", "Invite code is invalid or expired", 400);
    }

    if (this.usersByEmail.has(input.email)) {
      throw new AuthRepositoryError("conflict", "Email already registered", 409);
    }

    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      email: input.email,
      phoneNumber: null,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      disabledAt: null,
      createdAt: now,
    };
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: `${input.displayName}'s Workspace`,
      createdAt: now,
    };
    const membership: WorkspaceMembershipRecord = {
      workspace,
      membership: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
        joinedAt: now,
      },
    };

    invite.status = "used";
    invite.usedByUserId = user.id;
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    this.memberships.set(user.id, [membership]);

    return { user, workspaces: [membership], created: true };
  }

  async createPhoneVerificationCode(input: CreatePhoneVerificationCodeInput): Promise<void> {
    const now = new Date();
    for (const record of this.phoneVerificationCodes.values()) {
      if (record.phoneNumber === input.phoneNumber && record.purpose === input.purpose && !record.consumedAt) {
        record.consumedAt = now;
      }
    }

    const record: PhoneVerificationRecord = {
      id: randomUUID(),
      phoneNumber: input.phoneNumber,
      codeHash: input.codeHash,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      consumedAt: null,
      attempts: 0,
      createdAt: now,
    };
    this.phoneVerificationCodes.set(record.id, record);
  }

  async consumePhoneVerificationCode(input: ConsumePhoneVerificationCodeInput): Promise<void> {
    const record = Array.from(this.phoneVerificationCodes.values())
      .filter((item) => item.phoneNumber === input.phoneNumber && item.purpose === input.purpose && !item.consumedAt)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

    if (!record) {
      throw new AuthRepositoryError("verification_code_invalid", "Verification code is invalid", 400);
    }
    if (record.expiresAt <= input.now) {
      throw new AuthRepositoryError("verification_code_expired", "Verification code has expired", 400);
    }
    if (record.attempts >= 5 || record.codeHash !== input.codeHash) {
      record.attempts += 1;
      throw new AuthRepositoryError("verification_code_invalid", "Verification code is invalid", 400);
    }

    record.consumedAt = input.now;
  }

  async registerOrLoginWithPhone(input: RegisterOrLoginWithPhoneInput): Promise<RegisteredIdentity> {
    const existingUserId = this.usersByPhone.get(input.phoneNumber);
    if (existingUserId) {
      const user = this.users.get(existingUserId)!;
      return { user, workspaces: this.memberships.get(user.id) ?? [], created: false };
    }

    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      email: syntheticPhoneEmail(input.phoneNumber),
      phoneNumber: input.phoneNumber,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      disabledAt: null,
      createdAt: now,
    };
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: `${input.displayName}'s Workspace`,
      createdAt: now,
    };
    const membership: WorkspaceMembershipRecord = {
      workspace,
      membership: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
        joinedAt: now,
      },
    };

    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    this.usersByPhone.set(user.phoneNumber!, user.id);
    this.memberships.set(user.id, [membership]);

    return { user, workspaces: [membership], created: true };
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const userId = this.usersByEmail.get(email);
    return userId ? this.users.get(userId) : undefined;
  }

  async findUserById(userId: string): Promise<UserRecord | undefined> {
    return this.users.get(userId);
  }

  async listMemberships(userId: string): Promise<WorkspaceMembershipRecord[]> {
    return this.memberships.get(userId) ?? [];
  }

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<void> {
    this.refreshTokens.set(input.tokenHash, {
      id: randomUUID(),
      tokenHash: input.tokenHash,
      userId: input.userId,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    return this.refreshTokens.get(tokenHash);
  }

  async revokeRefreshToken(id: string): Promise<void> {
    for (const token of this.refreshTokens.values()) {
      if (token.id === id) {
        token.revokedAt = new Date();
      }
    }
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord> {
    const existingDeviceId = this.devicesByInstallation.get(input.installationId);
    if (existingDeviceId) {
      const existing = this.devices.get(existingDeviceId)!;
      if (existing.userId !== input.userId || existing.workspaceId !== input.workspaceId) {
        throw new AuthRepositoryError("conflict", "Device installation is already registered", 409);
      }

      const updated: DeviceRecord = {
        ...existing,
        platform: input.platform,
        appVersion: input.appVersion,
        deviceLabel: input.deviceLabel ?? existing.deviceLabel,
      };
      this.devices.set(updated.id, updated);
      return updated;
    }

    const device: DeviceRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      installationId: input.installationId,
      platform: input.platform,
      appVersion: input.appVersion,
      deviceLabel: input.deviceLabel ?? null,
      createdAt: new Date(),
    };
    this.devices.set(device.id, device);
    this.devicesByInstallation.set(device.installationId, device.id);
    return device;
  }

  async bindHardwareDevice(input: BindHardwareDeviceInput): Promise<HardwareDeviceRecord> {
    const device = this.devices.get(input.deviceId);
    if (!device || device.userId !== input.userId) {
      throw new AuthRepositoryError("forbidden", "Device access denied", 403);
    }

    const existingHardwareDeviceId = this.hardwareDevicesByHardwareId.get(input.hardwareDeviceId);
    if (existingHardwareDeviceId) {
      const existing = this.hardwareDevices.get(existingHardwareDeviceId)!;
      if (existing.workspaceId !== device.workspaceId || existing.deviceId !== device.id) {
        throw new AuthRepositoryError("conflict", "Hardware device is already bound", 409);
      }

      const updated: HardwareDeviceRecord = {
        ...existing,
        firmwareVersion: input.firmwareVersion,
        protocolVersion: input.protocolVersion,
        hardwareRevision: input.hardwareRevision,
      };
      this.hardwareDevices.set(updated.id, updated);
      return updated;
    }

    const hardwareDevice: HardwareDeviceRecord = {
      id: randomUUID(),
      workspaceId: device.workspaceId,
      deviceId: device.id,
      hardwareDeviceId: input.hardwareDeviceId,
      firmwareVersion: input.firmwareVersion,
      protocolVersion: input.protocolVersion,
      hardwareRevision: input.hardwareRevision,
      boundAt: new Date(),
    };
    this.hardwareDevices.set(hardwareDevice.id, hardwareDevice);
    this.hardwareDevicesByHardwareId.set(hardwareDevice.hardwareDeviceId, hardwareDevice.id);
    return hardwareDevice;
  }

  async recordCodexThreadUsage(input: RecordCodexThreadUsageInput): Promise<CodexThreadUsageResult> {
    const device = this.devices.get(input.deviceId);
    if (!device || device.userId !== input.userId || device.workspaceId !== input.workspaceId) {
      throw new AuthRepositoryError("forbidden", "Device access denied", 403);
    }

    const key = codexThreadKey(input);
    const existing = this.codexThreads.get(key);
    const ignoredStaleValue = Boolean(existing && input.tokensUsed < existing.tokensUsed);
    const acceptedTokensUsed = ignoredStaleValue ? existing!.tokensUsed : Math.max(existing?.tokensUsed ?? 0, input.tokensUsed);
    const deltaTokens = ignoredStaleValue ? 0 : acceptedTokensUsed - (existing?.tokensUsed ?? 0);

    this.codexThreads.set(key, {
      id: existing?.id ?? randomUUID(),
      input,
      tokensUsed: acceptedTokensUsed,
    });

    if (deltaTokens > 0 || !existing) {
      const rollupKey = `${input.workspaceId}:${input.userId}:${input.agentProvider}:${toUsageDate(input.sampledAtMs)}`;
      const rollup = this.rollups.get(rollupKey) ?? {
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentProvider: input.agentProvider,
        usageDate: toUsageDate(input.sampledAtMs),
        tokensUsed: 0,
      };
      rollup.tokensUsed += deltaTokens;
      this.rollups.set(rollupKey, rollup);
    }

    return {
      codexThreadId: input.codexThreadId,
      tokensUsed: input.tokensUsed,
      acceptedTokensUsed,
      ignoredStaleValue,
    };
  }

  async getTokenLeaderboard(input: GetTokenLeaderboardInput): Promise<LeaderboardEntryRecord[]> {
    const totals = new Map<string, number>();
    for (const rollup of this.rollups.values()) {
      if (rollup.agentProvider !== input.agentProvider) {
        continue;
      }
      if (input.workspaceId && rollup.workspaceId !== input.workspaceId) {
        continue;
      }
      if (input.fromDate && rollup.usageDate < input.fromDate) {
        continue;
      }
      if (input.toDate && rollup.usageDate > input.toDate) {
        continue;
      }

      totals.set(rollup.userId, (totals.get(rollup.userId) ?? 0) + rollup.tokensUsed);
    }

    return Array.from(totals.entries())
      .map(([userId, tokensUsed]) => ({
        userId,
        displayName: this.users.get(userId)?.displayName ?? "Unknown",
        tokensUsed,
        rank: 0,
      }))
      .sort((left, right) => right.tokensUsed - left.tokensUsed || left.displayName.localeCompare(right.displayName))
      .slice(0, input.limit)
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));
  }

  async getTokenLeaderboardTotal(input: Omit<GetTokenLeaderboardInput, "limit">): Promise<number> {
    let total = 0;
    for (const rollup of this.rollups.values()) {
      if (rollup.agentProvider !== input.agentProvider) {
        continue;
      }
      if (input.workspaceId && rollup.workspaceId !== input.workspaceId) {
        continue;
      }
      if (input.fromDate && rollup.usageDate < input.fromDate) {
        continue;
      }
      if (input.toDate && rollup.usageDate > input.toDate) {
        continue;
      }
      total += rollup.tokensUsed;
    }
    return total;
  }

  async getTokenRank(input: GetTokenRankInput): Promise<number | null> {
    const entries = await this.getTokenLeaderboard({ ...input, limit: Number.MAX_SAFE_INTEGER });
    const entry = entries.find((item) => item.userId === input.userId);
    return entry?.rank ?? null;
  }
}

function codexThreadKey(input: RecordCodexThreadUsageInput): string {
  return `${input.workspaceId}:${input.userId}:${input.deviceId}:${input.agentProvider}:${input.codexThreadId}`;
}

function toUsageDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function syntheticPhoneEmail(phoneNumber: string): string {
  const normalized = phoneNumber.replace("+", "00");
  return `phone-${normalized}@phone.agent-light.local`;
}
