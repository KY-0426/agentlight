const STORAGE_KEY = "agent-light-admin-token";
const STORAGE_USER_KEY = "agent-light-admin-username";
const STORAGE_DISPLAY_KEY = "agent-light-admin-display-name";
const origin = window.location.origin.replace(/\/$/, "");
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{2,64}$/;

const VIEW_META = {
  codes: { eyebrow: "授权管理", title: "激活码" },
  users: { eyebrow: "用户管理", title: "终端用户" },
  admins: { eyebrow: "系统管理", title: "管理员账号" },
};

const USER_TYPE_LABELS = { email: "邮箱", phone: "手机", activation: "激活" };
const CODE_STATUS_LABELS = { active: "可用", used: "已使用", revoked: "已作废" };

let currentView = "codes";
let latestCreatedCodes = [];
let toastTimer = 0;
let usersSearchTimer = 0;
let sessionExpiredMessage = "";

const loginScreen = document.getElementById("login-screen");
const adminApp = document.getElementById("admin-app");
const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminUsernameInput = document.getElementById("admin-username-input");
const adminPasswordInput = document.getElementById("admin-password-input");
const loginError = document.getElementById("login-error");
const loginUsernameError = document.getElementById("login-username-error");
const loginPasswordError = document.getElementById("login-password-error");
const sidebarUsername = document.getElementById("sidebar-username");
const topbarEyebrow = document.getElementById("topbar-eyebrow");
const topbarTitle = document.getElementById("topbar-title");
const refreshAllBtn = document.getElementById("refresh-all-btn");
const adminToast = document.getElementById("admin-toast");

function getAdminToken() {
  return sessionStorage.getItem(STORAGE_KEY) ?? "";
}

function setAdminToken(value) {
  if (value) sessionStorage.setItem(STORAGE_KEY, value);
  else sessionStorage.removeItem(STORAGE_KEY);
}

function getStoredUsername() {
  return sessionStorage.getItem(STORAGE_USER_KEY) ?? "";
}

function setStoredUsername(value) {
  if (value) sessionStorage.setItem(STORAGE_USER_KEY, value);
  else sessionStorage.removeItem(STORAGE_USER_KEY);
}

function getStoredDisplayName() {
  return sessionStorage.getItem(STORAGE_DISPLAY_KEY) ?? "";
}

function setStoredDisplayName(value) {
  if (value) sessionStorage.setItem(STORAGE_DISPLAY_KEY, value);
  else sessionStorage.removeItem(STORAGE_DISPLAY_KEY);
}

