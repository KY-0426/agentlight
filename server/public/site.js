const origin = window.location.origin.replace(/\/$/, "");

const serverUrlEl = document.getElementById("server-url");
const healthLink = document.getElementById("health-link");
const healthPill = document.getElementById("health-pill");
const copyBtn = document.getElementById("copy-url");

if (serverUrlEl) {
  serverUrlEl.textContent = origin;
}

if (healthLink) {
  healthLink.href = `${origin}/health`;
}

copyBtn?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(origin);
    copyBtn.textContent = "已复制";
    setTimeout(() => {
      copyBtn.textContent = "复制";
    }, 1800);
  } catch {
    copyBtn.textContent = "复制失败";
  }
});

async function refreshHealth() {
  if (!healthPill) return;

  try {
    const response = await fetch(`${origin}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error("bad status");
    const payload = await response.json();
    healthPill.dataset.state = "ok";
    healthPill.textContent = payload.environment === "production" ? "云托管在线" : "服务在线";
  } catch {
    healthPill.dataset.state = "fail";
    healthPill.textContent = "服务离线";
  }
}

refreshHealth();
