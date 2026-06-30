import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ApiErrorCode } from "@agent-light/shared";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

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
    const rows = await this.db
      .select()
      .from(schema.adminUsers)
      .where(sql`lower(${schema.adminUsers.username}) = lower(${username})`)
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
    const [countRow] = await this.db.select({ total: sql<number>`count(*)::int` }).from(schema.adminUsers);

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
    const [existing] = await this.db
      .select({ id: schema.adminUsers.id })
      .from(schema.adminUsers)
      .where(sql`lower(${schema.adminUsers.username}) = lower(${input.username})`)
      .limit(1);

    if (existing) {
      throw new AdminRepositoryError("conflict", "Admin username already exists", 409);
    }

    const [row] = await this.db
      .insert(schema.adminUsers)
      .values({
        username: input.username,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
      })
      .returning();

    return toAdminUserRecord(row);
  }

  async updateAdmin(id: string, input: UpdateAdminInput): Promise<AdminUserRecord> {
    const [existing] = await this.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, id)).limit(1);
    if (!existing) {
      throw new AdminRepositoryError("not_found", "Admin account not found", 404);
    }

    const [row] = await this.db
      .update(schema.adminUsers)
      .set({
        displayName: input.displayName ?? existing.displayName,
        passwordHash: input.passwordHash ?? existing.passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(schema.adminUsers.id, id))
      .returning();

    return toAdminUserRecord(row);
  }

  async setAdminDisabled(id: string, disabled: boolean): Promise<AdminUserRecord> {
    const [existing] = await this.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, id)).limit(1);
    if (!existing) {
      throw new AdminRepositoryError("not_found", "Admin account not found", 404);
    }

    const disabledAt = disabled ? new Date() : null;
    const [row] = await this.db
      .update(schema.adminUsers)
      .set({ disabledAt, updatedAt: new Date() })
      .where(eq(schema.adminUsers.id, id))
      .returning();

    return toAdminUserRecord(row);
  }

  async countActiveAdmins(): Promise<number> {
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
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
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      disabledAt: null,
      createdAt: new Date(),
    };
    this.users.set(record.id, record);
    this.usersByUsername.set(record.username.toLowerCase(), record.id);
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
