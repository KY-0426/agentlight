import { type FormEvent, useState } from "react";
import { resolveDefaultCloudServerUrl } from "../domain/leaderboard";
import { activateClient, isTauriRuntime } from "../tauriClient";

interface ActivationScreenProps {
  onActivated: () => void;
}

export function ActivationScreen({ onActivated }: ActivationScreenProps) {
  const [activationCode, setActivationCode] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isTauriRuntime()) {
      setStatus("error");
      setErrorMessage("请在 Win/Mac 桌面客户端中激活");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);
    try {
      await activateClient(resolveDefaultCloudServerUrl(), activationCode);
      setStatus("idle");
      onActivated();
    } catch (error) {
      setStatus("error");
      setErrorMessage(formatActivationError(error));
    }
  }

  return (
    <main className="activation-screen">
      <section className="activation-card" aria-labelledby="activation-heading">
        <p className="activation-card__eyebrow">Agent Light</p>
        <h1 id="activation-heading">激活客户端</h1>
        <p className="activation-card__lead">
          首次使用请输入客户激活码。激活成功后本机可离线使用桌宠、本地 API 与 CLI。
        </p>
        <form className="activation-form" onSubmit={(event) => void submit(event)}>
          <label className="activation-field">
            <span>客户激活码</span>
            <input
              type="text"
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value)}
              placeholder="例如 AL-XXXXXXXXXXXXXXXX"
              autoComplete="off"
              spellCheck={false}
              minLength={6}
              maxLength={64}
              required
            />
          </label>
          <button className="activation-submit" type="submit" disabled={status === "submitting"}>
            {status === "submitting" ? "激活中…" : "激活并进入"}
          </button>
          {status === "error" && errorMessage ? (
            <p className="activation-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}

function formatActivationError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.includes("activation_code_invalid") || message.includes("Activation code is invalid")) {
      return "激活码无效或已过期";
    }
    if (message.includes("activation_code_used") || message.includes("already been used")) {
      return "激活码已被使用";
    }
    if (message.includes("activation_code_revoked") || message.includes("revoked")) {
      return "激活码已被作废";
    }
    if (message.includes("activation_code_expired") || message.includes("expired")) {
      return "激活码已过期";
    }
    if (message.includes("Could not reach") || message.includes("activation_request_failed")) {
      return "无法连接激活服务器，请检查网络后重试";
    }
    return message || "激活失败，请稍后重试";
  }
  return "激活失败，请稍后重试";
}
