export type AppView = "main" | "settings" | "hardware-dev" | "activation";

export type ShellView = Exclude<AppView, "activation">;

export function getAppView(): AppView {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "hardware-dev" && params.get("dev") === "hardware") {
    return "hardware-dev";
  }
  if (params.get("view") === "settings") {
    return "settings";
  }
  if (params.get("view") === "activation") {
    return "activation";
  }
  return "main";
}

export function getShellView(): ShellView {
  const view = getAppView();
  return view === "activation" ? "main" : view;
}
