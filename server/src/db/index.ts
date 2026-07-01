import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { loadEnv } from "../config/env";
import * as schema from "./schema";

export function createDb(env = loadEnv()) {
  const pool = mysql.createPool(env.databaseUrl);

  return {
    db: drizzle(pool, { schema, mode: "default" }),
    pool,
  };
}

export { schema };