function showToast(message, type = "success") {
  if (!adminToast) return;
  adminToast.hidden = false;
  adminToast.textContent = message;
  adminToast.className = `admin-toast${type === "success" ? " is-success" : ""}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    adminToast.hidden = true;
  }, 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  if (!value) return '<span class="admin-table__muted">—</span>';
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setFieldError(errorEl, fieldEl, message) {
  if (!errorEl || !fieldEl) return;
  if (message) {
    errorEl.hidden = false;
    errorEl.textContent = message;
    fieldEl.classList.add("is-invalid");
  } else {
    errorEl.hidden = true;
    errorEl.textContent = "";
    fieldEl.classList.remove("is-invalid");
  }
}

function validateLoginFields() {
  const username = adminUsernameInput.value.trim();
  const password = adminPasswordInput.value;
  let valid = true;

  if (!username) {
    setFieldError(loginUsernameError, document.getElementById("login-username-field"), "请输入账号");
    valid = false;
  } else if (!USERNAME_PATTERN.test(username)) {
    setFieldError(loginUsernameError, document.getElementById("login-username-field"), "账号格式不正确（2–64 位字母数字._-）");
    valid = false;
  } else {
    setFieldError(loginUsernameError, document.getElementById("login-username-field"), "");
  }

  if (!password) {
    setFieldError(loginPasswordError, document.getElementById("login-password-field"), "请输入密码");
    valid = false;
  } else {
    setFieldError(loginPasswordError, document.getElementById("login-password-field"), "");
  }

  return valid;
}

function setLoginLoading(loading) {
  loginBtn.disabled = loading;
  loginBtn.classList.toggle("is-loading", loading);
}

function showPanel(loggedIn) {
  loginScreen.hidden = loggedIn;
  adminApp.hidden = !loggedIn;
  if (loggedIn && sidebarUsername) {
    sidebarUsername.textContent = getStoredDisplayName() || getStoredUsername() || "admin";
  }
  if (!loggedIn && sessionExpiredMessage) {
    loginError.hidden = false;
    loginError.textContent = sessionExpiredMessage;
    sessionExpiredMessage = "";
  }
}

function switchView(viewId) {
  currentView = viewId;
  const meta = VIEW_META[viewId] ?? VIEW_META.codes;
  topbarEyebrow.textContent = meta.eyebrow;
  topbarTitle.textContent = meta.title;

  document.querySelectorAll(".admin-sidebar__nav-item[data-view], .admin-mobile-tabs__item[data-view]").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.view === viewId);
  });

  document.querySelectorAll(".admin-view").forEach((el) => {
    const active = el.dataset.view === viewId;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  });

  void refreshView(viewId);
}

async function refreshView(viewId) {
  if (viewId === "codes") await refreshCodesView();
  if (viewId === "users") await refreshUsersView();
  if (viewId === "admins") await refreshAdminsView();
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAdminToken()}`,
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    sessionExpiredMessage = "登录已过期，请重新登录";
    setAdminToken("");
    setStoredUsername("");
    setStoredDisplayName("");
    showPanel(false);
    throw new Error("登录已过期");
  }

  if (!response.ok) {
    const message = payload?.error?.message ?? `请求失败 (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

function statusBadge(kind, status) {
  const labels = kind === "code" ? CODE_STATUS_LABELS : { active: "正常", disabled: "已禁用", used: "已使用", revoked: "已作废" };
  const label = labels[status] ?? status;
  return `<span class="admin-badge admin-badge--${status}">${label}</span>`;
}

function userTypeBadge(type) {
  return `<span class="admin-badge admin-badge--type">${USER_TYPE_LABELS[type] ?? type}</span>`;
}

function setTableLoading(tbody, colspan, message = "加载中…") {
  tbody.innerHTML = `<tr class="admin-table__loading"><td colspan="${colspan}">${message}</td></tr>`;
}

function setTableEmpty(tbody, colspan, message = "暂无数据") {
  tbody.innerHTML = `<tr class="admin-table__empty"><td colspan="${colspan}">${message}</td></tr>`;
}

async function fetchCodeStat(status) {
  const params = new URLSearchParams({ limit: "1", offset: "0" });
  if (status) params.set("status", status);
  const payload = await apiFetch(`/api/admin/activation-codes?${params.toString()}`);
  return payload.data.total;
}

async function refreshCodeStats() {
  const [total, active, used, revoked] = await Promise.all([
    fetchCodeStat(""),
    fetchCodeStat("active"),
    fetchCodeStat("used"),
    fetchCodeStat("revoked"),
  ]);
  document.getElementById("stat-total").textContent = String(total);
  document.getElementById("stat-active").textContent = String(active);
  document.getElementById("stat-used").textContent = String(used);
  document.getElementById("stat-revoked").textContent = String(revoked);
}

function renderCodes(items, total) {
  const tbody = document.getElementById("codes-table-body");
  const summary = document.getElementById("list-summary");
  if (items.length === 0) {
    setTableEmpty(tbody, 7);
    summary.textContent = `共 ${total} 条`;
    return;
  }

  tbody.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("tr");
    const userCell = item.user_id
      ? `<button type="button" class="admin-link-button" data-open-user-id="${item.user_id}">查看用户</button>`
      : '<span class="admin-table__muted">—</span>';
    row.innerHTML = `
      <td><code>${item.id.slice(0, 8)}…</code></td>
      <td>${statusBadge("code", item.status)}</td>
      <td>${item.label ? escapeHtml(item.label) : '<span class="admin-table__muted">—</span>'}</td>
      <td>${userCell}</td>
      <td>${formatDate(item.expires_at)}</td>
      <td>${formatDate(item.used_at)}</td>
      <td>${item.status === "active" ? `<button type="button" class="admin-button admin-button--danger admin-button--sm" data-revoke-id="${item.id}">作废</button>` : '<span class="admin-table__muted">—</span>'}</td>
    `;
    tbody.appendChild(row);
  }
  summary.textContent = `共 ${total} 条，当前显示 ${items.length} 条`;
}

async function refreshCodeList() {
  const listError = document.getElementById("list-error");
  listError.hidden = true;
  setTableLoading(document.getElementById("codes-table-body"), 7);

  const params = new URLSearchParams({ limit: "50", offset: "0" });
  const status = document.getElementById("list-status").value;
  if (status) params.set("status", status);

  const payload = await apiFetch(`/api/admin/activation-codes?${params.toString()}`);
  renderCodes(payload.data.items, payload.data.total);
}

async function refreshCodesView() {
  await Promise.all([refreshCodeStats(), refreshCodeList()]);
}

async function createCodes() {
  const createError = document.getElementById("create-error");
  const createBtn = document.getElementById("create-btn");
  createError.hidden = true;
  createBtn.disabled = true;

  try {
    const body = { count: Number(document.getElementById("create-count").value || 1) };
    const expiresDays = document.getElementById("create-expires-days").value.trim();
    if (expiresDays) body.expires_in_days = Number(expiresDays);
    const label = document.getElementById("create-label").value.trim();
    if (label) body.label = label;

    const payload = await apiFetch("/api/admin/activation-codes", {
      method: "POST",
      body: JSON.stringify(body),
    });

    latestCreatedCodes = payload.data.codes.map((entry) => entry.code);
    const createdCodes = document.getElementById("created-codes");
    createdCodes.hidden = false;
    document.getElementById("created-codes-text").textContent = latestCreatedCodes.join("\n");
    showToast(`已生成 ${latestCreatedCodes.length} 个激活码`);
    await refreshCodesView();
  } catch (error) {
    createError.hidden = false;
    createError.textContent = error instanceof Error ? error.message : "生成失败";
  } finally {
    createBtn.disabled = false;
  }
}

async function revokeCode(id) {
  if (!window.confirm("确定作废此激活码？")) return;
  await apiFetch(`/api/admin/activation-codes/${id}/revoke`, { method: "POST", body: "{}" });
  showToast("激活码已作废");
  await refreshCodesView();
}

async function fetchUserStat(status) {
  const params = new URLSearchParams({ limit: "1", offset: "0" });
  if (status) params.set("status", status);
  const payload = await apiFetch(`/api/admin/users?${params.toString()}`);
  return payload.data.total;
}

async function refreshUserStats() {
  const [total, active, disabled] = await Promise.all([
    fetchUserStat(""),
    fetchUserStat("active"),
    fetchUserStat("disabled"),
  ]);
  document.getElementById("user-stat-total").textContent = String(total);
  document.getElementById("user-stat-active").textContent = String(active);
  document.getElementById("user-stat-disabled").textContent = String(disabled);
}

function renderUsers(items, total) {
  const tbody = document.getElementById("users-table-body");
  const summary = document.getElementById("users-list-summary");
  if (items.length === 0) {
    setTableEmpty(tbody, 7, "没有匹配的用户");
    summary.textContent = `共 ${total} 条`;
    return;
  }

  tbody.innerHTML = "";
  for (const item of items) {
    const account = item.phone_number || item.email;
    const disabled = Boolean(item.disabled_at);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.display_name)}</td>
      <td>${userTypeBadge(item.user_type)}</td>
      <td><span class="admin-table__account" title="${escapeHtml(account)}">${escapeHtml(account)}</span></td>
      <td>${item.device_count}</td>
      <td>${disabled ? statusBadge("user", "disabled") : statusBadge("user", "active")}</td>
      <td>${formatDate(item.created_at)}</td>
      <td>
        <button type="button" class="admin-button admin-button--ghost admin-button--sm" data-view-user-id="${item.id}">详情</button>
        ${disabled
          ? `<button type="button" class="admin-button admin-button--ghost admin-button--sm" data-enable-user-id="${item.id}">启用</button>`
          : `<button type="button" class="admin-button admin-button--danger admin-button--sm" data-disable-user-id="${item.id}">禁用</button>`}
      </td>
    `;
    tbody.appendChild(row);
  }
  summary.textContent = `共 ${total} 条，当前显示 ${items.length} 条`;
}

