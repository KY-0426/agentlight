import { buildApp } from "./app";
import { loadEnv } from "./config/env";

const env = loadEnv();
const app = await buildApp();

try {
  await app.listen({ host: env.host, port: env.port });
} catch (error) {
  app.log.error({ err: error }, "server failed to start");
  process.exit(1);
}
