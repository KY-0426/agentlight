import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ActivationApp } from "./ActivationApp";
import App from "./App";
import { getAppView } from "./appView";
import "./styles.css";
import "./settings-panel.css";

const RootApp = getAppView() === "activation" ? ActivationApp : App;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
