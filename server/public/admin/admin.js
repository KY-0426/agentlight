const STORAGE_KEY = "agent-light-admin-key";
const origin = window.location.origin.replace(/\/$/, "");

const loginPanel = document.getElementById("login-panel");
const adminPanel = document.getElementById("admin-panel");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminKeyInput = document.getElementById("admin-key-input");
const loginError = document.getElementById("login-error");
const createBtn = document.getElementById("create-btn");
const createCount = document.getElementById("create-count");
const createExpiresDays = document.getElementById("create-expires-days");
const createLabel = document.getElementById("create-label");
const createError = document.getElementById("create-error");
const createdCodes = document.getElementById("created-codes");
const createdCodesText = document.getElementById("created-codes-text");
const copyCodesBtn = document.getElementById("copy-codes-btn");
const downloadCodesBtn = document.getElementById("download-codes-btn");
const refreshListBtn = document.getElementById("refresh-list-btn");
const listStatus = document.getElementById("list-status");
const codesTableBody = document.getElementById("codes-table-body");
const listSummary = document.getElementById("list-summary");
const listError = document.getElementById("list-error");

let latestCreatedCodes = [];

function getAdminKey() {
  return sessionStorage.getItem(STORAGE_KEY) ?? "";
}

function setAdminKey(value) {
  if (value) {
    sessionStorage.setItem(STORAGE_KEY, value);
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

function showLoginError(message) {
  loginError.hidden = false;
  loginError.textContent = message;
}

function hideLoginError() {
  loginError.hidden = true;
  loginError.textContent = "";
}

function showPanel(loggedIn) {
  loginPanel.hidden = loggedIn;
  adminPanel.hidden = !loggedIn;
  logoutBtn.hidden = !loggedIn;
}

async function apiFetch(path, options = {}) {
  const adminKey = getAdminKey();
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey}`,
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `请求失败 (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function tail(value) {
  if (!value) {
    return "-";
  }
  return value.length <= 8 ? value : `…${value.slice(-4)}`;
}

function renderCodes(items, total) {
  codesTableBody.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${item.id.slice(0, 8)}…</code></td>
      <td>${item.status}</td>
      <td>${item.label ?? "-"}</td>
      <td>${formatDate(item.expires_at)}</td>
      <td>${formatDate(item.used_at)}</td>
      <td>${tail(item.activated_installation_id)}</td>
      <td>${item.status === "active" ? `<button type="button" data-revoke-id="${item.id}">作废</button>` : "-"}</td>
    `;
    codesTableBody.appendChild(row);
  }

  listSummary.textContent = `共 ${total} 条，当前显示 ${items.length} 条`;
}

async function refreshList() {
  listError.hidden = true;
  listError.textContent = "";
  const params = new URLSearchParams({ limit: "50", offset: "0" });
  if (listStatus.value) {
    params.set("status", listStatus.value);
  }

  const payload = await apiFetch(`/api/admin/activation-codes?${params.toString()}`);
  renderCodes(payload.data.items, payload.data.total);
}

async function createCodes() {
  createError.hidden = true;
  createError.textContent = "";
  createBtn.disabled = true;

  try {
    const body = {
      count: Number(createCount.value || 1),
    };
    const expiresDays = createExpiresDays.value.trim();
    if (expiresDays) {
      body.expires_in_days = Number(expiresDays);
    }
    const label = createLabel.value.trim();
    if (label) {
      body.label = label;
    }

    const payload = await apiFetch("/api/admin/activation-codes", {
      method: "POST",
      body: JSON.stringify(body),
    });

    latestCreatedCodes = payload.data.codes.map((entry) => entry.code);
    createdCodes.hidden = false;
    createdCodesText.textContent = latestCreatedCodes.join("\n");
    await refreshList();
  } catch (error) {
    createError.hidden = false;
    createError.textContent = error instanceof Error ? error.message : "生成失败";
  } finally {
    createBtn.disabled = false;
  }
}

async function revokeCode(id) {
  await apiFetch(`/api/admin/activation-codes/${id}/revoke`, { method: "POST", body: "{}" });
  await refreshList();
}

loginBtn?.addEventListener("click", async () => {
  hideLoginError();
  const key = adminKeyInput.value.trim();
  if (!key) {
    showLoginError("请输入 Admin Key");
    return;
  }

  setAdminKey(key);
  try {
    await refreshList();
    showPanel(true);
  } catch (error) {
    setAdminKey("");
    showLoginError(error instanceof Error ? error.message : "登录失败");
  }
});

logoutBtn?.addEventListener("click", () => {
  setAdminKey("");
  showPanel(false);
});

createBtn?.addEventListener("click", () => {
  void createCodes();
});

refreshListBtn?.addEventListener("click", () => {
  void refreshList().catch((error) => {
    listError.hidden = false;
    listError.textContent = error instanceof Error ? error.message : "加载失败";
  });
});

listStatus?.addEventListener("change", () => {
  void refreshList().catch((error) => {
    listError.hidden = false;
    listError.textContent = error instanceof Error ? error.message : "加载失败";
  });
});

copyCodesBtn?.addEventListener("click", async () => {
  if (latestCreatedCodes.length === 0) {
    return;
  }
  await navigator.clipboard.writeText(latestCreatedCodes.join("\n"));
  copyCodesBtn.textContent = "已复制";
  setTimeout(() => {
    copyCodesBtn.textContent = "复制全部";
  }, 1500);
});

downloadCodesBtn?.addEventListener("click", () => {
  if (latestCreatedCodes.length === 0) {
    return;
  }
  const blob = new Blob([`code\n${latestCreatedCodes.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "agent-light-activation-codes.csv";
  link.click();
  URL.revokeObjectURL(url);
});

codesTableBody?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const revokeId = target.dataset.revokeId;
  if (!revokeId) {
    return;
  }
  void revokeCode(revokeId).catch((error) => {
    listError.hidden = false;
    listError.textContent = error instanceof Error ? error.message : "作废失败";
  });
});

if (getAdminKey()) {
  adminKeyInput.value = getAdminKey();
  void refreshList()
    .then(() => showPanel(true))
    .catch(() => {
      setAdminKey("");
      showPanel(false);
    });
} else {
  showPanel(false);
}
