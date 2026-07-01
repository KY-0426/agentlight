import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationPath = path.resolve("drizzle/0000_mysql_initial.sql");
const sql = fs.readFileSync(migrationPath, "utf8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((chunk) => chunk.trim())
  .filter(Boolean);

const conn = await mysql.createConnection(databaseUrl);

try {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
      \`id\` bigint NOT NULL AUTO_INCREMENT,
      \`hash\` text NOT NULL,
      \`created_at\` bigint,
      PRIMARY KEY (\`id\`)
    )
  `);

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    await conn.query(statement);
    console.log(`OK ${index + 1}/${statements.length}: ${statement.slice(0, 72).replace(/\s+/g, " ")}`);
  }

  await conn.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
    "0000_mysql_initial",
    Date.now(),
  ]);

  const [tables] = await conn.query("SHOW TABLES");
  console.log(`Done. ${tables.length} tables in database.`);
} finally {
  await conn.end();
}
