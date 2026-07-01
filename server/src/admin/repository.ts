import { desc, eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { ApiErrorCode } from "@agent-light/shared";
import * as schema from "../db/schema";
import { countStar, fetchRowById, newRowId, updateRowById } from "../db/query-helpers";

type Db = MySql2Database<typeof schema>;

export type AdminUserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  disabledAt: Date | null;
  createdAt: Date;
};

export type ListAdminsInput = {
  limit: number;
  offset: number;
};

export type ListAdminsResult = {
  items: AdminUserRecord[];
  total: number;
};

export type CreateAdminInput = {
  username: string;
  passwordHash: string;
  displayName: string;
};

export type UpdateAdminInput = {
  displayName?: string;
  passwordHash?: string;
};

export interface AdminRepository {
  findAdminByUsername(username: string): Promise<AdminUserRecord | undefined>;
  findAdminById(id: string): Promise<AdminUserRecord | undefined>;
  listAdmins(input: ListAdminsInput): Promise<ListAdminsResult>;
  createAdmin(input: CreateAdminInput): Promise<AdminUserRecord>;
  updateAdmin(id: string, input: UpdateAdminInput): Promise<AdminUserRecord>;
  setAdminDisabled(id: string, disabled: boolean): Promise<AdminUserRecord>;
  countActiveAdmins(): Promise<number>;
}

export class AdminRepositoryError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export class DrizzleAdminRepository implements AdminRepository {
  constructor(private readonly db: Db) {}

  async findAdminByUsername(username: string): Promise<AdminUserRecord | undefined> {
    const normalized = username.trim().toLowerCase();
    const rows = await this.db
      .select()
      .from(schema.adminUsers)
      .where(sql`lower(${schema.adminUsers.username}) = ${normalized}`)
      .limit(1);

    const row = rows[0];
    return row ? toAdminUserRecord(row) : undefined;
  }

  async findAdminById(id: string): Promise<AdminUserRecord | undefined> {
    const rows = await this.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, id)).limit(1);
    const row = rows[0];
    return row ? toAdminUserRecord(row) : undefined;
  }

  async listAdmins(input: ListAdminsInput): Promise<ListAdminsResult> {
    const [countRow] = await this.db.select({ total: countStar }).from(schema.adminUsers);

    const rows = await this.db
      .select()
      .from(schema.adminUsers)
      .orderBy(desc(schema.adminUsers.createdAt))
      .limit(input.limit)
      .offset(input.offset);

    return {
      items: rows.map(toAdminUserRecord),
      total: Number(countRow?.total ?? 0),
    };
  }

  async createAdmin(input: CreateAdminInput): Promise<AdminUserRecord> {
    const normalizedUsername = input.username.trim().toLowerCase();
    const [existing] = await this.db
      .select({ id: schema.adminUsers.id })
      .from(schema.adminUsers)
      .where(sql`lower(${schema.adminUsers.username}) = ${normalizedUsername}`)
      .limit(1);

    if (existing) {
      throw new AdminRepositoryError("conflict", "Admin username already exists", 409);
    }

    const adminId = newRowId();
    await this.db.insert(schema.adminUsers).values({
      id: adminId,
      username: normalizedUsername,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
    });
    const row = await fetchRowById<typeof schema.adminUsers.$inferSelect>(this.db, schema.adminUsers, adminId);
    if (!row) {
      throw new AdminRepositoryError("internal_error", "Admin insert failed", 500);
    }

    return toAdminUserRecord(row);
  }

  async updateAdmin(id: string, input: UpdateAdminInput): Promise<AdminUserRecord> {
    const [existing] = await this.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, id)).limit(1);
    if (!existing) {
      throw new AdminRepositoryError("not_found", "Admin account not found", 404);
    }

    const row = await updateRowById<typeof schema.adminUsers.$inferSelect>(this.db, schema.adminUsers, id, {
      displayName: input.displayName ?? existing.displayName,
      passwordHash: input.passwordHash ?? existing.passwordHash,
      updatedAt: new Date(),
    });

    return toAdminUserRecord(row);
  }

  async setAdminDisabled(id: string, disabled: boolean): Promise<AdminUserRecord> {
    const [existing] = await this.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, id)).limit(1);
    if (!existing) {
      throw new AdminRepositoryError("not_found", "Admin account not found", 404);
    }

    const row = await updateRowById<typeof schema.adminUsers.$inferSelect>(this.db, schema.adminUsers, id, {
      disabledAt: disabled ? new Date() : null,
      updatedAt: new Date(),
    });

    return toAdminUserRecord(row);
  }

  async countActiveAdmins(): Promise<number> {
    const [countRow] = await this.db
      .select({ total: countStar })
      .from(schema.adminUsers)
      .where(sql`${schema.adminUsers.disabledAt} is null`);

    return Number(countRow?.total ?? 0);
  }
}

export class InMemoryAdminRepository implements AdminRepository {
  private readonly users = new Map<string, AdminUserRecord>();
  private readonly usersByUsername = new Map<string, string>();

  constructor(seed?: AdminUserRecord) {
    if (seed) {
      this.users.set(seed.id, seed);
      this.usersByUsername.set(seed.username.toLowerCase(), seed.id);
    }
  }

  async findAdminByUsername(username: string): Promise<AdminUserRecord | undefined> {
    const id = this.usersByUsername.get(username.toLowerCase());
    return id ? this.users.get(id) : undefined;
  }

  async findAdminById(id: string): Promise<AdminUserRecord | undefined> {
    return this.users.get(id);
  }

  async listAdmins(input: ListAdminsInput): Promise<ListAdminsResult> {
    const items = [...this.users.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return {
      items: items.slice(input.offset, input.offset + input.limit),
      total: items.length,
    };
  }

  async createAdmin(input: CreateAdminInput): Promise<AdminUserRecord> {
    if (this.usersByUsername.has(input.username.toLowerCase())) {
      throw new AdminRepositoryError("conflict", "Admin username already exists", 409);
    }

    const record: AdminUserRecord = {
      id: newRowId(),
      username: input.username.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      disabledAt: null,
      createdAt: new Date(),
    };
    this.users.set(record.id, record);
    this.usersByUsername.set(record.username, record.id);
    return record;
  }

  async updateAdmin(id: string, input: UpdateAdminInput): Promise<AdminUserRecord> {
    const existing = this.users.get(id);
    if (!existing) {
      throw new AdminRepositoryError("not_found", "Admin account not found", 404);
    }

    const updated: AdminUserRecord = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      passwordHash: input.passwordHash ?? existing.passwordHash,
    };
    this.users.set(id, updated);
    return updated;
  }

  async setAdminDisabled(id: string, disabled: boolean): Promise<AdminUserRecord> {
    const existing = this.users.get(id);
    if (!existing) {
      throw new AdminRepositoryError("not_found", "Admin account not found", 404);
    }

    const updated: AdminUserRecord = {
      ...existing,
      disabledAt: disabled ? new Date() : null,
    };
    this.users.set(id, updated);
    return updated;
  }

  async countActiveAdmins(): Promise<number> {
    return [...this.users.values()].filter((user) => !user.disabledAt).length;
  }
}

function toAdminUserRecord(row: typeof schema.adminUsers.$inferSelect): AdminUserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}
