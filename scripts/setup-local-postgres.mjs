import pg from "pg";

const adminPassword = process.env.POSTGRES_ADMIN_PASSWORD ?? "postgres";

const admin = new pg.Client({
  host: process.env.POSTGRES_HOST ?? "127.0.0.1",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  user: process.env.POSTGRES_ADMIN_USER ?? "postgres",
  password: adminPassword,
  database: "postgres",
});

await admin.connect();

const roleExists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'agent_light'");
if (roleExists.rowCount === 0) {
  await admin.query("CREATE ROLE agent_light LOGIN PASSWORD 'agent_light'");
  console.log("Created role agent_light");
} else {
  await admin.query("ALTER ROLE agent_light WITH LOGIN PASSWORD 'agent_light'");
  console.log("Updated role agent_light password");
}

const dbExists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'agent_light'");
if (dbExists.rowCount === 0) {
  await admin.query("CREATE DATABASE agent_light OWNER agent_light");
  console.log("Created database agent_light");
} else {
  console.log("Database agent_light already exists");
}

await admin.query("GRANT ALL PRIVILEGES ON DATABASE agent_light TO agent_light");
await admin.end();

const appUser = new pg.Client({
  host: "127.0.0.1",
  port: 5432,
  user: "agent_light",
  password: "agent_light",
  database: "agent_light",
});
await appUser.connect();
const check = await appUser.query("SELECT current_user, current_database()");
console.log("Verified:", check.rows[0]);
await appUser.end();
