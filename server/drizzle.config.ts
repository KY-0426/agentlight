import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://agent_light:agent_light@127.0.0.1:3306/agent_light",
  },
  strict: true,
  verbose: true,
});