async function refreshUserList() {
  const listError = document.getElementById("users-list-error");
  listError.hidden = true;
  setTableLoading(document.getElementById("users-table-body"), 7);

  const params = new URLSearchParams({ limit: "50", offset: "0" });
  const q = document.getElementById("users-search").value.trim();
  const type = document.getElementById("users-type").value;
  const status = document.getElementById("users-status").value;
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  if (status) params.set("status", status);

  const payload = await apiFetch(`/api/admin/users?${params.toString()}`);
  renderUsers(payload.data.items, payload.data.total);
}

async function refreshUsersView() {
  await Promise.all([refreshUserStats(), refreshUserList()]);
}

async function showUserDetail(userId) {
  const panel = document.getElementById("user-detail-panel");
  const content = document.getElementById("user-detail-content");
  panel.hidden = false;
  content.innerHTML = '<p class="admin-note">加载中…</p>';

  const payload = await apiFetch(`/api/admin/users/${userId}`);
  const { user, devices, activation_code: activationCode } = payload.data;

  document.getElementById("user-detail-title").textContent = user.display_name;
  document.getElementById("user-detail-subtitle").textContent = user.email;

  const devicesHtml =
    devices.length === 0
      ? '<p class="admin-note">暂无设备</p>'
      : `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Installation</th><th>平台</th><th>版本</th><th>最近活跃</th></tr></thead><tbody>${devices
          .map(
            (device) => `<tr>
              <td><code>${escapeHtml(device.installation_id.slice(0, 12))}…</code></td>
              <td>${device.platform}</td>
              <td>${escapeHtml(device.app_version)}</td>
              <td>${formatDate(device.last_seen_at || device.created_at)}</td>
            </tr>`,
          )
          .join("")}</tbody></table></div>`;

  const activationHtml = activationCode
    ? `<p>激活码 <code>${activationCode.id.slice(0, 8)}…</code> · ${statusBadge("code", activationCode.status)} · ${formatDate(activationCode.used_at)}</p>`
    : '<p class="admin-note">无关联激活码</p>';

  content.innerHTML = `
    <div class="admin-detail-grid">
      <div><span class="admin-detail-label">类型</span>${userTypeBadge(user.user_type)}</div>
      <div><span class="admin-detail-label">状态</span>${user.disabled_at ? statusBadge("user", "disabled") : statusBadge("user", "active")}</div>
      <div><span class="admin-detail-label">手机</span>${user.phone_number ? escapeHtml(user.phone_number) : "—"}</div>
      <div><span class="admin-detail-label">设备数</span>${user.device_count}</div>
    </div>
    <h3 class="admin-detail-section">设备</h3>
    ${devicesHtml}
    <h3 class="admin-detail-section">激活码</h3>
    ${activationHtml}
    <div class="admin-inline-actions">
      ${user.disabled_at
        ? `<button type="button" class="admin-button admin-button--ghost" data-enable-user-id="${user.id}">启用用户</button>`
        : `<button type="button" class="admin-button admin-button--danger" data-disable-user-id="${user.id}">禁用用户</button>`}
    </div>
  `;
}

