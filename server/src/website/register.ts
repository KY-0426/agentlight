import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(moduleDir, "..", "..", "public");

export async function registerWebsite(app: FastifyInstance): Promise<void> {
  if (!existsSync(join(publicDir, "index.html"))) {
    app.log.warn({ publicDir }, "website public directory missing; skipping static site");
    return;
  }

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    index: ["index.html"],
    decorateReply: false,
  });
}
