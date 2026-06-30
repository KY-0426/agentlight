const STORAGE_KEY = "agent-light-admin-token";
const STORAGE_USER_KEY = "agent-light-admin-username";
const origin = window.location.origin.replace(/\/$/, "");

const loginScreen = document.getElementById("login-screen");
const adminApp = document.getElementById("admin-app");
const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminUsernameInput = document.getElementById("admin-username-input");
const adminPasswordInput = document.getElementById("admin-password-input");
const loginError = document.getElementById("login-error");
const sidebarUsername = document.getElementById("sidebar-username");
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
const refreshAllBtn = document.getElementById("refresh-all-btn");
const listStatus = document.getElementById("list-status");
const codesTableBody = document.getElementById("codes-table-body");
const listSummary = document.getElementById("list-summary");
const listError = document.getElementById("list-error");
const statTotal = document.getElementById("stat-total");
const statActive = document.getElementById("stat-active");
const statUsed = document.getElementById("stat-used");
const statRevoked = document.getElementById("stat-revoked");
const adminToast = document.getElementById("admin-toast");

let latestCreatedCodes = [];
let toastTimer = 0;

const STATUS_LABELS = {
  active: "可用",
  used: "已使用",
  revoked: "已作废",
};

function formatApiError(payload, status) {
  const code = payload?.error?.code;
  if (code === "activation_code_used") {
    return "该激活码已被使用，无法作废";
  }
  if (code === "not_found") {
    return "激活码不存在";
  }
  return payload?.error?.message ?? `请求失败 (${status})`;
}

function getAdminToken() {
  return sessionStorage.getItem(STORAGE_KEY) ?? "";
}

