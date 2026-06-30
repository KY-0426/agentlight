import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
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

export interface AdminRepository {
  findAdminByUsername(username: string): Promise<AdminUserRecord | undefined>;
  findAdminById(id: string): Promise<AdminUserRecord | undefined>;
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
