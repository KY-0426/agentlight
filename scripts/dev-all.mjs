import { spawn } from "node:child_process";

const commands = [
  ["desktop", "npm", ["run", "dev"]],
  ["server", "npm", ["run", "server:dev"]],
];

const children = commands.map(([label, command, args]) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on("exit", (code) => {
    if (code !== 0) {
      process.exitCode = code ?? 1;
      for (const other of children) {
        if (other !== child && other.exitCode === null) {
          other.kill("SIGTERM");
        }
      }
    }
  });

  return child;
});

process.on("SIGINT", () => {
  for (const child of children) {
    child.kill("SIGINT");
  }
});