async function setUserDisabled(userId, disabled) {
  const action = disabled ? "disable" : "enable";
  const label = disabled ? "禁用" : "启用";
  if (!window.confirm(`确定${label}此用户？`)) return;

  await apiFetch(`/api/admin/users/${userId}/${action}`, { method: "POST", body: "{}" });
  showToast(`用户已${label}`);
  document.getElementById("user-detail-panel").hidden = true;
  await refreshUsersView();
}

function renderAdmins(items, total) {
  const tbody = document.getElementById("admins-table-body");
  const summary = document.getElementById("admins-list-summary");
  if (items.length === 0) {
    setTableEmpty(tbody, 5);
    summary.textContent = `共 ${total} 条`;
    return;
  }

  tbody.innerHTML = "";
  for (const item of items) {
    const disabled = Boolean(item.disabled_at);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${escapeHtml(item.username)}</code></td>
      <td>${escapeHtml(item.display_name)}</td>
      <td>${disabled ? statusBadge("user", "disabled") : statusBadge("user", "active")}</td>
      <td>${formatDate(item.created_at)}</td>
      <td>
        <button type="button" class="admin-button admin-button--ghost admin-button--sm" data-reset-admin-id="${item.id}">改密</button>
        ${disabled
          ? `<button type="button" class="admin-button admin-button--ghost admin-button--sm" data-enable-admin-id="${item.id}">启用</button>`
          : `<button type="button" class="admin-button admin-button--danger admin-button--sm" data-disable-admin-id="${item.id}">禁用</button>`}
      </td>
    `;
    tbody.appendChild(row);
  }
  summary.textContent = `共 ${total} 条，当前显示 ${items.length} 条`;
}

async function refreshAdminsView() {
  const listError = document.getElementById("admins-list-error");
  listError.hidden = true;
  setTableLoading(document.getElementById("admins-table-body"), 5);

  const payload = await apiFetch("/api/admin/admins?limit=50&offset=0");
  renderAdmins(payload.data.items, payload.data.total);
}

function validateCreateAdminForm() {
  const username = document.getElementById("create-admin-username").value.trim();
  const displayName = document.getElementById("create-admin-display-name").value.trim();
  const password = document.getElementById("create-admin-password").value;
  let valid = true;

  if (!USERNAME_PATTERN.test(username)) {
    document.getElementById("create-admin-username-error").hidden = false;
    document.getElementById("create-admin-username-error").textContent = "用户名格式不正确";
    valid = false;
  } else {
    document.getElementById("create-admin-username-error").hidden = true;
  }

  if (!displayName) {
    document.getElementById("create-admin-display-name-error").hidden = false;
    document.getElementById("create-admin-display-name-error").textContent = "请输入显示名";
    valid = false;
  } else {
    document.getElementById("create-admin-display-name-error").hidden = true;
  }

  if (password.length < 12) {
    document.getElementById("create-admin-password-error").hidden = false;
    document.getElementById("create-admin-password-error").textContent = "密码至少 12 位";
    valid = false;
  } else {
    document.getElementById("create-admin-password-error").hidden = true;
  }

  return valid;
}

async function createAdminAccount(event) {
  event.preventDefault();
  const createError = document.getElementById("create-admin-error");
  createError.hidden = true;
  if (!validateCreateAdminForm()) return;

  try {
    await apiFetch("/api/admin/admins", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("create-admin-username").value.trim(),
        display_name: document.getElementById("create-admin-display-name").value.trim(),
        password: document.getElementById("create-admin-password").value,
      }),
    });
    document.getElementById("create-admin-form").reset();
    showToast("管理员已创建");
    await refreshAdminsView();
  } catch (error) {
    createError.hidden = false;
    createError.textContent = error instanceof Error ? error.message : "创建失败";
  }
}

async function resetAdminPassword(adminId) {
  const password = window.prompt("输入新密码（至少 12 位）");
  if (!password) return;
  if (password.length < 12) {
    showToast("密码至少 12 位", "error");
    return;
  }

  await apiFetch(`/api/admin/admins/${adminId}`, {
    method: "PATCH",
    body: JSON.stringify({ password }),
  });
  showToast("密码已更新");
}

async function setAdminDisabled(adminId, disabled) {
  const action = disabled ? "disable" : "enable";
  const label = disabled ? "禁用" : "启用";
  if (!window.confirm(`确定${label}此管理员？`)) return;

  await apiFetch(`/api/admin/admins/${adminId}/${action}`, { method: "POST", body: "{}" });
  showToast(`管理员已${label}`);
  await refreshAdminsView();
}

async function login() {
  loginError.hidden = true;
  if (!validateLoginFields()) return;

  setLoginLoading(true);
  try {
    const response = await fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        username: adminUsernameInput.value.trim(),
        password: adminPasswordInput.value,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "登录失败，请检查账号和密码");
    }

    setAdminToken(payload.data.access_token);
    setStoredUsername(payload.data.username ?? adminUsernameInput.value.trim());
    setStoredDisplayName(payload.data.display_name ?? "");
    adminPasswordInput.value = "";
    showPanel(true);
    switchView("codes");
    showToast("登录成功");
  } catch (error) {
    setAdminToken("");
    loginError.hidden = false;
    loginError.textContent = error instanceof Error ? error.message : "登录失败";
  } finally {
    setLoginLoading(false);
  }
}

loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void login();
});

adminUsernameInput?.addEventListener("blur", validateLoginFields);
adminPasswordInput?.addEventListener("blur", validateLoginFields);

logoutBtn?.addEventListener("click", () => {
  setAdminToken("");
  setStoredUsername("");
  setStoredDisplayName("");
  document.getElementById("created-codes").hidden = true;
  latestCreatedCodes = [];
  showPanel(false);
});

document.querySelectorAll(".admin-sidebar__nav-item[data-view], .admin-mobile-tabs__item[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view ?? "codes"));
});

refreshAllBtn?.addEventListener("click", () => {
  void refreshView(currentView).catch((error) => showToast(error instanceof Error ? error.message : "刷新失败", "error"));
});

document.getElementById("create-btn")?.addEventListener("click", () => void createCodes());
document.getElementById("refresh-list-btn")?.addEventListener("click", () => void refreshCodeList().catch(handleCodesListError));
document.getElementById("list-status")?.addEventListener("change", () => void refreshCodeList().catch(handleCodesListError));
document.getElementById("refresh-users-btn")?.addEventListener("click", () => void refreshUsersView().catch(handleUsersListError));
document.getElementById("users-type")?.addEventListener("change", () => void refreshUserList().catch(handleUsersListError));
document.getElementById("users-status")?.addEventListener("change", () => void refreshUserList().catch(handleUsersListError));
document.getElementById("users-search")?.addEventListener("input", () => {
  window.clearTimeout(usersSearchTimer);
  usersSearchTimer = window.setTimeout(() => {
    void refreshUserList().catch(handleUsersListError);
  }, 300);
});
document.getElementById("refresh-admins-btn")?.addEventListener("click", () => void refreshAdminsView().catch(handleAdminsListError));
document.getElementById("create-admin-form")?.addEventListener("submit", (event) => void createAdminAccount(event));
document.getElementById("close-user-detail-btn")?.addEventListener("click", () => {
  document.getElementById("user-detail-panel").hidden = true;
});

document.getElementById("copy-codes-btn")?.addEventListener("click", async () => {
  if (latestCreatedCodes.length === 0) return;
  await navigator.clipboard.writeText(latestCreatedCodes.join("\n"));
  showToast("已复制到剪贴板");
});

document.getElementById("download-codes-btn")?.addEventListener("click", () => {
  if (latestCreatedCodes.length === 0) return;
  const blob = new Blob([`code\n${latestCreatedCodes.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "agent-light-activation-codes.csv";
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV 已下载");
});

document.getElementById("codes-table-body")?.addEventListener("click", (event) => {
  handleActionClick(event, {
    "revoke-id": (id) => void revokeCode(id).catch(handleCodesListError),
    "open-user-id": (id) => {
      switchView("users");
      void showUserDetail(id).catch(handleUsersListError);
    },
  });
});

document.getElementById("users-table-body")?.addEventListener("click", (event) => {
  handleActionClick(event, {
    "view-user-id": (id) => void showUserDetail(id).catch(handleUsersListError),
    "disable-user-id": (id) => void setUserDisabled(id, true).catch(handleUsersListError),
    "enable-user-id": (id) => void setUserDisabled(id, false).catch(handleUsersListError),
  });
});

document.getElementById("user-detail-content")?.addEventListener("click", (event) => {
  handleActionClick(event, {
    "disable-user-id": (id) => void setUserDisabled(id, true).catch(handleUsersListError),
    "enable-user-id": (id) => void setUserDisabled(id, false).catch(handleUsersListError),
  });
});

document.getElementById("admins-table-body")?.addEventListener("click", (event) => {
  handleActionClick(event, {
    "reset-admin-id": (id) => void resetAdminPassword(id).catch(handleAdminsListError),
    "disable-admin-id": (id) => void setAdminDisabled(id, true).catch(handleAdminsListError),
    "enable-admin-id": (id) => void setAdminDisabled(id, false).catch(handleAdminsListError),
  });
});

function handleActionClick(event, handlers) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button");
  if (!(button instanceof HTMLButtonElement)) return;

  for (const [datasetKey, handler] of Object.entries(handlers)) {
    const camelKey = datasetKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const id = button.dataset[camelKey];
    if (id) {
      handler(id);
      return;
    }
  }
}

function handleCodesListError(error) {
  const listError = document.getElementById("list-error");
  listError.hidden = false;
  listError.textContent = error instanceof Error ? error.message : "加载失败";
}

function handleUsersListError(error) {
  const listError = document.getElementById("users-list-error");
  listError.hidden = false;
  listError.textContent = error instanceof Error ? error.message : "加载失败";
}

function handleAdminsListError(error) {
  const listError = document.getElementById("admins-list-error");
  listError.hidden = false;
  listError.textContent = error instanceof Error ? error.message : "加载失败";
}

if (getAdminToken()) {
  void refreshCodesView()
    .then(() => {
      showPanel(true);
      switchView("codes");
    })
    .catch(() => {
      sessionExpiredMessage = "会话已失效，请重新登录";
      setAdminToken("");
      showPanel(false);
    });
} else {
  showPanel(false);
}
