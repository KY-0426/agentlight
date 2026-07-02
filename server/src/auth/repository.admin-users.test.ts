import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";
import { countStar } from "../db/query-helpers";

describe("listUsersForAdmin device count query", () => {
  it("joins grouped device counts instead of using an ambiguous correlated subquery", () => {
    const db = drizzle(mysql.createPool("mysql://agent_light:agent_light@127.0.0.1:3306/agent_light"), {
      schema,
      mode: "default",
    });

    const deviceCountSubquery = db
      .select({
        userId: schema.devices.userId,
        deviceCount: countStar.as("device_count"),
      })
      .from(schema.devices)
      .groupBy(schema.devices.userId)
      .as("device_counts");

    const query = db
      .select({
        user: schema.users,
        deviceCount: sql<number>`coalesce(${deviceCountSubquery.deviceCount}, 0)`,
      })
      .from(schema.users)
      .leftJoin(deviceCountSubquery, eq(schema.users.id, deviceCountSubquery.userId))
      .limit(1);

    const sqlText = query.toSQL().sql;
    expect(sqlText).toContain("left join");
    expect(sqlText).toContain("group by");
    expect(sqlText).not.toContain("where `user_id` = `id`");
  });
});
