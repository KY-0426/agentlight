#!/usr/bin/env node

import { normalizeAgentStatus } from "@agent-light/shared";

const API_BASE = process.env.AGENT_LIGHT_URL ?? "http://127.0.0.1:18765";

async function main() {
  const [command, state, ...messageParts] = process.argv.slice(2);

  if (command === "status") {
    await printStatus();
    return;
  }

  if (command !== "state" || !state) {
    printUsage(1);
    return;
  }

  const normalizedState = normalizeAgentStatus(state);
  if (!normalizedState) {
    console.error(`Invalid state: ${state}`);
    printUsage(1);
    return;
  }

  const message = messageParts.join(" ").trim();
  const response = await fetch(`${API_BASE}/api/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      state: normalizedState,
      message: message.length > 0 ? message : undefined,
    }),
  });

  await printJsonResponse(response);
}

async function printStatus() {
  const response = await fetch(`${API_BASE}/api/state`);
  await printJsonResponse(response);
}

async function printJsonResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    console.error(text);
    process.exitCode = 1;
    return;
  }

  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

function printUsage(exitCode) {
  console.log(`Usage:
  agent-light state <standby|working|completed|attention> [message]
  agent-light status

Examples:
  agent-light state completed "任务完成"
  agent-light state attention "需要人工处理"

Legacy aliases are accepted:
  idle -> standby, running -> working, success -> completed, error/needs_action -> attention`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`agent-light CLI failed: ${error.message}`);
  process.exitCode = 1;
});
