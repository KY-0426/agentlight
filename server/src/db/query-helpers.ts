import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

export function newRowId(): string {
  return randomUUID();
}

export const countStar = sql<number>`cast(count(*) as signed)`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchRowById<T>(db: any, table: any, id: string): Promise<T | undefined> {
  const [row] = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as T[];
  return row;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateRowById<T>(db: any, table: any, id: string, set: Record<string, unknown>): Promise<T> {
  await db.update(table).set(set).where(eq(table.id, id));
  const row = await fetchRowById<T>(db, table, id);
  if (!row) {
    throw new Error("Row not found after update");
  }
  return row;
}
