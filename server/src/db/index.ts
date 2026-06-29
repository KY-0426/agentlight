import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "../config/env";
import * as schema from "./schema";

export function createDb(env = loadEnv()) {
  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

export { schema };
