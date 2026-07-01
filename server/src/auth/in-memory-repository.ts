import { randomUUID } from "node:crypto";
import { isDeviceOnline } from "@agent-light/shared";
import { hashOpaqueValue, createOpaqueToken } from "./crypto";
import {
  AuthRepositoryError,
  type AuthRepository,
  type BootstrapDeviceInput,
  type DeviceBootstrapResult,
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
  type ActivateClientInput,
  type ActivateClientResult,
  type ActivationCodeRecord,
  type AdminEndUserActivationSummary,
  type AdminEndUserDetailResult,
  type AdminEndUserDeviceRecord,
  type AdminEndUserListItem,
  type CreateActivationCodesInput,
  type CreateActivationCodesResult,
  type ListActivationCodesInput,
  type ListActivationCodesResult,
  type ListUsersForAdminInput,
  type ListUsersForAdminResult,
  inferAdminEndUserType,
} from "./repository";
import { resolveUsageRollupDate } from "../time/shanghai-date";

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

type InMemoryActivationCodeRecord = ActivationCodeRecord & {
  codeHash: string;
};

export class InMemoryAuthRepository implements AuthRepository {
  private readonly invites = new Map<string, InviteRecord>();
  private readonly activationCodes = new Map<string, InMemoryActivationCodeRecord>();
  private readonly activationCodesByHash = new Map<string, string>();
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