function setAdminToken(value) {
  if (value) {
    sessionStorage.setItem(STORAGE_KEY, value);
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

function getStoredUsername() {
  return sessionStorage.getItem(STORAGE_USER_KEY) ?? "admin";
}

function setStoredUsername(value) {
  if (value) {
    sessionStorage.setItem(STORAGE_USER_KEY, value);
  } else {
    sessionStorage.removeItem(STORAGE_USER_KEY);
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

function showToast(message, type = "success") {
  if (!adminToast) {
    return;
  }
  adminToast.hidden = false;
  adminToast.textContent = message;
  adminToast.className = `admin-toast${type === "success" ? " is-success" : ""}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    adminToast.hidden = true;
  }, 2600);
}

function showPanel(loggedIn) {
  loginScreen.hidden = loggedIn;
  adminApp.hidden = !loggedIn;
  if (loggedIn && sidebarUsername) {
    sidebarUsername.textContent = getStoredUsername();
  }
}

function setTableLoading() {
  codesTableBody.innerHTML = `<tr class="admin-table__loading"><td colspan="7">加载中…</td></tr>`;
}

function setTableEmpty(message = "暂无数据") {
  codesTableBody.innerHTML = `<tr class="admin-table__empty"><td colspan="7">${message}</td></tr>`;
}

async function apiFetch(path, options = {}) {
  const adminToken = getAdminToken();
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(formatApiError(payload, response.status));
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return '<span class="admin-table__muted">—</span>';
  }
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tail(value) {
  if (!value) {
    return '<span class="admin-table__muted">—</span>';
  }
  const text = value.length <= 10 ? value : `…${value.slice(-6)}`;
  return `<code title="${value}">${text}</code>`;
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] ?? status;
  return `<span class="admin-badge admin-badge--${status}">${label}</span>`;
}

function renderCodes(items, total) {
  if (items.length === 0) {
    setTableEmpty("没有匹配的激活码");
    listSummary.textContent = `共 ${total} 条`;
    return;
  }

  codesTableBody.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${item.id.slice(0, 8)}…</code></td>
      <td>${statusBadge(item.status)}</td>
      <td>${item.label ? escapeHtml(item.label) : '<span class="admin-table__muted">—</span>'}</td>
      <td>${formatDate(item.expires_at)}</td>
      <td>${formatDate(item.used_at)}</td>
      <td>${tail(item.activated_installation_id)}</td>
      <td>${
        item.status === "active"
          ? `<button type="button" class="admin-button admin-button--danger admin-button--sm" data-revoke-id="${item.id}">作废</button>`
          : '<span class="admin-table__muted">—</span>'
      }</td>
    `;
    codesTableBody.appendChild(row);
  }

  listSummary.textContent = `共 ${total} 条，当前显示 ${items.length} 条`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchStat(status) {
  const params = new URLSearchParams({ limit: "1", offset: "0" });
  if (status) {
    params.set("status", status);
  }
  const payload = await apiFetch(`/api/admin/activation-codes?${params.toString()}`);
  return payload.data.total;
}

async function refreshStats() {
  const [total, active, used, revoked] = await Promise.all([
    fetchStat(""),
    fetchStat("active"),
    fetchStat("used"),
    fetchStat("revoked"),
  ]);
  statTotal.textContent = String(total);
  statActive.textContent = String(active);
  statUsed.textContent = String(used);
  statRevoked.textContent = String(revoked);
}

async function refreshList() {
  listError.hidden = true;
  listError.textContent = "";
  setTableLoading();

  const params = new URLSearchParams({ limit: "50", offset: "0" });
  if (listStatus.value) {
    params.set("status", listStatus.value);
  }

  const payload = await apiFetch(`/api/admin/activation-codes?${params.toString()}`);
  renderCodes(payload.data.items, payload.data.total);
}

async function refreshAll() {
  await Promise.all([refreshStats(), refreshList()]);
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
    showToast(`已生成 ${latestCreatedCodes.length} 个激活码`);
    await refreshAll();
  } catch (error) {
    createError.hidden = false;
    createError.textContent = error instanceof Error ? error.message : "生成失败";
  } finally {
    createBtn.disabled = false;
  }
}

async function revokeCode(id) {
  const confirmed = window.confirm("确定作废此激活码？作废后不可恢复。");
  if (!confirmed) {
    return;
  }

  await apiFetch(`/api/admin/activation-codes/${id}/revoke`, { method: "POST", body: "{}" });
  showToast("激活码已作废");
  await refreshAll();
}

async function login() {
  hideLoginError();
  const username = adminUsernameInput.value.trim();
  const password = adminPasswordInput.value;
  if (!username || !password) {
    showLoginError("请输入账号和密码");
    return;
  }

  loginBtn.disabled = true;
  try {
    const response = await fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "登录失败");
    }

    setAdminToken(payload.data.access_token);
    setStoredUsername(payload.data.username ?? username);
    adminPasswordInput.value = "";
    await refreshAll();
    showPanel(true);
    showToast("登录成功");
  } catch (error) {
    setAdminToken("");
    showLoginError(error instanceof Error ? error.message : "登录失败");
  } finally {
    loginBtn.disabled = false;
  }
}

loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void login();
});

logoutBtn?.addEventListener("click", () => {
  setAdminToken("");
  setStoredUsername("");
  createdCodes.hidden = true;
  latestCreatedCodes = [];
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

refreshAllBtn?.addEventListener("click", () => {
  void refreshAll().catch((error) => {
    listError.hidden = false;
    listError.textContent = error instanceof Error ? error.message : "刷新失败";
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
  showToast("已复制到剪贴板");
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
  showToast("CSV 已下载");
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
  void revokeCode(revokeId).catch(async (error) => {
    listError.hidden = false;
    listError.textContent = error instanceof Error ? error.message : "作废失败";
    try {
      await refreshAll();
    } catch {
      // ignore refresh errors after revoke failure
    }
  });
});

if (getAdminToken()) {
  void refreshAll()
    .then(() => showPanel(true))
    .catch(() => {
      setAdminToken("");
      showPanel(false);
    });
} else {
  showPanel(false);
}
