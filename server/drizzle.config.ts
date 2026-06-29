import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
  },
  strict: true,
  verbose: true,
});