  addActivationCode(code: string, expiresAt: Date | null = null, label: string | null = null): void {
    const now = new Date();
    const codeHash = hashOpaqueValue(code);
    const record: InMemoryActivationCodeRecord = {
      id: randomUUID(),
      codeHash,
      status: "active",
      label,
      expiresAt,
      usedAt: null,
      userId: null,
      activatedInstallationId: null,
      activatedPlatform: null,
      activatedAppVersion: null,
      createdAt: now,
    };
    this.activationCodes.set(record.id, record);
    this.activationCodesByHash.set(codeHash, record.id);
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

  async updateUserDisplayName(userId: string, displayName: string): Promise<UserRecord> {
    const user = this.users.get(userId);
    if (!user) {
      throw new AuthRepositoryError("not_found", "User not found", 404);
    }

    const updated: UserRecord = {
      ...user,
      displayName: displayName.trim(),
    };
    this.users.set(userId, updated);
    return updated;
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

  async bootstrapDevice(input: BootstrapDeviceInput): Promise<DeviceBootstrapResult> {
    const existingDeviceId = this.devicesByInstallation.get(input.installationId);
    if (existingDeviceId) {
      const existing = this.devices.get(existingDeviceId);
      if (!existing) {
        throw new AuthRepositoryError("internal_error", "Device bootstrap failed", 500);
      }

      const user = this.users.get(existing.userId);
      if (!user || user.disabledAt) {
        throw new AuthRepositoryError("unauthorized", "Device owner is unavailable", 401);
      }

      const updated: DeviceRecord = {
        ...existing,
        platform: input.platform,
        appVersion: input.appVersion,
        deviceLabel: input.deviceLabel ?? existing.deviceLabel,
        lastSeenAt: new Date(),
      };
      this.devices.set(updated.id, updated);

      return {
        identity: {
          user,
          workspaces: this.memberships.get(user.id) ?? [],
          created: false,
        },
        device: updated,
        created: false,
      };
    }

    const now = new Date();
    const activationUser = this.findActivationUserForInstallation(input.installationId);
    if (!activationUser) {
      throw new AuthRepositoryError(
        "activation_code_required",
        "Device must be activated before cloud bootstrap",
        403,
      );
    }

    const user = this.users.get(activationUser.id);
    if (!user || user.disabledAt) {
      throw new AuthRepositoryError("unauthorized", "Activation account is unavailable", 401);
    }

    let memberships = this.memberships.get(user.id) ?? [];
    if (memberships.length === 0) {
      const workspace: WorkspaceRecord = {
        id: randomUUID(),
        name: `${user.displayName} 的工作空间`,
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
      memberships = [membership];
      this.memberships.set(user.id, memberships);
    }

    const workspaceId = memberships[0]!.membership.workspaceId;
    const device: DeviceRecord = {
      id: randomUUID(),
      workspaceId,
      userId: user.id,
      installationId: input.installationId,
      platform: input.platform,
      appVersion: input.appVersion,
      deviceLabel: input.deviceLabel ?? user.displayName,
      lastSeenAt: now,
      createdAt: now,
    };

    this.devices.set(device.id, device);
    this.devicesByInstallation.set(device.installationId, device.id);

    return {
      identity: { user, workspaces: memberships, created: false },
      device,
      created: true,
    };
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
        lastSeenAt: new Date(),
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
      lastSeenAt: new Date(),
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
      const usageDate = resolveUsageRollupDate(new Date());
      const rollupKey = `${input.workspaceId}:${input.userId}:${input.agentProvider}:${usageDate}`;
      const rollup = this.rollups.get(rollupKey) ?? {
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentProvider: input.agentProvider,
        usageDate,
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
      if (!this.isUserOnline(rollup.userId, input.workspaceId)) {
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
      if (!this.isUserOnline(rollup.userId, input.workspaceId)) {
        continue;
      }
      total += rollup.tokensUsed;
    }
    return total;
  }

  setDeviceLastSeenAt(installationId: string, lastSeenAt: Date | null): void {
    const deviceId = this.devicesByInstallation.get(installationId);
    if (!deviceId) {
      return;
    }
    const device = this.devices.get(deviceId);
    if (!device) {
      return;
    }
    this.devices.set(deviceId, { ...device, lastSeenAt });
  }

  private isUserOnline(userId: string, workspaceId?: string): boolean {
    for (const device of this.devices.values()) {
      if (device.userId !== userId) {
        continue;
      }
      if (workspaceId && device.workspaceId !== workspaceId) {
        continue;
      }
      if (isDeviceOnline(device.lastSeenAt)) {
        return true;
      }
    }
    return false;
  }

  async getTokenRank(input: GetTokenRankInput): Promise<number | null> {
    const entries = await this.getTokenLeaderboard({ ...input, limit: Number.MAX_SAFE_INTEGER });
    const entry = entries.find((item) => item.userId === input.userId);
    return entry?.rank ?? null;
  }

  async activateClient(input: ActivateClientInput): Promise<ActivateClientResult> {
    for (const record of this.activationCodes.values()) {
      if (record.status === "used" && record.activatedInstallationId === input.installationId) {
        return {
          activationId: record.id,
          installationId: input.installationId,
          activatedAt: record.usedAt ?? new Date(),
        };
      }
    }

    const codeId = this.activationCodesByHash.get(input.activationCodeHash);
    const code = codeId ? this.activationCodes.get(codeId) : undefined;
    if (!code || code.status !== "active" || (code.expiresAt && code.expiresAt <= new Date())) {
      if (!code) {
        throw new AuthRepositoryError("activation_code_invalid", "Activation code is invalid", 400);
      }
      if (code.status === "revoked") {
        throw new AuthRepositoryError("activation_code_revoked", "Activation code has been revoked", 400);
      }
      if (code.status === "used") {
        throw new AuthRepositoryError("activation_code_used", "Activation code has already been used", 400);
      }
      if (code.expiresAt && code.expiresAt <= new Date()) {
        throw new AuthRepositoryError("activation_code_expired", "Activation code has expired", 400);
      }
      throw new AuthRepositoryError("activation_code_invalid", "Activation code is invalid", 400);
    }

    const now = new Date();
    const displayName = generateRandomDisplayName();
    const user: UserRecord = {
      id: randomUUID(),
      email: syntheticActivationEmail(code.id),
      phoneNumber: null,
      passwordHash: input.passwordHash,
      displayName,
      disabledAt: null,
      createdAt: now,
    };
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: `${displayName} 的工作空间`,
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
    this.memberships.set(user.id, [membership]);

    code.status = "used";
    code.usedAt = now;
    code.userId = user.id;
    code.activatedInstallationId = input.installationId;
    code.activatedPlatform = input.platform;
    code.activatedAppVersion = input.appVersion;

    return {
      activationId: code.id,
      installationId: input.installationId,
      activatedAt: now,
    };
  }

  async createActivationCodes(input: CreateActivationCodesInput): Promise<CreateActivationCodesResult> {
    const codes: Array<{ id: string; code: string }> = [];
    for (let index = 0; index < input.count; index += 1) {
      const plaintext = `AL-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
      const codeHash = hashOpaqueValue(plaintext);
      const now = new Date();
      const record: InMemoryActivationCodeRecord = {
        id: randomUUID(),
        codeHash,
        status: "active",
        label: input.label,
        expiresAt: input.expiresAt,
        usedAt: null,
        userId: null,
        activatedInstallationId: null,
        activatedPlatform: null,
        activatedAppVersion: null,
        createdAt: now,
      };
      this.activationCodes.set(record.id, record);
      this.activationCodesByHash.set(codeHash, record.id);
      codes.push({ id: record.id, code: plaintext });
    }
    return { codes };
  }

  async listActivationCodes(input: ListActivationCodesInput): Promise<ListActivationCodesResult> {
    const items = [...this.activationCodes.values()]
      .filter((record) => !input.status || record.status === input.status)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return {
      items: items.slice(input.offset, input.offset + input.limit).map(({ codeHash: _codeHash, ...record }) => record),
      total: items.length,
    };
  }

  async revokeActivationCode(id: string): Promise<void> {
    const record = this.activationCodes.get(id);
    if (!record) {
      throw new AuthRepositoryError("not_found", "Activation code not found", 404);
    }

    if (record.status === "revoked") {
      return;
    }

    if (record.status === "used") {
      throw new AuthRepositoryError(
        "activation_code_used",
        "Activation code has already been used and cannot be revoked",
        409,
      );
    }

    record.status = "revoked";
  }

  async listUsersForAdmin(input: ListUsersForAdminInput): Promise<ListUsersForAdminResult> {
    const items = [...this.users.values()]
      .filter((user) => matchesAdminUserFilters(user, input))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return {
      items: items.slice(input.offset, input.offset + input.limit).map((user) => toAdminEndUserListItem(this, user)),
      total: items.length,
    };
  }

  async getUserAdminDetail(userId: string): Promise<AdminEndUserDetailResult | undefined> {
    const user = this.users.get(userId);
    if (!user) {
      return undefined;
    }

    const devices = [...this.devices.values()]
      .filter((device) => device.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(toAdminEndUserDeviceRecord);

    let activationCode: AdminEndUserActivationSummary | null = null;
    for (const record of this.activationCodes.values()) {
      if (record.userId === userId) {
        activationCode = {
          id: record.id,
          status: record.status,
          label: record.label,
          usedAt: record.usedAt,
        };
        break;
      }
    }

    return {
      user,
      deviceCount: devices.length,
      userType: inferAdminEndUserType(user.email),
      devices,
      activationCode,
    };
  }

  async setUserDisabled(userId: string, disabled: boolean): Promise<UserRecord> {
    const user = this.users.get(userId);
    if (!user) {
      throw new AuthRepositoryError("not_found", "User not found", 404);
    }

    const updated: UserRecord = {
      ...user,
      disabledAt: disabled ? new Date() : null,
    };
    this.users.set(userId, updated);

    if (disabled) {
      for (const [id, token] of this.refreshTokens.entries()) {
        if (token.userId === userId && !token.revokedAt) {
          this.refreshTokens.set(id, { ...token, revokedAt: new Date() });
        }
      }
    }

    return updated;
  }

  private findActivationUserForInstallation(installationId: string): { id: string } | undefined {
    for (const record of this.activationCodes.values()) {
      if (record.status === "used" && record.activatedInstallationId === installationId && record.userId) {
        return { id: record.userId };
      }
    }
    return undefined;
  }
}

function codexThreadKey(input: RecordCodexThreadUsageInput): string {
  return `${input.workspaceId}:${input.userId}:${input.deviceId}:${input.agentProvider}:${input.codexThreadId}`;
}

function syntheticActivationEmail(activationCodeId: string): string {
  const normalized = activationCodeId.replace(/-/g, "").slice(0, 32);
  return `activation-${normalized}@activation.agent-light.local`;
}

function generateRandomDisplayName(): string {
  const token = createOpaqueToken(6).replace(/_/g, "").slice(0, 6).toLowerCase();
  return `玩家_${token}`;
}

function syntheticPhoneEmail(phoneNumber: string): string {
  const normalized = phoneNumber.replace("+", "00");
  return `phone-${normalized}@phone.agent-light.local`;
}

function matchesAdminUserFilters(user: UserRecord, input: ListUsersForAdminInput): boolean {
  if (input.type && inferAdminEndUserType(user.email) !== input.type) {
    return false;
  }

  if (input.status === "active" && user.disabledAt) {
    return false;
  }

  if (input.status === "disabled" && !user.disabledAt) {
    return false;
  }

  if (input.q) {
    const needle = input.q.toLowerCase();
    return (
      user.email.toLowerCase().includes(needle) ||
      user.displayName.toLowerCase().includes(needle) ||
      (user.phoneNumber?.toLowerCase().includes(needle) ?? false)
    );
  }

  return true;
}

function toAdminEndUserListItem(repository: InMemoryAuthRepository, user: UserRecord): AdminEndUserListItem {
  const deviceCount = [...repository["devices"].values()].filter((device) => device.userId === user.id).length;
  return {
    user,
    deviceCount,
    userType: inferAdminEndUserType(user.email),
  };
}

function toAdminEndUserDeviceRecord(device: DeviceRecord): AdminEndUserDeviceRecord {
  return {
    id: device.id,
    installationId: device.installationId,
    platform: device.platform,
    appVersion: device.appVersion,
    deviceLabel: device.deviceLabel,
    lastSeenAt: null,
    createdAt: device.createdAt,
  };
}
