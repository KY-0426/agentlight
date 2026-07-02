const API_ERROR_RULES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /validation_failed|Invalid leaderboard query|Invalid device bootstrap/i, message: "请求参数有误，请刷新后重试" },
  { pattern: /activation_code_required|Device must be activated/i, message: "请先完成激活，再开启云端同步" },
  { pattern: /activation_code_invalid|Activation code is invalid/i, message: "激活码无效或已过期" },
  { pattern: /activation_code_used|already been used/i, message: "激活码已被使用" },
  { pattern: /activation_code_revoked|revoked/i, message: "激活码已被作废" },
  { pattern: /activation_code_expired|\bexpired\b/i, message: "激活码已过期" },
  { pattern: /verification_code_invalid|verification_code_expired/i, message: "验证码无效或已过期" },
  { pattern: /unauthorized|Unauthorized/i, message: "登录已过期，请重新开启云端同步" },
  { pattern: /forbidden|Forbidden|access denied/i, message: "暂无权限，请确认账号状态" },
  { pattern: /rate_limited|Too many bootstrap/i, message: "操作过于频繁，请稍后再试" },
  { pattern: /Could not reach|activation_request_failed|无法连接激活/i, message: "无法连接服务器，请检查网络后重试" },
  { pattern: /接口返回\s+\d{3}/, message: "服务暂时不可用，请稍后重试" },
  { pattern: /排行榜响应|响应格式不正确|条目字段/i, message: "排行榜数据异常，请稍后重试" },
];

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function isTechnicalPassthrough(message: string): boolean {
  return (
    /接口返回\s+\d{3}/.test(message) ||
    /[a-z]+_[a-z_]+/.test(message) ||
    /^[A-Za-z0-9_\s.:,-]+$/.test(message)
  );
}

export function formatUserFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (!message) {
    return fallback;
  }

  if (containsCjk(message) && !isTechnicalPassthrough(message)) {
    return message;
  }

  for (const rule of API_ERROR_RULES) {
    if (rule.pattern.test(message)) {
      return rule.message;
    }
  }

  return fallback;
}
